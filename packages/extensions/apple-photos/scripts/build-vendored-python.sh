#!/usr/bin/env bash
# Build a relocatable Python venv with osxphotos installed.
# Output: vendored/python/bin/python3 (callable from host.exec).
#
# Idempotent: skips the work if vendored/python/bin/python3 already exists
# AND `python3 -m osxphotos --version` returns 0. Pass FORCE=1 to rebuild.

set -euo pipefail

cd "$(dirname "$0")/.."

VENV_DIR="vendored/python"
PY="$VENV_DIR/bin/python3"
STAMP="$VENV_DIR/.osxphotos-version"

if [[ -z "${FORCE:-}" && -x "$PY" && -f "$STAMP" ]]; then
  if "$PY" -m osxphotos --version >/dev/null 2>&1; then
    echo "[vendor-python] already built ($(cat "$STAMP")) — skipping. FORCE=1 to rebuild."
    exit 0
  fi
fi

mkdir -p "$(dirname "$VENV_DIR")"
rm -rf "$VENV_DIR"

# osxphotos uses Python 3.10+ syntax (PEP 604 unions). The Xcode CLT python
# at /usr/bin/python3 is 3.9 and is too old. Prefer Homebrew 3.12 if present.
PYTHON_BIN=""
for cand in /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3.10 /usr/local/bin/python3.12 /usr/local/bin/python3.11 /usr/local/bin/python3.10; do
  if [[ -x "$cand" ]]; then PYTHON_BIN="$cand"; break; fi
done
if [[ -z "$PYTHON_BIN" ]]; then
  echo "[vendor-python] ERROR: need Python 3.10+ (osxphotos requires it). Install via:"
  echo "  brew install python@3.12"
  exit 1
fi
echo "[vendor-python] using $PYTHON_BIN"

# Use --copies when supported (Homebrew Python supports it). Falls back to
# symlinks (which still works on the developer Mac, just not relocatable).
echo "[vendor-python] creating venv at $VENV_DIR..."
"$PYTHON_BIN" -m venv --copies "$VENV_DIR" 2>/dev/null || "$PYTHON_BIN" -m venv "$VENV_DIR"

echo "[vendor-python] upgrading pip..."
"$PY" -m pip install --quiet --upgrade pip

echo "[vendor-python] installing osxphotos (this can take a minute on first run)..."
"$PY" -m pip install --quiet --no-cache-dir osxphotos

echo "[vendor-python] recording version..."
"$PY" -m osxphotos --version | tee "$STAMP"

echo "[vendor-python] stripping caches to shrink venv..."
find "$VENV_DIR" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$VENV_DIR" -type d -name 'tests' -prune -exec rm -rf {} + 2>/dev/null || true
find "$VENV_DIR" -type d -name 'test' -prune -exec rm -rf {} + 2>/dev/null || true

SIZE=$(du -sh "$VENV_DIR" | awk '{print $1}')
echo "[vendor-python] done. Venv size: $SIZE"
