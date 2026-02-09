// Modern SBOM Repository

let allProducts = [];
let filteredProducts = [];
let expandedProducts = new Set();
let dateFilterActive = false;
let dateFrom = null;
let dateTo = null;
let sortOrder = 'desc'; // 'asc' or 'desc'

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
    const sortSelect = document.getElementById('sort-select');
    const sortOrderToggle = document.getElementById('sort-order-toggle');
    const dateFilterToggle = document.getElementById('date-filter-toggle');
    const viewToggle = document.getElementById('view-toggle');
    const applyDateFilter = document.getElementById('apply-date-filter');
    const clearDates = document.getElementById('clear-dates');
    const removeDateFilter = document.getElementById('remove-date-filter');

    searchInput.addEventListener('input', debounce(handleSearch, 300));
    sortSelect.addEventListener('change', handleSort);
    sortOrderToggle.addEventListener('click', toggleSortOrder);
    dateFilterToggle.addEventListener('click', toggleDateFilterPanel);
    viewToggle.addEventListener('click', toggleView);
    applyDateFilter.addEventListener('click', applyDateFiltering);
    clearDates.addEventListener('click', clearDateFilters);
    removeDateFilter.addEventListener('click', clearDateFilters);

    // Quick filter buttons
    document.querySelectorAll('.quick-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const days = parseInt(e.target.dataset.days);
            applyQuickFilter(days);
        });
    });

    // Modal keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close whichever modal is open
            const sbomModal = document.getElementById('sbom-modal');
            const treeModal = document.getElementById('tree-modal');

            if (sbomModal && sbomModal.style.display === 'flex') {
                closeModal();
            }
            if (treeModal && treeModal.style.display === 'flex') {
                closeTreeModal();
            }

            const panel = document.getElementById('date-filter-panel');
            if (panel && panel.style.display === 'block') {
                toggleDateFilterPanel();
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
function toggleDateFilterPanel() {
    const panel = document.getElementById('date-filter-panel');
    const btn = document.getElementById('date-filter-toggle');

    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        btn.classList.add('active');
    } else {
        panel.style.display = 'none';
        btn.classList.remove('active');
    }
}

// Apply quick filter
function applyQuickFilter(days) {
    const today = new Date();
    const fromDate = new Date();
    fromDate.setDate(today.getDate() - days);

    document.getElementById('date-from').value = fromDate.toISOString().split('T')[0];
    document.getElementById('date-to').value = today.toISOString().split('T')[0];

    applyDateFiltering();
}

// Apply date filtering
function applyDateFiltering() {
    const fromInput = document.getElementById('date-from').value;
    const toInput = document.getElementById('date-to').value;

    if (!fromInput && !toInput) {
        showToast('Please select at least one date');
        return;
    }

    dateFrom = fromInput ? new Date(fromInput) : null;
    dateTo = toInput ? new Date(toInput) : null;
    dateFilterActive = true;

    // Update active filter display
    const activeFilter = document.getElementById('active-date-filter');
    const fromText = document.getElementById('filter-from-text');
    const toText = document.getElementById('filter-to-text');

    fromText.textContent = dateFrom ? formatDate(dateFrom.toISOString().split('T')[0]) : 'beginning';
    toText.textContent = dateTo ? formatDate(dateTo.toISOString().split('T')[0]) : 'now';
    activeFilter.style.display = 'flex';

    // Apply filter
    applyFilters();
    showToast('Date filter applied');
}

// Clear date filters
function clearDateFilters() {
    dateFrom = null;
    dateTo = null;
    dateFilterActive = false;

    document.getElementById('date-from').value = '';
    document.getElementById('date-to').value = '';
    document.getElementById('active-date-filter').style.display = 'none';

    applyFilters();
    showToast('Date filter cleared');
}

// Apply all filters (search + date)
function applyFilters() {
    const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();

    filteredProducts = allProducts.filter(product => {
        // Apply search filter
        let matchesSearch = true;
        if (searchQuery) {
            matchesSearch = product.name.toLowerCase().includes(searchQuery) ||
                product.versions.some(v => v.version.toLowerCase().includes(searchQuery));
        }

        // Apply date filter
        let matchesDate = true;
        if (dateFilterActive) {
            matchesDate = product.versions.some(version => {
                const versionDate = new Date(version.generatedAt);
                if (dateFrom && versionDate < dateFrom) return false;
                if (dateTo && versionDate > dateTo) return false;
                return true;
            });
        }

        return matchesSearch && matchesDate;
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

    return `
        <div class="product-card">
            <div class="product-header">
                <h2 class="product-name">
                    ${logo ? `<img src="${logo}" alt="${escapeHtml(product.name)} logo" class="product-logo" />` : ''}
                    ${escapeHtml(product.name)}
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
                    <span class="meta-badge">
                        📦 ${product.versions.length} version${product.versions.length !== 1 ? 's' : ''}
                    </span>
                    ${latestVersion ? `
                        <span class="meta-badge">
                            🆕 ${escapeHtml(latestVersion.version)}
                        </span>
                    ` : ''}
                </div>
            </div>

            <div class="versions-section">
                <div class="versions-header">
                    <span class="versions-title">Available Versions</span>
                    <span class="versions-toggle" onclick="toggleProductVersions('${escapeHtml(product.name)}')">
                        ${isExpanded ? 'Hide' : 'Show'} All
                    </span>
                </div>

                <div class="version-list ${isExpanded ? 'expanded' : ''}">
                    ${product.versions.map(version => renderVersionItem(product, version)).join('')}
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
                        title="View Dependency Tree"
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
                        title="View SBOM"
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
        document.getElementById('tree-search-input').addEventListener('input', handleTreeSearch);
        document.getElementById('tree-expand-all-btn').addEventListener('click', expandAllTree);
        document.getElementById('tree-collapse-all-btn').addEventListener('click', collapseAllTree);
        document.getElementById('tree-export-btn').addEventListener('click', () => exportTree(productName, version));
        modal.dataset.listenersSet = 'true';
    }

    // Clear search input
    document.getElementById('tree-search-input').value = '';

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

function handleTreeSearch(e) {
    treeSearchQuery = e.target.value.toLowerCase().trim();
    userExpandedAll = false;
    renderTree();
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
