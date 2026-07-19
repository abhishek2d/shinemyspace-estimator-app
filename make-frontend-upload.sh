#!/usr/bin/env bash
# ============================================================
#  Regenerates the clean, prod-ready frontend upload folder from the source.
#  Run this before each MANUAL upload to Hostinger so it's never stale:
#
#      ./make-frontend-upload.sh
#
#  It copies only the production files (index.html, .htaccess, sw.js, assets/)
#  and leaves out dev tooling (dev-server.js, package.json, .gitignore).
# ============================================================
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/estimator-shinemyspace"
OUT="$ROOT/estimator-shinemyspace upload"

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$SRC/index.html" "$SRC/.htaccess" "$SRC/sw.js" "$OUT/"
cp -r "$SRC/assets" "$OUT/"
find "$OUT" -name ".DS_Store" -delete 2>/dev/null || true

echo "✓ Rebuilt prod-ready upload folder:"
echo "  $OUT"
echo ""
echo "Files (upload ALL of these — remember .htaccess is hidden):"
( cd "$OUT" && find . -type f | sort | sed 's/^/  /' )
