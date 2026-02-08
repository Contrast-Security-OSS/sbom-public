#!/bin/bash

set -euo pipefail

# Unified SBOM Fetch and Generation Script
# Validates config, fetches artifacts from all sources, generates SBOMs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/config/products.yml}"
SBOM_DIR="$REPO_ROOT/docs/sboms"
TEMP_DIR="$REPO_ROOT/temp"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

validate_config() {
    echo "Validating configuration..."

    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo -e "${RED}ERROR: Config file not found: $CONFIG_FILE${NC}"
        exit 1
    fi

    # Check if products array exists and is not empty
    local product_count=$(yq eval '.products | length' "$CONFIG_FILE")
    if [[ "$product_count" == "0" || "$product_count" == "null" ]]; then
        echo -e "${RED}ERROR: No products defined in $CONFIG_FILE${NC}"
        exit 1
    fi

    echo "  Found $product_count products"

    # Validate each product
    local seen_names=()
    for ((i=0; i<product_count; i++)); do
        validate_product "$i" seen_names
    done

    echo -e "${GREEN}✓ Configuration valid${NC}"
}

validate_product() {
    local index=$1
    local -n seen=$2

    local name=$(yq eval ".products[$index].name" "$CONFIG_FILE")
    local source=$(yq eval ".products[$index].source" "$CONFIG_FILE")
    local max_versions=$(yq eval ".products[$index].max_versions" "$CONFIG_FILE")

    # Check required fields
    if [[ "$name" == "null" || -z "$name" ]]; then
        echo -e "${RED}ERROR: Product $index missing 'name'${NC}"
        exit 1
    fi

    if [[ "$source" == "null" || -z "$source" ]]; then
        echo -e "${RED}ERROR: Product '$name' missing 'source'${NC}"
        exit 1
    fi

    if [[ "$max_versions" == "null" || ! "$max_versions" =~ ^[0-9]+$ || "$max_versions" -lt 1 ]]; then
        echo -e "${RED}ERROR: Product '$name' has invalid 'max_versions': $max_versions${NC}"
        exit 1
    fi

    # Check source type
    if [[ ! "$source" =~ ^(s3|maven|artifactory)$ ]]; then
        echo -e "${RED}ERROR: Product '$name' has invalid source type: $source${NC}"
        exit 1
    fi

    # Check for path traversal
    if [[ "$name" =~ \.\./|\.\.$ || "$name" =~ ^\.\. ]]; then
        echo -e "${RED}ERROR: Product name contains path traversal: $name${NC}"
        exit 1
    fi

    # Check for duplicate names
    for seen_name in "${seen[@]}"; do
        if [[ "$seen_name" == "$name" ]]; then
            echo -e "${RED}ERROR: Duplicate product name: $name${NC}"
            exit 1
        fi
    done
    seen+=("$name")

    # Validate source-specific fields
    case "$source" in
        s3)
            local pattern=$(yq eval ".products[$index].artifact_pattern" "$CONFIG_FILE")
            if [[ "$pattern" == "null" || -z "$pattern" ]]; then
                echo -e "${RED}ERROR: S3 product '$name' missing 'artifact_pattern'${NC}"
                exit 1
            fi
            ;;
        maven)
            local group_id=$(yq eval ".products[$index].maven_group_id" "$CONFIG_FILE")
            local artifact_id=$(yq eval ".products[$index].maven_artifact_id" "$CONFIG_FILE")
            if [[ "$group_id" == "null" || -z "$group_id" ]]; then
                echo -e "${RED}ERROR: Maven product '$name' missing 'maven_group_id'${NC}"
                exit 1
            fi
            if [[ "$artifact_id" == "null" || -z "$artifact_id" ]]; then
                echo -e "${RED}ERROR: Maven product '$name' missing 'maven_artifact_id'${NC}"
                exit 1
            fi
            ;;
        artifactory)
            local path=$(yq eval ".products[$index].artifactory_path" "$CONFIG_FILE")
            local pattern=$(yq eval ".products[$index].artifact_pattern" "$CONFIG_FILE")
            if [[ "$path" == "null" || -z "$path" ]]; then
                echo -e "${RED}ERROR: Artifactory product '$name' missing 'artifactory_path'${NC}"
                exit 1
            fi
            if [[ "$pattern" == "null" || -z "$pattern" ]]; then
                echo -e "${RED}ERROR: Artifactory product '$name' missing 'artifact_pattern'${NC}"
                exit 1
            fi
            ;;
    esac
}

sanitize_slug() {
    local name="$1"
    # Keep only alphanumeric, spaces, hyphens, and dots
    # Convert to lowercase, replace spaces with hyphens, remove leading/trailing hyphens
    echo "$name" | tr -cd 'a-zA-Z0-9 .-' | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/^-*//' | sed 's/-*$//' | sed 's/--*/-/g'
}

# ============================================================================
# FETCH FUNCTIONS
# ============================================================================

fetch_s3() {
    local product_json="$1"
    local slug="$2"

    local name=$(echo "$product_json" | jq -r '.name')
    local pattern=$(echo "$product_json" | jq -r '.artifact_pattern')
    local max_versions=$(echo "$product_json" | jq -r '.max_versions')

    # PROTECTION: Check if SBOMs already exist for this product
    # This prevents overwriting manually-committed SBOMs
    local existing_sboms=$(find "$SBOM_DIR/$slug" -mindepth 2 -name "sbom.*.json" 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$existing_sboms" -gt 0 ]]; then
        echo -e "${YELLOW}  ⚠ Found $existing_sboms existing SBOM(s) - SKIPPING fetch to preserve manual SBOMs${NC}" >&2
        echo "  To regenerate, delete $SBOM_DIR/$slug/* first" >&2
        return
    fi

    # Check environment variables - only need public URL now
    if [[ -z "${S3_PUBLIC_URL:-}" ]]; then
        echo -e "${RED}ERROR: S3_PUBLIC_URL must be set${NC}"
        exit 2
    fi

    # Extract bucket and prefix from S3_PUBLIC_URL
    # Example: https://bucket.s3.region.amazonaws.com/path/ -> bucket, path/
    local bucket_url="$S3_PUBLIC_URL"

    echo "  Listing S3 (anonymous): $bucket_url" >&2

    # Try to list bucket using anonymous S3 XML API
    # This works if the bucket allows public ListBucket
    local listing=$(curl -s "$bucket_url" || echo "")

    # If XML listing is available, parse it
    if [[ "$listing" =~ \<Key\> ]]; then
        echo "  Using S3 XML API listing..." >&2
        # Extract <Key> elements from XML and filter by pattern
        local grep_pattern=$(echo "$pattern" | sed 's/\*/.*/')
        local files=$(echo "$listing" | grep -oP '<Key>\K[^<]+' | grep -E "$grep_pattern" | sed 's|.*/||' | sort -r | head -n "$max_versions")
    else
        echo -e "${YELLOW}  Cannot list bucket anonymously. Trying known version pattern...${NC}"
        # Fallback: Try constructing filenames from version_list
        # This requires the user to have a version_list in products.yml
        local version_list=$(echo "$product_json" | jq -r '.version_list[]?' 2>/dev/null)
        if [[ -n "$version_list" ]]; then
            echo "  Using version_list from config..." >&2

            # Try to list all files to do soft matching
            local all_files=$(curl -s "$bucket_url" | grep -oP '<Key>\K[^<]+' | sed 's|.*/||' || echo "")

            local files=""
            while IFS= read -r version_num; do
                [[ -z "$version_num" ]] && continue

                # Try to find a file that contains this version number
                if [[ -n "$all_files" ]]; then
                    # Soft match: find files containing the version number
                    local matched_file=$(echo "$all_files" | grep -E "[-_]${version_num}[-_\.]" | head -1)
                    if [[ -n "$matched_file" ]]; then
                        files+="$matched_file"$'\n'
                        continue
                    fi
                fi

                # If no listing available or no match, try constructing filename from pattern
                # Replace (.*) in pattern with the version number
                local constructed_file=$(echo "$pattern" | sed -E "s/\\\\\\./-/g; s/\(\.\*\)/${version_num}/g; s/\\\\\./\./g")

                # Test if constructed file exists with HEAD request
                if curl -sI -f "${bucket_url}${constructed_file}" > /dev/null 2>&1; then
                    files+="$constructed_file"$'\n'
                fi
            done <<< "$version_list"
            files=$(echo "$files" | head -n "$max_versions")
        else
            echo -e "${RED}ERROR: Cannot list S3 bucket anonymously and no version_list provided${NC}"
            echo "  Add 'version_list' to products.yml with known version numbers, or enable public listing on S3 bucket"
            return
        fi
    fi

    if [[ -z "$files" ]]; then
        echo -e "${YELLOW}  No files found matching pattern: $pattern${NC}" >&2
        return
    fi

    local count=$(echo "$files" | wc -l | tr -d ' ')
    echo "  Found $count file(s)" >&2

    # Download and process each file
    while IFS= read -r filename; do
        [[ -z "$filename" ]] && continue

        # Extract version
        local version=$(echo "$filename" | sed -E 's/.*-([0-9]+\.[0-9]+\.[0-9]+).*/\1/')
        if [[ -z "$version" || "$version" == "$filename" ]]; then
            version=$(echo "$filename" | sed 's/\.[^.]*$//' | sed 's/.*-//')
        fi

        echo "    Version: $version - $filename" >&2

        # Download
        local download_path="$TEMP_DIR/$slug-$version-$(basename "$filename")"
        if curl -f -s "${S3_PUBLIC_URL}${filename}" -o "$download_path"; then
            echo "$download_path|$version"
        else
            echo -e "${YELLOW}      Failed to download $filename${NC}" >&2
        fi
    done <<< "$files"
}

fetch_maven() {
    local product_json="$1"
    local slug="$2"

    local name=$(echo "$product_json" | jq -r '.name')
    local group_id=$(echo "$product_json" | jq -r '.maven_group_id')
    local artifact_id=$(echo "$product_json" | jq -r '.maven_artifact_id')
    local max_versions=$(echo "$product_json" | jq -r '.max_versions')

    echo "  Maven Central: $group_id:$artifact_id" >&2

    # Construct Maven URL
    local group_path=$(echo "$group_id" | tr '.' '/')
    local maven_base="https://repo1.maven.org/maven2/${group_path}/${artifact_id}"
    local metadata_url="${maven_base}/maven-metadata.xml"

    # Fetch metadata
    local metadata=$(curl -s "$metadata_url")
    if [[ -z "$metadata" ]]; then
        echo -e "${YELLOW}  Failed to fetch metadata from Maven Central${NC}" >&2
        return
    fi

    # Extract versions
    local versions=$(echo "$metadata" | grep -o '<version>[^<]*</version>' | sed 's/<version>//g' | sed 's/<\/version>//g' | sort -V -r | head -n "$max_versions")

    if [[ -z "$versions" ]]; then
        echo -e "${YELLOW}  No versions found${NC}" >&2
        return
    fi

    local count=$(echo "$versions" | wc -l | tr -d ' ')
    echo "  Found $count version(s)" >&2

    # Download each version
    while IFS= read -r version; do
        [[ -z "$version" ]] && continue

        local filename="${artifact_id}-${version}.jar"
        local download_url="${maven_base}/${version}/${filename}"
        local download_path="$TEMP_DIR/$slug-$version-${filename}"

        echo "    Version: $version - $filename" >&2

        if curl -f -s "$download_url" -o "$download_path"; then
            echo "$download_path|$version"
        else
            echo -e "${YELLOW}      Failed to download $filename${NC}" >&2
        fi
    done <<< "$versions"
}

fetch_artifactory() {
    local product_json="$1"
    local slug="$2"

    local name=$(echo "$product_json" | jq -r '.name')
    local artifactory_path=$(echo "$product_json" | jq -r '.artifactory_path')
    local pattern=$(echo "$product_json" | jq -r '.artifact_pattern')
    local max_versions=$(echo "$product_json" | jq -r '.max_versions')

    # Check environment variables
    if [[ -z "${ARTIFACTORY_URL:-}" ]]; then
        echo -e "${RED}ERROR: ARTIFACTORY_URL must be set${NC}" >&2
        exit 2
    fi

    # Authentication is optional for public repositories
    if [[ -n "${ARTIFACTORY_TOKEN:-}" ]] || [[ -n "${ARTIFACTORY_USER:-}" ]]; then
        echo "  Artifactory (REST API, authenticated): $artifactory_path" >&2
    else
        echo "  Artifactory (REST API, anonymous): $artifactory_path" >&2
    fi

    echo "  Pattern: $pattern" >&2

    # Use REST API to list repository contents
    # artifactory_path can be:
    # - Just repo name: "flex-agent-release" (list root)
    # - Repo with path: "cli/linux" (list that subpath)

    local storage_url="$ARTIFACTORY_URL/api/storage/$artifactory_path"
    echo "  Storage URL: $storage_url" >&2

    # Get directory listing with optional auth
    local listing
    if [[ -n "${ARTIFACTORY_TOKEN:-}" ]]; then
        listing=$(curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$storage_url" 2>/dev/null || echo '{}')
    elif [[ -n "${ARTIFACTORY_USER:-}" ]]; then
        listing=$(curl -s -u "$ARTIFACTORY_USER:$ARTIFACTORY_PASSWORD" "$storage_url" 2>/dev/null || echo '{}')
    else
        listing=$(curl -s "$storage_url" 2>/dev/null || echo '{}')
    fi

    if ! echo "$listing" | jq -e '.children' > /dev/null 2>&1; then
        echo -e "${YELLOW}  Could not list repository (may not exist or no access)${NC}" >&2
        echo "  Response: ${listing:0:300}" >&2
        return
    fi

    # Get version folders, sort by version number (descending), limit to max_versions
    local version_folders=$(echo "$listing" | jq -r '.children[] | select(.folder == true) | .uri' | \
        sed 's|^/||' | \
        grep -E '^[0-9]+\.[0-9]+' | \
        sort -V -r | \
        head -n "$max_versions")

    if [[ -z "$version_folders" ]]; then
        echo -e "${YELLOW}  No version folders found${NC}" >&2
        return
    fi

    local count=$(echo "$version_folders" | wc -l | tr -d ' ')
    echo "  Found $count version(s)" >&2

    # For each version folder, list files and download matches
    while IFS= read -r version; do
        [[ -z "$version" ]] && continue

        local version_url="$ARTIFACTORY_URL/api/storage/$artifactory_path/$version"

        # Get files in version directory
        local files
        if [[ -n "${ARTIFACTORY_TOKEN:-}" ]]; then
            files=$(curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$version_url" 2>/dev/null || echo '{}')
        elif [[ -n "${ARTIFACTORY_USER:-}" ]]; then
            files=$(curl -s -u "$ARTIFACTORY_USER:$ARTIFACTORY_PASSWORD" "$version_url" 2>/dev/null || echo '{}')
        else
            files=$(curl -s "$version_url" 2>/dev/null || echo '{}')
        fi

        # Find files matching pattern (convert shell glob to grep pattern)
        local grep_pattern=$(echo "$pattern" | sed 's/\*/.*/')
        local matched_files=$(echo "$files" | jq -r '.children[]? | select(.folder == false) | .uri' | sed 's|^/||' | grep -E "^$grep_pattern$" || true)

        if [[ -z "$matched_files" ]]; then
            continue
        fi

        # Download each matching file
        while IFS= read -r filename; do
            [[ -z "$filename" ]] && continue

            echo "    Version: $version - $filename" >&2

            local download_url="$ARTIFACTORY_URL/$artifactory_path/$version/$filename"
            local download_path="$TEMP_DIR/$slug-$version-$filename"

            # Download with optional authentication
            local download_success=false
            if [[ -n "${ARTIFACTORY_TOKEN:-}" ]]; then
                if curl -f -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$download_url" -o "$download_path" 2>/dev/null; then
                    download_success=true
                fi
            elif [[ -n "${ARTIFACTORY_USER:-}" ]]; then
                if curl -f -s -u "$ARTIFACTORY_USER:$ARTIFACTORY_PASSWORD" "$download_url" -o "$download_path" 2>/dev/null; then
                    download_success=true
                fi
            else
                # Anonymous download
                if curl -f -s "$download_url" -o "$download_path" 2>/dev/null; then
                    download_success=true
                fi
            fi

            if [[ "$download_success" == "true" ]]; then
                echo "$download_path|$version"
            else
                echo -e "${YELLOW}      Failed to download $filename${NC}" >&2
            fi
        done <<< "$matched_files"
    done <<< "$version_folders"
}

# ============================================================================
# SBOM GENERATION
# ============================================================================

generate_sboms_for_artifact() {
    local artifact_path="$1"
    local version="$2"
    local product_slug="$3"

    local version_dir="$SBOM_DIR/$product_slug/$version"
    mkdir -p "$version_dir"

    local spdx_output="$version_dir/sbom.spdx.json"
    local cyclonedx_output="$version_dir/sbom.cyclonedx.json"

    echo "      Generating SPDX..."
    if syft packages "$artifact_path" -q -o spdx-json="$spdx_output" 2>/dev/null; then
        echo -e "${GREEN}      ✓ SPDX generated${NC}"
    else
        echo -e "${YELLOW}      ✗ SPDX generation failed${NC}"
        echo '{"error": "SBOM generation failed"}' > "$spdx_output"
    fi

    echo "      Generating CycloneDX..."
    if syft packages "$artifact_path" -q -o cyclonedx-json="$cyclonedx_output" 2>/dev/null; then
        echo -e "${GREEN}      ✓ CycloneDX generated${NC}"
    else
        echo -e "${YELLOW}      ✗ CycloneDX generation failed${NC}"
        echo '{"error": "SBOM generation failed"}' > "$cyclonedx_output"
    fi
}

write_metadata() {
    local product_name="$1"
    local product_slug="$2"
    local source="$3"

    local metadata_file="$SBOM_DIR/$product_slug/metadata.json"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    cat > "$metadata_file" <<EOF
{
  "name": "$product_name",
  "slug": "$product_slug",
  "source": "$source",
  "generatedAt": "$timestamp"
}
EOF

    echo "  Wrote metadata.json"
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    echo "================================================"
    echo " SBOM Fetch and Generation"
    echo "================================================"
    echo ""

    # Install dependencies
    if ! command -v yq &> /dev/null; then
        echo "Installing yq..."
        YQ_VERSION="v4.35.1"
        YQ_BINARY="yq_linux_amd64"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            YQ_BINARY="yq_darwin_amd64"
        fi
        wget -q "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/${YQ_BINARY}" -O /tmp/yq
        chmod +x /tmp/yq
        sudo mv /tmp/yq /usr/local/bin/yq
    fi

    if ! command -v syft &> /dev/null; then
        echo "Installing Syft..."
        curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin
    fi

    # Validate configuration
    validate_config
    echo ""

    # Create directories
    mkdir -p "$SBOM_DIR"
    mkdir -p "$TEMP_DIR"

    # Process each product
    local product_count=$(yq eval '.products | length' "$CONFIG_FILE")

    for ((i=0; i<product_count; i++)); do
        # Read product config as JSON
        local product_json=$(yq eval ".products[$i]" -o=json "$CONFIG_FILE")
        local name=$(echo "$product_json" | jq -r '.name')
        local source=$(echo "$product_json" | jq -r '.source')

        echo "================================================"
        echo "Product: $name (source: $source)"
        echo "================================================"

        # Generate slug
        local slug=$(sanitize_slug "$name")
        echo "  Slug: $slug"

        # Create product directory
        mkdir -p "$SBOM_DIR/$slug"

        # Write metadata
        write_metadata "$name" "$slug" "$source"

        # Fetch artifacts based on source
        local artifacts=""
        case "$source" in
            s3)
                artifacts=$(fetch_s3 "$product_json" "$slug")
                ;;
            maven)
                artifacts=$(fetch_maven "$product_json" "$slug")
                ;;
            artifactory)
                artifacts=$(fetch_artifactory "$product_json" "$slug")
                ;;
        esac

        # Generate SBOMs for each artifact
        if [[ -n "$artifacts" ]]; then
            while IFS='|' read -r artifact_path version; do
                [[ -z "$artifact_path" ]] && continue
                echo "    Generating SBOM for version: $version"
                generate_sboms_for_artifact "$artifact_path" "$version" "$slug"
                # Clean up artifact
                rm -f "$artifact_path"
            done <<< "$artifacts"
        else
            echo -e "${YELLOW}  No artifacts fetched${NC}"
        fi

        echo ""
    done

    # Clean up temp directory
    rm -rf "$TEMP_DIR"

    echo "================================================"
    echo -e "${GREEN}✓ SBOM generation complete!${NC}"
    echo "================================================"
}

# Run main
main

