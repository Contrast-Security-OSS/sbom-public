#!/bin/bash

set -euo pipefail

# Fetch artifacts from Artifactory for a single product
# Expects CURRENT_PRODUCT_INDEX environment variable
# Expects ARTIFACTORY_URL and either ARTIFACTORY_TOKEN or (ARTIFACTORY_USER + ARTIFACTORY_PASSWORD)

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
if [[ -z "${ARTIFACTORY_URL:-}" ]]; then
    echo "Error: ARTIFACTORY_URL environment variable not set"
    exit 1
fi

# Check if we have either token or user/password authentication
if [[ -z "${ARTIFACTORY_TOKEN:-}" ]] && [[ -z "${ARTIFACTORY_USER:-}" || -z "${ARTIFACTORY_PASSWORD:-}" ]]; then
    echo "Error: Either ARTIFACTORY_TOKEN or both ARTIFACTORY_USER and ARTIFACTORY_PASSWORD must be set"
    exit 1
fi

# Set up authentication header or credentials
if [[ -n "${ARTIFACTORY_TOKEN:-}" ]]; then
    AUTH_HEADER="X-JFrog-Art-Api: $ARTIFACTORY_TOKEN"
    CURL_AUTH="-H"
    CURL_AUTH_VALUE="$AUTH_HEADER"
else
    CURL_AUTH="-u"
    CURL_AUTH_VALUE="$ARTIFACTORY_USER:$ARTIFACTORY_PASSWORD"
fi

i=$CURRENT_PRODUCT_INDEX
PRODUCT_NAME=$(yq eval ".products[$i].name" "$CONFIG_FILE")
ARTIFACTORY_PATH=$(yq eval ".products[$i].artifactory_path" "$CONFIG_FILE")
PATTERN=$(yq eval ".products[$i].artifact_pattern" "$CONFIG_FILE")
MAX_VERSIONS=$(yq eval ".products[$i].max_versions" "$CONFIG_FILE")

echo "  Artifactory path: $ARTIFACTORY_PATH"
echo "  Pattern: $PATTERN"

# Create product directory
PRODUCT_SLUG=$(echo "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
PRODUCT_DIR="$TEMP_DIR/$PRODUCT_SLUG"
mkdir -p "$PRODUCT_DIR"

# Query Artifactory for versions using AQL
# Search recursively for artifacts matching the pattern
AQL_QUERY='items.find({
    "path": {"$match": "'$ARTIFACTORY_PATH'/*"},
    "name": {"$match": "'$PATTERN'"}
}).sort({"$desc": ["modified"]}).limit('$MAX_VERSIONS')'

echo "  Searching Artifactory..."

AQL_RESPONSE=$(curl -s -X POST \
    $CURL_AUTH "$CURL_AUTH_VALUE" \
    -H "Content-Type: text/plain" \
    -d "$AQL_QUERY" \
    "$ARTIFACTORY_URL/api/search/aql" || echo '{"results":[]}')

ARTIFACT_COUNT=$(echo "$AQL_RESPONSE" | jq '.results | length')

if [[ "$ARTIFACT_COUNT" == "0" ]]; then
    echo "  No artifacts found"
    exit 0
fi

echo "  Found $ARTIFACT_COUNT artifact(s)"

# Process each artifact from AQL results
for ((k=0; k<ARTIFACT_COUNT; k++)); do
    REPO=$(echo "$AQL_RESPONSE" | jq -r ".results[$k].repo")
    ARTIFACT_PATH=$(echo "$AQL_RESPONSE" | jq -r ".results[$k].path")
    ARTIFACT_NAME=$(echo "$AQL_RESPONSE" | jq -r ".results[$k].name")

    # Try to extract version from path or filename
    # Look for version patterns like: 1.2.3, v1.2.3, etc.
    VERSION="latest"

    # Try to extract from path first (e.g., "flex-agent-release/1.11.0/...")
    if [[ "$ARTIFACT_PATH" =~ ([0-9]+\.[0-9]+\.[0-9]+) ]]; then
        VERSION="${BASH_REMATCH[1]}"
    # Try to extract from filename
    elif [[ "$ARTIFACT_NAME" =~ ([0-9]+\.[0-9]+\.[0-9]+) ]]; then
        VERSION="${BASH_REMATCH[1]}"
    fi

    echo "  Version: $VERSION"
    VERSION_DIR="$PRODUCT_DIR/$VERSION"
    mkdir -p "$VERSION_DIR"

    # Download artifact
    DOWNLOAD_URL="$ARTIFACTORY_URL/$REPO/$ARTIFACT_PATH/$ARTIFACT_NAME"
    echo "    Downloading: $ARTIFACT_NAME"

    if curl -f -s $CURL_AUTH "$CURL_AUTH_VALUE" "$DOWNLOAD_URL" -o "$VERSION_DIR/$ARTIFACT_NAME"; then
        echo "    Successfully downloaded"

        # Add to manifest
        TEMP_MANIFEST=$(mktemp)
        jq --arg name "$PRODUCT_NAME" \
           --arg version "$VERSION" \
           --arg artifact "$VERSION_DIR/$ARTIFACT_NAME" \
           '.products += [{"name": $name, "version": $version, "artifact": $artifact}]' \
           "$MANIFEST_FILE" > "$TEMP_MANIFEST"
        mv "$TEMP_MANIFEST" "$MANIFEST_FILE"
    else
        echo "    Error: Failed to download $ARTIFACT_NAME"
    fi
done
