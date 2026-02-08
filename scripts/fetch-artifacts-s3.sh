#!/bin/bash

set -euo pipefail

# Fetch artifacts from S3 for a single product
# Expects CURRENT_PRODUCT_INDEX environment variable
# Expects S3_BUCKET_URL and S3_PUBLIC_URL environment variables

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/config/products.yml}"
TEMP_DIR="$REPO_ROOT/temp"
MANIFEST_FILE="$TEMP_DIR/manifest.json"

if [[ -z "${CURRENT_PRODUCT_INDEX:-}" ]]; then
    echo "Error: CURRENT_PRODUCT_INDEX not set"
    exit 1
fi

# Check required environment variables
if [[ -z "${S3_BUCKET_URL:-}" ]]; then
    echo "Error: S3_BUCKET_URL environment variable not set"
    exit 1
fi

if [[ -z "${S3_PUBLIC_URL:-}" ]]; then
    echo "Error: S3_PUBLIC_URL environment variable not set"
    exit 1
fi

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI not installed. Install with: pip install awscli"
    exit 1
fi

i=$CURRENT_PRODUCT_INDEX
PRODUCT_NAME=$(yq eval ".products[$i].name" "$CONFIG_FILE")
PATTERN=$(yq eval ".products[$i].artifact_pattern" "$CONFIG_FILE")
MAX_VERSIONS=$(yq eval ".products[$i].max_versions" "$CONFIG_FILE")

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
    exit 0
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
