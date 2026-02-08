#!/bin/bash

set -euo pipefail

# Generate SBOMs from downloaded artifacts using Syft
# Requires: manifest.json from fetch-artifacts.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR="$REPO_ROOT/temp"
MANIFEST_FILE="$TEMP_DIR/manifest.json"
SBOM_DIR="$REPO_ROOT/sboms"

# Check if manifest exists
if [[ ! -f "$MANIFEST_FILE" ]]; then
    echo "Error: Manifest file not found at $MANIFEST_FILE"
    echo "Run fetch-artifacts.sh first"
    exit 1
fi

# Install Syft if not present
if ! command -v syft &> /dev/null; then
    echo "Installing Syft..."
    curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin
fi

SYFT_VERSION=$(syft version | head -n 1 || echo "unknown")
echo "Using Syft: $SYFT_VERSION"

# Ensure SBOM directory exists (but don't delete it)
mkdir -p "$SBOM_DIR"

echo "Starting SBOM generation..."

# Get total artifacts
TOTAL_ARTIFACTS=$(jq '.products | length' "$MANIFEST_FILE")
echo "Processing $TOTAL_ARTIFACTS artifacts..."

# Group artifacts by product for better organization
PRODUCTS=$(jq -r '.products | map(.name) | unique | .[]' "$MANIFEST_FILE")

while IFS= read -r PRODUCT_NAME; do
    [[ -z "$PRODUCT_NAME" ]] && continue

    echo ""
    echo "Product: $PRODUCT_NAME"

    # Create product slug
    PRODUCT_SLUG=$(echo "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    PRODUCT_SBOM_DIR="$SBOM_DIR/$PRODUCT_SLUG"

    # Clean only this product's directory (preserve other products)
    rm -rf "$PRODUCT_SBOM_DIR"
    mkdir -p "$PRODUCT_SBOM_DIR"

    # Get versions for this product
    VERSIONS=$(jq -r --arg name "$PRODUCT_NAME" '.products[] | select(.name == $name) | .version' "$MANIFEST_FILE" | sort -V -r)

    while IFS= read -r VERSION; do
        [[ -z "$VERSION" ]] && continue

        echo "  Version: $VERSION"

        VERSION_SBOM_DIR="$PRODUCT_SBOM_DIR/$VERSION"
        mkdir -p "$VERSION_SBOM_DIR"

        # Get artifacts for this product/version
        ARTIFACTS=$(jq -r --arg name "$PRODUCT_NAME" --arg version "$VERSION" \
            '.products[] | select(.name == $name and .version == $version) | .artifact' \
            "$MANIFEST_FILE")

        while IFS= read -r ARTIFACT_PATH; do
            [[ -z "$ARTIFACT_PATH" ]] && continue

            ARTIFACT_NAME=$(basename "$ARTIFACT_PATH")
            echo "    Generating SBOM for: $ARTIFACT_NAME"

            # Generate SPDX JSON
            SPDX_OUTPUT="$VERSION_SBOM_DIR/sbom.spdx.json"
            echo "      - SPDX format..."
            syft packages "$ARTIFACT_PATH" -q -o spdx-json="$SPDX_OUTPUT" 2>/dev/null || {
                echo "      Warning: SPDX generation failed for $ARTIFACT_NAME"
                echo '{"error": "SBOM generation failed"}' > "$SPDX_OUTPUT"
            }

            # Generate CycloneDX JSON
            CYCLONEDX_OUTPUT="$VERSION_SBOM_DIR/sbom.cyclonedx.json"
            echo "      - CycloneDX format..."
            syft packages "$ARTIFACT_PATH" -q -o cyclonedx-json="$CYCLONEDX_OUTPUT" 2>/dev/null || {
                echo "      Warning: CycloneDX generation failed for $ARTIFACT_NAME"
                echo '{"error": "SBOM generation failed"}' > "$CYCLONEDX_OUTPUT"
            }

            # Extract component count for metadata
            COMPONENT_COUNT=0
            if command -v jq &> /dev/null && [[ -f "$CYCLONEDX_OUTPUT" ]]; then
                COMPONENT_COUNT=$(jq '.components | length // 0' "$CYCLONEDX_OUTPUT" 2>/dev/null || echo 0)
            fi

            echo "      Components found: $COMPONENT_COUNT"

        done <<< "$ARTIFACTS"

    done <<< "$VERSIONS"

done <<< "$PRODUCTS"

echo ""
echo "SBOM generation complete!"
echo "Run build-index.sh to generate the index.json file"
