#!/bin/bash

set -euo pipefail

# Fetch artifacts from Maven Central

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

echo "Starting artifact fetch from Maven Central..."
echo "Config file: $CONFIG_FILE"

# Initialize manifest
echo '{"products": []}' > "$MANIFEST_FILE"

# Get number of products
PRODUCT_COUNT=$(yq eval '.products | length' "$CONFIG_FILE")
echo "Found $PRODUCT_COUNT products in configuration"

# Process each product
for ((i=0; i<PRODUCT_COUNT; i++)); do
    PRODUCT_NAME=$(yq eval ".products[$i].name" "$CONFIG_FILE")
    MAVEN_CENTRAL=$(yq eval ".products[$i].maven_central" "$CONFIG_FILE")
    MAVEN_GROUP_ID=$(yq eval ".products[$i].maven_group_id" "$CONFIG_FILE")
    MAVEN_ARTIFACT_ID=$(yq eval ".products[$i].maven_artifact_id" "$CONFIG_FILE")
    MAX_VERSIONS=$(yq eval ".products[$i].max_versions" "$CONFIG_FILE")

    echo ""
    echo "Processing: $PRODUCT_NAME"

    if [[ "$MAVEN_CENTRAL" != "true" ]]; then
        echo "  Skipping: Not a Maven Central product"
        continue
    fi

    echo "  Maven Central: $MAVEN_GROUP_ID:$MAVEN_ARTIFACT_ID"

    # Create product directory
    PRODUCT_SLUG=$(echo "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    PRODUCT_DIR="$TEMP_DIR/$PRODUCT_SLUG"
    mkdir -p "$PRODUCT_DIR"

    # Construct Maven repository path
    GROUP_PATH=$(echo "$MAVEN_GROUP_ID" | tr '.' '/')
    MAVEN_BASE_URL="https://repo1.maven.org/maven2/${GROUP_PATH}/${MAVEN_ARTIFACT_ID}"
    METADATA_URL="${MAVEN_BASE_URL}/maven-metadata.xml"

    echo "  Fetching version metadata..."

    # Download maven-metadata.xml
    METADATA=$(curl -s "$METADATA_URL")

    if [[ -z "$METADATA" ]]; then
        echo "  Error: Failed to fetch metadata from Maven Central"
        continue
    fi

    # Extract versions from XML (grab all <version> tags)
    VERSIONS=$(echo "$METADATA" | grep -o '<version>[^<]*</version>' | sed 's/<version>//g' | sed 's/<\/version>//g' | sort -V -r)

    if [[ -z "$VERSIONS" ]]; then
        echo "  No versions found on Maven Central"
        continue
    fi

    # Limit to max versions if specified
    if [[ "$MAX_VERSIONS" != "null" && "$MAX_VERSIONS" -gt 0 ]]; then
        VERSIONS=$(echo "$VERSIONS" | head -n "$MAX_VERSIONS")
    fi

    VERSION_COUNT=$(echo "$VERSIONS" | wc -l | tr -d ' ')
    echo "  Found $VERSION_COUNT version(s)"

    # Download each version
    while IFS= read -r VERSION; do
        [[ -z "$VERSION" ]] && continue

        echo "  Version: $VERSION"
        VERSION_DIR="$PRODUCT_DIR/$VERSION"
        mkdir -p "$VERSION_DIR"

        # Construct download URL
        # Format: https://repo1.maven.org/maven2/com/contrastsecurity/contrast-agent/{version}/contrast-agent-{version}.jar
        FILENAME="${MAVEN_ARTIFACT_ID}-${VERSION}.jar"
        DOWNLOAD_URL="${MAVEN_BASE_URL}/${VERSION}/${FILENAME}"

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
            echo "    Error: Failed to download $FILENAME from Maven Central"
        fi

    done <<< "$VERSIONS"
done

echo ""
echo "Maven Central artifact fetch complete!"
echo "Manifest: $MANIFEST_FILE"
echo "Total artifacts: $(jq '.products | length' "$MANIFEST_FILE")"
