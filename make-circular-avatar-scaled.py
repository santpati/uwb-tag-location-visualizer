#!/usr/bin/env python3
"""
Creates a circular avatar with adjustable zoom/padding
"""

from PIL import Image, ImageDraw
import sys

def make_circular_avatar(input_path, output_path, size=200, zoom_factor=0.75):
    """
    Create a circular avatar with zoom control
    
    Args:
        input_path: Path to input image
        output_path: Path to save output
        size: Output size in pixels
        zoom_factor: How much of the circle to fill (0.5-1.0)
                    Lower = more padding/smaller face
                    0.75 = good balance with breathing room
    """
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

    # Calculate the size to create with zoom factor
    # We'll create a larger canvas and place the image smaller in the center
    temp_size = int(size / zoom_factor)
    
    # Resize to temp size
    img = img.resize((temp_size, temp_size), Image.Resampling.LANCZOS)

    # Create a larger canvas to work with
    canvas = Image.new('RGB', (temp_size, temp_size), (255, 255, 255))
    canvas.paste(img, (0, 0))

    # Now crop from center to get final size with zoom effect
    left = (temp_size - size) // 2
    top = (temp_size - size) // 2
    right = left + size
    bottom = top + size
    img = canvas.crop((left, top, right, bottom))

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
    print(f'✅ Created circular avatar: {output_path} (zoom: {zoom_factor})')

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 make-circular-avatar-scaled.py <input_image> <output_image> [zoom_factor]")
        print("  zoom_factor: 0.5-1.0 (default 0.75, lower = smaller face/more padding)")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    zoom_factor = float(sys.argv[3]) if len(sys.argv) > 3 else 0.75

    make_circular_avatar(input_path, output_path, 200, zoom_factor)

