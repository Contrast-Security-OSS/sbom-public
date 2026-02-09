# SBOM Repository Specification v2.0

**Version**: 2.1 (Enhanced)
**Last Updated**: 2026-02-09
**Status**: Active

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Configuration Schema](#configuration-schema)
4. [Script Specifications](#script-specifications)
5. [Workflow Specification](#workflow-specification)
6. [Security Model](#security-model)
7. [Extension Guide](#extension-guide)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### Purpose

Automatically generate and publish Software Bill of Materials (SBOMs) for Contrast Security products by fetching artifacts from multiple sources and generating SBOMs in SPDX and CycloneDX formats.

### Goals

- **Automated**: Generate SBOMs without manual intervention
- **Multi-source**: Support S3, Maven Central, and Artifactory
- **Dual format**: Generate both SPDX and CycloneDX
- **Public**: Publish via GitHub Pages for customer transparency
- **Simple**: Minimize complexity while maintaining functionality

### Key Simplifications from v1.0

- **Single unified fetch script** (not 4 separate scripts)
- **No manifest.json** (scans filesystem instead)
- **Single SBOM location** (docs/sboms/ only, not duplicated)
- **Metadata preservation** (no lossy name transformations)
- **Config validation** (fail fast on invalid config)

---

## Current Status & Recent Improvements

### Working Products (as of Feb 2026)

| Product | Versions | Source | Notes |
|---------|----------|--------|-------|
| **EOP** | 13 | S3 (anonymous) | Manually committed, protected from overwrite |
| **Java Agent** | 10 | Maven Central | Fully automated |
| **Flex Agent** | 11 | Artifactory (anonymous) | Public repository |
| **Python Agent** | 10 | PyPI | Fully automated |
| **Node Agent** | 10 | npm | Fully automated with enhanced catalogers |
| **Go Agent (Linux AMD64)** | 10 | Artifactory (anonymous) | Enhanced binary cataloger |
| **DotNet Core Agent** | 10 | NuGet | Fully automated |
| **DotNet Core IIS Installer** | 10 | NuGet | Fully automated |
| **Contrast CLI Linux** | 10 | Artifactory (anonymous) | Enhanced binary cataloger |
| **Contrast CLI Mac** | 10 | Artifactory (anonymous) | Enhanced binary cataloger |
| **Contrast CLI Windows** | 10 | Artifactory (anonymous) | Enhanced binary cataloger |

### Recent Improvements (Feb 2026)

#### 0. Syft Configuration Enhancement (Feb 9, 2026)

**Comprehensive Multi-Language Detection**:
- Added `--override-default-catalogers all` to enable all 52+ catalogers
- Added `--enrich golang,java,javascript,python` for enhanced metadata
- Changed from deprecated `syft packages` to `syft scan` command
- Targets binary catalogers for Go, .NET, Node.js compiled artifacts

**Syft Command**:
```bash
syft scan "$artifact_path" \
  --override-default-catalogers all \
  --enrich golang,java,javascript,python \
  -o spdx-json="$output_file" \
  -q
```

**Enabled Catalogers Include**:
- `go-module-binary-cataloger`: Extracts Go dependencies from compiled binaries
- `dotnet-deps-binary-cataloger`: Extracts .NET dependencies from assemblies
- `javascript-package-cataloger`: Extracts npm package information
- And 49+ more catalogers for comprehensive coverage

**Impact**: Better SBOM completeness for all languages, especially compiled artifacts

#### 1. Interactive Dependency Tree Visualization (Feb 9, 2026)

**New Feature**: Interactive hierarchical dependency tree viewer

**Files Added**:
- `site/dependency-tree.html`: Main tree viewer page
- `site/dependency-tree.js`: Tree rendering and interaction logic

**Features**:
- File-explorer-style collapsible tree structure
- Click nodes to expand/collapse (▶/▼ arrows)
- Search with automatic path expansion and highlighting
- Expand All / Collapse All buttons
- Export as ASCII text tree
- Stats dashboard (total, direct, transitive packages)
- Contrast Security branded design

**Data Source**: Parses CycloneDX SBOM dependency relationships

**Access**: Click the tree icon (🌳) next to any SBOM version on the main site

#### 2. Anonymous Access for Public Repositories

**S3 (EOP)**:
- Removed AWS credential requirements
- Uses public HTTP endpoint with XML API
- Supports `version_list` fallback if bucket listing disabled
- No security risk of credential exposure

**Artifactory (Flex Agent)**:
- Switched from AQL queries to REST API
- Supports anonymous access for public repositories
- Auto-detects and uses credentials only if provided
- Constructs URLs from version directories

#### 3. SBOM Protection Mechanism

Manually-committed SBOMs are now protected from workflow overwrite:

```bash
# Script checks for existing SBOMs before fetching
local existing_sboms=$(find "$SBOM_DIR/$slug" -mindepth 2 -name "sbom.*.json" | wc -l)
if [[ "$existing_sboms" -gt 0 ]]; then
    echo "⚠ Found existing SBOMs - SKIPPING fetch to preserve manual SBOMs"
    return
fi
```

This ensures EOP SBOMs (and any others manually committed) won't be overwritten by automated workflows.

#### 4. Frontend Fixes

**Data Structure Alignment**:
- Fixed mismatch between backend (`generatedAt`) and frontend (`releaseDate`)
- Construct SBOM URLs from slug/version/format instead of expecting pre-computed paths
- Check `formats` array to conditionally show download buttons

**Cache Busting**:
- Added version parameter to `app.js` (`app.js?v=2`)
- Prevents GitHub Pages CDN from serving stale versions

#### 5. Stderr Redirect for Fetch Functions

All informational messages now go to stderr:

```bash
echo "  Found $count artifacts" >&2  # Don't capture this
echo "$download_path|$version"       # DO capture this
```

This prevents log messages from being captured as artifact data, which was causing empty SBOM generation attempts.

#### 6. Build Script Improvements

**build-index.sh**:
- Handles empty version arrays without failing
- Uses `-sc` flag for compact JSON output
- Proper empty array handling: `for item in "${array[@]+"${array[@]}"}"`

---

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────┐
│    GitHub Actions Workflow              │
│    (generate-sboms.yml)                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    Configuration                         │
│    (config/products.yml)                │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    Unified Fetch & Generate Script      │
│    (scripts/fetch-and-generate.sh)      │
│    - Validates config                   │
│    - Fetches from all sources           │
│    - Generates SBOMs with Syft          │
│    - Writes to docs/sboms/ directly     │
│    - Creates metadata.json per product  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    Index Builder                         │
│    (scripts/build-index.sh)             │
│    - Scans docs/sboms/                  │
│    - Reads metadata.json for names      │
│    - Builds docs/sboms/index.json       │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    Site Builder                          │
│    (scripts/build-site.js)              │
│    - Copies site/ to docs/              │
└──────────────┬──────────────────────────┘
               │
               ▼
         ┌────────────┐
         │   docs/    │
         │  (GitHub   │
         │   Pages)   │
         └────────────┘
```

### Component Responsibilities

| Component | Input | Output | Purpose |
|-----------|-------|--------|---------|
| `products.yml` | Manual config | Product definitions | Define what to fetch |
| `fetch-and-generate.sh` | products.yml + credentials | docs/sboms/ + metadata | Fetch artifacts and generate SBOMs |
| `build-index.sh` | docs/sboms/ + metadata.json | index.json | Build searchable index |
| `build-site.js` | site/ templates | docs/ website | Build static website |

---

## Configuration Schema

### products.yml

**Location**: `config/products.yml`

#### Schema

```yaml
products:
  - name: string                    # REQUIRED: Display name (preserved exactly)
    source: enum                    # REQUIRED: "s3" | "maven" | "artifactory"
    max_versions: integer           # REQUIRED: Max versions to fetch (>= 1)

    # Source-specific fields

    # For source: "s3"
    artifact_pattern: string        # REQUIRED: Pattern like "Contrast-*.war"
    version_list: array             # OPTIONAL: List of known filenames (fallback if bucket listing disabled)

    # For source: "maven"
    maven_group_id: string          # REQUIRED: e.g. "com.contrastsecurity"
    maven_artifact_id: string       # REQUIRED: e.g. "contrast-agent"

    # For source: "artifactory"
    artifactory_path: string        # REQUIRED: e.g. "flex-agent-release"
    artifact_pattern: string        # REQUIRED: e.g. "contrast-flex-agent*"
```

#### Validation Rules

**Enforced at runtime:**
1. ✅ Each product MUST have: `name`, `source`, `max_versions`
2. ✅ `source` MUST be one of: `s3`, `maven`, `artifactory`
3. ✅ `max_versions` MUST be integer >= 1
4. ✅ Source-specific required fields MUST be present
5. ✅ Product `name` MUST NOT contain path traversal (`../`, `./`)
6. ✅ Product `name` MUST be unique

#### Slug Generation

Product names are converted to filesystem-safe slugs:

```bash
# Sanitization: keep only alphanumeric, spaces, hyphens, dots
# Then: lowercase, spaces→hyphens, trim leading/trailing hyphens
".NET Agent" → "net-agent"
"Go Agent (Linux AMD64)" → "go-agent-linux-amd64"
"EOP" → "eop"
```

**IMPORTANT**: Original names are preserved in `metadata.json`, not reconstructed from slugs.

#### Example Configuration

```yaml
products:
  - name: "EOP"
    source: "s3"
    artifact_pattern: "Contrast-*.war"
    max_versions: 10

  - name: "Java Agent"
    source: "maven"
    maven_group_id: "com.contrastsecurity"
    maven_artifact_id: "contrast-agent"
    max_versions: 10

  - name: ".NET Agent"
    source: "artifactory"
    artifactory_path: "dotnet-release"
    artifact_pattern: "ContrastSetup.zip"
    max_versions: 10
```

---

## Script Specifications

### fetch-and-generate.sh (Unified Script)

**Purpose**: Single script that validates config, fetches artifacts from all sources, and generates SBOMs.

**Interface:**

```bash
# Required Environment Variables (by source)
# For S3 products:
S3_BUCKET_URL           # e.g. s3://bucket-name/path/
S3_PUBLIC_URL           # e.g. https://bucket.s3.region.amazonaws.com/path/

# For Artifactory products:
ARTIFACTORY_URL         # e.g. https://artifactory.example.com
ARTIFACTORY_TOKEN       # Preferred
# OR
ARTIFACTORY_USER        # Username
ARTIFACTORY_PASSWORD    # Password

# Optional
CONFIG_FILE             # Default: config/products.yml

# External Dependencies
- yq (YAML parser)
- jq (JSON processor)
- curl (downloads)
- syft (SBOM generator with enhanced catalogers)

# Exit Codes
0 - Success
1 - Configuration validation failed
2 - Missing required environment variables
3 - SBOM generation failed
```

**Algorithm:**

```
1. Validate config file
   - Check required fields exist for each product
   - Check for duplicate names
   - Validate source types
   - Check for path traversal in names

2. For each product in products.yml:
   a. Generate safe slug
   b. Create product directory: docs/sboms/<slug>/
   c. Write metadata.json with canonical name
   d. Based on source type:
      - s3: List S3 bucket, filter by pattern, download
      - maven: Fetch maven-metadata.xml, download JARs
      - artifactory: Query AQL, download artifacts
   e. For each downloaded artifact:
      - Check if SBOM already exists (skip if both formats present)
      - Extract version from filename/path
      - Create version directory: docs/sboms/<slug>/<version>/
      - Generate SPDX: syft scan --override-default-catalogers all --enrich golang,java,javascript,python
      - Generate CycloneDX: syft scan --override-default-catalogers all --enrich golang,java,javascript,python
   f. Clean up downloaded artifacts (save disk space)

3. Log summary of generated SBOMs
```

**Key Functions:**

```bash
# Input validation
validate_config()           # Check products.yml structure
validate_product()          # Check single product has required fields
sanitize_slug()             # Convert name to safe filesystem slug
check_path_traversal()      # Prevent ../.. attacks

# Protection
check_sbom_exists()         # Check if SBOM already exists for version

# Fetching (one function per source)
fetch_s3()                  # List & download from S3
fetch_maven()               # Fetch from Maven Central
fetch_npm()                 # Fetch from npm registry
fetch_pypi()                # Fetch from PyPI registry
fetch_nuget()               # Fetch from NuGet registry
fetch_artifactory()         # Query REST API & download

# SBOM generation
generate_sboms_for_artifact()  # Run syft scan with enhanced catalogers

# Metadata
write_metadata()            # Write metadata.json for product
```

**Metadata Format:**

Each product gets `docs/sboms/<slug>/metadata.json`:

```json
{
  "name": "Original Product Name",
  "slug": "product-slug",
  "source": "maven",
  "generatedAt": "2026-02-08T19:02:17Z"
}
```

**Output Structure:**

```
docs/sboms/
├── eop/
│   ├── metadata.json          # {"name": "EOP", "slug": "eop", ...}
│   ├── 3.12.10/
│   │   ├── sbom.spdx.json
│   │   └── sbom.cyclonedx.json
│   └── 3.12.9/
│       ├── sbom.spdx.json
│       └── sbom.cyclonedx.json
├── java-agent/
│   ├── metadata.json          # {"name": "Java Agent", ...}
│   └── 6.25.1/
│       ├── sbom.spdx.json
│       └── sbom.cyclonedx.json
└── net-agent/                 # Note: slug is "net-agent"
    ├── metadata.json          # But name is ".NET Agent"
    └── 1.2.3/
        ├── sbom.spdx.json
        └── sbom.cyclonedx.json
```

---

### build-index.sh (Simplified)

**Purpose**: Scan docs/sboms/ and build index.json.

**Interface:**

```bash
# Input
# - Scans docs/sboms/
# - Reads metadata.json for canonical names

# Output
# - Creates/updates docs/sboms/index.json

# Dependencies
- jq

# Exit Codes
0 - Success
1 - docs/sboms/ not found
```

**Algorithm:**

```
1. Initialize empty index structure
2. For each product directory in docs/sboms/:
   a. Read metadata.json for canonical product name
   b. For each version directory:
      - Check for sbom.spdx.json and sbom.cyclonedx.json
      - Extract release date from file timestamp (best effort)
      - Add to product's versions array
   c. Sort versions (newest first)
   d. Add product to index
3. Sort products alphabetically by name
4. Write to docs/sboms/index.json
```

**Index Format:**

```json
{
  "generated": "2026-02-08T19:02:17Z",
  "products": [
    {
      "name": ".NET Agent",           // From metadata.json
      "slug": "net-agent",            // Directory name
      "source": "artifactory",        // From metadata.json
      "versions": [
        {
          "version": "1.2.3",
          "generatedAt": "2026-02-08T19:02:17Z",
          "formats": ["spdx", "cyclonedx"]
        }
      ]
    }
  ]
}
```

**IMPORTANT**: Paths are not stored in index. Frontend constructs them as:
```javascript
const spdxPath = `sboms/${product.slug}/${version.version}/sbom.spdx.json`;
```

---

### build-site.js (Simplified)

**Purpose**: Copy site templates to docs/.

**Interface:**

```bash
# Input
# - Reads site/ directory

# Output
# - Copies site/* to docs/
# - Creates docs/.nojekyll

# Dependencies
- node.js

# Exit Codes
0 - Success
1 - site/ directory not found
```

**Algorithm:**

```
1. Check site/ exists
2. Copy site/index.html to docs/index.html
3. Copy site/styles.css to docs/styles.css
4. Copy site/app.js to docs/app.js
5. Copy site/dependency-tree.html to docs/dependency-tree.html
6. Copy site/dependency-tree.js to docs/dependency-tree.js
7. Copy site/logo.svg to docs/logo.svg
8. Create docs/.nojekyll (disable Jekyll processing)
```

**IMPORTANT**: Does NOT copy sboms/ to docs/sboms/ because SBOMs are already generated directly in docs/sboms/ by fetch-and-generate.sh.

---

## Workflow Specification

### generate-sboms.yml

**File**: `.github/workflows/generate-sboms.yml`

**Triggers:**
- `workflow_dispatch`: Manual trigger
- `schedule`: Weekly (optional, currently commented)

**Permissions:**
- `contents: write`

**Steps:**

1. Checkout repository
2. Setup Node.js 18
3. Configure AWS credentials (for S3 products)
4. Install dependencies (jq, yq)
5. **Fetch and Generate** (unified step)
   - Runs: `./scripts/fetch-and-generate.sh`
   - Environment variables: S3_*, ARTIFACTORY_*
6. **Build Index**
   - Runs: `./scripts/build-index.sh`
7. **Build Site**
   - Runs: `node scripts/build-site.js`
8. **Commit and Push**
   - Adds: `docs/`
   - Commit: "Update SBOMs - <timestamp>"
   - Pushes to origin
9. **Cleanup** (always runs)
   - Note: Artifacts already cleaned during fetch-and-generate

**Required Secrets:**
- `AWS_ACCESS_KEY_ID_ENG_DEVELOPMENT`
- `AWS_SECRET_ACCESS_KEY_ENG_DEVELOPMENT`
- `S3_BUCKET_URL`
- `S3_PUBLIC_URL`
- `ARTIFACTORY_URL`
- `ARTIFACTORY_USER`
- `ARTIFACTORY_PASSWORD`

---

## Security Model

### Threat Model

**Trusted:**
- Repository maintainers
- GitHub Actions environment
- products.yml (version controlled)
- GitHub Secrets

**Untrusted:**
- Downloaded artifacts (not executed)
- External pull requests (workflows don't run)

### Security Controls

1. **Input Validation**
   - Product names sanitized before filesystem operations
   - Path traversal sequences rejected (`../`, `./`)
   - Configuration validated before processing

2. **Credential Management**
   - All credentials in GitHub Secrets
   - Never logged or committed
   - Token-based auth preferred

3. **Isolation**
   - Artifacts not executed
   - Each product has isolated directory
   - Workflows don't run on PRs

4. **Defense in Depth**
   - Even with repo write access, scripts validate input
   - Fail fast on invalid configuration
   - Clear error messages for debugging

### Security Improvements from v1.0

- ✅ Explicit path traversal checking
- ✅ Config validation before processing
- ✅ No redundant data copies (smaller attack surface)
- ✅ Simpler scripts (easier to audit)
- ✅ **Anonymous access for public repositories**
  - **S3**: No AWS credentials needed for public buckets
    - Eliminates risk of credential exposure in CI/CD
    - Works with public HTTP endpoints
    - Falls back to version_list if bucket listing disabled
  - **Artifactory**: REST API supports anonymous access
    - Public repositories (like flex-agent-release) work without credentials
    - Credentials auto-detected and used only if provided
    - Reduces attack surface for credential theft
- ✅ **SBOM protection mechanism**
  - Manually-committed SBOMs are protected from overwrite
  - Script checks for existing SBOMs before fetching
  - Prevents accidental data loss

---

## Extension Guide

### Adding a New Artifact Source

To add support for a new source (e.g., NPM, PyPI):

1. **Add source type to products.yml schema**

```yaml
- name: "New Product"
  source: "newsource"          # New source type
  newsource_url: "..."         # Source-specific config
  artifact_pattern: "*.tgz"
  max_versions: 10
```

2. **Add fetch function to fetch-and-generate.sh**

```bash
fetch_newsource() {
    local product_json="$1"
    local product_name=$(echo "$product_json" | jq -r '.name')
    local product_slug="$2"
    local newsource_url=$(echo "$product_json" | jq -r '.newsource_url')
    local pattern=$(echo "$product_json" | jq -r '.artifact_pattern')
    local max_versions=$(echo "$product_json" | jq -r '.max_versions')

    echo "  Fetching from newsource: $newsource_url"

    # Fetch and download artifacts
    # ...

    # Return list of downloaded files with versions
    echo "/path/to/artifact.tgz|1.2.3"
}
```

3. **Add case to main loop**

```bash
case "$SOURCE" in
    s3)
        artifacts=$(fetch_s3 "$product_json" "$slug")
        ;;
    maven)
        artifacts=$(fetch_maven "$product_json" "$slug")
        ;;
    artifactory)
        artifacts=$(fetch_artifactory "$product_json" "$slug")
        ;;
    newsource)
        artifacts=$(fetch_newsource "$product_json" "$slug")
        ;;
    *)
        echo "  ERROR: Unknown source type: $SOURCE"
        exit 1
        ;;
esac
```

4. **Update workflow if needed**

Add required secrets for the new source.

---

## Troubleshooting

### Common Issues

**"Configuration validation failed"**
- Check products.yml syntax with: `yq eval . config/products.yml`
- Ensure all required fields are present
- Check for duplicate product names

**"S3_BUCKET_URL not set"**
- Configure GitHub repository secrets
- Verify secret names match exactly

**"No artifacts found"**
- Check artifact_pattern matches actual filenames
- Verify credentials have access
- Test connectivity to source

**"SBOM generation failed"**
- Check artifact downloaded successfully
- Verify artifact is valid (not corrupted)
- Check Syft supports the file type

**"Website not updating"**
- Verify workflow committed changes to docs/
- Check GitHub Pages is enabled (Settings > Pages > Source: docs/)
- Wait 1-2 minutes for deployment

**"Product name shows incorrectly"**
- Check metadata.json exists in product directory
- Verify metadata.json contains correct canonical name
- Rebuild index: run build-index.sh

### Debugging Tips

**Test configuration validation:**
```bash
./scripts/fetch-and-generate.sh --validate-only
```

**Test single product locally:**
```bash
export S3_BUCKET_URL="..."
export S3_PUBLIC_URL="..."
./scripts/fetch-and-generate.sh --product="EOP"
```

**Check metadata:**
```bash
cat docs/sboms/*/metadata.json | jq
```

**Verify index:**
```bash
cat docs/sboms/index.json | jq '.products[] | {name, slug, versions: (.versions | length)}'
```

---

## Validation Checklist

Before merging changes:

- [ ] `products.yml` validates: `yq eval . config/products.yml`
- [ ] No duplicate product names
- [ ] Scripts are executable: `chmod +x scripts/*.sh`
- [ ] GitHub Secrets configured
- [ ] Test workflow runs successfully
- [ ] Generated SBOMs are valid JSON
- [ ] metadata.json exists for each product
- [ ] index.json builds correctly
- [ ] Website displays correct product names
- [ ] No credentials in logs or commits

---

## Changelog

### Version 2.1 (2026-02-09) - Enhanced Detection & Visualization

**New Features:**
- ✅ Enhanced Syft configuration with all catalogers enabled
- ✅ Binary cataloger support for Go, .NET, Node.js compiled artifacts
- ✅ Interactive dependency tree visualization
- ✅ npm, PyPI, and NuGet source support
- ✅ Per-version SBOM protection mechanism

**Improvements:**
- ✅ Comprehensive multi-language dependency detection
- ✅ File-explorer-style tree viewer with search
- ✅ Contrast Security branded visualization
- ✅ Export dependency trees as ASCII text
- ✅ Automatic skip of existing SBOMs

**Coverage Expansion:**
- ✅ Added 70 new SBOMs across 7 products
- ✅ All Contrast CLI platforms (Linux, Mac, Windows)
- ✅ Go Agent with binary cataloger
- ✅ Node Agent with enhanced detection
- ✅ .NET Core Agent and IIS Installer

### Version 2.0 (2026-02-08) - Simplified Architecture

**Breaking Changes:**
- Consolidated 4 fetch scripts into 1 unified script
- Eliminated manifest.json intermediate file
- Removed sboms/ directory (only docs/sboms/ now)
- Changed index.json format (no file paths)

**Improvements:**
- ✅ Metadata.json preserves canonical product names
- ✅ Config validation prevents runtime errors
- ✅ Path traversal protection
- ✅ 50% reduction in code complexity
- ✅ No redundant data storage
- ✅ Faster execution (less I/O)

**Migration from v1.0:**
- Delete old scripts: fetch-artifacts.sh, fetch-artifacts-*.sh, generate-sboms.sh
- Delete sboms/ directory (data moved to docs/sboms/)
- Update workflow to use new scripts
- Run new workflow to regenerate all SBOMs

### Version 1.0 (2026-02-08) - Initial

- Multi-source support (S3, Maven, Artifactory)
- Dual format SBOMs (SPDX, CycloneDX)
- GitHub Pages publishing

---

## Architecture Comparison

### v1.0 (Complex)
```
7 files, 800+ lines
fetch-artifacts.sh (orchestrator)
  ├── fetch-artifacts-s3.sh
  ├── fetch-artifacts-maven.sh
  └── fetch-artifacts-artifactory.sh
      └── creates manifest.json
          └── generate-sboms.sh
              └── writes to sboms/
                  └── build-index.sh (guesses names)
                      └── build-site.js (copies sboms/ to docs/sboms/)
                          └── docs/ (2x storage)
```

### v2.0 (Simple)
```
3 files, 400 lines
fetch-and-generate.sh (unified)
  └── writes to docs/sboms/ + metadata.json
      └── build-index.sh (reads metadata.json)
          └── build-site.js (copies templates only)
              └── docs/ (single copy)
```

**Metrics:**
- **Lines of code**: 800 → 400 (-50%)
- **Number of scripts**: 7 → 3 (-57%)
- **Disk usage**: 2x → 1x (-50%)
- **YAML parses**: 4 per product → 1 per product (-75%)
- **Data transformations**: 3 (fetch→manifest→sbom→index) → 2 (fetch→sbom→index) (-33%)

---

**End of Specification**
