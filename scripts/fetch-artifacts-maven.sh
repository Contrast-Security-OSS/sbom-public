#!/bin/bash

set -euo pipefail

# Fetch artifacts from Maven Central for a single product
# Expects CURRENT_PRODUCT_INDEX environment variable

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/config/products.yml}"
TEMP_DIR="$REPO_ROOT/temp"
MANIFEST_FILE="$TEMP_DIR/manifest.json"

if [[ -z "${CURRENT_PRODUCT_INDEX:-}" ]]; then
    echo "Error: CURRENT_PRODUCT_INDEX not set"
    exit 1
fi

i=$CURRENT_PRODUCT_INDEX
PRODUCT_NAME=$(yq eval ".products[$i].name" "$CONFIG_FILE")
MAVEN_GROUP_ID=$(yq eval ".products[$i].maven_group_id" "$CONFIG_FILE")
MAVEN_ARTIFACT_ID=$(yq eval ".products[$i].maven_artifact_id" "$CONFIG_FILE")
MAX_VERSIONS=$(yq eval ".products[$i].max_versions" "$CONFIG_FILE")

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
    exit 1
fi

# Extract versions from XML (grab all <version> tags)
VERSIONS=$(echo "$METADATA" | grep -o '<version>[^<]*</version>' | sed 's/<version>//g' | sed 's/<\/version>//g' | sort -V -r)

if [[ -z "$VERSIONS" ]]; then
    echo "  No versions found on Maven Central"
    exit 0
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
