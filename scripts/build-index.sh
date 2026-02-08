#!/bin/bash

set -euo pipefail

# Build index.json from SBOMs in the sboms directory
# This script scans the sboms/ directory structure and generates index.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SBOM_DIR="$REPO_ROOT/sboms"
INDEX_FILE="$SBOM_DIR/index.json"

echo "Building index from SBOMs directory..."

# Check if sboms directory exists
if [[ ! -d "$SBOM_DIR" ]]; then
    echo "Error: sboms/ directory not found at $SBOM_DIR"
    echo "Run generate-sboms.sh first"
    exit 1
fi

# Initialize index
cat > "$INDEX_FILE" <<INDEXEOF
{
  "generated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "generator": "Syft",
  "products": []
}
INDEXEOF

# Find all product directories (exclude index.json)
PRODUCT_DIRS=$(find "$SBOM_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

if [[ -z "$PRODUCT_DIRS" ]]; then
    echo "No product directories found in $SBOM_DIR"
    exit 0
fi

while IFS= read -r PRODUCT_DIR; do
    [[ -z "$PRODUCT_DIR" ]] && continue

    PRODUCT_SLUG=$(basename "$PRODUCT_DIR")
    
    # Convert slug back to product name (capitalize first letter of each word)
    PRODUCT_NAME=$(echo "$PRODUCT_SLUG" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')
    
    echo ""
    echo "Product: $PRODUCT_NAME ($PRODUCT_SLUG)"

    # Find all version directories
    VERSION_DIRS=$(find "$PRODUCT_DIR" -mindepth 1 -maxdepth 1 -type d | sort -V -r)

    if [[ -z "$VERSION_DIRS" ]]; then
        echo "  No versions found"
        continue
    fi

    # Prepare product entry for index
    PRODUCT_INDEX_ENTRY='{"name": "'"$PRODUCT_NAME"'", "versions": []}'

    while IFS= read -r VERSION_DIR; do
        [[ -z "$VERSION_DIR" ]] && continue

        VERSION=$(basename "$VERSION_DIR")
        
        # Check if both SBOM files exist
        SPDX_FILE="$VERSION_DIR/sbom.spdx.json"
        CYCLONEDX_FILE="$VERSION_DIR/sbom.cyclonedx.json"

        if [[ ! -f "$SPDX_FILE" ]] || [[ ! -f "$CYCLONEDX_FILE" ]]; then
            echo "  Warning: Skipping version $VERSION - missing SBOM files"
            continue
        fi

        echo "  Version: $VERSION"

        # Try to extract release date from file stats
        RELEASE_DATE=$(date -u +"%Y-%m-%d" || echo "unknown")
        if [[ -f "$SPDX_FILE" ]]; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                RELEASE_DATE=$(stat -f "%Sm" -t "%Y-%m-%d" "$SPDX_FILE" 2>/dev/null || echo "unknown")
            else
                RELEASE_DATE=$(stat -c "%y" "$SPDX_FILE" 2>/dev/null | cut -d' ' -f1 || echo "unknown")
            fi
        fi

        # Add version to product index entry
        PRODUCT_INDEX_ENTRY=$(echo "$PRODUCT_INDEX_ENTRY" | jq \
            --arg version "$VERSION" \
            --arg date "$RELEASE_DATE" \
            --arg spdx "sboms/$PRODUCT_SLUG/$VERSION/sbom.spdx.json" \
            --arg cyclonedx "sboms/$PRODUCT_SLUG/$VERSION/sbom.cyclonedx.json" \
            '.versions += [{
                "version": $version,
                "releaseDate": $date,
                "sboms": {
                    "spdx": $spdx,
                    "cyclonedx": $cyclonedx
                }
            }]')

    done <<< "$VERSION_DIRS"

    # Only add product if it has versions
    VERSION_COUNT=$(echo "$PRODUCT_INDEX_ENTRY" | jq '.versions | length')
    if [[ "$VERSION_COUNT" -gt 0 ]]; then
        # Add product to index
        TEMP_INDEX=$(mktemp)
        jq --argjson product "$PRODUCT_INDEX_ENTRY" '.products += [$product]' "$INDEX_FILE" > "$TEMP_INDEX"
        mv "$TEMP_INDEX" "$INDEX_FILE"
        echo "  Added $VERSION_COUNT version(s)"
    else
        echo "  Skipped (no valid versions)"
    fi

done <<< "$PRODUCT_DIRS"

echo ""
echo "Index build complete!"
echo "Index file: $INDEX_FILE"
echo "Total products: $(jq '.products | length' "$INDEX_FILE")"
echo ""
jq -r '.products[] | "  \(.name): \(.versions | length) versions"' "$INDEX_FILE"
