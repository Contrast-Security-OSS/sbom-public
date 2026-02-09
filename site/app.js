// Modern SBOM Repository

let allProducts = [];
let filteredProducts = [];
let expandedProducts = new Set();
let sortOrder = 'desc'; // 'asc' or 'desc'
let productPackages = new Map(); // Map of product name -> Set of package names
let packageToProducts = new Map(); // Map of package name -> Set of product names
let packageDetails = new Map(); // Map of package name -> Map of (product name -> version info)
let packagesLoaded = false;
let searchSuggestions = []; // All possible search suggestions
let activeSuggestionIndex = -1; // For keyboard navigation

// Language and platform logo mapping (using transparent SVGs from CDNs)
const languageLogos = {
    'Java Agent': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg',
    'Python Agent': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg',
    'Node Agent': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg',
    'Go Agent (Linux AMD64)': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/go/go-original.svg',
    'DotNet Core Agent': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/dotnetcore/dotnetcore-original.svg',
    'EOP': 'contrast-icon.svg',
    'Flex Agent': 'contrast-icon.svg'
};

// Repository URL mapping based on source and slug
function getRepositoryUrl(product) {
    const source = product.source;
    const slug = product.slug;

    switch (source) {
        case 'maven':
            // Java Agent -> contrast-agent on Maven
            return 'https://mvnrepository.com/artifact/com.contrastsecurity/contrast-agent';
        case 'nuget':
            // Convert slug to package name
            if (slug === 'dotnet-core-agent') {
                return 'https://www.nuget.org/packages/Contrast.SensorsNetCore';
            } else if (slug === 'dotnet-core-iis-installer') {
                return 'https://www.nuget.org/profiles/contrastsecurity';
            }
            return `https://www.nuget.org/packages/${slug}`;
        case 'npm':
            return `https://www.npmjs.com/package/@contrast/agent`;
        case 'pypi':
            return `https://pypi.org/project/contrast-agent/`;
        case 'github':
            return `https://github.com/Contrast-Security-OSS/${slug}/releases`;
        case 'artifactory':
            // Artifactory links for specific agents
            if (slug === 'flex-agent') {
                return 'https://pkg.contrastsecurity.com/artifactory/flex-agent-release/';
            } else if (slug === 'go-agent-linux-amd64') {
                return 'https://pkg.contrastsecurity.com/artifactory/go-agent-release/';
            }
            // No repository links for other artifactory products
            return null;
        case 's3':
            // EOP links to Contrast Hub
            if (slug === 'eop') {
                return 'https://hub.contrastsecurity.com';
            }
            // No repository links for other S3 products
            return null;
        default:
            return null;
    }
}

// Get display name for repository source
function getSourceDisplayName(source) {
    switch (source) {
        case 'maven':
            return 'Maven Central';
        case 'nuget':
            return 'NuGet';
        case 'npm':
            return 'npm';
        case 'pypi':
            return 'PyPI';
        case 'artifactory':
            return 'Artifactory';
        case 's3':
            return 'Contrast Hub';
        case 'github':
            return 'GitHub';
        default:
            return 'Repository';
    }
}

// Format download count with K/M suffix for readability
function formatDownloadCount(count) {
    if (count === 0 || count === undefined || count === null) {
        return null; // Don't show if no data
    }

    if (count >= 1000000) {
        return (count / 1000000).toFixed(1) + 'M';
    } else if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'K';
    }
    return count.toLocaleString();
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadProducts();
    setupEventListeners();
    // Load package data in the background for search functionality
    loadPackageData();
});

// Load products from index.json
async function loadProducts() {
    try {
        const response = await fetch('sboms/index.json');
        if (!response.ok) {
            throw new Error('Failed to load product index');
        }

        const data = await response.json();
        allProducts = data.products || [];
        filteredProducts = [...allProducts];

        // Update stats with animation
        animateStats(data);

        // Render products
        renderProducts();
    } catch (error) {
        console.error('Error loading products:', error);
        showError(error.message);
    }
}

// Load package data from CycloneDX SBOMs for advanced search
async function loadPackageData() {
    console.log('Loading package data for search...');

    // Show loading badge
    const loadingBadge = document.getElementById('search-loading-badge');
    if (loadingBadge) {
        loadingBadge.style.display = 'flex';
    }

    try {
        const promises = allProducts.map(async (product) => {
            const packages = new Set();

            // Load multiple versions (up to first 5) to get better coverage
            const versionsToLoad = product.versions.slice(0, 5).filter(v => v.formats.includes('cyclonedx'));

            const versionPromises = versionsToLoad.map(async (version) => {
                const sbomUrl = `sboms/${product.slug}/${version.version}/sbom.cyclonedx.json`;

                try {
                    const response = await fetch(sbomUrl);
                    if (!response.ok) return;

                    const sbom = await response.json();
                    const components = sbom.components || [];

                    // Extract package names
                    components.forEach(comp => {
                        if (comp.name) {
                            const pkgName = comp.name.toLowerCase();
                            packages.add(pkgName);

                            // Build reverse mapping: package -> products
                            if (!packageToProducts.has(pkgName)) {
                                packageToProducts.set(pkgName, new Set());
                            }
                            packageToProducts.get(pkgName).add(product.name);

                            // Build detailed mapping: package -> product -> list of versions
                            if (!packageDetails.has(pkgName)) {
                                packageDetails.set(pkgName, new Map());
                            }
                            if (!packageDetails.get(pkgName).has(product.name)) {
                                packageDetails.get(pkgName).set(product.name, []);
                            }
                            const versions = packageDetails.get(pkgName).get(product.name);
                            if (!versions.includes(version.version)) {
                                versions.push(version.version);
                            }
                        }
                    });
                } catch (err) {
                    console.warn(`Failed to load packages for ${product.name} ${version.version}:`, err);
                }
            });

            await Promise.all(versionPromises);
            productPackages.set(product.name, packages);
        });

        await Promise.all(promises);
        packagesLoaded = true;

        // Calculate total packages found
        let totalPackages = 0;
        packageDetails.forEach(productMap => {
            totalPackages++;
        });

        console.log(`Package data loaded: ${productPackages.size} products, ${totalPackages} unique packages`);

        // Rebuild search suggestions with package data
        buildSearchSuggestions();

        // Hide loading badge with a short delay for visual feedback
        setTimeout(() => {
            if (loadingBadge) {
                loadingBadge.style.animation = 'fadeOut 0.3s ease-out';
                setTimeout(() => {
                    loadingBadge.style.display = 'none';
                    loadingBadge.style.animation = '';
                }, 300);
            }
        }, 500);

        // Re-apply filters if there's an active search
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value.trim()) {
            applyFilters();
        }
    } catch (error) {
        console.error('Error loading package data:', error);
        // Hide loading badge on error
        if (loadingBadge) {
            loadingBadge.style.display = 'none';
        }
    }
}

// Animate stats counters
function animateStats(data) {
    const productCount = data.products.length;
    const versionCount = data.products.reduce((sum, p) => sum + p.versions.length, 0);

    // Animate numbers
    animateCounter('stat-products', 0, productCount, 1000);
    animateCounter('stat-versions', 0, versionCount, 1500);

    // Update date
    if (data.generated) {
        const date = new Date(data.generated);
        const today = new Date();
        const diffDays = Math.floor((today - date) / (1000 * 60 * 60 * 24));

        let dateText;
        if (diffDays === 0) {
            dateText = 'Today';
        } else if (diffDays === 1) {
            dateText = '1 day ago';
        } else if (diffDays < 7) {
            dateText = `${diffDays} days ago`;
        } else {
            dateText = date.toLocaleDateString();
        }

        document.getElementById('stat-updated').textContent = dateText;
    }
}

// Animate counter
function animateCounter(id, start, end, duration) {
    const element = document.getElementById(id);
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if (current >= end) {
            element.textContent = end;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 16);
}

// Setup event listeners
function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');
    const sortSelect = document.getElementById('sort-select');
    const sortOrderToggle = document.getElementById('sort-order-toggle');
    const viewToggle = document.getElementById('view-toggle');

    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim()) {
            showSuggestions(searchInput.value);
        }
    });

    // Clear button functionality
    searchClearBtn.addEventListener('click', clearSearch);

    sortSelect.addEventListener('change', handleSort);
    sortOrderToggle.addEventListener('click', toggleSortOrder);
    viewToggle.addEventListener('click', toggleView);

    // Click outside to close suggestions
    document.addEventListener('click', (e) => {
        const suggestionsBox = document.getElementById('search-suggestions');
        if (!e.target.closest('.search-input-container')) {
            hideSuggestions();
        }
    });

    // Modal keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close suggestions first
            const suggestionsBox = document.getElementById('search-suggestions');
            if (suggestionsBox && suggestionsBox.style.display === 'block') {
                hideSuggestions();
                return;
            }

            // Close whichever modal is open
            const sbomModal = document.getElementById('sbom-modal');
            const treeModal = document.getElementById('tree-modal');

            if (sbomModal && sbomModal.style.display === 'flex') {
                closeModal();
            }
            if (treeModal && treeModal.style.display === 'flex') {
                closeTreeModal();
            }
        }
    });
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Build search suggestions from all available data
function buildSearchSuggestions() {
    const suggestions = [];

    // Add product names
    allProducts.forEach(product => {
        const versionCount = product.versions.length;
        const latestVersion = product.versions[0]?.version || '';
        let context = `${versionCount} version${versionCount !== 1 ? 's' : ''}`;
        if (latestVersion) {
            context += ` • latest: ${latestVersion}`;
        }
        suggestions.push({
            text: product.name,
            type: 'Product',
            icon: '📦',
            context: context
        });
    });

    // Add version numbers with product context
    const versionMap = new Map(); // version -> list of products
    allProducts.forEach(product => {
        product.versions.forEach(v => {
            if (!versionMap.has(v.version)) {
                versionMap.set(v.version, []);
            }
            versionMap.get(v.version).push(product.name);
        });
    });

    versionMap.forEach((products, version) => {
        const context = products.length === 1
            ? `in ${products[0]}`
            : `in ${products.length} products`;
        suggestions.push({
            text: version,
            type: 'Version',
            icon: '🏷️',
            context: context
        });
    });

    // Add package names with product and version context
    if (packagesLoaded) {
        const packages = Array.from(packageToProducts.entries())
            .sort((a, b) => b[1].size - a[1].size) // Sort by number of products (most common first)
            .slice(0, 500); // Limit to top 500 packages

        packages.forEach(([pkg, productSet]) => {
            const productList = Array.from(productSet);
            const productVersions = packageDetails.get(pkg);

            // Helper function to format version list
            const formatVersions = (versions) => {
                if (versions.length === 1) {
                    return versions[0];
                } else if (versions.length === 2) {
                    return versions.join(', ');
                } else if (versions.length === 3) {
                    return versions.join(', ');
                } else {
                    return `${versions.slice(0, 2).join(', ')} and ${versions.length - 2} more`;
                }
            };

            let context;
            if (productList.length === 1) {
                const versions = productVersions.get(productList[0]);
                const versionText = formatVersions(versions);
                const versionLabel = versions.length === 1 ? 'version' : 'versions';
                context = `in ${productList[0]} (${versions.length} ${versionLabel}: ${versionText})`;
            } else if (productList.length === 2) {
                const versions1 = productVersions.get(productList[0]);
                const versions2 = productVersions.get(productList[1]);
                context = `in ${productList[0]} (${versions1.length} ver.), ${productList[1]} (${versions2.length} ver.)`;
            } else {
                const versions1 = productVersions.get(productList[0]);
                const versions2 = productVersions.get(productList[1]);
                context = `in ${productList[0]} (${versions1.length} ver.), ${productList[1]} (${versions2.length} ver.) and ${productList.length - 2} more`;
            }

            suggestions.push({
                text: pkg,
                type: 'Package',
                icon: '📘',
                context: context
            });
        });
    }

    searchSuggestions = suggestions;
}

// Handle search input with suggestions
function handleSearchInput(event) {
    const query = event.target.value.trim();
    const clearBtn = document.getElementById('search-clear-btn');

    // Toggle clear button visibility
    if (event.target.value.length > 0) {
        clearBtn.style.display = 'flex';
    } else {
        clearBtn.style.display = 'none';
    }

    if (query.length > 0) {
        showSuggestions(query);
    } else {
        hideSuggestions();
    }

    // Apply filters with debounce
    debounce(() => applyFilters(), 300)();
}

// Clear search input and reset filters
function clearSearch() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');

    searchInput.value = '';
    clearBtn.style.display = 'none';
    hideSuggestions();
    applyFilters();
    searchInput.focus();
}

// Show search suggestions
function showSuggestions(query) {
    if (searchSuggestions.length === 0) {
        buildSearchSuggestions();
    }

    const suggestionsBox = document.getElementById('search-suggestions');
    const lowerQuery = query.toLowerCase();

    // Filter and rank suggestions
    const matches = searchSuggestions
        .filter(s => s.text.toLowerCase().includes(lowerQuery))
        .sort((a, b) => {
            // Prioritize starts-with matches
            const aStarts = a.text.toLowerCase().startsWith(lowerQuery);
            const bStarts = b.text.toLowerCase().startsWith(lowerQuery);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            // Then by type (products > versions > packages)
            const typeOrder = { 'Product': 0, 'Version': 1, 'Package': 2 };
            return typeOrder[a.type] - typeOrder[b.type];
        })
        .slice(0, 10); // Limit to 10 suggestions

    if (matches.length === 0) {
        hideSuggestions();
        return;
    }

    // Render suggestions
    suggestionsBox.innerHTML = matches.map((suggestion, index) => {
        const highlightedText = highlightMatch(suggestion.text, query);
        return `
            <div class="search-suggestion-item ${index === 0 ? 'active' : ''}"
                 data-index="${index}"
                 onclick="selectSuggestion('${escapeHtml(suggestion.text)}')">
                <span class="suggestion-icon">${suggestion.icon}</span>
                <div class="suggestion-content">
                    <div class="suggestion-text">${highlightedText}</div>
                    <div class="suggestion-meta">
                        <span class="suggestion-type">${suggestion.type}</span>
                        ${suggestion.context ? `<span class="suggestion-context">${escapeHtml(suggestion.context)}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    suggestionsBox.style.display = 'block';
    activeSuggestionIndex = 0;
}

// Hide suggestions
function hideSuggestions() {
    const suggestionsBox = document.getElementById('search-suggestions');
    suggestionsBox.style.display = 'none';
    activeSuggestionIndex = -1;
}

// Highlight matching text
function highlightMatch(text, query) {
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return escapeHtml(text).replace(regex, '<mark>$1</mark>');
}

// Escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Handle keyboard navigation in suggestions
function handleSearchKeydown(event) {
    const suggestionsBox = document.getElementById('search-suggestions');
    if (suggestionsBox.style.display !== 'block') return;

    const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
        updateActiveSuggestion(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
        updateActiveSuggestion(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
            const text = items[activeSuggestionIndex].querySelector('.suggestion-text').textContent;
            selectSuggestion(text);
        }
    } else if (event.key === 'Escape') {
        hideSuggestions();
    }
}

// Update active suggestion visual state
function updateActiveSuggestion(items) {
    items.forEach((item, index) => {
        if (index === activeSuggestionIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('active');
        }
    });
}

// Select a suggestion
function selectSuggestion(text) {
    const searchInput = document.getElementById('search-input');
    searchInput.value = text;
    hideSuggestions();
    applyFilters();
}

// Handle search
function handleSearch(event) {
    applyFilters();
}

// Handle sort
function handleSort(event) {
    const sortBy = event.target.value;

    switch (sortBy) {
        case 'name':
            filteredProducts.sort((a, b) => {
                const result = a.name.localeCompare(b.name);
                return sortOrder === 'asc' ? result : -result;
            });
            break;
        case 'date':
            filteredProducts.sort((a, b) => {
                const dateA = a.versions[0]?.generatedAt || '0000-00-00';
                const dateB = b.versions[0]?.generatedAt || '0000-00-00';
                const result = dateB.localeCompare(dateA);
                return sortOrder === 'desc' ? result : -result;
            });
            break;
        case 'versions':
            filteredProducts.sort((a, b) => {
                const result = b.versions.length - a.versions.length;
                return sortOrder === 'desc' ? result : -result;
            });
            break;
    }

    renderProducts();
}

// Toggle sort order
function toggleSortOrder() {
    sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('sort-order-toggle');
    btn.classList.toggle('descending', sortOrder === 'desc');

    // Re-apply current sort
    const sortSelect = document.getElementById('sort-select');
    handleSort({ target: sortSelect });
}

// Toggle view (grid/list)
let currentView = 'grid';
function toggleView() {
    const grid = document.getElementById('product-grid');
    currentView = currentView === 'grid' ? 'list' : 'grid';

    if (currentView === 'list') {
        grid.style.gridTemplateColumns = '1fr';
    } else {
        grid.style.gridTemplateColumns = '';
    }
}

// Toggle date filter panel
// Apply search filter
function applyFilters() {
    const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();

    filteredProducts = allProducts.filter(product => {
        // Apply search filter
        if (searchQuery) {
            // Search in product name
            if (product.name.toLowerCase().includes(searchQuery)) {
                return true;
            }

            // Search in version numbers
            if (product.versions.some(v => v.version.toLowerCase().includes(searchQuery))) {
                return true;
            }

            // Search in dependency packages (if loaded)
            if (packagesLoaded && productPackages.has(product.name)) {
                const packages = productPackages.get(product.name);
                for (const packageName of packages) {
                    if (packageName.includes(searchQuery)) {
                        return true;
                    }
                }
            }

            return false;
        }
        return true;
    });

    // Re-apply current sort
    const sortSelect = document.getElementById('sort-select');
    handleSort({ target: sortSelect });
}

// Render products
function renderProducts() {
    const productGrid = document.getElementById('product-grid');
    const noResults = document.getElementById('no-results');

    if (filteredProducts.length === 0) {
        productGrid.style.display = 'none';
        noResults.style.display = 'block';
        return;
    }

    productGrid.style.display = 'grid';
    noResults.style.display = 'none';

    productGrid.innerHTML = filteredProducts.map(product =>
        renderProductCard(product)
    ).join('');
}

// Render single product card
function renderProductCard(product) {
    const isExpanded = expandedProducts.has(product.name);
    const latestVersion = product.versions[0];
    const logo = languageLogos[product.name];
    const downloadCount = formatDownloadCount(product.downloadCount);

    // Show only the latest version by default, or all versions when expanded
    const versionsToShow = isExpanded ? product.versions : [latestVersion];

    // Construct SBOM URL for latest version
    const latestSpdxUrl = latestVersion ? `sboms/${product.slug}/${latestVersion.version}/sbom.spdx.json` : '';
    const latestHasSpdx = latestVersion && latestVersion.formats.includes('spdx');

    const repoUrl = getRepositoryUrl(product);

    return `
        <div class="product-card">
            <div class="product-header">
                <h2 class="product-name">
                    ${logo ? `<img src="${logo}" alt="${escapeHtml(product.name)} logo" class="product-logo" />` : ''}
                    <span class="product-name-text">${escapeHtml(product.name)}</span>
                    ${repoUrl ? `
                        <a href="${escapeHtml(repoUrl)}"
                           target="_blank"
                           rel="noopener noreferrer"
                           class="product-repo-link"
                           title="View on ${getSourceDisplayName(product.source)}"
                           onclick="event.stopPropagation()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                <polyline points="15 3 21 3 21 9"></polyline>
                                <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                        </a>
                    ` : ''}
                </h2>
                <div class="product-meta">
                    ${downloadCount ? `
                        <span class="meta-badge download-badge">
                            <svg class="download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span class="download-count">${downloadCount}</span>
                        </span>
                    ` : ''}
                    ${product.versions.length > 1 ? `
                        <span class="meta-badge meta-badge-clickable"
                              onclick="toggleProductVersions('${escapeHtml(product.name)}')"
                              title="Click to ${isExpanded ? 'hide' : 'show all'} versions">
                            📦 ${product.versions.length} versions
                        </span>
                    ` : `
                        <span class="meta-badge">
                            📦 1 version
                        </span>
                    `}
                    ${latestVersion && latestHasSpdx ? `
                        <span class="meta-badge meta-badge-clickable"
                              onclick="viewSBOM('${escapeHtml(latestSpdxUrl)}', '${escapeHtml(product.name)} ${escapeHtml(latestVersion.version)}')"
                              title="Click to view SBOM">
                            🆕 ${escapeHtml(latestVersion.version)}
                        </span>
                    ` : latestVersion ? `
                        <span class="meta-badge">
                            🆕 ${escapeHtml(latestVersion.version)}
                        </span>
                    ` : ''}
                </div>
            </div>

            <div class="versions-section">
                <div class="versions-header">
                    <span class="versions-title">${isExpanded ? 'All Versions' : 'Current Version'}</span>
                    ${product.versions.length > 1 ? `
                        <span class="versions-toggle" onclick="toggleProductVersions('${escapeHtml(product.name)}')">
                            ${isExpanded ? 'Hide' : 'Show All'}
                        </span>
                    ` : ''}
                </div>

                <div class="version-list">
                    ${versionsToShow.map(version => renderVersionItem(product, version)).join('')}
                </div>
            </div>
        </div>
    `;
}

// Render version item
function renderVersionItem(product, version) {
    // Construct SBOM URLs from slug, version, and format
    const spdxUrl = `sboms/${product.slug}/${version.version}/sbom.spdx.json`;
    const cyclonedxUrl = `sboms/${product.slug}/${version.version}/sbom.cyclonedx.json`;

    // Check which formats are available
    const hasSpdx = version.formats.includes('spdx');
    const hasCyclonedx = version.formats.includes('cyclonedx');

    return `
        <div class="version-item">
            <div class="version-info">
                <div class="version-number">${escapeHtml(version.version)}</div>
                <div class="version-date">Generated: ${formatDate(version.generatedAt)}</div>
            </div>
            <div class="version-actions">
                ${hasSpdx ? `
                    <button
                        class="btn-format"
                        onclick="downloadSBOM('${escapeHtml(spdxUrl)}', '${escapeHtml(product.name)}-${escapeHtml(version.version)}-spdx.json')"
                        title="Download SPDX format"
                    >
                        SPDX
                    </button>
                ` : ''}
                ${hasCyclonedx ? `
                    <button
                        class="btn-format"
                        onclick="downloadSBOM('${escapeHtml(cyclonedxUrl)}', '${escapeHtml(product.name)}-${escapeHtml(version.version)}-cyclonedx.json')"
                        title="Download CycloneDX format"
                    >
                        CycloneDX
                    </button>
                ` : ''}
                ${hasCyclonedx ? `
                    <button
                        class="btn-icon"
                        onclick="viewDependencyTree('${escapeHtml(cyclonedxUrl)}', '${escapeHtml(product.name)}', '${escapeHtml(version.version)}')"
                        title="View interactive dependency tree"
                        aria-label="View dependency tree for ${escapeHtml(product.name)} ${escapeHtml(version.version)}"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="7" r="2"/>
                            <path d="M12 9v6"/>
                            <circle cx="8" cy="17" r="2"/>
                            <circle cx="16" cy="17" r="2"/>
                            <path d="M12 15l-2.5 1.5"/>
                            <path d="M12 15l2.5 1.5"/>
                        </svg>
                    </button>
                ` : ''}
                ${hasSpdx ? `
                    <button
                        class="btn-icon"
                        onclick="viewSBOM('${escapeHtml(spdxUrl)}', '${escapeHtml(product.name)} ${escapeHtml(version.version)}')"
                        title="Preview SBOM contents"
                        aria-label="Preview SBOM for ${escapeHtml(product.name)} ${escapeHtml(version.version)}"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

// Toggle product versions
function toggleProductVersions(productName) {
    if (expandedProducts.has(productName)) {
        expandedProducts.delete(productName);
    } else {
        expandedProducts.add(productName);
    }
    renderProducts();
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Download SBOM
function downloadSBOM(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Show toast notification
    showToast('Download started');
}

// View SBOM in modal
async function viewSBOM(url, title) {
    const modal = document.getElementById('sbom-modal');
    const modalTitle = document.getElementById('modal-title');
    const sbomContent = document.getElementById('sbom-content');

    modalTitle.textContent = title;
    sbomContent.innerHTML = '<code>Loading...</code>';
    modal.style.display = 'flex';

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to load SBOM');
        }

        const data = await response.json();
        const formatted = JSON.stringify(data, null, 2);
        sbomContent.innerHTML = `<code>${escapeHtml(formatted)}</code>`;
    } catch (error) {
        console.error('Error loading SBOM:', error);
        sbomContent.innerHTML = `<code>Error loading SBOM: ${escapeHtml(error.message)}</code>`;
    }
}

// Close modal
function closeModal() {
    const modal = document.getElementById('sbom-modal');
    modal.style.display = 'none';
}

// Show error
function showError(message) {
    const productGrid = document.getElementById('product-grid');
    productGrid.innerHTML = `
        <div class="loading-state">
            <div class="no-results-icon">⚠️</div>
            <h3>Error loading products</h3>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

// Show toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: var(--primary);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 10px;
        box-shadow: var(--shadow-lg);
        animation: slideIn 0.3s ease-out;
        z-index: 2000;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Dependency Tree Modal - State
let treeData = null;
let expandedNodes = new Set();
let treeSearchQuery = '';
let userExpandedAll = false;
let treeSearchSuggestions = [];
let activeTreeSuggestionIndex = -1;

// View dependency tree
async function viewDependencyTree(sbomUrl, productName, version) {
    const modal = document.getElementById('tree-modal');
    const modalTitle = document.getElementById('tree-modal-title');
    const treeContent = document.getElementById('tree-content');
    const treeLoading = document.getElementById('tree-loading');

    // Reset state
    treeData = null;
    expandedNodes = new Set();
    treeSearchQuery = '';
    userExpandedAll = false;

    // Update title
    modalTitle.textContent = `${productName} ${version} - Dependency Tree`;

    // Show modal and loading
    modal.style.display = 'flex';
    treeLoading.style.display = 'flex';
    treeContent.style.display = 'none';
    treeContent.innerHTML = '';

    // Setup event listeners (only once)
    if (!modal.dataset.listenersSet) {
        const treeSearchInput = document.getElementById('tree-search-input');
        const treeSearchClearBtn = document.getElementById('tree-search-clear-btn');

        treeSearchInput.addEventListener('input', handleTreeSearch);
        treeSearchInput.addEventListener('keydown', handleTreeSearchKeydown);
        treeSearchInput.addEventListener('focus', () => {
            if (treeSearchInput.value.trim()) {
                showTreeSuggestions(treeSearchInput.value);
            }
        });

        treeSearchClearBtn.addEventListener('click', clearTreeSearch);

        document.getElementById('tree-expand-all-btn').addEventListener('click', expandAllTree);
        document.getElementById('tree-collapse-all-btn').addEventListener('click', collapseAllTree);
        document.getElementById('tree-export-btn').addEventListener('click', () => exportTree(productName, version));

        // Click outside to close tree suggestions
        document.addEventListener('click', (e) => {
            const suggestionsBox = document.getElementById('tree-search-suggestions');
            if (suggestionsBox && !e.target.closest('.tree-controls .search-input-container')) {
                hideTreeSuggestions();
            }
        });

        modal.dataset.listenersSet = 'true';
    }

    // Clear search input and suggestions
    document.getElementById('tree-search-input').value = '';
    document.getElementById('tree-search-clear-btn').style.display = 'none';
    hideTreeSuggestions();

    try {
        const response = await fetch(sbomUrl);
        if (!response.ok) throw new Error('Failed to load SBOM');

        const sbom = await response.json();
        treeData = parseCycloneDX(sbom, productName, version);

        if (!treeData || treeData.children.length === 0) {
            treeLoading.innerHTML = '<div class="tree-empty">No dependency information found in this SBOM.</div>';
            return;
        }

        // Expand root by default
        expandedNodes.add(getNodeId(treeData));

        updateTreeStats(treeData);
        buildTreeSearchSuggestions();
        renderTree();

        treeLoading.style.display = 'none';
        treeContent.style.display = 'block';
    } catch (error) {
        treeLoading.innerHTML = `<div class="tree-empty" style="color: var(--accent);">Error loading SBOM: ${escapeHtml(error.message)}</div>`;
    }
}

function closeTreeModal() {
    const modal = document.getElementById('tree-modal');
    modal.style.display = 'none';

    // Reset state
    treeData = null;
    expandedNodes = new Set();
    treeSearchQuery = '';
    userExpandedAll = false;
    treeSearchSuggestions = [];
    activeTreeSuggestionIndex = -1;
    hideTreeSuggestions();
}

function parseCycloneDX(sbom, productName, version) {
    const components = sbom.components || [];
    const dependencies = sbom.dependencies || [];

    const componentMap = new Map();
    components.forEach(comp => {
        const ref = comp.purl || comp['bom-ref'] || comp.name;
        componentMap.set(ref, {
            name: comp.name,
            version: comp.version || 'unknown',
            type: comp.type || 'library',
            purl: comp.purl,
            description: comp.description,
            licenses: comp.licenses
        });
    });

    let rootRef = null;
    if (sbom.metadata && sbom.metadata.component) {
        rootRef = sbom.metadata.component.purl || sbom.metadata.component['bom-ref'] || sbom.metadata.component.name;
    }

    if (!rootRef && dependencies.length > 0) {
        rootRef = dependencies[0].ref;
    }

    if (!rootRef && components.length > 0) {
        rootRef = components[0].purl || components[0]['bom-ref'] || components[0].name;
    }

    const root = {
        name: sbom.metadata?.component?.name || productName || 'Root Package',
        version: sbom.metadata?.component?.version || version || '',
        children: [],
        type: 'root',
        depth: 0,
        id: 'root'
    };

    const processedRefs = new Set();

    function buildTree(ref, depth = 1, maxDepth = 10) {
        if (depth > maxDepth || processedRefs.has(ref)) {
            return null;
        }
        processedRefs.add(ref);

        const component = componentMap.get(ref);
        if (!component) return null;

        const node = {
            name: component.name,
            version: component.version,
            type: depth === 1 ? 'direct' : 'transitive',
            depth: depth,
            purl: component.purl,
            description: component.description,
            licenses: component.licenses,
            children: [],
            id: `${component.name}@${component.version}-${depth}`
        };

        const dep = dependencies.find(d => d.ref === ref);
        if (dep && dep.dependsOn) {
            dep.dependsOn.forEach(childRef => {
                const childNode = buildTree(childRef, depth + 1, maxDepth);
                if (childNode) {
                    node.children.push(childNode);
                }
            });
        }

        return node;
    }

    if (dependencies.length > 0) {
        const rootDep = dependencies.find(d => d.ref === rootRef);
        if (rootDep && rootDep.dependsOn) {
            rootDep.dependsOn.forEach(depRef => {
                const childNode = buildTree(depRef, 1);
                if (childNode) {
                    root.children.push(childNode);
                }
            });
        }
    }

    if (root.children.length === 0 && components.length > 0) {
        components.slice(0, 100).forEach((comp, i) => {
            root.children.push({
                name: comp.name,
                version: comp.version || 'unknown',
                type: 'direct',
                depth: 1,
                purl: comp.purl,
                description: comp.description,
                licenses: comp.licenses,
                children: [],
                id: `${comp.name}@${comp.version || 'unknown'}-1-${i}`
            });
        });
    }

    return root;
}

function getNodeId(node) {
    return node.id || `${node.name}@${node.version}-${node.depth || 0}`;
}

function updateTreeStats(tree) {
    let totalPackages = 0;
    let directDeps = 0;
    let transitiveDeps = 0;

    function countNodes(node) {
        totalPackages++;
        if (node.type === 'direct') directDeps++;
        if (node.type === 'transitive') transitiveDeps++;
        if (node.children) {
            node.children.forEach(countNodes);
        }
    }

    if (tree.children) {
        tree.children.forEach(countNodes);
    }

    document.getElementById('tree-stat-total').textContent = totalPackages;
    document.getElementById('tree-stat-direct').textContent = directDeps;
    document.getElementById('tree-stat-transitive').textContent = transitiveDeps;
}

// Build tree search suggestions from current tree data
function buildTreeSearchSuggestions() {
    const suggestions = [];
    const seen = new Set();

    function extractPackages(node) {
        const packageId = `${node.name}@${node.version || ''}`.toLowerCase();
        if (!seen.has(packageId)) {
            seen.add(packageId);
            suggestions.push({
                text: node.name,
                version: node.version || '',
                type: node.type || 'package',
                icon: node.type === 'direct' ? '📘' : '📙'
            });
        }

        if (node.children) {
            node.children.forEach(extractPackages);
        }
    }

    if (treeData && treeData.children) {
        treeData.children.forEach(extractPackages);
    }

    treeSearchSuggestions = suggestions;
}

function handleTreeSearch(e) {
    const query = e.target.value.trim();
    const clearBtn = document.getElementById('tree-search-clear-btn');

    // Toggle clear button visibility
    if (e.target.value.length > 0) {
        clearBtn.style.display = 'flex';
    } else {
        clearBtn.style.display = 'none';
    }

    if (query.length > 0) {
        showTreeSuggestions(query);
    } else {
        hideTreeSuggestions();
    }

    treeSearchQuery = query.toLowerCase();
    userExpandedAll = false;
    renderTree();
}

// Clear tree search
function clearTreeSearch() {
    const treeSearchInput = document.getElementById('tree-search-input');
    const clearBtn = document.getElementById('tree-search-clear-btn');

    treeSearchInput.value = '';
    clearBtn.style.display = 'none';
    hideTreeSuggestions();
    treeSearchQuery = '';
    userExpandedAll = false;
    renderTree();
    treeSearchInput.focus();
}

// Show tree search suggestions
function showTreeSuggestions(query) {
    if (treeSearchSuggestions.length === 0) {
        buildTreeSearchSuggestions();
    }

    const suggestionsBox = document.getElementById('tree-search-suggestions');
    const lowerQuery = query.toLowerCase();

    // Filter and rank suggestions
    const matches = treeSearchSuggestions
        .filter(s => s.text.toLowerCase().includes(lowerQuery))
        .sort((a, b) => {
            // Prioritize starts-with matches
            const aStarts = a.text.toLowerCase().startsWith(lowerQuery);
            const bStarts = b.text.toLowerCase().startsWith(lowerQuery);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            // Then by type (direct > transitive)
            if (a.type === 'direct' && b.type !== 'direct') return -1;
            if (a.type !== 'direct' && b.type === 'direct') return 1;
            return 0;
        })
        .slice(0, 10); // Limit to 10 suggestions

    if (matches.length === 0) {
        hideTreeSuggestions();
        return;
    }

    // Render suggestions
    suggestionsBox.innerHTML = matches.map((suggestion, index) => {
        const highlightedText = highlightMatch(suggestion.text, query);
        const displayText = suggestion.version ? `${suggestion.text}@${suggestion.version}` : suggestion.text;
        const highlightedDisplay = suggestion.version
            ? `${highlightedText}@${escapeHtml(suggestion.version)}`
            : highlightedText;

        return `
            <div class="search-suggestion-item ${index === 0 ? 'active' : ''}"
                 data-index="${index}"
                 onclick="selectTreeSuggestion('${escapeHtml(suggestion.text)}')">
                <span class="suggestion-icon">${suggestion.icon}</span>
                <div class="suggestion-content">
                    <div class="suggestion-text">${highlightedDisplay}</div>
                    <div class="suggestion-meta">
                        <span class="suggestion-type">${suggestion.type === 'direct' ? 'Direct' : 'Transitive'}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    suggestionsBox.style.display = 'block';
    activeTreeSuggestionIndex = 0;
}

// Hide tree suggestions
function hideTreeSuggestions() {
    const suggestionsBox = document.getElementById('tree-search-suggestions');
    suggestionsBox.style.display = 'none';
    activeTreeSuggestionIndex = -1;
}

// Select a tree suggestion
function selectTreeSuggestion(text) {
    const treeSearchInput = document.getElementById('tree-search-input');
    treeSearchInput.value = text;
    hideTreeSuggestions();
    treeSearchQuery = text.toLowerCase();
    userExpandedAll = false;
    renderTree();
}

// Handle keyboard navigation in tree suggestions
function handleTreeSearchKeydown(event) {
    const suggestionsBox = document.getElementById('tree-search-suggestions');
    if (suggestionsBox.style.display !== 'block') return;

    const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeTreeSuggestionIndex = (activeTreeSuggestionIndex + 1) % items.length;
        updateActiveTreeSuggestion(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeTreeSuggestionIndex = (activeTreeSuggestionIndex - 1 + items.length) % items.length;
        updateActiveTreeSuggestion(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (activeTreeSuggestionIndex >= 0 && items[activeTreeSuggestionIndex]) {
            const text = items[activeTreeSuggestionIndex].querySelector('.suggestion-text').textContent.split('@')[0];
            selectTreeSuggestion(text);
        }
    } else if (event.key === 'Escape') {
        hideTreeSuggestions();
    }
}

// Update active tree suggestion visual state
function updateActiveTreeSuggestion(items) {
    items.forEach((item, index) => {
        if (index === activeTreeSuggestionIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('active');
        }
    });
}

function matchesTreeSearch(node) {
    if (!treeSearchQuery) return true;

    const matchesName = node.name.toLowerCase().includes(treeSearchQuery);
    const matchesVersion = node.version && node.version.toLowerCase().includes(treeSearchQuery);
    const matchesDescription = node.description && node.description.toLowerCase().includes(treeSearchQuery);

    return matchesName || matchesVersion || matchesDescription;
}

function hasMatchingChild(node) {
    if (!node.children || node.children.length === 0) return false;

    for (const child of node.children) {
        if (matchesTreeSearch(child) || hasMatchingChild(child)) {
            return true;
        }
    }
    return false;
}

function renderTree() {
    const container = document.getElementById('tree-content');

    if (!treeData) {
        container.innerHTML = '<div class="tree-empty">No data to display</div>';
        return;
    }

    if (treeSearchQuery && !userExpandedAll) {
        expandMatchingPaths(treeData);
    }

    const html = renderTreeNode(treeData, 0);
    container.innerHTML = html;
}

function expandMatchingPaths(node) {
    if (matchesTreeSearch(node)) {
        expandedNodes.add(getNodeId(node));
    }

    if (node.children && node.children.length > 0) {
        const hasMatch = node.children.some(child =>
            matchesTreeSearch(child) || hasMatchingChild(child)
        );

        if (hasMatch) {
            expandedNodes.add(getNodeId(node));
            node.children.forEach(expandMatchingPaths);
        }
    }
}

function renderTreeNode(node, level) {
    const nodeId = getNodeId(node);
    const isExpanded = expandedNodes.has(nodeId);
    const hasChildren = node.children && node.children.length > 0;

    const nodeMatches = matchesTreeSearch(node);
    const childMatches = hasMatchingChild(node);

    if (treeSearchQuery && !nodeMatches && !childMatches) {
        return '';
    }

    const highlightClass = treeSearchQuery && nodeMatches ? 'highlight' : '';

    const packageString = node.version ? `${node.name}@${node.version}` : node.name;

    let html = `
        <div class="tree-node ${highlightClass}" style="padding-left: ${level * 24}px;">
            <div class="node-content">
                <div class="node-main" onclick="toggleTreeNode('${escapeHtml(nodeId)}')">
                    ${hasChildren ? `
                        <span class="node-toggle">
                            ${isExpanded ? '▼' : '▶'}
                        </span>
                    ` : '<span class="node-toggle node-empty">•</span>'}

                    <span class="node-icon ${node.type}">
                        ${node.type === 'root' ? '📦' : node.type === 'direct' ? '📘' : '📙'}
                    </span>

                    <span class="node-name">${escapeHtml(node.name)}</span>

                    ${node.version ? `
                        <span class="node-version">@${escapeHtml(node.version)}</span>
                    ` : ''}

                    ${hasChildren ? `
                        <span class="node-count">(${node.children.length})</span>
                    ` : ''}
                </div>
                <button
                    class="node-copy-btn"
                    onclick="event.stopPropagation(); copyNodeToClipboard('${escapeHtml(packageString)}')"
                    title="Copy ${escapeHtml(packageString)}"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
            </div>

            ${node.description ? `
                <div class="node-description">${escapeHtml(node.description.substring(0, 100))}${node.description.length > 100 ? '...' : ''}</div>
            ` : ''}

            ${node.licenses && node.licenses.length > 0 ? `
                <div class="node-license">
                    License: ${node.licenses.map(l => l.license?.name || l.license?.id || 'Unknown').join(', ')}
                </div>
            ` : ''}
        </div>
    `;

    if (hasChildren && isExpanded) {
        html += '<div class="node-children">';
        node.children.forEach(child => {
            html += renderTreeNode(child, level + 1);
        });
        html += '</div>';
    }

    return html;
}

function toggleTreeNode(nodeId) {
    userExpandedAll = false;
    if (expandedNodes.has(nodeId)) {
        expandedNodes.delete(nodeId);
    } else {
        expandedNodes.add(nodeId);
    }
    renderTree();
}

function expandAllTree() {
    userExpandedAll = true;
    function addAllNodes(node) {
        expandedNodes.add(getNodeId(node));
        if (node.children) {
            node.children.forEach(addAllNodes);
        }
    }
    addAllNodes(treeData);
    renderTree();
}

function collapseAllTree() {
    userExpandedAll = true;
    expandedNodes.clear();
    expandedNodes.add(getNodeId(treeData));
    renderTree();
}

function exportTree(productName, version) {
    let text = '';

    function exportNode(node, prefix = '', isLast = true) {
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';

        text += prefix + connector + node.name;
        if (node.version) text += `@${node.version}`;
        text += '\n';

        if (node.children && node.children.length > 0) {
            node.children.forEach((child, i) => {
                exportNode(child, prefix + childPrefix, i === node.children.length - 1);
            });
        }
    }

    exportNode(treeData);

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${productName}-${version}-dependency-tree.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function copyNodeToClipboard(packageString) {
    try {
        await navigator.clipboard.writeText(packageString);
        showToast(`✓ Copied: ${packageString}`);
    } catch (error) {
        // Fallback for browsers that don't support clipboard API
        const textarea = document.createElement('textarea');
        textarea.value = packageString;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast(`✓ Copied: ${packageString}`);
        } catch (err) {
            showToast('✗ Failed to copy');
        }
        document.body.removeChild(textarea);
    }
}

// Add slideIn and fadeOut animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateX(100%);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    @keyframes fadeOut {
        from {
            opacity: 1;
        }
        to {
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
