#!/bin/bash

set -euo pipefail

# Fetch EOP artifacts from S3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/config/products.yml}"
TEMP_DIR="$REPO_ROOT/temp"
MANIFEST_FILE="$TEMP_DIR/manifest.json"

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

echo "Starting EOP artifact fetch from S3..."
echo "Config file: $CONFIG_FILE"

# Initialize manifest
echo '{"products": []}' > "$MANIFEST_FILE"

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI not installed. Install with: pip install awscli"
    exit 1
fi

# Get number of products
PRODUCT_COUNT=$(yq eval '.products | length' "$CONFIG_FILE")
echo "Found $PRODUCT_COUNT products in configuration"

# Process each product
for ((i=0; i<PRODUCT_COUNT; i++)); do
    PRODUCT_NAME=$(yq eval ".products[$i].name" "$CONFIG_FILE")
    S3_BUCKET_URL=$(yq eval ".products[$i].s3_bucket_url" "$CONFIG_FILE")
    S3_PUBLIC_URL=$(yq eval ".products[$i].s3_public_url" "$CONFIG_FILE")
    PATTERN=$(yq eval ".products[$i].artifact_pattern" "$CONFIG_FILE")
    MAX_VERSIONS=$(yq eval ".products[$i].max_versions" "$CONFIG_FILE")

    echo ""
    echo "Processing: $PRODUCT_NAME"

    if [[ "$S3_BUCKET_URL" == "null" || -z "$S3_BUCKET_URL" ]]; then
        echo "  Skipping: Not an S3 product"
        continue
    fi

    echo "  S3 bucket: $S3_BUCKET_URL"

    # Create product directory
    PRODUCT_SLUG=$(echo "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    PRODUCT_DIR="$TEMP_DIR/$PRODUCT_SLUG"
    mkdir -p "$PRODUCT_DIR"

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
done

echo ""
echo "EOP artifact fetch complete!"
echo "Manifest: $MANIFEST_FILE"
echo "Total artifacts: $(jq '.products | length' "$MANIFEST_FILE")"
