#!/bin/bash

set -euo pipefail

# Fetch artifacts from Artifactory

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/config/products.yml}"
TEMP_DIR="$REPO_ROOT/temp"
MANIFEST_FILE="$TEMP_DIR/manifest.json"

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
    REPO=$(yq eval ".products[$i].artifactory_repo" "$CONFIG_FILE")
    PATH_PREFIX=$(yq eval ".products[$i].artifactory_path" "$CONFIG_FILE")
    PATTERN=$(yq eval ".products[$i].artifact_pattern" "$CONFIG_FILE")

    # Skip if not an Artifactory product
    if [[ "$REPO" == "null" || -z "$REPO" ]]; then
        echo ""
        echo "Processing: $PRODUCT_NAME"
        echo "  Skipping: Not an Artifactory product"
        continue
    fi

    echo ""
    echo "Processing: $PRODUCT_NAME"
    echo "  Repository: $REPO"
    echo "  Path: $PATH_PREFIX"
    echo "  Pattern: $PATTERN"

    # Create product directory
    PRODUCT_SLUG=$(echo "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    PRODUCT_DIR="$TEMP_DIR/$PRODUCT_SLUG"
    mkdir -p "$PRODUCT_DIR"

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

    RESPONSE=$(curl -s $CURL_AUTH "$CURL_AUTH_VALUE" "$API_URL" || echo '{}')

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
            $CURL_AUTH "$CURL_AUTH_VALUE" \
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
            curl -s $CURL_AUTH "$CURL_AUTH_VALUE" "$DOWNLOAD_URL" -o "$VERSION_DIR/$ARTIFACT_NAME"

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
                $CURL_AUTH "$CURL_AUTH_VALUE" \
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
                curl -s $CURL_AUTH "$CURL_AUTH_VALUE" "$DOWNLOAD_URL" -o "$VERSION_DIR/$ARTIFACT_NAME"

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
echo "Artifactory artifact fetch complete!"
echo "Manifest: $MANIFEST_FILE"
echo "Total artifacts: $(jq '.products | length' "$MANIFEST_FILE")"
