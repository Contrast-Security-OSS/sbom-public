// Dependency Tree Visualizer - File Tree Style
// Clean hierarchical view like a file explorer

let treeData = null;
let expandedNodes = new Set();
let filteredTree = null;
let searchQuery = '';
let userExpandedAll = false;

// Get SBOM URL from query parameters
const urlParams = new URLSearchParams(window.location.search);
const sbomUrl = urlParams.get('sbom');
const productName = urlParams.get('product');
const version = urlParams.get('version');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (!sbomUrl) {
        showError('No SBOM specified. Please navigate from the main page.');
        return;
    }

    // Update page title
    if (productName && version) {
        document.getElementById('page-title').textContent = `${productName} ${version}`;
        document.getElementById('page-subtitle').textContent = 'Dependency tree - Click to expand/collapse';
    }

    // Setup event listeners
    document.getElementById('search-input').addEventListener('input', handleSearch);
    document.getElementById('expand-all-btn').addEventListener('click', expandAll);
    document.getElementById('collapse-all-btn').addEventListener('click', collapseAll);
    document.getElementById('export-btn').addEventListener('click', exportTree);

    loadAndVisualize();
});

async function loadAndVisualize() {
    try {
        const response = await fetch(sbomUrl);
        if (!response.ok) throw new Error('Failed to load SBOM');

        const sbom = await response.json();
        treeData = parseCycloneDX(sbom);

        if (!treeData || treeData.children.length === 0) {
            showError('No dependency information found in this SBOM.');
            return;
        }

        // Expand root by default
        expandedNodes.add(getNodeId(treeData));

        updateStats(treeData);
        renderTree();
        document.getElementById('loading').style.display = 'none';
    } catch (error) {
        showError(`Error loading SBOM: ${error.message}`);
    }
}

function parseCycloneDX(sbom) {
    // Parse CycloneDX format to extract dependency tree
    const components = sbom.components || [];
    const dependencies = sbom.dependencies || [];

    // Create a map of components by ref (purl)
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

    // Find root component
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

    // Build tree structure
    const root = {
        name: sbom.metadata?.component?.name || productName || 'Root Package',
        version: sbom.metadata?.component?.version || version || '',
        children: [],
        type: 'root',
        depth: 0,
        id: 'root'
    };

    // Build dependency tree
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

        // Find dependencies of this component
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

    // Add direct dependencies to root
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

    // If no dependencies found, add all components as direct children
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

function updateStats(tree) {
    // Count total packages
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

    document.getElementById('stat-total').textContent = totalPackages;
    document.getElementById('stat-direct').textContent = directDeps;
    document.getElementById('stat-transitive').textContent = transitiveDeps;
}

function handleSearch(e) {
    searchQuery = e.target.value.toLowerCase().trim();
    userExpandedAll = false; // Reset flag when searching
    renderTree();
}

function matchesSearch(node) {
    if (!searchQuery) return true;

    const matchesName = node.name.toLowerCase().includes(searchQuery);
    const matchesVersion = node.version && node.version.toLowerCase().includes(searchQuery);
    const matchesDescription = node.description && node.description.toLowerCase().includes(searchQuery);

    return matchesName || matchesVersion || matchesDescription;
}

function hasMatchingChild(node) {
    if (!node.children || node.children.length === 0) return false;

    for (const child of node.children) {
        if (matchesSearch(child) || hasMatchingChild(child)) {
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

    // If searching and user hasn't manually expanded/collapsed all, expand matching paths
    if (searchQuery && !userExpandedAll) {
        expandMatchingPaths(treeData);
    }

    const html = renderNode(treeData, 0);
    container.innerHTML = html;
}

function expandMatchingPaths(node) {
    if (matchesSearch(node)) {
        expandedNodes.add(getNodeId(node));
    }

    if (node.children && node.children.length > 0) {
        const hasMatch = node.children.some(child =>
            matchesSearch(child) || hasMatchingChild(child)
        );

        if (hasMatch) {
            expandedNodes.add(getNodeId(node));
            node.children.forEach(expandMatchingPaths);
        }
    }
}

function renderNode(node, level) {
    const nodeId = getNodeId(node);
    const isExpanded = expandedNodes.has(nodeId);
    const hasChildren = node.children && node.children.length > 0;

    // Check if node or its children match search
    const nodeMatches = matchesSearch(node);
    const childMatches = hasMatchingChild(node);

    // Hide if doesn't match search
    if (searchQuery && !nodeMatches && !childMatches) {
        return '';
    }

    // Highlight if matches search
    const highlightClass = searchQuery && nodeMatches ? 'highlight' : '';

    let html = `
        <div class="tree-node ${highlightClass}" style="padding-left: ${level * 24}px;">
            <div class="node-content" onclick="toggleNode('${escapeHtml(nodeId)}')">
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

    // Render children if expanded
    if (hasChildren && isExpanded) {
        html += '<div class="node-children">';
        node.children.forEach(child => {
            html += renderNode(child, level + 1);
        });
        html += '</div>';
    }

    return html;
}

function toggleNode(nodeId) {
    userExpandedAll = false; // Reset flag when manually toggling
    if (expandedNodes.has(nodeId)) {
        expandedNodes.delete(nodeId);
    } else {
        expandedNodes.add(nodeId);
    }
    renderTree();
}

function expandAll() {
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

function collapseAll() {
    userExpandedAll = true;
    expandedNodes.clear();
    // Keep root expanded
    expandedNodes.add(getNodeId(treeData));
    renderTree();
}

function exportTree() {
    // Export tree as text
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

    // Download as text file
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

function showError(message) {
    const loading = document.getElementById('loading');
    loading.innerHTML = `<div class="error-message">${message}</div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
