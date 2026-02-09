# SBOM Public Repository - Development Notes

## Project Structure
- **Source files**: `site/app.js`, `site/index.html`, `site/styles.css`
- **Production**: `docs/` (served by GitHub Pages)
- **Build command**: `node scripts/build-site.js` (copies site/ to docs/)
- **Data source**: `docs/sboms/index.json` contains product metadata

## Key Features

### Version Display
- Default view shows current version only
- "Show All" button expands to display all versions
- Clickable badges:
  - Version count pill toggles expansion
  - Latest version pill opens SBOM preview modal

### Search & Autosuggest
- Search bar with intelligent autosuggest dropdown
- Shows products, versions, and packages with contextual information
- Package search across dependency trees
- Loads up to 5 versions per product for comprehensive search coverage
- Clear button (X) on all search inputs (main search + dependency tree search)
- Keyboard navigation support:
  - ↑/↓ arrow keys to navigate suggestions
  - Enter to select
  - Escape to close

### Repository Links
- External link icons on product cards
- Links to respective package managers and repositories
- Hover tooltips show destination (e.g., "View on Maven Central")

### Dependency Tree Modal
- Same autosuggest and clear functionality as main search
- Interactive tree with expand/collapse
- Click-to-copy package names
- Search filters tree in real-time

## Repository Link Mappings

Implementation in `getRepositoryUrl()` function in `site/app.js`:

| Product | Repository URL |
|---------|---------------|
| Java Agent | https://mvnrepository.com/artifact/com.contrastsecurity/contrast-agent |
| Python Agent | https://pypi.org/project/contrast-agent/ |
| Node Agent | https://www.npmjs.com/package/@contrast/agent |
| DotNet Core Agent | https://www.nuget.org/packages/Contrast.SensorsNetCore |
| DotNet Core IIS Installer | https://www.nuget.org/profiles/contrastsecurity |
| Flex Agent | https://pkg.contrastsecurity.com/artifactory/flex-agent-release/ |
| Go Agent (Linux AMD64) | https://pkg.contrastsecurity.com/artifactory/go-agent-release/ |
| EOP | https://hub.contrastsecurity.com |

## Technical Implementation Details

### Data Structures
- **`packageDetails`**: Map tracking `package → product → versions array`
- **`productPackages`**: Map of `product name → Set of package names`
- **`packageToProducts`**: Map of `package name → Set of product names`
- **`searchSuggestions`**: Array of all possible search suggestions
- **`treeSearchSuggestions`**: Array of suggestions for dependency tree search

### Key Functions

#### Search & Autosuggest
- **`buildSearchSuggestions()`**: Creates autosuggest data from products and packages
- **`handleSearchInput()`**: Toggles clear button visibility and shows suggestions
- **`showSuggestions(query)`**: Filters and displays matching suggestions
- **`selectSuggestion(text)`**: Handles suggestion selection
- **`handleSearchKeydown(event)`**: Manages keyboard navigation

#### Package Loading
- **`loadPackageData()`**: Fetches up to 5 versions per product for comprehensive search
- Runs in background after initial page load
- Builds `packageToProducts` and `packageDetails` mappings
- Shows loading badge during fetch

#### Repository Links
- **`getRepositoryUrl(product)`**: Maps product source to correct repository URL
- **`getSourceDisplayName(source)`**: Returns display name for tooltip (e.g., "Maven Central")

### Important Implementation Notes
- All interactive pills use `onclick` with `event.stopPropagation()` to prevent card click conflicts
- Search input uses `padding: 1rem 3rem 1rem 3rem` to accommodate both search icon and clear button
- Autosuggest dropdowns have max-height of 400px/300px with custom scrollbar styling
- Multi-version loading balances performance (5 versions) with comprehensive search coverage

## Building & Deploying

### Development Workflow
1. Make changes in `site/` directory
2. Run `node scripts/build-site.js` to copy to `docs/`
3. Test locally by opening `docs/index.html`
4. Commit both `site/` and `docs/` files
5. Push to GitHub - Pages auto-deploys from `docs/`

### Git Commands
```bash
# Build the site
node scripts/build-site.js

# Stage and commit changes
git add site/ docs/
git commit -m "Description of changes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# Push to remote
git push
```

## Future Enhancement Ideas
- Add filtering by date range
- Export search results to CSV
- Add version comparison view
- Implement SBOM diff between versions
- Add vulnerability scanning integration
- Enable bulk SBOM downloads
