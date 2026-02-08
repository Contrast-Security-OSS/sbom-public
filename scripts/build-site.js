#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Directories
const REPO_ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(REPO_ROOT, 'site');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

console.log('Building static site...');

// Check if site directory exists
if (!fs.existsSync(SITE_DIR)) {
    console.error(`ERROR: site/ directory not found at ${SITE_DIR}`);
    process.exit(1);
}

// Create docs directory
if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// Copy site files to docs
const filesToCopy = [
    'index.html',
    'styles.css',
    'app.js',
    'logo.svg'
];

console.log('Copying site files to docs/...');

for (const file of filesToCopy) {
    const src = path.join(SITE_DIR, file);
    const dest = path.join(DOCS_DIR, file);

    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`  ✓ Copied ${file}`);
    } else {
        console.warn(`  ⚠ Warning: ${file} not found in site/`);
    }
}

// Create .nojekyll file (disable Jekyll processing)
const nojekyllPath = path.join(DOCS_DIR, '.nojekyll');
fs.writeFileSync(nojekyllPath, '');
console.log('  ✓ Created .nojekyll');

console.log('');
console.log('✓ Site build complete!');
console.log(`  Output: ${DOCS_DIR}`);
console.log('');
console.log('Note: SBOMs are already in docs/sboms/ from fetch-and-generate.sh');
