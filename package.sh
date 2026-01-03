#!/bin/bash
# SLAB Packaging Script
# Creates a ZIP file compatible with GNOME Extensions website

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

./build.sh

echo "=== Packaging SLAB for Release ==="

UUID="slab@slab.dev"
ZIP_NAME="${UUID}.zip"

cd dist/
echo "Creating ${ZIP_NAME}..."
zip -r "../${ZIP_NAME}" ./*

cd ..
echo "=== Packaging Complete ==="
echo "Artifact: ${ZIP_NAME}"
