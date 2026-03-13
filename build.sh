#!/bin/bash
# ═══════════════════════════════════════════
#  HVM VPS — Build Phase (Render/Railway)
# ═══════════════════════════════════════════

set -e

echo "╔═══════════════════════════════════════╗"
echo "║    ⚡ HVM VPS — BUILD STARTING        ║"
echo "╚═══════════════════════════════════════╝"

# Node deps
echo "[1/5] Installing Node.js dependencies…"
npm install --production

# Python deps
echo "[2/5] Installing Python packages…"
pip install --user -r requirements.txt 2>/dev/null || pip3 install --user -r requirements.txt 2>/dev/null || true

# SSHX
echo "[3/5] Installing SSHX…"
curl -sSf https://sshx.io/get | sh 2>/dev/null || wget -qO- https://sshx.io/get | sh 2>/dev/null || true

# Tools
echo "[4/5] Installing extra tools…"
bash scripts/install-tools.sh 2>/dev/null || true

# Dirs
echo "[5/5] Setting up workspace…"
mkdir -p /tmp/vps-logs /tmp/vps-data workspace uploads .cache

echo ""
echo "✅ BUILD COMPLETE"
