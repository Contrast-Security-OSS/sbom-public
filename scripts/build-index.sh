#!/bin/bash

set -euo pipefail

# Build index.json from docs/sboms/ directory structure
# Reads metadata.json for canonical product names

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SBOM_DIR="$REPO_ROOT/docs/sboms"
INDEX_FILE="$SBOM_DIR/index.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

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
    IFS=$'\n' sorted_versions=($(printf '%s\n' "${versions[@]}" | sort -t. -k1,1nr -k2,2nr -k3,3nr))

    # Output each version
    for version_data in "${sorted_versions[@]}"; do
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
