# Contrast Security - Public SBOM Repository

Automated system for publishing Software Bill of Materials (SBOMs) for Contrast Security products.

🌐 **Live Site**: https://contrastsecurity.dev/sbom-public/

## Overview

This repository automatically generates and publishes SBOMs for Contrast Security products in both SPDX and CycloneDX formats. A modern, searchable web interface hosted on GitHub Pages provides easy access to all SBOMs for transparency and compliance.

## Features

- 🔄 **Automated SBOM Generation**: Workflow-triggered generation with manual dispatch option
- 📦 **Multi-Source Support**: Fetches artifacts from S3, Maven Central, npm, PyPI, and Artifactory
- 🔐 **Anonymous Access**: Works with public repositories without credentials
- 📋 **Dual Format**: SPDX and CycloneDX for maximum compatibility
- 🔍 **Searchable Interface**: Modern web UI with filtering and sorting
- 📱 **Mobile Responsive**: Works seamlessly on all devices
- ⚡ **Static Site**: Fast, no backend required

## Current SBOM Coverage

**9 of 11 products** • **94 versions** • **188 SBOM files** (SPDX + CycloneDX)

| Product | Versions | Source | Status |
|---------|----------|--------|--------|
| **EOP** | 13 | Manual (S3) | ✅ Active |
| **Java Agent** | 10 | Maven Central | ✅ Active |
| **Flex Agent** | 11 | Manual | ✅ Active |
| **Go Agent (Linux AMD64)** | 10 | Artifactory (public) | ✅ Active |
| **Contrast CLI Linux** | 10 | Artifactory (public) | ✅ Active |
| **Contrast CLI Mac** | 10 | Artifactory (public) | ✅ Active |
| **Contrast CLI Windows** | 10 | Artifactory (public) | ✅ Active |
| **Node Agent** | 10 | npm | ✅ Active |
| **Python Agent** | 10 | PyPI | ✅ Active |
| .NET Agent | - | Artifactory (private) | ⚠️ Requires credentials |
| .NET Agent IIS Installer | - | Artifactory (private) | ⚠️ Requires credentials |

## Architecture

### Technology Stack

- **SBOM Generator**: [Syft](https://github.com/anchore/syft) by Anchore
- **Automation**: GitHub Actions workflows
- **Hosting**: GitHub Pages (static site)
- **Frontend**: Vanilla JavaScript with modern UI

### Data Flow

```
┌─────────────┐
│   Sources   │
│  - S3       │
│  - Maven    │
│  - npm      │
│  - PyPI     │
│  - Artifactory│
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Fetch &    │
│  Generate   │
│  (Syft)     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Build     │
│   Index     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   GitHub    │
│   Pages     │
└─────────────┘
```

## Repository Structure

```
.
├── .github/workflows/
│   └── generate-sboms.yml    # Main automation workflow
├── config/
│   └── products.yml           # Product definitions
├── scripts/
│   ├── fetch-and-generate.sh  # Unified fetch + SBOM generation
│   ├── build-index.sh         # Index builder
│   └── build-site.js          # Static site builder
├── site/                      # Website source files
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── logo.svg
├── docs/                      # Generated GitHub Pages site
│   ├── sboms/                 # Generated SBOMs
│   │   ├── index.json         # Product/version index
│   │   ├── {product}/
│   │   │   ├── metadata.json
│   │   │   └── {version}/
│   │   │       ├── sbom.spdx.json
│   │   │       └── sbom.cyclonedx.json
│   └── [website files]
├── SPEC.md                    # Technical specification
└── README.md                  # This file
```

## Setup

### Prerequisites

1. **GitHub Repository** with Pages enabled:
   - Settings → Pages → Source: Deploy from branch
   - Branch: `master` → `/docs`

2. **Required GitHub Secrets**:
   ```
   ARTIFACTORY_URL      # Base URL (e.g., https://pkg.contrastsecurity.com/artifactory)
   S3_PUBLIC_URL        # Public S3 bucket URL (for EOP)
   ```

3. **Optional GitHub Secrets** (for private Artifactory repositories):
   ```
   ARTIFACTORY_USER     # Artifactory username
   ARTIFACTORY_PASSWORD # Artifactory password or API token
   ```

### Configuration

Products are configured in `config/products.yml`:

```yaml
products:
  # Maven Central example
  - name: "Java Agent"
    source: "maven"
    maven_group_id: "com.contrastsecurity"
    maven_artifact_id: "contrast-agent"
    max_versions: 10

  # npm registry example
  - name: "Node Agent"
    source: "npm"
    npm_package: "@contrast/agent"
    max_versions: 10

  # PyPI registry example
  - name: "Python Agent"
    source: "pypi"
    pypi_package: "contrast-agent"
    max_versions: 10

  # Artifactory with flat structure (version/file)
  - name: "Flex Agent"
    source: "artifactory"
    artifactory_path: "flex-agent-release"
    artifact_pattern: "contrast-flex-agent*"
    max_versions: 10

  # Artifactory with nested structure (version/platform/file)
  - name: "Go Agent (Linux AMD64)"
    source: "artifactory"
    artifactory_path: "go-agent-release"
    platform_subdir: "linux-amd64"
    artifact_pattern: "contrast-go*"
    max_versions: 10
```

See `config/products.yml` for complete examples.

**Platform Subdirectory Support**: For Artifactory repositories with nested version/platform/file structures, use the `platform_subdir` field to specify the platform directory within each version folder.

## Usage

### Viewing SBOMs

Visit the live site: https://contrastsecurity.dev/sbom-public/

Features:
- **Search**: Filter by product name or version
- **Sort**: By name, date, or version count
- **Download**: SPDX or CycloneDX formats
- **View**: Inspect SBOM content in-browser

### Manual Workflow Run

1. Go to **Actions** tab
2. Select **Generate SBOMs** workflow
3. Click **Run workflow**
4. Select branch and run

### Local Development

Test the website locally:

```bash
# Serve the docs directory
python3 -m http.server --directory docs 8000

# Or use any static file server
npx serve docs

# Visit http://localhost:8000
```

Test SBOM generation locally:

```bash
# Set environment variables
export ARTIFACTORY_URL="https://pkg.contrastsecurity.com/artifactory"
export S3_PUBLIC_URL="https://your-bucket.s3.amazonaws.com/path/"

# Run the fetch and generate script
./scripts/fetch-and-generate.sh

# Build the index
./scripts/build-index.sh

# Build the site
node scripts/build-site.js
```

## Adding New Products

1. **Edit** `config/products.yml`:

   ```yaml
   - name: "New Product"
     source: "maven"
     maven_group_id: "com.contrastsecurity"
     maven_artifact_id: "new-product"
     max_versions: 10
   ```

2. **Commit and push** changes

3. **Run workflow** manually or wait for next scheduled run

4. SBOMs will appear on the website automatically

## Enabling Private Artifactory Products

Currently, several products require Artifactory credentials. To enable them:

1. **Add GitHub Secrets** (if not already present):
   ```
   ARTIFACTORY_USER=your-username
   ARTIFACTORY_PASSWORD=your-password-or-token
   ```

2. **Run workflow** - products will be fetched automatically

## Maintenance

### Monitoring

- **Workflow Status**: Check Actions tab for run history
- **Email Notifications**: GitHub sends emails on workflow failures
- **Site Health**: Visit the live site to verify updates

### Storage Management

- **Workflow Artifacts**: Auto-deleted after 90 days
- **SBOMs in docs/**: Persisted in Git (small JSON files)
- **Repository Size**: Monitor with `git count-objects -vH`

### Updating the UI

1. Edit files in `site/` directory
2. Run `node scripts/build-site.js` to copy to `docs/`
3. Commit and push changes
4. GitHub Pages updates automatically

## Security

### Anonymous Access

The system is designed to work with public repositories:
- **S3**: Uses public HTTP endpoints (no AWS credentials)
- **Maven Central**: Public API
- **npm**: Public registry API
- **PyPI**: Public registry API
- **Artifactory**: Public repos use REST API anonymously

### Private Repositories

For private Artifactory repositories:
- Credentials stored as GitHub encrypted secrets
- Used only during workflow execution
- Never exposed in logs or outputs

### SBOM Protection

Manually-committed SBOMs are protected from overwrite:
- **EOP**: Manually committed from S3, protected by existence check in script
- **Flex Agent**: Manually committed, removed from products.yml to prevent fetching
- Products marked as manual are skipped during workflow execution
- To update manual SBOMs: Replace files directly and rebuild index

## Troubleshooting

### Workflow Failures

Check the Actions tab for detailed logs. Common issues:

- **Secrets not set**: Add required secrets in repository settings
- **Network errors**: Retry the workflow
- **Invalid config**: Validate `products.yml` syntax

### Missing Products

If a product doesn't appear:

1. Check workflow logs for fetch errors
2. Verify source repository/URL is correct
3. For Artifactory: Ensure credentials have read access
4. Check `docs/sboms/index.json` for product entry

### Website Not Updating

1. **Hard refresh** browser (Ctrl+Shift+R / Cmd+Shift+R)
2. Check GitHub Pages **Settings** → Pages → Build status
3. Wait 2-5 minutes for CDN cache to clear

## Technical Documentation

For detailed technical specifications, see [SPEC.md](SPEC.md).

Topics covered:
- Complete configuration schema
- Script implementation details
- Workflow specification
- Security model
- Extension guide

## Contributing

This is a Contrast Security internal project. For questions or issues:

1. Check the [SPEC.md](SPEC.md) for technical details
2. Review workflow logs in Actions tab
3. Contact the Contrast Security OSS team

## License

This repository is maintained by Contrast Security for transparency and compliance purposes.

The SBOMs published here are for informational purposes and subject to change.
