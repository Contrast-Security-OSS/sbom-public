// Dependency Tree Visualizer
// Powered by D3.js

let svg, g, simulation, zoom;
let treeData = null;
let nodes = [];
let links = [];

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
        document.getElementById('page-subtitle').textContent = 'Interactive dependency tree visualization';
    }

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

        initializeVisualization();
        renderTree(treeData);
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

    // Find root component (usually the main artifact)
    let rootRef = null;
    if (sbom.metadata && sbom.metadata.component) {
        rootRef = sbom.metadata.component.purl || sbom.metadata.component['bom-ref'] || sbom.metadata.component.name;
    }

    // If no metadata root, use the first dependency or component
    if (!rootRef && dependencies.length > 0) {
        rootRef = dependencies[0].ref;
    }

    if (!rootRef && components.length > 0) {
        rootRef = components[0].purl || components[0]['bom-ref'] || components[0].name;
    }

    // Build tree structure
    const root = {
        name: sbom.metadata?.component?.name || productName || 'Root',
        version: sbom.metadata?.component?.version || version || '',
        children: [],
        type: 'root',
        depth: 0
    };

    // Build dependency tree from dependencies array
    const processedRefs = new Set();

    function buildTree(ref, depth = 1, maxDepth = 5) {
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
            children: []
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
        components.slice(0, 50).forEach(comp => {
            root.children.push({
                name: comp.name,
                version: comp.version || 'unknown',
                type: 'direct',
                depth: 1,
                purl: comp.purl,
                children: []
            });
        });
    }

    return root;
}

function initializeVisualization() {
    const container = document.getElementById('tree-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Create SVG
    svg = d3.select('#tree-svg')
        .attr('width', width)
        .attr('height', height);

    // Create zoom behavior
    zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);

    // Create group for zoomable content
    g = svg.append('g');

    // Create arrow marker for links
    svg.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 25)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 8)
        .attr('markerHeight', 8)
        .append('svg:path')
        .attr('d', 'M 0,-5 L 10,0 L 0,5')
        .attr('fill', 'rgba(150, 150, 255, 0.6)');
}

function renderTree(rootData) {
    const container = document.getElementById('tree-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Flatten tree to nodes and links
    nodes = [];
    links = [];

    function traverse(node, parent = null) {
        const nodeObj = {
            id: `${node.name}@${node.version}`,
            name: node.name,
            version: node.version,
            type: node.type,
            depth: node.depth,
            purl: node.purl,
            description: node.description,
            children: node.children || [],
            _children: null
        };
        nodes.push(nodeObj);

        if (parent) {
            links.push({
                source: parent.id,
                target: nodeObj.id
            });
        }

        if (node.children) {
            node.children.forEach(child => traverse(child, nodeObj));
        }
    }

    traverse(rootData);

    // Create force simulation
    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links)
            .id(d => d.id)
            .distance(d => {
                // Vary distance based on depth
                return 80 + (d.target.depth * 20);
            })
        )
        .force('charge', d3.forceManyBody()
            .strength(-400)
            .distanceMax(300)
        )
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(35));

    // Draw links
    const link = g.append('g')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('class', 'link')
        .attr('marker-end', 'url(#arrowhead)');

    // Draw nodes
    const node = g.append('g')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', 'node')
        .call(drag(simulation));

    // Add circles
    node.append('circle')
        .attr('r', d => d.type === 'root' ? 20 : 15)
        .attr('fill', d => {
            if (d.type === 'root') return '#8b9bff';
            if (d.type === 'direct') return '#6dd5ed';
            return '#f093fb';
        })
        .attr('stroke', 'rgba(255, 255, 255, 0.8)');

    // Add labels
    node.append('text')
        .text(d => d.name.length > 20 ? d.name.substring(0, 18) + '...' : d.name)
        .attr('x', 0)
        .attr('y', d => d.type === 'root' ? -25 : -20)
        .attr('text-anchor', 'middle')
        .attr('fill', 'white')
        .style('font-size', d => d.type === 'root' ? '14px' : '12px')
        .style('font-weight', d => d.type === 'root' ? '700' : '500');

    // Add version labels
    node.append('text')
        .text(d => d.version)
        .attr('x', 0)
        .attr('y', d => d.type === 'root' ? 35 : 30)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(255, 255, 255, 0.7)')
        .style('font-size', '10px');

    // Add tooltips and click handlers
    node.on('mouseover', showTooltip)
        .on('mouseout', hideTooltip)
        .on('click', showNodeInfo);

    // Update positions on simulation tick
    simulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Initial zoom to fit
    setTimeout(() => {
        const bounds = g.node().getBBox();
        const fullWidth = width;
        const fullHeight = height;
        const midX = bounds.x + bounds.width / 2;
        const midY = bounds.y + bounds.height / 2;
        const scale = 0.8 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
        const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];

        svg.transition().duration(750).call(
            zoom.transform,
            d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
        );
    }, 500);
}

function drag(simulation) {
    function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
    }

    function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
    }

    function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
    }

    return d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended);
}

function showTooltip(event, d) {
    const tooltip = d3.select('body').append('div')
        .attr('class', 'tooltip')
        .style('opacity', 0);

    let html = `<strong>${d.name}</strong>`;
    if (d.version) html += `<br>Version: ${d.version}`;
    if (d.description) html += `<br>${d.description.substring(0, 100)}${d.description.length > 100 ? '...' : ''}`;
    if (d.purl) html += `<br><small style="opacity: 0.7">${d.purl.substring(0, 60)}${d.purl.length > 60 ? '...' : ''}</small>`;

    tooltip.html(html)
        .style('left', (event.pageX + 15) + 'px')
        .style('top', (event.pageY - 28) + 'px')
        .transition()
        .duration(200)
        .style('opacity', 1);
}

function hideTooltip() {
    d3.select('.tooltip').remove();
}

function showNodeInfo(event, d) {
    const infoDiv = document.getElementById('selected-node-info');
    let html = `<strong style="color: #8b9bff;">${d.name}</strong>`;
    if (d.version) html += `<br><span style="opacity: 0.8;">Version: ${d.version}</span>`;
    html += `<br><span style="opacity: 0.8;">Type: ${d.type}</span>`;
    html += `<br><span style="opacity: 0.8;">Depth: ${d.depth}</span>`;

    const childCount = d.children ? d.children.length : 0;
    if (childCount > 0) {
        html += `<br><span style="opacity: 0.8;">Dependencies: ${childCount}</span>`;
    }

    infoDiv.innerHTML = html;
}

function resetZoom() {
    svg.transition().duration(750).call(
        zoom.transform,
        d3.zoomIdentity
    );
}

function expandAll() {
    // This would require tree layout - for force layout, we can restart simulation
    if (simulation) {
        simulation.alpha(1).restart();
    }
}

function collapseAll() {
    // For force layout, we can cool down the simulation
    if (simulation) {
        simulation.alpha(0);
    }
}

function showError(message) {
    const loading = document.getElementById('loading');
    loading.innerHTML = `<div class="error-message">${message}</div>`;
}
