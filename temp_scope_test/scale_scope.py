#!/usr/bin/env python3
"""
Scope Image Scaling Script for TURBO Mode
Scales scope overlay images to half size for DPR 0.5 compatibility
"""

from PIL import Image
import os
import sys

def scale_image(input_path, output_path, scale_factor=0.5):
    """Scale an image by the given factor"""
    try:
        with Image.open(input_path) as img:
            # Get original dimensions
            orig_width, orig_height = img.size
            print(f"Original size: {orig_width} x {orig_height}")
            
            # Calculate new dimensions (half size)
            new_width = int(orig_width * scale_factor)
            new_height = int(orig_height * scale_factor)
            print(f"New size: {new_width} x {new_height}")
            
            # Scale the image using high-quality resampling
            scaled_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # Save the scaled image
            scaled_img.save(output_path, quality=95)
            print(f"✅ Scaled image saved: {output_path}")
            
            # Calculate size reduction
            orig_size = os.path.getsize(input_path)
            new_size = os.path.getsize(output_path)
            reduction = (1 - new_size / orig_size) * 100
            print(f"📊 File size: {orig_size:,} → {new_size:,} bytes ({reduction:.1f}% reduction)")
            
            return True
            
    except Exception as e:
        print(f"❌ Error scaling {input_path}: {e}")
        return False

def main():
    """Main function to scale all scope images"""
    print("🔍 TURBO Mode: Scaling Scope Images for DPR 0.5")
    print("=" * 50)
    
    # Define scope files to scale
    scope_files = [
        "scope_arc.tga",
        "scope_arc_nw.tga", 
        "scope_arc_ne.tga",
        "scope_arc_sw.tga"
    ]
    
    # Create scaled versions directory
    scaled_dir = "scaled_scope"
    os.makedirs(scaled_dir, exist_ok=True)
    
    success_count = 0
    total_count = len(scope_files)
    
    for scope_file in scope_files:
        if os.path.exists(scope_file):
            print(f"\n🔄 Processing: {scope_file}")
            output_file = os.path.join(scaled_dir, scope_file)
            
            if scale_image(scope_file, output_file, 0.5):
                success_count += 1
        else:
            print(f"⚠️  File not found: {scope_file}")
    
    print(f"\n" + "=" * 50)
    print(f"🎯 Scaling complete: {success_count}/{total_count} files processed")
    
    if success_count > 0:
        print(f"📁 Scaled images saved in: {scaled_dir}/")
        print(f"💡 These can now be used to create a DPR 0.5 compatible turbo-valve.zip")

if __name__ == "__main__":
    main()
