#!/bin/bash

set -euo pipefail

# Fetch artifacts from Artifactory based on products.yml configuration
# Requires: ARTIFACTORY_URL and ARTIFACTORY_TOKEN environment variables

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$REPO_ROOT/config/products.yml"
TEMP_DIR="$REPO_ROOT/temp"
MANIFEST_FILE="$TEMP_DIR/manifest.json"

# Check required environment variables
if [[ -z "${ARTIFACTORY_URL:-}" ]]; then
    echo "Error: ARTIFACTORY_URL environment variable not set"
    exit 1
fi

if [[ -z "${ARTIFACTORY_TOKEN:-}" ]]; then
    echo "Error: ARTIFACTORY_TOKEN environment variable not set"
    exit 1
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
    DIRECT_URL=$(yq eval ".products[$i].direct_download_url" "$CONFIG_FILE")
    PATTERN=$(yq eval ".products[$i].artifact_pattern" "$CONFIG_FILE")

    echo ""
    echo "Processing: $PRODUCT_NAME"

    # Create product directory
    PRODUCT_SLUG=$(echo "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    PRODUCT_DIR="$TEMP_DIR/$PRODUCT_SLUG"
    mkdir -p "$PRODUCT_DIR"

    # Check if this is a direct download product
    if [[ "$DIRECT_URL" != "null" && -n "$DIRECT_URL" ]]; then
        echo "  Direct download from: $DIRECT_URL"

        VERSION="latest"
        VERSION_DIR="$PRODUCT_DIR/$VERSION"
        mkdir -p "$VERSION_DIR"

        # Extract filename from pattern or URL
        ARTIFACT_NAME="contrast-agent-latest.jar"
        if [[ "$PATTERN" == *"*"* ]]; then
            # Use pattern to determine filename
            ARTIFACT_NAME=$(echo "$PATTERN" | sed 's/\*/latest/')
        fi

        echo "  Downloading: $ARTIFACT_NAME"

        # Download with redirect following
        if curl -L -f -s "$DIRECT_URL" -o "$VERSION_DIR/$ARTIFACT_NAME"; then
            echo "  Successfully downloaded"

            # Add to manifest
            TEMP_MANIFEST=$(mktemp)
            jq --arg name "$PRODUCT_NAME" \
               --arg version "$VERSION" \
               --arg artifact "$VERSION_DIR/$ARTIFACT_NAME" \
               '.products += [{"name": $name, "version": $version, "artifact": $artifact}]' \
               "$MANIFEST_FILE" > "$TEMP_MANIFEST"
            mv "$TEMP_MANIFEST" "$MANIFEST_FILE"
        else
            echo "  Error: Failed to download from $DIRECT_URL"
        fi

        continue
    fi

    # Standard Artifactory download path
    REPO=$(yq eval ".products[$i].artifactory_repo" "$CONFIG_FILE")
    PATH_PREFIX=$(yq eval ".products[$i].artifactory_path" "$CONFIG_FILE")

    echo "  Repository: $REPO"
    echo "  Path: $PATH_PREFIX"
    echo "  Pattern: $PATTERN"

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

    RESPONSE=$(curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$API_URL" || echo '{}')

    # Parse version directories
    VERSIONS=$(echo "$RESPONSE" | jq -r '.children[]? | select(.folder == true) | .uri' | tr -d '/')

    if [[ -z "$VERSIONS" ]]; then
        echo "  Warning: No versions found, checking for direct artifacts..."
        # Try to get artifacts directly from this path
        ARTIFACTS=$(echo "$RESPONSE" | jq -r '.children[]? | select(.folder == false) | .uri' | tr -d '/')

        if [[ -z "$ARTIFACTS" ]]; then
            echo "  No artifacts found for $PRODUCT_NAME"
            continue
        fi

        # Process artifacts without version subdirectories
        VERSION="latest"
        VERSION_DIR="$PRODUCT_DIR/$VERSION"
        mkdir -p "$VERSION_DIR"

        while IFS= read -r ARTIFACT; do
            # Check if artifact matches pattern
            if [[ ! "$ARTIFACT" == $PATTERN ]]; then
                continue
            fi

            # Check exclude patterns
            EXCLUDED=false
            for EXCLUDE in "${EXCLUDE_PATTERNS[@]}"; do
                if [[ "$ARTIFACT" == $EXCLUDE ]]; then
                    EXCLUDED=true
                    break
                fi
            done

            if [[ "$EXCLUDED" == true ]]; then
                echo "  Skipping excluded: $ARTIFACT"
                continue
            fi

            # Download artifact
            DOWNLOAD_URL="$ARTIFACTORY_URL/$REPO/$PATH_PREFIX/$ARTIFACT"
            echo "  Downloading: $ARTIFACT"
            curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$DOWNLOAD_URL" -o "$VERSION_DIR/$ARTIFACT"

            # Add to manifest
            TEMP_MANIFEST=$(mktemp)
            jq --arg name "$PRODUCT_NAME" \
               --arg version "$VERSION" \
               --arg artifact "$VERSION_DIR/$ARTIFACT" \
               '.products += [{"name": $name, "version": $version, "artifact": $artifact}]' \
               "$MANIFEST_FILE" > "$TEMP_MANIFEST"
            mv "$TEMP_MANIFEST" "$MANIFEST_FILE"
        done <<< "$ARTIFACTS"
    else
        # Process each version
        echo "  Found versions: $(echo "$VERSIONS" | tr '\n' ' ')"

        while IFS= read -r VERSION; do
            [[ -z "$VERSION" ]] && continue

            VERSION_DIR="$PRODUCT_DIR/$VERSION"
            mkdir -p "$VERSION_DIR"

            # Query artifacts in version directory
            VERSION_API_URL="$ARTIFACTORY_URL/api/storage/$REPO/$PATH_PREFIX/$VERSION"
            VERSION_RESPONSE=$(curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$VERSION_API_URL" || echo '{}')

            ARTIFACTS=$(echo "$VERSION_RESPONSE" | jq -r '.children[]? | select(.folder == false) | .uri' | tr -d '/')

            if [[ -z "$ARTIFACTS" ]]; then
                echo "  No artifacts found in version $VERSION"
                continue
            fi

            # Process each artifact
            while IFS= read -r ARTIFACT; do
                [[ -z "$ARTIFACT" ]] && continue

                # Check if artifact matches pattern
                if [[ ! "$ARTIFACT" == $PATTERN ]]; then
                    continue
                fi

                # Check exclude patterns
                EXCLUDED=false
                for EXCLUDE in "${EXCLUDE_PATTERNS[@]}"; do
                    if [[ "$ARTIFACT" == $EXCLUDE ]]; then
                        EXCLUDED=true
                        break
                    fi
                done

                if [[ "$EXCLUDED" == true ]]; then
                    echo "  Skipping excluded: $ARTIFACT"
                    continue
                fi

                # Download artifact
                DOWNLOAD_URL="$ARTIFACTORY_URL/$REPO/$PATH_PREFIX/$VERSION/$ARTIFACT"
                echo "  Downloading: $VERSION/$ARTIFACT"
                curl -s -H "X-JFrog-Art-Api: $ARTIFACTORY_TOKEN" "$DOWNLOAD_URL" -o "$VERSION_DIR/$ARTIFACT"

                # Add to manifest
                TEMP_MANIFEST=$(mktemp)
                jq --arg name "$PRODUCT_NAME" \
                   --arg version "$VERSION" \
                   --arg artifact "$VERSION_DIR/$ARTIFACT" \
                   '.products += [{"name": $name, "version": $version, "artifact": $artifact}]' \
                   "$MANIFEST_FILE" > "$TEMP_MANIFEST"
                mv "$TEMP_MANIFEST" "$MANIFEST_FILE"

            done <<< "$ARTIFACTS"

        done <<< "$VERSIONS"
    fi
done

echo ""
echo "Artifact fetch complete!"
echo "Manifest: $MANIFEST_FILE"
echo "Total artifacts: $(jq '.products | length' "$MANIFEST_FILE")"
