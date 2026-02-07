// Global state
let allProducts = [];
let filteredProducts = [];
let expandedProducts = new Set();

// Load and initialize
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

        // Update last updated date
        const lastUpdated = document.getElementById('last-updated');
        if (data.generated) {
            const date = new Date(data.generated);
            lastUpdated.textContent = date.toLocaleString();
        }

        renderProducts();
    } catch (error) {
        console.error('Error loading products:', error);
        document.getElementById('product-list').innerHTML = `
            <div class="no-results">
                <p>Error loading products. Please try again later.</p>
                <p style="color: var(--text-light); font-size: 0.9rem;">${error.message}</p>
            </div>
        `;
    }
}

// Setup event listeners
function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    const sortSelect = document.getElementById('sort-select');

    searchInput.addEventListener('input', handleSearch);
    sortSelect.addEventListener('change', handleSort);
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
        case 'version':
            filteredProducts.sort((a, b) => {
                const versionA = a.versions[0]?.version || '';
                const versionB = b.versions[0]?.version || '';
                return compareVersions(versionB, versionA); // Descending
            });
            break;
        case 'date':
            filteredProducts.sort((a, b) => {
                const dateA = a.versions[0]?.releaseDate || '0000-00-00';
                const dateB = b.versions[0]?.releaseDate || '0000-00-00';
                return dateB.localeCompare(dateA); // Descending
            });
            break;
    }

    renderProducts();
}

// Compare version strings (semver-like)
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const part1 = parts1[i] || 0;
        const part2 = parts2[i] || 0;

        if (part1 > part2) return 1;
        if (part1 < part2) return -1;
    }

    return 0;
}

// Render products
function renderProducts() {
    const productList = document.getElementById('product-list');
    const noResults = document.getElementById('no-results');

    if (filteredProducts.length === 0) {
        productList.style.display = 'none';
        noResults.style.display = 'block';
        return;
    }

    productList.style.display = 'flex';
    noResults.style.display = 'none';

    productList.innerHTML = filteredProducts.map(product =>
        renderProductCard(product)
    ).join('');
}

// Render single product card
function renderProductCard(product) {
    const isExpanded = expandedProducts.has(product.name);
    const versionCount = product.versions.length;

    return `
        <div class="product-card">
            <div class="product-header" onclick="toggleProduct('${escapeHtml(product.name)}')">
                <h2>${escapeHtml(product.name)}</h2>
                <span class="toggle ${isExpanded ? 'expanded' : ''}">▶</span>
            </div>
            <div class="version-count">${versionCount} version${versionCount !== 1 ? 's' : ''} available</div>
            <div class="versions" style="display: ${isExpanded ? 'flex' : 'none'}">
                ${product.versions.map(version => renderVersionRow(product, version)).join('')}
            </div>
        </div>
    `;
}

// Render version row
function renderVersionRow(product, version) {
    return `
        <div class="version-row">
            <div class="version-info">
                <div class="version-number">${escapeHtml(version.version)}</div>
                <div class="version-date">Released: ${escapeHtml(version.releaseDate)}</div>
            </div>
            <div class="version-actions">
                <button class="btn-primary" onclick="downloadSBOM('${escapeHtml(version.sboms.spdx)}', '${escapeHtml(product.name)}-${escapeHtml(version.version)}-spdx.json')">
                    SPDX
                </button>
                <button class="btn-primary" onclick="downloadSBOM('${escapeHtml(version.sboms.cyclonedx)}', '${escapeHtml(product.name)}-${escapeHtml(version.version)}-cyclonedx.json')">
                    CycloneDX
                </button>
                <button class="btn-outline" onclick="viewSBOM('${escapeHtml(version.sboms.spdx)}', '${escapeHtml(product.name)} ${escapeHtml(version.version)} - SPDX')">
                    View
                </button>
            </div>
        </div>
    `;
}

// Toggle product expansion
function toggleProduct(productName) {
    if (expandedProducts.has(productName)) {
        expandedProducts.delete(productName);
    } else {
        expandedProducts.add(productName);
    }
    renderProducts();
}

// Download SBOM
function downloadSBOM(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

// Close modal when clicking outside
document.addEventListener('click', (event) => {
    const modal = document.getElementById('sbom-modal');
    if (event.target === modal) {
        closeModal();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeModal();
    }
});

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
