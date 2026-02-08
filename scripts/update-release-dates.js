#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse the custom format
const dateUpdates = `eop:3.11.11,2025-01-21|3.12.0,2025-02-26|3.12.1,2025-03-20|3.12.2,2025-04-22|3.12.3,2025-05-22|3.12.4,2025-06-20|3.12.4-PATCH,2026-01-14|3.12.5,2025-07-22|3.12.6,2025-07-21|3.12.7,2025-09-23|3.12.8,2025-10-23|3.12.9,2025-12-16|3.12.10,2026-01-23;java-agent:6.19.0(latest),2025-06-24`;

// Parse the data
const updates = {};
const products = dateUpdates.split(';');

products.forEach(productData => {
    const [productName, versionsData] = productData.split(':');
    const normalizedProductName = productName.trim().toLowerCase().replace(/\s+/g, '-');
    
    updates[normalizedProductName] = {};
    
    const versions = versionsData.split('|');
    versions.forEach(versionData => {
        const [version, date] = versionData.split(',');
        // Handle version like "6.19.0(latest)" -> "latest"
        const cleanVersion = version.includes('(latest)') ? 'latest' : version.trim();
        updates[normalizedProductName][cleanVersion] = date.trim();
    });
});

console.log('Parsed updates:');
console.log(JSON.stringify(updates, null, 2));

// Read current index.json
const indexPath = path.join(__dirname, '..', 'sboms', 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

let updatedCount = 0;
let notFoundCount = 0;
const notFound = [];

// Update release dates
index.products.forEach(product => {
    const productSlug = product.name.toLowerCase().replace(/\s+/g, '-');
    
    if (updates[productSlug]) {
        product.versions.forEach(version => {
            if (updates[productSlug][version.version]) {
                const newDate = updates[productSlug][version.version];
                console.log(`Updating ${product.name} ${version.version}: ${version.releaseDate} → ${newDate}`);
                version.releaseDate = newDate;
                updatedCount++;
            }
        });
    }
});

// Check for versions that weren't found
Object.keys(updates).forEach(productSlug => {
    Object.keys(updates[productSlug]).forEach(version => {
        const product = index.products.find(p => 
            p.name.toLowerCase().replace(/\s+/g, '-') === productSlug
        );
        
        if (!product) {
            notFound.push(`${productSlug}:${version} - product not found`);
            notFoundCount++;
        } else {
            const versionObj = product.versions.find(v => v.version === version);
            if (!versionObj) {
                notFound.push(`${product.name}:${version} - version not found`);
                notFoundCount++;
            }
        }
    });
});

// Update generated timestamp
index.generated = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// Write back to file
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

console.log('\n===========================================');
console.log(`✅ Updated ${updatedCount} release dates`);
if (notFoundCount > 0) {
    console.log(`⚠️  ${notFoundCount} version(s) not found in index:`);
    notFound.forEach(item => console.log(`   - ${item}`));
}
console.log('===========================================');
console.log(`\nIndex file updated: ${indexPath}`);
console.log('Run "node scripts/build-site.js" to rebuild the site');
