FROM ubuntu:22.04

USER root
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    sudo \
    git \
    git-lfs \
    python3 \
    python3-pip \
    qemu-system-x86 \
    qemu-kvm \
    && rm -rf /var/lib/apt/lists/*

# Install ttyd (universal binary)
RUN curl -sL https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 \
    -o /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

RUN pip3 install --no-cache-dir huggingface_hub[cli]
RUN git lfs install

RUN useradd -m -u 1000 user \
    && echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER user
WORKDIR /home/user

RUN mkdir -p /home/user/storage

RUN cat <<'SCRIPT' > /home/user/start.sh
#!/bin/bash

# ── Port Detection (Universal) ──
# Render uses PORT env, HF Spaces uses 7860, fallback 10000
PORT="${PORT:-7860}"

REPO_ID="${REPO_ID:-}"
HF_TOKEN="${HF_TOKEN:-}"
STORAGE_DIR="/home/user/storage"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-300}"

echo "==============================="
echo "  Platform: ${RENDER:+Render}${SPACE_ID:+HuggingFace}${PLATFORM:-Universal}"
echo "  Port:     $PORT"
echo "  Storage:  $STORAGE_DIR"
echo "==============================="

# ── Restore ──
mkdir -p "$STORAGE_DIR"
if [ -n "$HF_TOKEN" ] && [ -n "$REPO_ID" ]; then
    echo "[RESTORE] Downloading from $REPO_ID..."
    huggingface-cli download \
        "$REPO_ID" \
        --local-dir "$STORAGE_DIR" \
        --repo-type dataset \
        --token "$HF_TOKEN" \
        || echo "[RESTORE] Failed or repo empty"
else
    echo "[RESTORE] Skipped — REPO_ID or HF_TOKEN not set"
fi

# ── Backup Function ──
do_backup() {
    if [ -n "$HF_TOKEN" ] && [ -n "$REPO_ID" ]; then
        echo "[BACKUP] $(date) — Uploading to $REPO_ID..."
        huggingface-cli upload \
            "$REPO_ID" \
            "$STORAGE_DIR" . \
            --repo-type=dataset \
            --token="$HF_TOKEN" \
        && echo "[BACKUP] Success" \
        || echo "[BACKUP] Failed"
    fi
}

# ── Auto Backup Loop ──
(
    while true; do
        sleep "$BACKUP_INTERVAL"
        do_backup
    done
) &
AUTO_PID=$!

# ── Shutdown Handler ──
cleanup() {
    echo ""
    echo "[SHUTDOWN] Final backup..."
    kill "$AUTO_PID" 2>/dev/null
    do_backup
    echo "[SHUTDOWN] Done"
    exit 0
}
trap cleanup SIGTERM SIGINT

# ── Health Check Endpoint (for Render) ──
(
    while true; do
        echo -e "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK" \
            | nc -l -p 10001 -q 1 2>/dev/null || true
    done
) &

# ── Start Web Terminal ──
echo "[READY] Web terminal on port $PORT"
ttyd -p "$PORT" -W bash &
wait $!
SCRIPT

RUN chmod +x /home/user/start.sh

EXPOSE 7860 10000

ENTRYPOINT ["/home/user/start.sh"]
