# Contrast Security - Public SBOM Repository

Automated system for publishing Software Bill of Materials (SBOMs) for all Contrast Security products.

## Overview

This repository automatically generates and publishes SBOMs for Contrast Security products in both SPDX and CycloneDX formats. A static website hosted on GitHub Pages provides searchable, filterable access to all SBOMs.

## Features

- 📦 Daily automated SBOM generation from Artifactory
- 🔄 Dual format support: SPDX and CycloneDX
- 🔍 Searchable web interface
- 📱 Mobile-responsive design
- ⚡ Fast, static site (no backend required)

## Architecture

- **Artifact Source**: Artifactory repositories
- **SBOM Generator**: Syft (by Anchore)
- **Automation**: GitHub Actions (daily at 2 AM UTC)
- **Hosting**: GitHub Pages

## Repository Structure

```
├── .github/workflows/     # GitHub Actions workflows
├── scripts/               # Automation scripts
├── config/               # Product configurations
├── site/                 # Static site source
├── docs/                 # Generated GitHub Pages site
└── sboms/               # Generated SBOMs (CI only)
```

## Configuration

Products are defined in `config/products.yml`. Add new products by specifying:

- Product name
- Artifactory repository and path
- Artifact patterns
- Exclusion patterns (optional)

## Setup

### Prerequisites

1. Repository secrets configured:
   - `ARTIFACTORY_URL`: Artifactory base URL
   - `ARTIFACTORY_TOKEN`: API token with read access

2. GitHub Pages enabled:
   - Settings → Pages → Source: Deploy from branch
   - Branch: main → /docs

### Local Development

Test the site locally:

```bash
# Serve the docs directory
python3 -m http.server --directory docs 8000

# Visit http://localhost:8000
```

## Workflow

The automated workflow runs daily:

1. Fetches artifacts from Artifactory
2. Generates SBOMs using Syft
3. Builds static site with search/filter UI
4. Deploys to GitHub Pages

Manual runs: Actions tab → "Generate SBOMs" → Run workflow

## Adding Products

Edit `config/products.yml`:

```yaml
products:
  - name: "Your Product Name"
    artifactory_repo: "repo-name"
    artifactory_path: "path/to/artifacts"
    artifact_pattern: "*.jar"
    exclude_patterns:
      - "*-sources.jar"
```

Changes take effect on the next workflow run.

## Maintenance

- **Monitoring**: GitHub Actions emails on failures
- **Storage**: Workflow runs auto-deleted after 90 days
- **Updates**: Edit `site/` files to modify UI

## License

This repository is maintained by Contrast Security for transparency and compliance purposes.

## Support

For issues or questions, contact the Contrast Security OSS team.
