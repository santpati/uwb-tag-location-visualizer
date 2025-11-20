#!/usr/bin/env python3
"""
Creates a circular avatar from a rectangular image with a white border
"""

from PIL import Image, ImageDraw
import sys

def make_circular_avatar(input_path, output_path, size=200):
    # Open the image
    img = Image.open(input_path)

    # Convert to RGB if necessary
    if img.mode != 'RGB':
        img = img.convert('RGB')

    # Resize to square, cropping to center
    width, height = img.size
    min_dim = min(width, height)

    # Crop to square from center
    left = (width - min_dim) // 2
    top = (height - min_dim) // 2
    right = left + min_dim
    bottom = top + min_dim
    img = img.crop((left, top, right, bottom))

    # Resize to target size
    img = img.resize((size, size), Image.Resampling.LANCZOS)

    # Create a circular mask
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size, size), fill=255)

    # Create output image with transparency
    output = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    # Paste the circular image
    output.paste(img, (0, 0), mask)

    # Add white border
    border_width = 4
    draw = ImageDraw.Draw(output)
    draw.ellipse(
        (0, 0, size-1, size-1),
        outline='white',
        width=border_width
    )

    # Save the result
    output.save(output_path, 'PNG')
    print(f'✅ Created circular avatar: {output_path}')

if __name__ == '__main__':
    input_path = sys.argv[1] if len(sys.argv) > 1 else '/Users/luhanson/Documents/GitHub/tango/public/avatar-fc589a1e394f.jpeg'
    output_path = sys.argv[2] if len(sys.argv) > 2 else '/Users/luhanson/Documents/GitHub/tango/public/avatar-fc589a1e394f-circular.png'

    make_circular_avatar(input_path, output_path, 200)
