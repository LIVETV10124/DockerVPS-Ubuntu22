#!/bin/bash
# ═══════════════════════════════════════════════════════
#  HVM VPS — Runtime Orchestrator (NO DOCKER!)
# ═══════════════════════════════════════════════════════

G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'
R='\033[0;31m'; B='\033[1m'; N='\033[0m'

echo ""
echo -e "${C}${B}╔═══════════════════════════════════════════════════╗${N}"
echo -e "${C}${B}║        ⚡  HVM VPS — STARTING (Native Metal)      ║${N}"
echo -e "${C}${B}║        🚫 No Docker · No Container · Pure VPS     ║${N}"
echo -e "${C}${B}╚═══════════════════════════════════════════════════╝${N}"
echo ""

mkdir -p /tmp/vps-logs /tmp/vps-data workspace uploads .cache 2>/dev/null

# ── Env ────────────────────────────────────────
export VPS_BOOT=$(date +%s)
export VPS_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null | cut -d- -f1 || echo "vps-$$")
export WORKSPACE_DIR="$(pwd)/workspace"
export PATH="$HOME/.local/bin:$PATH"

echo -e "  ${Y}[*]${N} VPS ID    : ${B}$VPS_ID${N}"
echo -e "  ${Y}[*]${N} Workspace : ${B}$WORKSPACE_DIR${N}"
echo -e "  ${Y}[*]${N} Port      : ${B}${PORT:-3000}${N}"
echo ""

# ── 1) SSHX ────────────────────────────────────
echo -e "  ${Y}[1/4]${N} Starting SSHX terminal…"

rm -f /tmp/sshx_url.txt
: > /tmp/sshx_output.txt

# Find sshx binary
SSHX_BIN=""
for p in sshx "$HOME/.local/bin/sshx" "/usr/local/bin/sshx" "$(pwd)/sshx"; do
    if command -v "$p" &>/dev/null || [ -x "$p" ]; then
        SSHX_BIN="$p"
        break
    fi
done

if [ -z "$SSHX_BIN" ]; then
    echo -e "  ${Y}[*]${N} SSHX not found, installing…"
    curl -sSf https://sshx.io/get | sh 2>/dev/null
    SSHX_BIN="sshx"
fi

(
    cd "$WORKSPACE_DIR" 2>/dev/null || cd /tmp
    $SSHX_BIN --shell bash 2>&1 | while IFS= read -r line; do
        echo "$line" >> /tmp/sshx_output.txt
        echo "[SSHX] $line" >> /tmp/vps-logs/sshx.log
        if echo "$line" | grep -qo 'https://sshx.io/[^ ]*'; then
            echo "$line" | grep -o 'https://sshx.io/[^ ]*' | head -1 > /tmp/sshx_url.txt
        fi
    done
) &
SSHX_PID=$!
echo $SSHX_PID > /tmp/sshx.pid

# Wait for URL
echo -n "        "
for i in $(seq 1 40); do
    if [ -s /tmp/sshx_url.txt ]; then
        echo ""
        echo -e "  ${G}[✓]${N} SSHX ready → ${B}$(cat /tmp/sshx_url.txt)${N}"
        break
    fi
    echo -n "·"
    sleep 0.5
done
if [ ! -s /tmp/sshx_url.txt ]; then
    echo ""
    echo -e "  ${Y}[*]${N} SSHX URL pending (background capture)"
fi

# ── 2) Python Worker ──────────────────────────
echo -e "  ${Y}[2/4]${N} Starting keep-alive worker…"

PYTHON_BIN=$(command -v python3 || command -v python)
if [ -n "$PYTHON_BIN" ]; then
    $PYTHON_BIN worker.py >> /tmp/vps-logs/worker.log 2>&1 &
    WORKER_PID=$!
    echo $WORKER_PID > /tmp/worker.pid
    echo -e "  ${G}[✓]${N} Worker started (PID $WORKER_PID)"
else
    echo -e "  ${R}[✗]${N} Python not found, worker skipped"
fi

# ── 3) System info ────────────────────────────
echo -e "  ${Y}[3/4]${N} Collecting system info…"

SSHX_LINK=$(cat /tmp/sshx_url.txt 2>/dev/null || echo "pending")
cat > /tmp/keep_alive.txt <<EOF
══════════════════════════════════════════════
  HVM VPS — STATUS REPORT
══════════════════════════════════════════════
  Status    : ONLINE ✅
  Mode      : Native (No Docker/Container)
  VPS ID    : $VPS_ID
  Started   : $(date -u '+%Y-%m-%d %H:%M:%S UTC')
  SSHX      : $SSHX_LINK
  Port      : ${PORT:-3000}
  Node.js   : $(node --version 2>/dev/null || echo N/A)
  Python    : $($PYTHON_BIN --version 2>/dev/null || echo N/A)
  Kernel    : $(uname -r 2>/dev/null || echo N/A)
  Arch      : $(uname -m 2>/dev/null || echo N/A)
══════════════════════════════════════════════
EOF

echo -e "  ${G}[✓]${N} System info collected"

# ── 4) Start Web Server ──────────────────────
echo ""
echo -e "  ${Y}[4/4]${N} Starting HVM Control Panel…"
echo ""
echo -e "${C}${B}╔═══════════════════════════════════════════════════╗${N}"
echo -e "${C}${B}║           ✅  HVM VPS — FULLY OPERATIONAL         ║${N}"
echo -e "${C}${B}╠═══════════════════════════════════════════════════╣${N}"
echo -e "${C}${B}║  Panel  → http://0.0.0.0:${PORT:-3000}                     ║${N}"
echo -e "${C}${B}║  SSHX   → $(printf '%-40s' "$SSHX_LINK")║${N}"
echo -e "${C}${B}║  Mode   → Native Metal (No Container) 🔥         ║${N}"
echo -e "${C}${B}╚═══════════════════════════════════════════════════╝${N}"
echo ""

exec node server.js
