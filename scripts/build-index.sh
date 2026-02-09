#!/bin/bash

set -euo pipefail

# Build index.json from docs/sboms/ directory structure
# Reads metadata.json for canonical product names

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SBOM_DIR="$REPO_ROOT/docs/sboms"
INDEX_FILE="$SBOM_DIR/index.json"
CONFIG_FILE="$REPO_ROOT/config/products.yml"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Fetch download count from npm
fetch_npm_downloads() {
    local package="$1"
    local count=$(curl -s "https://api.npmjs.org/downloads/point/last-year/$package" | jq -r '.downloads // 0')
    echo "$count"
}

# Fetch download count from PyPI
fetch_pypi_downloads() {
    local package="$1"
    # PyPI doesn't have a public API for download counts anymore
    # Use pypistats.org API which aggregates BigQuery data
    local count=$(curl -s "https://pypistats.org/api/packages/$package/recent?period=year" | jq -r '.data.last_year // 0')
    echo "$count"
}

# Fetch download count from Maven Central
fetch_maven_downloads() {
    local group_id="$1"
    local artifact_id="$2"
    # Maven Central stats from mvnrepository.com scraping or use a proxy
    # Note: Maven Central doesn't have official download count API
    # We'll return 0 for now or implement scraping if needed
    echo "0"
}

# Fetch download count from NuGet
fetch_nuget_downloads() {
    local package="$1"
    local count=$(curl -s "https://azuresearch-usnc.nuget.org/query?q=packageid:$package&prerelease=false" | jq -r '.data[0].totalDownloads // 0')
    echo "$count"
}

# Get download count based on product source
get_download_count() {
    local product_name="$1"
    local source="$2"

    case "$source" in
        npm)
            local npm_package=$(yq eval ".products[] | select(.name == \"$product_name\") | .npm_package" "$CONFIG_FILE" 2>/dev/null)
            if [[ -n "$npm_package" && "$npm_package" != "null" ]]; then
                fetch_npm_downloads "$npm_package"
            else
                echo "0"
            fi
            ;;
        pypi)
            local pypi_package=$(yq eval ".products[] | select(.name == \"$product_name\") | .pypi_package" "$CONFIG_FILE" 2>/dev/null)
            if [[ -n "$pypi_package" && "$pypi_package" != "null" ]]; then
                fetch_pypi_downloads "$pypi_package"
            else
                echo "0"
            fi
            ;;
        maven)
            local group_id=$(yq eval ".products[] | select(.name == \"$product_name\") | .maven_group_id" "$CONFIG_FILE" 2>/dev/null)
            local artifact_id=$(yq eval ".products[] | select(.name == \"$product_name\") | .maven_artifact_id" "$CONFIG_FILE" 2>/dev/null)
            if [[ -n "$group_id" && "$group_id" != "null" && -n "$artifact_id" && "$artifact_id" != "null" ]]; then
                fetch_maven_downloads "$group_id" "$artifact_id"
            else
                echo "0"
            fi
            ;;
        nuget)
            local nuget_package=$(yq eval ".products[] | select(.name == \"$product_name\") | .nuget_package" "$CONFIG_FILE" 2>/dev/null)
            if [[ -n "$nuget_package" && "$nuget_package" != "null" ]]; then
                fetch_nuget_downloads "$nuget_package"
            else
                echo "0"
            fi
            ;;
        *)
            echo "0"
            ;;
    esac
}

echo "Building SBOM index..."

# Check if sboms directory exists
if [[ ! -d "$SBOM_DIR" ]]; then
    echo -e "${RED}ERROR: $SBOM_DIR not found${NC}"
    exit 1
fi

# Initialize index
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TEMP_INDEX=$(mktemp)

# Start JSON
cat > "$TEMP_INDEX" <<EOF
{
  "generated": "$TIMESTAMP",
  "products": [
EOF

FIRST_PRODUCT=true

# Scan each product directory
for product_dir in "$SBOM_DIR"/*/; do
    [[ ! -d "$product_dir" ]] && continue

    product_slug=$(basename "$product_dir")

    # Skip if this is the index.json itself or other files
    [[ "$product_slug" == "index.json" ]] && continue

    # Read metadata.json
    metadata_file="$product_dir/metadata.json"
    if [[ ! -f "$metadata_file" ]]; then
        echo -e "${YELLOW}WARNING: No metadata.json for $product_slug, skipping${NC}"
        continue
    fi

    product_name=$(jq -r '.name' "$metadata_file")
    product_source=$(jq -r '.source' "$metadata_file")

    echo "  Processing: $product_name ($product_slug)"

    # Fetch download count (directly, no timeout for now)
    echo "    Fetching download count..."
    download_count=$(get_download_count "$product_name" "$product_source" 2>/dev/null || echo "0")
    if [[ "$download_count" =~ ^[0-9]+$ ]]; then
        echo "    Downloads: $download_count"
    else
        download_count="0"
        echo "    Downloads: unavailable (using 0)"
    fi

    # Add comma if not first product
    if [[ "$FIRST_PRODUCT" == "false" ]]; then
        echo "," >> "$TEMP_INDEX"
    fi
    FIRST_PRODUCT=false

    # Start product object
    cat >> "$TEMP_INDEX" <<EOF
    {
      "name": "$product_name",
      "slug": "$product_slug",
      "source": "$product_source",
      "downloadCount": $download_count,
      "versions": [
EOF

    FIRST_VERSION=true
    version_count=0

    # Collect and sort versions
    declare -a versions=()
    for version_dir in "$product_dir"/*/; do
        [[ ! -d "$version_dir" ]] && continue

        version_name=$(basename "$version_dir")

        # Check if SBOMs exist
        spdx_file="$version_dir/sbom.spdx.json"
        cyclonedx_file="$version_dir/sbom.cyclonedx.json"

        if [[ ! -f "$spdx_file" && ! -f "$cyclonedx_file" ]]; then
            continue
        fi

        # Get timestamp from file (best effort)
        if [[ -f "$spdx_file" ]]; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                generated_at=$(stat -f "%Sm" -t "%Y-%m-%dT%H:%M:%SZ" "$spdx_file")
            else
                generated_at=$(date -u -r "$spdx_file" +"%Y-%m-%dT%H:%M:%SZ")
            fi
        else
            generated_at="$TIMESTAMP"
        fi

        # Determine which formats are available
        formats=()
        [[ -f "$spdx_file" ]] && formats+=("spdx")
        [[ -f "$cyclonedx_file" ]] && formats+=("cyclonedx")
        formats_json=$(printf '%s\n' "${formats[@]}" | jq -R . | jq -sc .)

        versions+=("$version_name|$generated_at|$formats_json")
    done

    # Sort versions (reverse semver-like sort, newest first)
    if [[ ${#versions[@]} -gt 0 ]]; then
        IFS=$'\n' sorted_versions=($(printf '%s\n' "${versions[@]}" | sort -t. -k1,1nr -k2,2nr -k3,3nr))
    else
        sorted_versions=()
    fi

    # Output each version
    for version_data in "${sorted_versions[@]+"${sorted_versions[@]}"}"; do
        IFS='|' read -r version_name generated_at formats_json <<< "$version_data"

        version_count=$((version_count + 1))

        # Add comma if not first version
        if [[ "$FIRST_VERSION" == "false" ]]; then
            echo "," >> "$TEMP_INDEX"
        fi
        FIRST_VERSION=false

        # Output version object
        cat >> "$TEMP_INDEX" <<EOF
        {
          "version": "$version_name",
          "generatedAt": "$generated_at",
          "formats": $formats_json
        }
EOF
    done

    # Close versions array and product object
    cat >> "$TEMP_INDEX" <<EOF
      ]
    }
EOF

    echo "    Added $version_count versions"
done

# Close products array and root object
cat >> "$TEMP_INDEX" <<EOF
  ]
}
EOF

# Validate JSON
if ! jq empty "$TEMP_INDEX" 2>/dev/null; then
    echo -e "${RED}ERROR: Generated invalid JSON${NC}"
    cat "$TEMP_INDEX"
    rm "$TEMP_INDEX"
    exit 1
fi

# Move to final location
mv "$TEMP_INDEX" "$INDEX_FILE"

# Print summary
product_count=$(jq '.products | length' "$INDEX_FILE")
total_versions=$(jq '[.products[].versions | length] | add' "$INDEX_FILE")

echo ""
echo -e "${GREEN}✓ Index built successfully${NC}"
echo "  Products: $product_count"
echo "  Total versions: $total_versions"
echo "  Output: $INDEX_FILE"
