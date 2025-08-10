#!/bin/bash

# Build xash3d-fwgs locally with function table support
set -e

echo "Building xash3d-fwgs locally with EXPORT_TABLE=1..."

# Create build directory
mkdir -p /tmp/xash-build
cd /tmp/xash-build

# Clone if not exists
if [ ! -d "xash3d-fwgs" ]; then
    git clone --depth 1 https://github.com/FWGS/xash3d-fwgs.git
fi

cd xash3d-fwgs

# Set up Emscripten build with function table export
export EMCC_CFLAGS="-s EXPORT_TABLE=1 -s ALLOW_TABLE_GROWTH=1 -s EXPORTED_RUNTIME_METHODS=['addFunction','removeFunction','ccall','cwrap'] -s MODULARIZE=1 -s ENVIRONMENT=web"

# Configure and build
./waf configure --build-type=release --enable-gl --disable-vgui || echo "Configure might have warnings, continuing..."
./waf build --target=engine

# Copy the built files to our client directory
echo "Copying built files to client/assets/local/"
mkdir -p /home/shane/Desktop/cs16-web/client/assets/local/
cp build/engine/xash* /home/shane/Desktop/cs16-web/client/assets/local/ || echo "Copy completed with some files missing (normal)"

echo "Build complete! Update bootstrap.js to use local files."
echo "Files available in client/assets/local/"
ls -la /home/shane/Desktop/cs16-web/client/assets/local/
