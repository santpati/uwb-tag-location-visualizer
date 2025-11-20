#!/usr/bin/env node
/**
 * Creates a circular avatar from a rectangular image
 */

const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

async function makeCircularAvatar(inputPath, outputPath, size = 200) {
    // Load the image
    const image = await loadImage(inputPath);

    // Create a square canvas
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Enable anti-aliasing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw white circular background with border
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 4; // Leave room for border

    // Draw outer white border
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();

    // Create circular clipping path for the image
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Calculate dimensions to fill the circle (cover, not contain)
    const imageAspect = image.width / image.height;
    let drawWidth, drawHeight, drawX, drawY;

    if (imageAspect > 1) {
        // Image is wider than tall
        drawHeight = size;
        drawWidth = size * imageAspect;
        drawX = -(drawWidth - size) / 2;
        drawY = 0;
    } else {
        // Image is taller than wide
        drawWidth = size;
        drawHeight = size / imageAspect;
        drawX = 0;
        drawY = -(drawHeight - size) / 2;
    }

    // Draw the image
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

    // Save the result
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);

    console.log(`✅ Created circular avatar: ${outputPath}`);
}

// Run if called directly
if (require.main === module) {
    const inputPath = process.argv[2] || '/Users/luhanson/Documents/GitHub/tango/public/avatar-fc589a1e394f.jpeg';
    const outputPath = process.argv[3] || '/Users/luhanson/Documents/GitHub/tango/public/avatar-fc589a1e394f-circular.png';

    makeCircularAvatar(inputPath, outputPath, 200)
        .then(() => console.log('Done!'))
        .catch(err => console.error('Error:', err.message));
}

module.exports = makeCircularAvatar;
