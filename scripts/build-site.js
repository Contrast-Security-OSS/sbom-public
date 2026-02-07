#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Paths
const REPO_ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(REPO_ROOT, 'site');
const SBOM_DIR = path.join(REPO_ROOT, 'sboms');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const INDEX_FILE = path.join(SBOM_DIR, 'index.json');

console.log('Building static site for GitHub Pages...\n');

// Check if SBOM directory and index exist
if (!fs.existsSync(SBOM_DIR)) {
    console.error('Error: sboms/ directory not found');
    console.error('Run generate-sboms.sh first');
    process.exit(1);
}

if (!fs.existsSync(INDEX_FILE)) {
    console.error('Error: sboms/index.json not found');
    console.error('Run generate-sboms.sh first');
    process.exit(1);
}

// Clean and create docs directory
console.log('Cleaning docs/ directory...');
if (fs.existsSync(DOCS_DIR)) {
    fs.rmSync(DOCS_DIR, { recursive: true });
}
fs.mkdirSync(DOCS_DIR, { recursive: true });

// Copy static assets
console.log('Copying static assets...');
const staticFiles = ['index.html', 'styles.css', 'app.js'];

staticFiles.forEach(file => {
    const src = path.join(SITE_DIR, file);
    const dest = path.join(DOCS_DIR, file);

    if (!fs.existsSync(src)) {
        console.error(`Warning: ${file} not found in site/`);
        return;
    }

    fs.copyFileSync(src, dest);
    console.log(`  Copied: ${file}`);
});

// Copy SBOMs directory
console.log('\nCopying SBOMs...');
const docsSbomDir = path.join(DOCS_DIR, 'sboms');
copyDirectory(SBOM_DIR, docsSbomDir);

// Load and validate index
console.log('\nValidating index.json...');
const indexData = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));

if (!indexData.products || !Array.isArray(indexData.products)) {
    console.error('Error: Invalid index.json format');
    process.exit(1);
}

console.log(`  Products: ${indexData.products.length}`);
console.log(`  Total versions: ${indexData.products.reduce((sum, p) => sum + p.versions.length, 0)}`);

// Create .nojekyll file (required for GitHub Pages to serve files with underscores)
fs.writeFileSync(path.join(DOCS_DIR, '.nojekyll'), '');
console.log('\nCreated .nojekyll file');

// Create CNAME file if CNAME environment variable is set
if (process.env.CNAME) {
    fs.writeFileSync(path.join(DOCS_DIR, 'CNAME'), process.env.CNAME);
    console.log(`Created CNAME file: ${process.env.CNAME}`);
}

// Generate summary
console.log('\n' + '='.repeat(50));
console.log('Site build complete!');
console.log('='.repeat(50));
console.log(`\nOutput directory: ${DOCS_DIR}`);
console.log('\nTo test locally:');
console.log(`  cd ${DOCS_DIR}`);
console.log('  python3 -m http.server 8000');
console.log('  Open http://localhost:8000\n');

// Helper function to copy directory recursively
function copyDirectory(src, dest) {
    if (!fs.existsSync(src)) {
        console.error(`Error: Source directory not found: ${src}`);
        return;
    }

    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }

    // Count files for logging
    const fileCount = countFiles(dest);
    console.log(`  Copied ${fileCount} SBOM files`);
}

// Helper function to count files recursively
function countFiles(dir) {
    let count = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            count += countFiles(fullPath);
        } else {
            count++;
        }
    }

    return count;
}
