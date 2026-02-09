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
    'Contrast CLI Mac': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/apple/apple-original.svg',
    'Contrast CLI Windows': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows11/windows11-original.svg',
    'Contrast CLI Linux': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/linux/linux-original.svg'
};

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
            closeModal();
            const panel = document.getElementById('date-filter-panel');
            if (panel.style.display === 'block') {
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

    return `
        <div class="product-card">
            <div class="product-header">
                <h2 class="product-name">
                    ${logo ? `<img src="${logo}" alt="${escapeHtml(product.name)} logo" class="product-logo" />` : ''}
                    ${escapeHtml(product.name)}
                </h2>
                <div class="product-meta">
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

// View dependency tree
function viewDependencyTree(sbomUrl, productName, version) {
    // Navigate to dependency tree page with parameters
    const params = new URLSearchParams({
        sbom: sbomUrl,
        product: productName,
        version: version
    });
    window.location.href = `dependency-tree.html?${params.toString()}`;
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
