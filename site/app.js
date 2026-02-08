// Modern SBOM Repository

let allProducts = [];
let filteredProducts = [];
let expandedProducts = new Set();

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
    const viewToggle = document.getElementById('view-toggle');

    searchInput.addEventListener('input', debounce(handleSearch, 300));
    sortSelect.addEventListener('change', handleSort);
    viewToggle.addEventListener('click', toggleView);

    // Modal keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
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
    const query = event.target.value.toLowerCase().trim();

    if (!query) {
        filteredProducts = [...allProducts];
    } else {
        filteredProducts = allProducts.filter(product => {
            // Search in product name
            if (product.name.toLowerCase().includes(query)) {
                return true;
            }

            // Search in versions
            return product.versions.some(version =>
                version.version.toLowerCase().includes(query)
            );
        });
    }

    renderProducts();
}

// Handle sort
function handleSort(event) {
    const sortBy = event.target.value;

    switch (sortBy) {
        case 'name':
            filteredProducts.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case 'date':
            filteredProducts.sort((a, b) => {
                const dateA = a.versions[0]?.releaseDate || '0000-00-00';
                const dateB = b.versions[0]?.releaseDate || '0000-00-00';
                return dateB.localeCompare(dateA);
            });
            break;
        case 'versions':
            filteredProducts.sort((a, b) => b.versions.length - a.versions.length);
            break;
    }

    renderProducts();
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

    return `
        <div class="product-card">
            <div class="product-header">
                <h2 class="product-name">${escapeHtml(product.name)}</h2>
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
    return `
        <div class="version-item">
            <div class="version-info">
                <div class="version-number">${escapeHtml(version.version)}</div>
                <div class="version-date">Released: ${formatDate(version.releaseDate)}</div>
            </div>
            <div class="version-actions">
                <button
                    class="btn-format"
                    onclick="downloadSBOM('${escapeHtml(version.sboms.spdx)}', '${escapeHtml(product.name)}-${escapeHtml(version.version)}-spdx.json')"
                    title="Download SPDX format"
                >
                    SPDX
                </button>
                <button
                    class="btn-format"
                    onclick="downloadSBOM('${escapeHtml(version.sboms.cyclonedx)}', '${escapeHtml(product.name)}-${escapeHtml(version.version)}-cyclonedx.json')"
                    title="Download CycloneDX format"
                >
                    CycloneDX
                </button>
                <button
                    class="btn-icon"
                    onclick="viewSBOM('${escapeHtml(version.sboms.spdx)}', '${escapeHtml(product.name)} ${escapeHtml(version.version)}')"
                    title="View SBOM"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
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
