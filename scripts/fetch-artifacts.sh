#!/bin/bash

set -euo pipefail

# Fetch artifacts from Artifactory based on products.yml configuration
# Requires: ARTIFACTORY_URL and ARTIFACTORY_TOKEN environment variables

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$REPO_ROOT/config/products.yml"
TEMP_DIR="$REPO_ROOT/temp"
MANIFEST_FILE="$TEMP_DIR/manifest.json"

# Check required environment variables
if [[ -z "${ARTIFACTORY_URL:-}" ]]; then
    echo "Error: ARTIFACTORY_URL environment variable not set"
    exit 1
fi

if [[ -z "${ARTIFACTORY_TOKEN:-}" ]]; then
    echo "Error: ARTIFACTORY_TOKEN environment variable not set"
    exit 1
fi

# Install yq if not present (for YAML parsing)
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

# Clean and create temp directory
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

echo "Starting artifact fetch from Artifactory..."
echo "Config file: $CONFIG_FILE"
echo "Artifactory URL: $ARTIFACTORY_URL"

# Initialize manifest
echo '{"products": []}' > "$MANIFEST_FILE"

# Get number of products
PRODUCT_COUNT=$(yq eval '.products | length' "$CONFIG_FILE")
echo "Found $PRODUCT_COUNT products in configuration"

# Process each product
for ((i=0; i<PRODUCT_COUNT; i++)); do
    PRODUCT_NAME=$(yq eval ".products[$i].name" "$CONFIG_FILE")
    DIRECT_URL=$(yq eval ".products[$i].direct_download_url" "$CONFIG_FILE")
    PATTERN=$(yq eval ".products[$i].artifact_pattern" "$CONFIG_FILE")

    echo ""
    echo "Processing: $PRODUCT_NAME"

    # Create product directory
    PRODUCT_SLUG=$(echo "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    PRODUCT_DIR="$TEMP_DIR/$PRODUCT_SLUG"
    mkdir -p "$PRODUCT_DIR"

    # Check if this is a direct download product
    if [[ "$DIRECT_URL" != "null" && -n "$DIRECT_URL" ]]; then
        echo "  Direct download from: $DIRECT_URL"

        VERSION="latest"
        VERSION_DIR="$PRODUCT_DIR/$VERSION"
        mkdir -p "$VERSION_DIR"

        # Extract filename from pattern or URL
        ARTIFACT_NAME="contrast-agent-latest.jar"
        if [[ "$PATTERN" == *"*"* ]]; then
            # Use pattern to determine filename
            ARTIFACT_NAME=$(echo "$PATTERN" | sed 's/\*/latest/')
        fi

        echo "  Downloading: $ARTIFACT_NAME"

        # Download with redirect following
        if curl -L -f -s "$DIRECT_URL" -o "$VERSION_DIR/$ARTIFACT_NAME"; then
            echo "  Successfully downloaded"

            # Add to manifest
            TEMP_MANIFEST=$(mktemp)
            jq --arg name "$PRODUCT_NAME" \
               --arg version "$VERSION" \
               --arg artifact "$VERSION_DIR/$ARTIFACT_NAME" \
               '.products += [{"name": $name, "version": $version, "artifact": $artifact}]' \
               "$MANIFEST_FILE" > "$TEMP_MANIFEST"
            mv "$TEMP_MANIFEST" "$MANIFEST_FILE"
        else
            echo "  Error: Failed to download from $DIRECT_URL"
        fi

        continue
    fi

    # Check if this is an S3 bucket product
    S3_BUCKET_URL=$(yq eval ".products[$i].s3_bucket_url" "$CONFIG_FILE")
    S3_PUBLIC_URL=$(yq eval ".products[$i].s3_public_url" "$CONFIG_FILE")
    MAX_VERSIONS=$(yq eval ".products[$i].max_versions" "$CONFIG_FILE")

    if [[ "$S3_BUCKET_URL" != "null" && -n "$S3_BUCKET_URL" ]]; then
        echo "  S3 bucket: $S3_BUCKET_URL"

        # Check if AWS CLI is available
        if ! command -v aws &> /dev/null; then
            echo "  Error: AWS CLI not installed. Install with: pip install awscli"
            continue
        fi

        # List files in S3 bucket matching pattern
        echo "  Listing files matching pattern: $PATTERN"

        # Convert wildcard pattern to grep pattern
        GREP_PATTERN=$(echo "$PATTERN" | sed 's/\*/.*/')

        # List and filter files, sort by name (which includes date)
        S3_FILES=$(aws s3 ls "$S3_BUCKET_URL" | grep -E "$GREP_PATTERN" | awk '{print $4}' | sort -r)

        if [[ -z "$S3_FILES" ]]; then
            echo "  No files found matching pattern"
            continue
        fi

        # Limit to max versions if specified
        if [[ "$MAX_VERSIONS" != "null" && "$MAX_VERSIONS" -gt 0 ]]; then
            S3_FILES=$(echo "$S3_FILES" | head -n "$MAX_VERSIONS")
        fi

        echo "  Found $(echo "$S3_FILES" | wc -l | tr -d ' ') file(s)"

        # Download each file
        while IFS= read -r FILENAME; do
            [[ -z "$FILENAME" ]] && continue

            # Extract version from filename (e.g., Contrast-3.12.0.20260207.hash.war -> 3.12.0)
            VERSION=$(echo "$FILENAME" | sed -E 's/Contrast-([0-9]+\.[0-9]+\.[0-9]+).*/\1/')

            # If version extraction fails, use the full filename as version
            if [[ -z "$VERSION" || "$VERSION" == "$FILENAME" ]]; then
                VERSION=$(echo "$FILENAME" | sed 's/\.war$//' | sed 's/Contrast-//')
            fi

            echo "  Version: $VERSION"
            VERSION_DIR="$PRODUCT_DIR/$VERSION"
            mkdir -p "$VERSION_DIR"

            # Download from S3
            DOWNLOAD_URL="${S3_PUBLIC_URL}${FILENAME}"
            echo "    Downloading: $FILENAME"

            if curl -f -s "$DOWNLOAD_URL" -o "$VERSION_DIR/$FILENAME"; then
                echo "    Successfully downloaded"

                # Add to manifest
                TEMP_MANIFEST=$(mktemp)
                jq --arg name "$PRODUCT_NAME" \
                   --arg version "$VERSION" \
                   --arg artifact "$VERSION_DIR/$FILENAME" \
                   '.products += [{"name": $name, "version": $version, "artifact": $artifact}]' \
                   "$MANIFEST_FILE" > "$TEMP_MANIFEST"
                mv "$TEMP_MANIFEST" "$MANIFEST_FILE"
            else
                echo "    Error: Failed to download $FILENAME"
            fi

        done <<< "$S3_FILES"

        continue
    fi

    # Standard Artifactory download path
    REPO=$(yq eval ".products[$i].artifactory_repo" "$CONFIG_FILE")
    PATH_PREFIX=$(yq eval ".products[$i].artifactory_path" "$CONFIG_FILE")

    echo "  Repository: $REPO"
    echo "  Path: $PATH_PREFIX"
    echo "  Pattern: $PATTERN"

    # Get exclude patterns if any
    EXCLUDE_PATTERNS=()
    EXCLUDE_COUNT=$(yq eval ".products[$i].exclude_patterns | length" "$CONFIG_FILE")
    if [[ "$EXCLUDE_COUNT" != "0" && "$EXCLUDE_COUNT" != "null" ]]; then
        for ((j=0; j<EXCLUDE_COUNT; j++)); do
            EXCLUDE_PATTERN=$(yq eval ".products[$i].exclude_patterns[$j]" "$CONFIG_FILE")
            EXCLUDE_PATTERNS+=("$EXCLUDE_PATTERN")
            echo "  Exclude: $EXCLUDE_PATTERN"
        done
    fi

    # Query Artifactory for versions
    API_URL="$ARTIFACTORY_URL/api/storage/$REPO/$PATH_PREFIX"
    echo "  Querying: $API_URL"

    RESPONSE=$(curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$API_URL" || echo '{}')

    # Parse version directories
    VERSIONS=$(echo "$RESPONSE" | jq -r '.children[]? | select(.folder == true) | .uri' | tr -d '/')

    if [[ -z "$VERSIONS" ]]; then
        echo "  Warning: No versions found, searching recursively for artifacts..."

        # Use AQL to recursively search for artifacts
        AQL_QUERY='{
            "repo": "'$REPO'",
            "path": {"$match": "'$PATH_PREFIX'/*"},
            "name": {"$match": "'$PATTERN'"}
        }'

        AQL_RESPONSE=$(curl -s -X POST \
            -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" \
            -H "Content-Type: text/plain" \
            -d "items.find($AQL_QUERY)" \
            "$ARTIFACTORY_URL/api/search/aql" || echo '{"results":[]}')

        ARTIFACT_COUNT=$(echo "$AQL_RESPONSE" | jq '.results | length')

        if [[ "$ARTIFACT_COUNT" == "0" ]]; then
            echo "  No artifacts found for $PRODUCT_NAME"
            continue
        fi

        echo "  Found $ARTIFACT_COUNT artifact(s)"

        # Process artifacts without version subdirectories
        VERSION="latest"
        VERSION_DIR="$PRODUCT_DIR/$VERSION"
        mkdir -p "$VERSION_DIR"

        for ((k=0; k<ARTIFACT_COUNT; k++)); do
            ARTIFACT_PATH=$(echo "$AQL_RESPONSE" | jq -r ".results[$k].path")
            ARTIFACT_NAME=$(echo "$AQL_RESPONSE" | jq -r ".results[$k].name")

            # Check exclude patterns
            EXCLUDED=false
            for EXCLUDE in "${EXCLUDE_PATTERNS[@]}"; do
                if [[ "$ARTIFACT_NAME" == $EXCLUDE ]]; then
                    EXCLUDED=true
                    break
                fi
            done

            if [[ "$EXCLUDED" == true ]]; then
                echo "  Skipping excluded: $ARTIFACT_NAME"
                continue
            fi

            # Download artifact
            DOWNLOAD_URL="$ARTIFACTORY_URL/$REPO/$ARTIFACT_PATH/$ARTIFACT_NAME"
            echo "  Downloading: $ARTIFACT_NAME"
            curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$DOWNLOAD_URL" -o "$VERSION_DIR/$ARTIFACT_NAME"

            # Add to manifest
            TEMP_MANIFEST=$(mktemp)
            jq --arg name "$PRODUCT_NAME" \
               --arg version "$VERSION" \
               --arg artifact "$VERSION_DIR/$ARTIFACT_NAME" \
               '.products += [{"name": $name, "version": $version, "artifact": $artifact}]' \
               "$MANIFEST_FILE" > "$TEMP_MANIFEST"
            mv "$TEMP_MANIFEST" "$MANIFEST_FILE"
        done
    else
        # Process each version
        echo "  Found versions: $(echo "$VERSIONS" | tr '\n' ' ')"

        while IFS= read -r VERSION; do
            [[ -z "$VERSION" ]] && continue

            VERSION_DIR="$PRODUCT_DIR/$VERSION"
            mkdir -p "$VERSION_DIR"

            # Use Artifactory's AQL to recursively find artifacts
            # This handles nested folder structures
            AQL_QUERY='{
                "repo": "'$REPO'",
                "path": {"$match": "'$PATH_PREFIX/$VERSION'/*"},
                "name": {"$match": "'$PATTERN'"}
            }'

            echo "  Searching recursively in version $VERSION..."
            AQL_RESPONSE=$(curl -s -X POST \
                -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" \
                -H "Content-Type: text/plain" \
                -d "items.find($AQL_QUERY)" \
                "$ARTIFACTORY_URL/api/search/aql" || echo '{"results":[]}')

            # Extract file paths from AQL results
            ARTIFACT_COUNT=$(echo "$AQL_RESPONSE" | jq '.results | length')

            if [[ "$ARTIFACT_COUNT" == "0" ]]; then
                echo "  No artifacts found in version $VERSION"
                continue
            fi

            echo "  Found $ARTIFACT_COUNT artifact(s)"

            # Process each artifact from AQL results
            for ((k=0; k<ARTIFACT_COUNT; k++)); do
                ARTIFACT_PATH=$(echo "$AQL_RESPONSE" | jq -r ".results[$k].path")
                ARTIFACT_NAME=$(echo "$AQL_RESPONSE" | jq -r ".results[$k].name")

                # Check exclude patterns
                EXCLUDED=false
                for EXCLUDE in "${EXCLUDE_PATTERNS[@]}"; do
                    if [[ "$ARTIFACT_NAME" == $EXCLUDE ]]; then
                        EXCLUDED=true
                        break
                    fi
                done

                if [[ "$EXCLUDED" == true ]]; then
                    echo "  Skipping excluded: $ARTIFACT_NAME"
                    continue
                fi

                # Download artifact
                DOWNLOAD_URL="$ARTIFACTORY_URL/$REPO/$ARTIFACT_PATH/$ARTIFACT_NAME"
                echo "  Downloading: $ARTIFACT_NAME"
                curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$DOWNLOAD_URL" -o "$VERSION_DIR/$ARTIFACT_NAME"

                # Add to manifest
                TEMP_MANIFEST=$(mktemp)
                jq --arg name "$PRODUCT_NAME" \
                   --arg version "$VERSION" \
                   --arg artifact "$VERSION_DIR/$ARTIFACT_NAME" \
                   '.products += [{"name": $name, "version": $version, "artifact": $artifact}]' \
                   "$MANIFEST_FILE" > "$TEMP_MANIFEST"
                mv "$TEMP_MANIFEST" "$MANIFEST_FILE"
            done

        done <<< "$VERSIONS"
    fi
done

echo ""
echo "Artifact fetch complete!"
echo "Manifest: $MANIFEST_FILE"
echo "Total artifacts: $(jq '.products | length' "$MANIFEST_FILE")"
