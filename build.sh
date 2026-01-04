#!/bin/bash
# SLAB Build Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== SLAB Build Script ==="

# install dependencies if needed
echo "[1/5] Checking dependencies..."
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
    echo "Installing dependencies..."
    npm install
else
    echo "Dependencies already installed"
fi

# clean previous build
echo "[2/5] Cleaning dist/"
rm -rf dist/
mkdir -p dist/schemas

# compile TypeScript
echo "[3/5] Compiling TypeScript..."
npx tsc

# copy static assets
echo "[4/5] Copying metadata and schemas..."
cp metadata.json dist/
cp schemas/*.xml dist/schemas/

# compile GSettings schemas
echo "[5/5] Compiling GSettings schemas..."
glib-compile-schemas dist/schemas/

# rename extension.js to root (GNOME Shell expects it there)
if [ -f "dist/extension.js" ]; then
    echo "=== Build Complete ==="
    echo "Output: dist/"
    echo ""
    echo "To install:"
    echo "  mkdir -p ~/.local/share/gnome-shell/extensions/slab@slab.dev"
    echo "  cp -r dist/* ~/.local/share/gnome-shell/extensions/slab@slab.dev/"
    echo "  gnome-extensions enable slab@slab.dev"
else
    echo "ERROR: extension.js not found in dist/"
    exit 1
fi
