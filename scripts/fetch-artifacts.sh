#!/bin/bash

set -euo pipefail

# Unified artifact fetcher - routes to appropriate source-specific script
# Based on the "source" field in products.yml

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

echo "Starting artifact fetch..."
echo "Config file: $CONFIG_FILE"

# Initialize manifest
echo '{"products": []}' > "$MANIFEST_FILE"

# Get number of products
PRODUCT_COUNT=$(yq eval '.products | length' "$CONFIG_FILE")
echo "Found $PRODUCT_COUNT products in configuration"

# Process each product by source type
for ((i=0; i<PRODUCT_COUNT; i++)); do
    PRODUCT_NAME=$(yq eval ".products[$i].name" "$CONFIG_FILE")
    SOURCE=$(yq eval ".products[$i].source" "$CONFIG_FILE")

    echo ""
    echo "Processing: $PRODUCT_NAME (source: $SOURCE)"

    case "$SOURCE" in
        s3)
            # Call S3-specific script
            export CURRENT_PRODUCT_INDEX=$i
            "$SCRIPT_DIR/fetch-artifacts-s3.sh" || echo "  Warning: Failed to fetch $PRODUCT_NAME"
            ;;
        maven)
            # Call Maven-specific script
            export CURRENT_PRODUCT_INDEX=$i
            "$SCRIPT_DIR/fetch-artifacts-maven.sh" || echo "  Warning: Failed to fetch $PRODUCT_NAME"
            ;;
        artifactory)
            # Call Artifactory-specific script
            export CURRENT_PRODUCT_INDEX=$i
            "$SCRIPT_DIR/fetch-artifacts-artifactory.sh" || echo "  Warning: Failed to fetch $PRODUCT_NAME"
            ;;
        *)
            echo "  Error: Unknown source type '$SOURCE'"
            ;;
    esac
done

echo ""
echo "Artifact fetch complete!"
echo "Manifest: $MANIFEST_FILE"
echo "Total artifacts: $(jq '.products | length' "$MANIFEST_FILE")"
