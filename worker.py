#!/usr/bin/env python3
"""
HVM VPS — Keep-Alive & SSHX Monitor (Native Metal)
"""

import os, re, sys, time, signal, subprocess, json, socket
from datetime import datetime, timezone
from pathlib import Path

try:
    from urllib.request import Request, urlopen
except ImportError:
    pass

# ── Config ──
PORT = os.environ.get("PORT", "3000")
SERVICE_URL = (
    os.environ.get("RENDER_EXTERNAL_URL")
    or os.environ.get("RAILWAY_STATIC_URL")
    or os.environ.get("RAILWAY_PUBLIC_DOMAIN")
    or os.environ.get("KOYEB_PUBLIC_DOMAIN")
    or os.environ.get("SERVICE_URL", "")
)
PING_INTERVAL = 210
CHECK_INTERVAL = 25
SSHX_RESTART_COOLDOWN = 60

last_sshx_restart = 0

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def proc_alive(name):
    try:
        r = subprocess.run(["pgrep", "-f", name], capture_output=True, timeout=5)
        return r.returncode == 0
    except:
        return False

def read(path):
    try:
        return Path(path).read_text()
    except:
        return ""

def get_sshx_url():
    txt = read("/tmp/sshx_url.txt").strip()
    if txt.startswith("https://"):
        return txt
    raw = read("/tmp/sshx_output.txt")
    m = re.search(r"https://sshx\.io/\S+", raw)
    if m:
        url = m.group().rstrip(".,;)")
        Path("/tmp/sshx_url.txt").write_text(url)
        log(f"✓ Captured SSHX → {url}")
        return url
    return None

def restart_sshx():
    global last_sshx_restart
    now = time.time()
    if now - last_sshx_restart < SSHX_RESTART_COOLDOWN:
        return False
    last_sshx_restart = now
    log("↻ Restarting SSHX…")
    subprocess.run(["pkill", "-f", "sshx"], capture_output=True)
    time.sleep(2)
    try:
        os.remove("/tmp/sshx_url.txt")
    except:
        pass
    Path("/tmp/sshx_output.txt").write_text("")
    workspace = os.environ.get("WORKSPACE_DIR", os.getcwd() + "/workspace")
    subprocess.Popen(
        f"cd {workspace} 2>/dev/null; sshx --shell bash 2>&1 | tee -a /tmp/sshx_output.txt",
        shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    for _ in range(30):
        time.sleep(1)
        if get_sshx_url():
            log(f"✓ SSHX restarted → {get_sshx_url()}")
            return True
    log("⚠ SSHX started, URL pending")
    return False

def ping():
    # Local
    try:
        req = Request(f"http://127.0.0.1:{PORT}/keep-alive",
                      headers={"User-Agent": "HVM-Worker/2.0"})
        urlopen(req, timeout=10)
        log("↑ local ping OK")
    except Exception as e:
        log(f"↑ local ping FAIL: {e}")
    # External
    if SERVICE_URL:
        base = SERVICE_URL if SERVICE_URL.startswith("http") else f"https://{SERVICE_URL}"
        try:
            req = Request(f"{base}/health",
                          headers={"User-Agent": "HVM-Worker/2.0"})
            urlopen(req, timeout=10)
            log("↑ external ping OK")
        except Exception as e:
            log(f"↑ external ping FAIL: {e}")

def collect_metrics():
    """Collect and store metrics history"""
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        metrics = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "cpu": cpu,
            "mem_pct": mem.percent,
            "mem_used": mem.used // 1048576,
            "mem_total": mem.total // 1048576,
            "disk_pct": disk.percent,
            "net": {},
        }
        try:
            net = psutil.net_io_counters()
            metrics["net"] = {
                "sent": net.bytes_sent,
                "recv": net.bytes_recv,
            }
        except:
            pass
        # Append to history file (keep last 360 entries = 3 hours at 30s intervals)
        hist_file = "/tmp/vps-data/metrics.json"
        history = []
        try:
            history = json.loads(Path(hist_file).read_text())
        except:
            pass
        history.append(metrics)
        history = history[-360:]
        Path(hist_file).write_text(json.dumps(history))
    except ImportError:
        pass

def write_status():
    url = get_sshx_url() or "pending"
    txt = f"""══════════════════════════════════════════
  HVM VPS — KEEP-ALIVE STATUS
══════════════════════════════════════════
  Checked : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}
  Status  : ALIVE ✅
  Mode    : Native Metal (No Container)
  SSHX    : {url}
  Worker  : PID {os.getpid()}
══════════════════════════════════════════
"""
    try:
        Path("/tmp/keep_alive.txt").write_text(txt)
    except:
        pass

def main():
    log("HVM Keep-Alive Worker started (Native Metal)")
    log(f"  PORT = {PORT}")
    log(f"  SERVICE_URL = {SERVICE_URL or '(not set)'}")
    last_ping = 0.0
    while True:
        try:
            get_sshx_url()
            if not proc_alive("sshx"):
                log("⚠ SSHX not running")
                restart_sshx()
            now = time.time()
            if now - last_ping >= PING_INTERVAL:
                ping()
                last_ping = now
            collect_metrics()
            write_status()
        except Exception as e:
            log(f"✗ error: {e}")
        time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    for s in (signal.SIGTERM, signal.SIGINT):
        signal.signal(s, lambda *_: (log("Shutting down…"), sys.exit(0)))
    main()
