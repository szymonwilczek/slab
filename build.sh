#!/bin/bash
# SLAB Build Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== SLAB Build Script ==="

# clean previous build
echo "[1/4] Cleaning dist/"
rm -rf dist/
mkdir -p dist/schemas

# compile TypeScript
echo "[2/4] Compiling TypeScript..."
npx tsc

# copy static assets
echo "[3/4] Copying metadata and schemas..."
cp metadata.json dist/
cp schemas/*.xml dist/schemas/

# compile GSettings schemas
echo "[4/4] Compiling GSettings schemas..."
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
