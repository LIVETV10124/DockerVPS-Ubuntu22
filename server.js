// ═══════════════════════════════════════════════════════════════════
//  HVM VPS CONTROL PANEL v2.0 — Native Metal, No Docker
//  Real VPS dashboard with full system management
// ═══════════════════════════════════════════════════════════════════

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, exec, spawn } = require("child_process");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const BOOT = Date.now();
const VPS_ID = process.env.VPS_ID || "hvm-" + Math.random().toString(36).slice(2, 8);
const WORKSPACE = process.env.WORKSPACE_DIR || path.join(process.cwd(), "workspace");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

function run(cmd, fb = "N/A") {
  try {
    return execSync(cmd, { timeout: 8000, stdio: "pipe", env: { ...process.env, PATH: process.env.PATH + ":/usr/local/bin:/usr/bin:/bin" } }).toString().trim();
  } catch { return fb; }
}

function sshxUrl() {
  try {
    const u = fs.readFileSync("/tmp/sshx_url.txt", "utf8").trim();
    if (u.startsWith("https://")) return u;
  } catch {}
  try {
    const raw = fs.readFileSync("/tmp/sshx_output.txt", "utf8");
    const m = raw.match(/https:\/\/sshx\.io\/\S+/);
    if (m) { fs.writeFileSync("/tmp/sshx_url.txt", m[0]); return m[0]; }
  } catch {}
  return null;
}

function uptime() {
  const d = Date.now() - BOOT;
  const days = Math.floor(d / 864e5);
  const h = Math.floor((d % 864e5) / 36e5);
  const m = Math.floor((d % 36e5) / 6e4);
  const s = Math.floor((d % 6e4) / 1e3);
  if (days > 0) return `${days}d ${h}h ${m}m`;
  return `${h}h ${m}m ${s}s`;
}

function systemUptime() {
  const u = os.uptime();
  const d = Math.floor(u / 86400);
  const h = Math.floor((u % 86400) / 3600);
  const m = Math.floor((u % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function procAlive(name) { return run(`pgrep -f ${name}`, "") !== ""; }

function getCpu() {
  const load = os.loadavg();
  const cpus = os.cpus().length;
  return Math.min(100, Math.round((load[0] / cpus) * 100));
}

function getMem() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total: (total / 1048576) | 0,
    free: (free / 1048576) | 0,
    used: (used / 1048576) | 0,
    pct: Math.round((used / total) * 100),
    totalGB: (total / 1073741824).toFixed(1),
    usedGB: (used / 1073741824).toFixed(1),
  };
}

function getDisk() {
  const raw = run("df -h / | tail -1", "");
  if (!raw) return { total: "N/A", used: "N/A", free: "N/A", pct: 0, device: "N/A" };
  const p = raw.split(/\s+/);
  return { device: p[0], total: p[1], used: p[2], free: p[3], pct: parseInt(p[4]) || 0, mount: p[5] };
}

function getSwap() {
  const raw = run("free -m | grep Swap", "");
  if (!raw) return { total: 0, used: 0, free: 0, pct: 0 };
  const p = raw.split(/\s+/);
  const total = parseInt(p[1]) || 0;
  const used = parseInt(p[2]) || 0;
  return { total, used, free: total - used, pct: total > 0 ? Math.round((used / total) * 100) : 0 };
}

function getProcesses(sort = "-%mem", limit = 30) {
  const raw = run(`ps aux --sort=${sort} | head -${limit + 1}`, "");
  if (!raw) return [];
  return raw.split("\n").slice(1).map(l => {
    const p = l.split(/\s+/);
    return {
      user: p[0], pid: p[1], cpu: p[2], mem: p[3],
      vsz: ((parseInt(p[4]) || 0) / 1024).toFixed(0),
      rss: ((parseInt(p[5]) || 0) / 1024).toFixed(1),
      tty: p[6], stat: p[7], start: p[8], time: p[9],
      cmd: p.slice(10).join(" ").substring(0, 80),
    };
  }).filter(p => p.pid);
}

function getNetwork() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs) {
      result.push({ iface: name, addr: a.address, family: a.family, mac: a.mac, internal: a.internal, netmask: a.netmask });
    }
  }
  return result;
}

function getPorts() {
  const raw = run("ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null", "");
  if (!raw) return [];
  return raw.split("\n").slice(1).map(l => {
    const p = l.split(/\s+/);
    return { proto: p[0], state: p[1], recv: p[2], send: p[3], local: p[4], peer: p[5], process: p[6] || "" };
  }).filter(c => c.proto);
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).map(i => {
      let stat;
      try { stat = fs.statSync(path.join(dir, i.name)); }
      catch { stat = { size: 0, mtime: new Date(), mode: 0 }; }
      return {
        name: i.name, isDir: i.isDirectory(), isSymlink: i.isSymbolicLink(),
        size: stat.size, modified: stat.mtime, mode: stat.mode,
        perms: run(`stat -c '%a' "${path.join(dir, i.name)}" 2>/dev/null || stat -f '%Lp' "${path.join(dir, i.name)}" 2>/dev/null`, "---"),
        owner: run(`stat -c '%U' "${path.join(dir, i.name)}" 2>/dev/null`, "?"),
        group: run(`stat -c '%G' "${path.join(dir, i.name)}" 2>/dev/null`, "?"),
      };
    }).sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
  } catch { return []; }
}

function getMetricsHistory() {
  try { return JSON.parse(fs.readFileSync("/tmp/vps-data/metrics.json", "utf8")); }
  catch { return []; }
}

// ═══════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════

app.get("/api/status", (_r, res) => {
  const mem = getMem(), disk = getDisk(), swap = getSwap();
  res.json({
    status: "online", mode: "native-metal", vpsId: VPS_ID,
    sshxUrl: sshxUrl(), sshx: procAlive("sshx"), worker: procAlive("worker.py"),
    uptime: uptime(), systemUptime: systemUptime(),
    cpu: getCpu(), cpuModel: os.cpus()[0]?.model || "N/A", cpuSpeed: os.cpus()[0]?.speed || 0,
    mem, disk, swap, loadavg: os.loadavg(),
    hostname: os.hostname(), arch: os.arch(), platform: os.platform(),
    cpus: os.cpus().length, node: process.version,
    python: run("python3 --version 2>&1 || python --version 2>&1"),
    kernel: run("uname -r"), kernelFull: run("uname -a"),
    distro: run("cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'\"' -f2", "Unknown"),
    publicIP: run("curl -s --max-time 3 ifconfig.me 2>/dev/null || curl -s --max-time 3 icanhazip.com 2>/dev/null", "N/A"),
    processCount: parseInt(run("ps aux | wc -l", "0")) - 1,
    userCount: parseInt(run("who | wc -l", "0")),
    ts: new Date().toISOString(),
  });
});

app.get("/api/processes", (req, res) => {
  const sort = req.query.sort || "-%mem";
  res.json(getProcesses(sort, parseInt(req.query.limit) || 30));
});

app.post("/api/kill/:pid", (req, res) => {
  const sig = req.body.signal || "TERM";
  const r = run(`kill -${sig} ${req.params.pid} 2>&1`, "failed");
  res.json({ ok: r !== "failed", result: r });
});

app.get("/api/network", (_r, res) => {
  res.json({
    interfaces: getNetwork(), ports: getPorts(),
    dns: run("cat /etc/resolv.conf 2>/dev/null | grep nameserver", ""),
    hostname: os.hostname(),
    publicIP: run("curl -s --max-time 3 ifconfig.me 2>/dev/null", "N/A"),
    rx: run("cat /sys/class/net/eth0/statistics/rx_bytes 2>/dev/null", "0"),
    tx: run("cat /sys/class/net/eth0/statistics/tx_bytes 2>/dev/null", "0"),
  });
});

app.get("/api/files", (req, res) => {
  const dir = req.query.path || WORKSPACE;
  res.json({ path: dir, items: listDir(dir) });
});

app.get("/api/file-content", (req, res) => {
  const f = req.query.path;
  if (!f) return res.status(400).json({ error: "path required" });
  try {
    const stat = fs.statSync(f);
    if (stat.size > 2097152) return res.status(413).json({ error: "Too large" });
    const isBinary = run(`file --mime-encoding "${f}" 2>/dev/null`, "").includes("binary");
    res.json({ path: f, content: isBinary ? "[Binary file]" : fs.readFileSync(f, "utf8"), size: stat.size, binary: isBinary });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post("/api/file-save", (req, res) => {
  const { path: fp, content } = req.body;
  if (!fp) return res.status(400).json({ error: "path required" });
  try {
    fs.writeFileSync(fp, content);
    res.json({ ok: true, path: fp, size: Buffer.byteLength(content) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/file-delete", (req, res) => {
  const { path: fp } = req.body;
  try { fs.rmSync(fp, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/file-mkdir", (req, res) => {
  const { path: fp } = req.body;
  try { fs.mkdirSync(fp, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const dest = path.join(req.body.dir || WORKSPACE, req.file.originalname);
  fs.renameSync(req.file.path, dest);
  res.json({ ok: true, path: dest, size: req.file.size });
});

app.get("/api/download", (req, res) => {
  const f = req.query.path;
  if (!f || !fs.existsSync(f)) return res.status(404).json({ error: "not found" });
  res.download(f);
});

app.get("/api/logs", (req, res) => {
  const file = req.query.file || "/tmp/vps-logs/sshx.log";
  const lines = Math.min(parseInt(req.query.lines) || 80, 500);
  const content = run(`tail -n ${lines} "${file}" 2>/dev/null`, "No logs");
  res.json({ file, content, lines });
});

app.get("/api/metrics-history", (_r, res) => res.json(getMetricsHistory()));

app.get("/api/packages", (_r, res) => {
  const raw = run("dpkg -l 2>/dev/null | grep '^ii' | head -50 || rpm -qa --queryformat '%{NAME} %{VERSION}\\n' 2>/dev/null | head -50 || pip3 list --format=columns 2>/dev/null | tail -20", "");
  const pkgs = raw.split("\n").map(l => {
    const p = l.split(/\s+/);
    if (p[0] === "ii") return { name: p[1], version: p[2], arch: p[3], desc: p.slice(4).join(" ") };
    return { name: p[0], version: p[1] || "", desc: p.slice(2).join(" ") };
  }).filter(p => p.name);
  res.json(pkgs);
});

app.get("/api/env", (_r, res) => {
  const safe = { ...process.env };
  ["PASSWORD", "SECRET", "TOKEN", "KEY", "PRIVATE"].forEach(k => {
    Object.keys(safe).forEach(ek => { if (ek.toUpperCase().includes(k)) safe[ek] = "***"; });
  });
  res.json(safe);
});

app.get("/api/crontab", (_r, res) => {
  res.json({ crontab: run("crontab -l 2>/dev/null", "No crontab") });
});

app.post("/api/exec", (req, res) => {
  const { cmd, cwd, timeout } = req.body;
  if (!cmd) return res.status(400).json({ error: "cmd required" });
  try {
    const output = execSync(cmd, {
      timeout: Math.min(parseInt(timeout) || 15000, 30000),
      cwd: cwd || WORKSPACE,
      stdio: "pipe",
      env: { ...process.env, TERM: "xterm-256color" },
    }).toString();
    res.json({ cmd, output, exitCode: 0 });
  } catch (e) {
    res.json({ cmd, output: (e.stdout?.toString() || "") + (e.stderr?.toString() || e.message), exitCode: e.status || 1 });
  }
});

app.get("/api/sshx-url", (_r, res) => {
  const u = sshxUrl();
  res.json({ url: u, ready: !!u });
});

app.post("/api/sshx/restart", (_r, res) => {
  run("pkill -f sshx");
  setTimeout(() => {
    exec(`cd ${WORKSPACE}; sshx --shell bash 2>&1 | tee -a /tmp/sshx_output.txt &`, { shell: "/bin/bash" });
  }, 1500);
  res.json({ ok: true, msg: "SSHX restarting…" });
});

app.get("/health", (_r, res) => res.json({ status: "ok", uptime: uptime(), mode: "native-metal" }));
app.get("/keep-alive", (_r, res) => res.json({ alive: true, uptime: uptime(), ts: new Date().toISOString() }));
app.get("/terminal", (_r, res) => { const u = sshxUrl(); u ? res.redirect(302, u) : res.status(503).json({ error: "SSHX not ready" }); });

// ═══════════════════════════════════════════════════
//  DASHBOARD HTML
// ═══════════════════════════════════════════════════

app.get("/", (req, res) => {
  if (req.query.noredirect === undefined && req.query.panel === undefined) {
    const u = sshxUrl();
    if (u) return res.redirect(302, u);
  }
  res.send(generateDashboard());
});

app.get("/dashboard", (_r, res) => res.send(generateDashboard()));

function generateDashboard() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HVM VPS — Control Panel</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🖥️</text></svg>">
<style>
:root{
  --bg:#080b12;--sb:#0c1018;--card:#111621;--card2:#151c28;--bdr:#1a2332;--bdr2:#243044;
  --acc:#00ff88;--acc2:#3b82f6;--acc3:#f43f5e;--acc4:#f59e0b;--acc5:#a855f7;--acc6:#06b6d4;
  --txt:#c9d1d9;--dim:#4a5568;--muted:#6b7280;--white:#f1f5f9;
  --green:#22c55e;--red:#ef4444;--yellow:#eab308;--blue:#3b82f6;
  --glow:0 0 20px rgba(0,255,136,.08);
  --radius:12px;
}
*{margin:0;padding:0;box-sizing:border-box}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px}
body{background:var(--bg);color:var(--txt);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;min-height:100vh;overflow:hidden}
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

/* ═══ SIDEBAR ═══ */
.sb{width:260px;background:var(--sb);border-right:1px solid var(--bdr);display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh;z-index:100;transition:.3s}
.sb-brand{padding:22px 20px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:14px}
.sb-logo{width:42px;height:42px;background:linear-gradient(135deg,var(--acc),#00b864);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:var(--bg);box-shadow:var(--glow)}
.sb-brand h2{font-size:1rem;color:var(--white);font-weight:700;letter-spacing:-.3px}
.sb-brand small{font-size:.62rem;color:var(--dim);display:block;margin-top:2px;text-transform:uppercase;letter-spacing:1px}
.sb nav{flex:1;overflow-y:auto;padding:6px 0}
.sb .sec{padding:16px 22px 6px;font-size:.6rem;text-transform:uppercase;letter-spacing:2px;color:var(--dim);font-weight:700}
.sb .ni{display:flex;align-items:center;gap:13px;padding:10px 22px;color:var(--muted);text-decoration:none;font-size:.84rem;border-left:3px solid transparent;transition:.15s;cursor:pointer;font-weight:500}
.sb .ni:hover{color:var(--txt);background:rgba(255,255,255,.02)}
.sb .ni.a{color:var(--acc);background:rgba(0,255,136,.04);border-left-color:var(--acc)}
.sb .ni .ic{font-size:1.05rem;width:24px;text-align:center}
.sb .badge{margin-left:auto;font-size:.58rem;padding:2px 8px;border-radius:10px;font-weight:700}
.sb .badge.live{background:var(--acc);color:var(--bg)}
.sb .badge.cnt{background:rgba(59,130,246,.2);color:var(--acc2)}
.sb-ft{padding:16px 20px;border-top:1px solid var(--bdr);display:flex;align-items:center;gap:12px}
.sb-av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-size:.72rem;color:#fff;font-weight:700}
.sb-ft .nm{font-size:.78rem;color:var(--txt);font-weight:600}
.sb-ft .rl{font-size:.6rem;color:var(--dim)}

/* ═══ MAIN ═══ */
.mn{margin-left:260px;flex:1;height:100vh;overflow-y:auto;display:flex;flex-direction:column}
.tb{position:sticky;top:0;z-index:50;background:rgba(8,11,18,.88);backdrop-filter:blur(16px);border-bottom:1px solid var(--bdr);padding:12px 30px;display:flex;align-items:center;justify-content:space-between}
.tb-l{display:flex;align-items:center;gap:16px}
.ham{display:none;background:none;border:none;color:var(--txt);font-size:1.3rem;cursor:pointer}
.bc{font-size:.8rem;color:var(--dim)}.bc b{color:var(--txt);font-weight:600}
.tb-r{display:flex;align-items:center;gap:10px}
.pill{display:flex;align-items:center;gap:6px;font-size:.76rem;padding:5px 14px;border-radius:20px;font-weight:600;border:1px solid}
.pill.on{background:rgba(34,197,94,.08);color:var(--green);border-color:rgba(34,197,94,.2)}
.pill.off{background:rgba(239,68,68,.08);color:var(--red);border-color:rgba(239,68,68,.2)}
.pill .dot{width:7px;height:7px;border-radius:50%;background:currentColor;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
.tbtn{background:var(--card);border:1px solid var(--bdr);color:var(--txt);padding:7px 16px;border-radius:8px;font-size:.78rem;cursor:pointer;transition:.15s;font-family:inherit;font-weight:500}
.tbtn:hover{border-color:var(--acc);color:var(--acc)}
.tbtn.pri{background:linear-gradient(135deg,var(--acc),#00cc6a);color:var(--bg);border-color:var(--acc);font-weight:700;box-shadow:0 2px 12px rgba(0,255,136,.2)}
.tbtn.pri:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,255,136,.3)}
.ct{padding:26px 30px;flex:1}

/* ═══ PAGE ═══ */
.pg{display:none;animation:fu .35s ease}.pg.a{display:block}
@keyframes fu{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

/* ═══ CARDS GRID ═══ */
.cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;margin-bottom:22px}
.sc{background:var(--card);border:1px solid var(--bdr);border-radius:var(--radius);padding:20px;transition:.2s;position:relative;overflow:hidden}
.sc:hover{border-color:var(--bdr2);transform:translateY(-2px);box-shadow:var(--glow)}
.sc-h{display:flex;justify-content:space-between;align-items:flex-start}
.sc-i{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:1.15rem}
.sc-l{font-size:.68rem;color:var(--dim);text-transform:uppercase;letter-spacing:1px;font-weight:600}
.sc-v{font-size:1.7rem;font-weight:800;color:var(--white);margin:6px 0 3px;letter-spacing:-.5px}
.sc-s{font-size:.72rem;color:var(--muted);font-weight:500}
.sc-bar{height:4px;background:var(--bdr);border-radius:2px;margin-top:12px;overflow:hidden}
.sc-bf{height:100%;border-radius:2px;transition:width .6s}

/* ═══ PANEL ═══ */
.pn{background:var(--card);border:1px solid var(--bdr);border-radius:var(--radius);margin-bottom:20px;overflow:hidden}
.pn-h{padding:16px 22px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between}
.pn-h h3{font-size:.9rem;color:var(--white);display:flex;align-items:center;gap:9px;font-weight:700}
.pn-a{display:flex;gap:8px}
.pn-b{padding:18px 22px}.pn-b.np{padding:0}

/* ═══ TABLE ═══ */
.t{width:100%;border-collapse:collapse;font-size:.78rem}
.t th{text-align:left;padding:11px 16px;font-size:.65rem;text-transform:uppercase;letter-spacing:1px;color:var(--dim);background:rgba(0,0,0,.25);border-bottom:1px solid var(--bdr);font-weight:700;position:sticky;top:0}
.t td{padding:10px 16px;border-bottom:1px solid rgba(26,35,50,.6);vertical-align:middle}
.t tr:hover td{background:rgba(255,255,255,.015)}
.mono{font-family:'JetBrains Mono',monospace;font-size:.75rem}

/* ═══ TAGS ═══ */
.tag{display:inline-flex;align-items:center;padding:3px 10px;border-radius:6px;font-size:.67rem;font-weight:600;gap:4px}
.tag.g{background:rgba(34,197,94,.12);color:#4ade80}
.tag.r{background:rgba(239,68,68,.12);color:#f87171}
.tag.y{background:rgba(234,179,8,.12);color:#facc15}
.tag.b{background:rgba(59,130,246,.12);color:#60a5fa}
.tag.p{background:rgba(168,85,247,.12);color:#c084fc}
.tag.c{background:rgba(6,182,212,.12);color:#22d3ee}

/* ═══ BUTTONS ═══ */
.btn{border:none;border-radius:8px;padding:8px 18px;font-size:.8rem;cursor:pointer;font-family:inherit;transition:.15s;font-weight:600;display:inline-flex;align-items:center;gap:6px}
.btn-s{padding:4px 12px;font-size:.72rem;border-radius:6px}
.btn-a{background:linear-gradient(135deg,var(--acc),#00cc6a);color:var(--bg)}
.btn-a:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,255,136,.25)}
.btn-d{background:rgba(239,68,68,.1);color:#f87171;border:1px solid rgba(239,68,68,.2)}
.btn-d:hover{background:rgba(239,68,68,.2)}
.btn-g{background:transparent;color:var(--muted);border:1px solid var(--bdr)}
.btn-g:hover{border-color:var(--acc);color:var(--acc)}
.btn-b{background:rgba(59,130,246,.1);color:#60a5fa;border:1px solid rgba(59,130,246,.2)}
.btn-b:hover{background:rgba(59,130,246,.2)}
.btn-p{background:rgba(168,85,247,.1);color:#c084fc;border:1px solid rgba(168,85,247,.2)}

/* ═══ SSHX HERO ═══ */
.hero{background:linear-gradient(135deg,rgba(0,255,136,.04),rgba(59,130,246,.04));border:1px solid rgba(0,255,136,.15);border-radius:16px;padding:32px;text-align:center;margin-bottom:24px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 30% 40%,rgba(0,255,136,.03),transparent 50%),radial-gradient(circle at 70% 60%,rgba(59,130,246,.03),transparent 50%);pointer-events:none}
.hero h3{color:var(--acc);font-size:1.2rem;margin-bottom:4px;font-weight:800;position:relative}
.hero .sub{color:var(--muted);font-size:.84rem;margin-bottom:16px;position:relative}
.hero .url-box{background:rgba(0,0,0,.35);padding:14px 20px;border-radius:10px;font-family:'JetBrains Mono',monospace;font-size:.88rem;color:var(--acc2);margin:0 auto 18px;max-width:460px;word-break:break-all;border:1px solid rgba(59,130,246,.15);position:relative}
.hero .url-box a{color:var(--acc2);text-decoration:none}
.hero .url-box a:hover{color:#93c5fd;text-decoration:underline}
.hero .btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;position:relative}
.hero .big-btn{padding:14px 32px;font-size:1.05rem;border-radius:12px}

/* ═══ TERMINAL ═══ */
.term{background:#0a0a0a;border-radius:10px;padding:16px 20px;font-family:'JetBrains Mono',monospace;font-size:.78rem;color:#a0a0a0;max-height:340px;overflow-y:auto;line-height:1.7;border:1px solid #1a1a1a}
.term .ps{color:var(--acc);font-weight:600}
.term .cmd{color:var(--white)}
.term .err{color:var(--red)}
.qr{display:flex;gap:8px;margin-top:12px}
.qr input{flex:1;background:var(--card2);border:1px solid var(--bdr);color:var(--txt);padding:11px 16px;border-radius:10px;font-family:'JetBrains Mono',monospace;font-size:.82rem;transition:.2s}
.qr input:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(0,255,136,.08)}

/* ═══ FILE MANAGER ═══ */
.fp{display:flex;align-items:center;gap:8px;margin-bottom:14px;background:var(--card2);padding:10px 14px;border-radius:10px;border:1px solid var(--bdr)}
.fp input{flex:1;background:transparent;border:none;color:var(--txt);font-family:'JetBrains Mono',monospace;font-size:.82rem}
.fp input:focus{outline:none}
.fi{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid rgba(26,35,50,.4);cursor:pointer;transition:.1s;font-size:.82rem}
.fi:hover{background:rgba(255,255,255,.02)}
.fi .fic{font-size:1.05rem;width:24px;text-align:center}
.fi .fin{flex:1;font-weight:500}
.fi .fin.dir{color:var(--acc2)}
.fi .fm{color:var(--dim);font-size:.7rem;font-family:'JetBrains Mono',monospace}

/* ═══ LOG ═══ */
.logv{background:#060606;padding:16px;border-radius:10px;font-family:'JetBrains Mono',monospace;font-size:.72rem;color:#666;max-height:450px;overflow:auto;line-height:1.8;white-space:pre-wrap;word-break:break-all;border:1px solid #141414}

/* ═══ CHART CANVAS ═══ */
.chart-wrap{position:relative;height:140px;margin-bottom:8px}
.chart-wrap canvas{position:absolute;inset:0;width:100%!important;height:100%!important}

/* ═══ GAUGE ═══ */
.gauge{position:relative;width:120px;height:120px;margin:0 auto}
.gauge svg{transform:rotate(-90deg)}
.gauge-bg{fill:none;stroke:var(--bdr);stroke-width:8}
.gauge-fill{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset .6s}
.gauge-txt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gauge-val{font-size:1.6rem;font-weight:800;color:var(--white)}
.gauge-label{font-size:.6rem;color:var(--dim);text-transform:uppercase;letter-spacing:1px}

/* ═══ BAR CHART ═══ */
.bars{display:flex;flex-direction:column;gap:8px}
.bar-r{display:flex;align-items:center;gap:12px;font-size:.78rem}
.bar-l{width:70px;color:var(--muted);text-align:right;font-weight:500;font-size:.72rem}
.bar-t{flex:1;height:8px;background:var(--bdr);border-radius:4px;overflow:hidden}
.bar-f{height:100%;border-radius:4px;transition:width .6s}
.bar-p{width:45px;color:var(--txt);font-weight:700;font-size:.72rem;font-family:'JetBrains Mono',monospace}

/* ═══ DUAL COL ═══ */
.dual{display:grid;grid-template-columns:1fr 1fr;gap:20px}

/* ═══ TOAST ═══ */
.toast-c{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px}
.toast{background:var(--card);border:1px solid var(--bdr);border-radius:12px;padding:12px 20px;font-size:.82rem;display:flex;align-items:center;gap:10px;animation:tIn .3s;box-shadow:0 8px 32px rgba(0,0,0,.5)}
@keyframes tIn{from{transform:translateX(100%);opacity:0}to{transform:none;opacity:1}}
.toast.ok{border-left:3px solid var(--green)}.toast.err{border-left:3px solid var(--red)}

/* ═══ RESPONSIVE ═══ */
@media(max-width:900px){.sb{transform:translateX(-100%)}.sb.open{transform:none}.mn{margin-left:0}.ham{display:block}.cg{grid-template-columns:1fr 1fr}.dual{grid-template-columns:1fr}}
@media(max-width:500px){.cg{grid-template-columns:1fr}.ct{padding:16px}.hero{padding:22px}}

/* ═══ GLOW ACCENTS ═══ */
.glow-g{box-shadow:0 0 0 1px rgba(0,255,136,.1),inset 0 1px 0 rgba(0,255,136,.05)}
.glow-b{box-shadow:0 0 0 1px rgba(59,130,246,.1),inset 0 1px 0 rgba(59,130,246,.05)}

/* ═══ EDITOR ═══ */
.editor{width:100%;min-height:300px;background:#0a0a0a;border:1px solid var(--bdr);border-radius:8px;color:var(--txt);font-family:'JetBrains Mono',monospace;font-size:.8rem;padding:14px;resize:vertical}
.editor:focus{outline:none;border-color:var(--acc)}
</style>
</head>
<body>

<!-- ═══ SIDEBAR ═══ -->
<aside class="sb" id="sb">
  <div class="sb-brand">
    <div class="sb-logo">⚡</div>
    <div>
      <h2>HVM Panel</h2>
      <small>Native Metal VPS</small>
    </div>
  </div>
  <nav>
    <div class="sec">Dashboard</div>
    <a class="ni a" data-p="overview"><span class="ic">📊</span>Overview</a>
    <a class="ni" data-p="terminal"><span class="ic">🖥️</span>Terminal<span class="badge live" id="sshx-b">LIVE</span></a>
    <a class="ni" data-p="processes"><span class="ic">⚙️</span>Processes<span class="badge cnt" id="proc-cnt">0</span></a>

    <div class="sec">Infrastructure</div>
    <a class="ni" data-p="monitoring"><span class="ic">📈</span>Monitoring</a>
    <a class="ni" data-p="network"><span class="ic">🌐</span>Network</a>
    <a class="ni" data-p="storage"><span class="ic">💾</span>Storage</a>

    <div class="sec">Management</div>
    <a class="ni" data-p="files"><span class="ic">📁</span>File Manager</a>
    <a class="ni" data-p="editor"><span class="ic">✏️</span>Editor</a>
    <a class="ni" data-p="logs"><span class="ic">📋</span>Logs</a>
    <a class="ni" data-p="packages"><span class="ic">📦</span>Packages</a>

    <div class="sec">Tools</div>
    <a class="ni" data-p="console"><span class="ic">💻</span>Console</a>
    <a class="ni" data-p="env"><span class="ic">🔑</span>Environment</a>
    <a class="ni" data-p="settings"><span class="ic">🔧</span>Settings</a>
  </nav>
  <div class="sb-ft">
    <div class="sb-av">R</div>
    <div><div class="nm">root</div><div class="rl">Administrator</div></div>
  </div>
</aside>

<!-- ═══ MAIN ═══ -->
<div class="mn">
  <div class="tb">
    <div class="tb-l">
      <button class="ham" onclick="document.getElementById('sb').classList.toggle('open')">☰</button>
      <div class="bc">HVM Panel / <b id="pt">Overview</b></div>
    </div>
    <div class="tb-r">
      <div class="pill on" id="pill"><span class="dot"></span><span id="stxt">Online</span></div>
      <button class="tbtn" onclick="R()">↻ Refresh</button>
      <button class="tbtn pri" onclick="oT()">⚡ Terminal</button>
    </div>
  </div>

  <div class="ct">

    <!-- ═══ OVERVIEW ═══ -->
    <div class="pg a" id="pg-overview">
      <div class="hero">
        <h3>🖥️ Native Metal VPS Terminal</h3>
        <p class="sub">No Docker · No Container · Real System Access via SSHX</p>
        <div class="url-box" id="sshx-d">Connecting…</div>
        <div class="btns">
          <button class="btn btn-a big-btn" onclick="oT()">🖥️ Open Terminal</button>
          <button class="btn btn-g" onclick="cU()">📋 Copy URL</button>
          <button class="btn btn-d btn-s" onclick="rS()">↻ Restart SSHX</button>
        </div>
      </div>
      <div class="cg" id="stats"></div>
      <div class="dual">
        <div class="pn">
          <div class="pn-h"><h3>📊 Resource Usage</h3></div>
          <div class="pn-b"><div class="bars" id="res-bars"></div></div>
        </div>
        <div class="pn">
          <div class="pn-h"><h3>📈 Load Average</h3></div>
          <div class="pn-b"><div class="bars" id="load-bars"></div></div>
        </div>
      </div>
      <div class="pn">
        <div class="pn-h"><h3>⚙️ Services</h3></div>
        <div class="pn-b np"><table class="t"><thead><tr><th>Service</th><th>Status</th><th>Type</th><th>Details</th><th></th></tr></thead><tbody id="svc-body"></tbody></table></div>
      </div>
      <div class="pn">
        <div class="pn-h"><h3>🖥️ System Identity</h3></div>
        <div class="pn-b"><div id="sys-id" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px"></div></div>
      </div>
    </div>

    <!-- ═══ TERMINAL ═══ -->
    <div class="pg" id="pg-terminal">
      <div class="hero">
        <h3>🖥️ Remote Terminal — SSHX</h3>
        <p class="sub">Full bash shell access directly in your browser</p>
        <div class="url-box" id="sshx-t">Connecting…</div>
        <div class="btns">
          <button class="btn btn-a big-btn" onclick="oT()">🖥️ Launch Shell</button>
          <button class="btn btn-g" onclick="cU()">📋 Copy</button>
          <button class="btn btn-d" onclick="rS()">↻ Restart</button>
        </div>
      </div>
      <div class="pn"><div class="pn-h"><h3>💻 Quick Command</h3></div><div class="pn-b">
        <div class="qr"><input id="qcmd" placeholder="$ type a command…" onkeydown="if(event.key==='Enter')qRun()"><button class="btn btn-a" onclick="qRun()">Run ▶</button></div>
        <div class="term" id="qout"><span class="ps">$</span> <span style="color:var(--dim)">ready</span></div>
      </div></div>
      <div class="pn"><div class="pn-h"><h3>📖 Quick Actions</h3></div><div class="pn-b">
        <div style="display:flex;flex-wrap:wrap;gap:8px" id="quick-btns"></div>
      </div></div>
    </div>

    <!-- ═══ PROCESSES ═══ -->
    <div class="pg" id="pg-processes">
      <div class="pn"><div class="pn-h"><h3>⚙️ Process Manager</h3><div class="pn-a">
        <select id="ps-sort" class="tbtn" style="font-size:.72rem" onchange="lP()">
          <option value="-%mem">Sort: Memory ↓</option>
          <option value="-%cpu">Sort: CPU ↓</option>
          <option value="-pid">Sort: PID ↓</option>
        </select>
        <button class="btn btn-g btn-s" onclick="lP()">↻</button>
      </div></div>
      <div class="pn-b np" style="max-height:620px;overflow:auto">
        <table class="t"><thead><tr><th>PID</th><th>User</th><th>CPU%</th><th>MEM%</th><th>RSS</th><th>Status</th><th>Time</th><th>Command</th><th></th></tr></thead><tbody id="pb"></tbody></table>
      </div></div>
    </div>

    <!-- ═══ MONITORING ═══ -->
    <div class="pg" id="pg-monitoring">
      <div class="cg" id="mon-cards"></div>
      <div class="dual">
        <div class="pn"><div class="pn-h"><h3>📊 CPU History</h3></div><div class="pn-b"><div class="chart-wrap"><canvas id="cpu-cv"></canvas></div></div></div>
        <div class="pn"><div class="pn-h"><h3>📊 Memory History</h3></div><div class="pn-b"><div class="chart-wrap"><canvas id="mem-cv"></canvas></div></div></div>
      </div>
      <div class="pn"><div class="pn-h"><h3>📋 System Specs</h3></div><div class="pn-b"><div id="specs" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px"></div></div></div>
    </div>

    <!-- ═══ NETWORK ═══ -->
    <div class="pg" id="pg-network">
      <div class="cg" id="net-cards"></div>
      <div class="dual">
        <div class="pn"><div class="pn-h"><h3>🌐 Interfaces</h3></div><div class="pn-b np"><table class="t"><thead><tr><th>Name</th><th>Address</th><th>Type</th><th>MAC</th><th>Scope</th></tr></thead><tbody id="nif"></tbody></table></div></div>
        <div class="pn"><div class="pn-h"><h3>🔌 Listening Ports</h3><div class="pn-a"><button class="btn btn-g btn-s" onclick="lN()">↻</button></div></div><div class="pn-b np"><table class="t"><thead><tr><th>Proto</th><th>State</th><th>Local</th><th>Process</th></tr></thead><tbody id="npt"></tbody></table></div></div>
      </div>
    </div>

    <!-- ═══ STORAGE ═══ -->
    <div class="pg" id="pg-storage">
      <div class="cg" id="sto-cards"></div>
      <div class="pn"><div class="pn-h"><h3>💾 Disk Details</h3></div><div class="pn-b"><div class="term" id="disk-out" style="color:#888"></div></div></div>
    </div>

    <!-- ═══ FILE MANAGER ═══ -->
    <div class="pg" id="pg-files">
      <div class="pn"><div class="pn-h"><h3>📁 File Manager</h3><div class="pn-a">
        <button class="btn btn-g btn-s" onclick="fNav(cP)">↻</button>
        <button class="btn btn-b btn-s" onclick="fMkdir()">📁 New Folder</button>
        <label class="btn btn-p btn-s" style="cursor:pointer">📤 Upload<input type="file" style="display:none" onchange="fUpload(this)"></label>
      </div></div>
      <div class="pn-b">
        <div class="fp"><span>📂</span><input id="fp-in" value="${WORKSPACE}" onkeydown="if(event.key==='Enter')fNav(this.value)"><button class="btn btn-g btn-s" onclick="fNav(document.getElementById('fp-in').value)">Go</button><button class="btn btn-g btn-s" onclick="fUp()">⬆</button></div>
        <div id="flist"></div>
      </div></div>
      <div class="pn" id="fpv-pn" style="display:none"><div class="pn-h"><h3 id="fpv-nm">📄 Preview</h3><div class="pn-a"><button class="btn btn-g btn-s" onclick="document.getElementById('fpv-pn').style.display='none'">✕</button><button class="btn btn-b btn-s" id="fpv-dl">⬇ Download</button></div></div><div class="pn-b"><div class="logv" id="fpv-ct"></div></div></div>
    </div>

    <!-- ═══ EDITOR ═══ -->
    <div class="pg" id="pg-editor">
      <div class="pn"><div class="pn-h"><h3>✏️ File Editor</h3><div class="pn-a"><button class="btn btn-a btn-s" onclick="eSave()">💾 Save</button></div></div>
      <div class="pn-b">
        <div class="fp"><span>📝</span><input id="ed-path" placeholder="Enter file path to edit…" onkeydown="if(event.key==='Enter')eLoad(this.value)"><button class="btn btn-g btn-s" onclick="eLoad(document.getElementById('ed-path').value)">Open</button></div>
        <textarea class="editor" id="ed-content" placeholder="Open a file to start editing…"></textarea>
      </div></div>
    </div>

    <!-- ═══ LOGS ═══ -->
    <div class="pg" id="pg-logs">
      <div class="pn"><div class="pn-h"><h3>📋 Log Viewer</h3><div class="pn-a">
        <select id="log-sel" class="tbtn" style="font-size:.72rem" onchange="lL(this.value)">
          <option value="/tmp/vps-logs/sshx.log">SSHX Log</option>
          <option value="/tmp/vps-logs/worker.log">Worker Log</option>
          <option value="/tmp/keep_alive.txt">Keep Alive</option>
          <option value="/var/log/syslog">Syslog</option>
        </select>
        <button class="btn btn-g btn-s" onclick="lL()">↻</button>
      </div></div>
      <div class="pn-b"><div class="logv" id="log-ct">Loading…</div></div></div>
    </div>

    <!-- ═══ PACKAGES ═══ -->
    <div class="pg" id="pg-packages">
      <div class="pn"><div class="pn-h"><h3>📦 Installed Packages</h3><div class="pn-a"><button class="btn btn-g btn-s" onclick="lPk()">↻</button></div></div>
      <div class="pn-b np" style="max-height:550px;overflow:auto"><table class="t"><thead><tr><th>Package</th><th>Version</th><th>Description</th></tr></thead><tbody id="pkb"></tbody></table></div></div>
    </div>

    <!-- ═══ CONSOLE ═══ -->
    <div class="pg" id="pg-console">
      <div class="pn"><div class="pn-h"><h3>💻 Web Console</h3><div class="pn-a"><button class="btn btn-g btn-s" onclick="document.getElementById('con-out').innerHTML=''">Clear</button></div></div>
      <div class="pn-b">
        <div class="term" id="con-out" style="min-height:380px;max-height:520px"><span style="color:var(--dim)">HVM VPS Console — Native Metal Edition\nType commands below. Output appears here.\n${'─'.repeat(50)}\n</span></div>
        <div class="qr"><span style="color:var(--acc);font-family:'JetBrains Mono',monospace;padding:11px 4px;font-weight:700">$</span><input id="con-in" placeholder="command…" onkeydown="if(event.key==='Enter')conRun()"><button class="btn btn-a" onclick="conRun()">Run</button></div>
      </div></div>
    </div>

    <!-- ═══ ENVIRONMENT ═══ -->
    <div class="pg" id="pg-env">
      <div class="pn"><div class="pn-h"><h3>🔑 Environment Variables</h3><div class="pn-a"><button class="btn btn-g btn-s" onclick="lEnv()">↻</button></div></div>
      <div class="pn-b np" style="max-height:550px;overflow:auto"><table class="t"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody id="env-b"></tbody></table></div></div>
    </div>

    <!-- ═══ SETTINGS ═══ -->
    <div class="pg" id="pg-settings">
      <div class="pn"><div class="pn-h"><h3>🔧 VPS Settings</h3></div><div class="pn-b">
        <div class="cg">
          <div class="sc glow-g">
            <div class="sc-l">SSHX Session</div>
            <p style="margin:10px 0;font-size:.82rem;color:var(--muted)">Restart the terminal session</p>
            <button class="btn btn-d" onclick="rS()">↻ Restart SSHX</button>
          </div>
          <div class="sc glow-b">
            <div class="sc-l">Keep-Alive</div>
            <p style="margin:10px 0;font-size:.82rem;color:var(--muted)">Force a keep-alive ping now</p>
            <button class="btn btn-b" onclick="pKA()">📡 Ping Now</button>
          </div>
          <div class="sc">
            <div class="sc-l">Auto Refresh</div>
            <p style="margin:8px 0;font-size:.82rem;color:var(--muted)">Dashboard refresh rate</p>
            <select id="ref-int" class="tbtn" style="width:100%;margin-top:6px" onchange="setRI(this.value)">
              <option value="3000">3 seconds</option><option value="5000" selected>5 seconds</option>
              <option value="10000">10 seconds</option><option value="0">Disabled</option>
            </select>
          </div>
          <div class="sc">
            <div class="sc-l">Raw API</div>
            <p style="margin:10px 0;font-size:.82rem;color:var(--muted)">View raw system JSON</p>
            <button class="btn btn-g" onclick="window.open('/api/status')">📋 View JSON</button>
          </div>
        </div>
      </div></div>
      <div class="pn"><div class="pn-h"><h3>🔗 API Endpoints</h3></div><div class="pn-b np">
        <table class="t"><thead><tr><th>Endpoint</th><th>Method</th><th>Description</th><th></th></tr></thead><tbody>
          <tr><td class="mono">/api/status</td><td><span class="tag g">GET</span></td><td>Full system status</td><td><button class="btn btn-g btn-s" onclick="window.open('/api/status')">→</button></td></tr>
          <tr><td class="mono">/api/processes</td><td><span class="tag g">GET</span></td><td>Process list</td><td><button class="btn btn-g btn-s" onclick="window.open('/api/processes')">→</button></td></tr>
          <tr><td class="mono">/api/network</td><td><span class="tag g">GET</span></td><td>Network info</td><td><button class="btn btn-g btn-s" onclick="window.open('/api/network')">→</button></td></tr>
          <tr><td class="mono">/api/files?path=/</td><td><span class="tag g">GET</span></td><td>List files</td><td><button class="btn btn-g btn-s" onclick="window.open('/api/files')">→</button></td></tr>
          <tr><td class="mono">/api/exec</td><td><span class="tag y">POST</span></td><td>Execute command</td><td><span class="tag p">JSON</span></td></tr>
          <tr><td class="mono">/api/file-save</td><td><span class="tag y">POST</span></td><td>Save file</td><td><span class="tag p">JSON</span></td></tr>
          <tr><td class="mono">/api/upload</td><td><span class="tag y">POST</span></td><td>Upload file</td><td><span class="tag p">multipart</span></td></tr>
          <tr><td class="mono">/api/kill/:pid</td><td><span class="tag r">POST</span></td><td>Kill process</td><td><span class="tag p">JSON</span></td></tr>
          <tr><td class="mono">/terminal</td><td><span class="tag g">GET</span></td><td>→ SSHX redirect</td><td><button class="btn btn-g btn-s" onclick="window.open('/terminal')">→</button></td></tr>
          <tr><td class="mono">/health</td><td><span class="tag g">GET</span></td><td>Health check</td><td><button class="btn btn-g btn-s" onclick="window.open('/health')">→</button></td></tr>
          <tr><td class="mono">/api/metrics-history</td><td><span class="tag g">GET</span></td><td>Metrics history</td><td><button class="btn btn-g btn-s" onclick="window.open('/api/metrics-history')">→</button></td></tr>
          <tr><td class="mono">/api/env</td><td><span class="tag g">GET</span></td><td>Env vars (masked)</td><td><button class="btn btn-g btn-s" onclick="window.open('/api/env')">→</button></td></tr>
        </tbody></table>
      </div></div>
    </div>

  </div>
</div>

<div class="toast-c" id="toasts"></div>

<!-- ═══════════════════════════════════════════════
     CLIENT JAVASCRIPT
     ═══════════════════════════════════════════════ -->
<script>
let sU=null,cP='${WORKSPACE}',cpuH=Array(60).fill(0),memH=Array(60).fill(0),rT=null,RI=5000;
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const $=id=>document.getElementById(id);

/* ── Nav ── */
document.querySelectorAll('.ni[data-p]').forEach(n=>{
  n.addEventListener('click',()=>{
    document.querySelectorAll('.ni').forEach(x=>x.classList.remove('a'));
    n.classList.add('a');
    document.querySelectorAll('.pg').forEach(p=>p.classList.remove('a'));
    const pg=$('pg-'+n.dataset.p);if(pg)pg.classList.add('a');
    $('pt').textContent=n.textContent.replace(/LIVE|\\d+/g,'').trim();
    lPg(n.dataset.p);
    $('sb').classList.remove('open');
  });
});

function lPg(p){
  switch(p){
    case 'overview':R();break;case 'terminal':gU();break;case 'processes':lP();break;
    case 'monitoring':R();break;case 'network':lN();break;case 'storage':lSt();break;
    case 'files':fNav(cP);break;case 'logs':lL();break;case 'packages':lPk();break;
    case 'env':lEnv();break;
  }
}

/* ── Toast ── */
function toast(m,t='ok'){const c=$('toasts'),e=document.createElement('div');e.className='toast '+t;e.innerHTML=(t==='ok'?'✅':'❌')+' '+m;c.appendChild(e);setTimeout(()=>e.remove(),4000)}

/* ── API ── */
async function api(u,o){try{const r=await fetch(u,o);return await r.json()}catch(e){console.error(e);return null}}

/* ── SSHX ── */
async function gU(){const d=await api('/api/sshx-url');if(d?.url){sU=d.url;['sshx-d','sshx-t'].forEach(i=>{const e=$(i);if(e)e.innerHTML='<a href="'+d.url+'" target="_blank">'+d.url+'</a>'});const b=$('sshx-b');if(b){b.textContent='LIVE';b.className='badge live'}}else{['sshx-d','sshx-t'].forEach(i=>{const e=$(i);if(e)e.innerHTML='<span style="color:var(--yellow)">⏳ Establishing session…</span>'})}}
function oT(){if(sU)window.open(sU,'_blank');else toast('SSHX not ready','err')}
function cU(){if(sU)navigator.clipboard.writeText(sU).then(()=>toast('URL copied!'))}
async function rS(){toast('Restarting SSHX…');await api('/api/sshx/restart',{method:'POST'});setTimeout(gU,4000)}

/* ── Refresh All ── */
async function R(){
  const d=await api('/api/status');if(!d)return;
  if(d.sshxUrl){sU=d.sshxUrl;['sshx-d','sshx-t'].forEach(i=>{const e=$(i);if(e)e.innerHTML='<a href="'+d.sshxUrl+'" target="_blank">'+d.sshxUrl+'</a>'})}
  const p=$('pill'),st=$('stxt');
  p.className='pill '+(d.status==='online'?'on':'off');
  st.textContent=d.status==='online'?'Online':'Offline';

  const pc=$('proc-cnt');if(pc)pc.textContent=d.processCount;

  /* stat cards */
  $('stats').innerHTML=\`
    <div class="sc"><div class="sc-h"><div><div class="sc-l">CPU Usage</div><div class="sc-v">\${d.cpu}%</div><div class="sc-s">\${d.cpus} cores · \${d.arch}</div></div><div class="sc-i" style="background:rgba(0,255,136,.08);color:var(--acc)">⚡</div></div><div class="sc-bar"><div class="sc-bf" style="width:\${d.cpu}%;background:var(--acc)"></div></div></div>
    <div class="sc"><div class="sc-h"><div><div class="sc-l">Memory</div><div class="sc-v">\${d.mem.usedGB} GB</div><div class="sc-s">\${d.mem.free} MB free / \${d.mem.total} MB</div></div><div class="sc-i" style="background:rgba(59,130,246,.08);color:var(--acc2)">🧠</div></div><div class="sc-bar"><div class="sc-bf" style="width:\${d.mem.pct}%;background:var(--acc2)"></div></div></div>
    <div class="sc"><div class="sc-h"><div><div class="sc-l">Disk</div><div class="sc-v">\${d.disk.used||'?'}</div><div class="sc-s">\${d.disk.free} free / \${d.disk.total}</div></div><div class="sc-i" style="background:rgba(245,158,11,.08);color:var(--acc4)">💾</div></div><div class="sc-bar"><div class="sc-bf" style="width:\${d.disk.pct}%;background:var(--acc4)"></div></div></div>
    <div class="sc"><div class="sc-h"><div><div class="sc-l">Uptime</div><div class="sc-v" style="font-size:1.3rem">\${d.uptime}</div><div class="sc-s">System: \${d.systemUptime}</div></div><div class="sc-i" style="background:rgba(168,85,247,.08);color:var(--acc5)">⏱️</div></div></div>
  \`;

  /* resource bars */
  $('res-bars').innerHTML=\`
    <div class="bar-r"><span class="bar-l">CPU</span><div class="bar-t"><div class="bar-f" style="width:\${d.cpu}%;background:var(--acc)"></div></div><span class="bar-p">\${d.cpu}%</span></div>
    <div class="bar-r"><span class="bar-l">Memory</span><div class="bar-t"><div class="bar-f" style="width:\${d.mem.pct}%;background:var(--acc2)"></div></div><span class="bar-p">\${d.mem.pct}%</span></div>
    <div class="bar-r"><span class="bar-l">Disk</span><div class="bar-t"><div class="bar-f" style="width:\${d.disk.pct}%;background:var(--acc4)"></div></div><span class="bar-p">\${d.disk.pct}%</span></div>
    <div class="bar-r"><span class="bar-l">Swap</span><div class="bar-t"><div class="bar-f" style="width:\${d.swap.pct}%;background:var(--acc5)"></div></div><span class="bar-p">\${d.swap.pct}%</span></div>
  \`;

  /* load avg */
  const mL=Math.max(d.cpus,...d.loadavg)||1;
  $('load-bars').innerHTML=['1 min','5 min','15 min'].map((l,i)=>{
    const pc=Math.min(100,Math.round((d.loadavg[i]/mL)*100));
    return \`<div class="bar-r"><span class="bar-l">\${l}</span><div class="bar-t"><div class="bar-f" style="width:\${pc}%;background:var(--acc6)"></div></div><span class="bar-p">\${d.loadavg[i].toFixed(2)}</span></div>\`;
  }).join('');

  /* services */
  $('svc-body').innerHTML=\`
    <tr><td><b>🖥️ SSHX Terminal</b></td><td><span class="tag \${d.sshx?'g':'r'}">\${d.sshx?'● Running':'○ Down'}</span></td><td><span class="tag c">shell</span></td><td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">\${d.sshxUrl||'N/A'}</td><td><button class="btn btn-d btn-s" onclick="rS()">↻</button></td></tr>
    <tr><td><b>🐍 Python Worker</b></td><td><span class="tag \${d.worker?'g':'r'}">\${d.worker?'● Running':'○ Down'}</span></td><td><span class="tag b">daemon</span></td><td>keep-alive + sshx monitor</td><td><span class="tag b">auto</span></td></tr>
    <tr><td><b>🟢 Node.js Server</b></td><td><span class="tag g">● Running</span></td><td><span class="tag g">web</span></td><td>Express · port \${location.port||'443'}</td><td><span class="tag g">primary</span></td></tr>
  \`;

  /* sys identity */
  const si=[['Hostname',d.hostname],['VPS ID','${VPS_ID}'],['Distro',d.distro],['Kernel',d.kernel],['Arch',d.arch],['Platform',d.platform],['CPUs',d.cpus+' cores'],['CPU Model',d.cpuModel],['Node.js',d.node],['Python',d.python],['Public IP',d.publicIP],['Processes',d.processCount]];
  $('sys-id').innerHTML=si.map(([k,v])=>\`<div style="background:var(--card2);padding:12px 16px;border-radius:10px;border:1px solid var(--bdr)"><div style="font-size:.62rem;color:var(--dim);text-transform:uppercase;letter-spacing:1px;font-weight:600">\${k}</div><div style="font-size:.85rem;color:var(--white);margin-top:5px;font-weight:600;word-break:break-all">\${v||'N/A'}</div></div>\`).join('');

  /* monitoring page */
  $('mon-cards').innerHTML=\`
    <div class="sc"><div class="sc-l">Kernel</div><div class="sc-v" style="font-size:1rem">\${d.kernel}</div></div>
    <div class="sc"><div class="sc-l">CPU Model</div><div class="sc-v" style="font-size:.85rem">\${d.cpuModel}</div></div>
    <div class="sc"><div class="sc-l">Public IP</div><div class="sc-v" style="font-size:1rem">\${d.publicIP}</div></div>
    <div class="sc"><div class="sc-l">Processes</div><div class="sc-v">\${d.processCount}</div></div>
  \`;

  $('specs').innerHTML=[['Hostname',d.hostname],['Architecture',d.arch],['CPUs',d.cpus],['CPU Speed',d.cpuSpeed+' MHz'],['Total RAM',d.mem.total+' MB'],['Free RAM',d.mem.free+' MB'],['Swap Total',d.swap.total+' MB'],['Swap Used',d.swap.used+' MB'],['Disk Total',d.disk.total],['Disk Used',d.disk.used],['Kernel',d.kernel],['Distro',d.distro],['Node.js',d.node],['Python',d.python],['Uptime',d.uptime],['System Uptime',d.systemUptime]].map(([k,v])=>\`<div style="background:var(--card2);padding:10px 14px;border-radius:8px;border:1px solid var(--bdr)"><div style="font-size:.6rem;color:var(--dim);text-transform:uppercase;letter-spacing:1px;font-weight:600">\${k}</div><div style="font-size:.82rem;color:var(--white);margin-top:4px;font-weight:600">\${v||'N/A'}</div></div>\`).join('');

  /* charts */
  cpuH.push(d.cpu);cpuH.shift();memH.push(d.mem.pct);memH.shift();
  drawC('cpu-cv',cpuH,'#00ff88');drawC('mem-cv',memH,'#3b82f6');
}

function drawC(id,data,col){
  const cv=$(id);if(!cv)return;
  const c=cv.getContext('2d'),W=cv.width=cv.parentElement.offsetWidth,H=cv.height=140;
  c.clearRect(0,0,W,H);
  c.strokeStyle='rgba(255,255,255,.03)';c.lineWidth=1;
  for(let y=0;y<=100;y+=25){const py=H-(y/100)*H;c.beginPath();c.moveTo(0,py);c.lineTo(W,py);c.stroke()}
  c.beginPath();c.strokeStyle=col;c.lineWidth=2;
  const s=W/(data.length-1);
  data.forEach((v,i)=>{const x=i*s,y=H-(v/100)*H;i===0?c.moveTo(x,y):c.lineTo(x,y)});
  c.stroke();c.lineTo(W,H);c.lineTo(0,H);c.closePath();
  const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,col+'30');g.addColorStop(1,col+'00');
  c.fillStyle=g;c.fill();
  /* current value label */
  const last=data[data.length-1];
  c.fillStyle=col;c.font='bold 12px Inter';c.textAlign='right';
  c.fillText(last+'%',W-6,16);
}

/* ── Processes ── */
async function lP(){
  const sort=$('ps-sort')?.value||'-%mem';
  const procs=await api('/api/processes?sort='+sort);if(!procs)return;
  $('pb').innerHTML=procs.map(p=>\`
    <tr>
      <td class="mono">\${p.pid}</td><td>\${p.user}</td>
      <td><span class="tag \${parseFloat(p.cpu)>50?'r':parseFloat(p.cpu)>15?'y':'g'}">\${p.cpu}%</span></td>
      <td><span class="tag \${parseFloat(p.mem)>50?'r':parseFloat(p.mem)>15?'y':'b'}">\${p.mem}%</span></td>
      <td class="mono">\${p.rss} MB</td>
      <td><span class="tag p">\${p.stat||'?'}</span></td>
      <td class="mono">\${p.time||''}</td>
      <td class="mono" style="max-width:180px;overflow:hidden;text-overflow:ellipsis" title="\${esc(p.cmd)}">\${esc(p.cmd)}</td>
      <td><button class="btn btn-d btn-s" onclick="kP('\${p.pid}')">Kill</button></td>
    </tr>
  \`).join('');
}
async function kP(pid){if(!confirm('Kill PID '+pid+'?'))return;const r=await api('/api/kill/'+pid,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});r?.ok?toast('Killed '+pid):toast('Failed','err');lP()}

/* ── Network ── */
async function lN(){
  const d=await api('/api/network');if(!d)return;
  $('net-cards').innerHTML=\`
    <div class="sc"><div class="sc-l">Hostname</div><div class="sc-v" style="font-size:1rem">\${d.hostname}</div></div>
    <div class="sc"><div class="sc-l">Public IP</div><div class="sc-v" style="font-size:1rem">\${d.publicIP}</div></div>
    <div class="sc"><div class="sc-l">Interfaces</div><div class="sc-v">\${d.interfaces.length}</div></div>
    <div class="sc"><div class="sc-l">Open Ports</div><div class="sc-v">\${d.ports.length}</div></div>
  \`;
  $('nif').innerHTML=d.interfaces.map(i=>\`<tr><td>\${i.iface}</td><td class="mono">\${i.addr}</td><td><span class="tag \${i.family==='IPv4'?'g':'b'}">\${i.family}</span></td><td class="mono">\${i.mac}</td><td><span class="tag \${i.internal?'y':'c'}">\${i.internal?'local':'external'}</span></td></tr>\`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--dim)">No interfaces</td></tr>';
  $('npt').innerHTML=d.ports.map(c=>\`<tr><td><span class="tag g">\${c.proto}</span></td><td>\${c.state}</td><td class="mono">\${c.local}</td><td class="mono" style="max-width:150px;overflow:hidden;text-overflow:ellipsis">\${c.process||'*'}</td></tr>\`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--dim)">None</td></tr>';
}

/* ── Storage ── */
async function lSt(){
  const d=await api('/api/status');if(!d)return;
  $('sto-cards').innerHTML=\`
    <div class="sc"><div class="sc-l">Total</div><div class="sc-v">\${d.disk.total}</div><div class="sc-s">Device: \${d.disk.device||'/'}</div></div>
    <div class="sc"><div class="sc-l">Used</div><div class="sc-v">\${d.disk.used}</div><div class="sc-bar"><div class="sc-bf" style="width:\${d.disk.pct}%;background:var(--acc4)"></div></div></div>
    <div class="sc"><div class="sc-l">Free</div><div class="sc-v">\${d.disk.free}</div></div>
    <div class="sc"><div class="sc-l">Usage</div><div class="sc-v">\${d.disk.pct}%</div></div>
  \`;
  const o=await api('/api/exec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd:'df -hT && echo "\\n── Inodes ──" && df -iT && echo "\\n── Mount Points ──" && mount | head -15'})});
  if(o)$('disk-out').textContent=o.output;
}

/* ── File Manager ── */
async function fNav(dir){
  cP=dir;$('fp-in').value=dir;
  const d=await api('/api/files?path='+encodeURIComponent(dir));if(!d)return;
  if(!d.items.length){$('flist').innerHTML='<div style="padding:24px;text-align:center;color:var(--dim)">📂 Empty directory</div>';return}
  $('flist').innerHTML=d.items.map(f=>{
    const sz=f.isDir?'—':fmtSz(f.size);
    const ic=f.isDir?'📁':f.isSymlink?'🔗':fIco(f.name);
    const mod=new Date(f.modified).toLocaleString();
    return \`<div class="fi" onclick="\${f.isDir?\`fNav('\${dir}/\${f.name}')\`:\`fPv('\${dir}/\${f.name}')\`}">
      <span class="fic">\${ic}</span><span class="fin \${f.isDir?'dir':''}">\${esc(f.name)}</span>
      <span class="fm">\${f.owner}:\${f.group}</span><span class="fm">\${f.perms}</span>
      <span class="fm">\${sz}</span><span class="fm">\${mod}</span>
      \${!f.isDir?'<button class="btn btn-g btn-s" style="padding:2px 8px;font-size:.65rem" onclick="event.stopPropagation();fDel(\\''+dir+'/'+f.name+'\\')">🗑</button>':''}
    </div>\`;
  }).join('');
}
function fUp(){const p=cP.split('/').filter(Boolean);p.pop();fNav('/'+p.join('/')||'/')}
async function fPv(p){
  const d=await api('/api/file-content?path='+encodeURIComponent(p));
  $('fpv-pn').style.display='block';
  $('fpv-nm').textContent='📄 '+p.split('/').pop();
  $('fpv-ct').textContent=d?d.content:'Cannot read';
  $('fpv-dl').onclick=()=>window.open('/api/download?path='+encodeURIComponent(p));
}
async function fDel(p){if(!confirm('Delete '+p.split('/').pop()+'?'))return;await api('/api/file-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:p})});toast('Deleted');fNav(cP)}
async function fMkdir(){const n=prompt('Folder name:');if(!n)return;await api('/api/file-mkdir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:cP+'/'+n})});toast('Created '+n);fNav(cP)}
async function fUpload(input){
  if(!input.files[0])return;const fd=new FormData();fd.append('file',input.files[0]);fd.append('dir',cP);
  await api('/api/upload',{method:'POST',body:fd});toast('Uploaded '+input.files[0].name);fNav(cP);input.value='';
}
function fmtSz(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';if(b<1073741824)return(b/1048576).toFixed(1)+' MB';return(b/1073741824).toFixed(1)+' GB'}
function fIco(n){const e=n.split('.').pop().toLowerCase();const m={js:'📜',ts:'📜',py:'🐍',sh:'⚙️',json:'📋',yml:'📋',yaml:'📋',md:'📝',txt:'📝',log:'📋',html:'🌐',css:'🎨',jpg:'🖼️',png:'🖼️',gif:'🖼️',svg:'🖼️',zip:'📦',tar:'📦',gz:'📦',lock:'🔒',env:'🔑',toml:'⚙️',cfg:'⚙️',conf:'⚙️',ini:'⚙️',sql:'🗃️',db:'🗃️',csv:'📊',xml:'📰',rs:'🦀',go:'🐹',rb:'💎',java:'☕',c:'⚡',h:'⚡',cpp:'⚡',Makefile:'🔨'};return m[e]||'📄'}

/* ── Editor ── */
async function eLoad(p){
  if(!p)return;$('ed-path').value=p;
  const d=await api('/api/file-content?path='+encodeURIComponent(p));
  $('ed-content').value=d?d.content:'Cannot read file';
  toast('Opened '+p.split('/').pop());
}
async function eSave(){
  const p=$('ed-path').value,c=$('ed-content').value;
  if(!p){toast('No file open','err');return}
  await api('/api/file-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:p,content:c})});
  toast('Saved '+p.split('/').pop());
}

/* ── Logs ── */
async function lL(f){
  if(!f)f=$('log-sel')?.value||'/tmp/vps-logs/sshx.log';
  const d=await api('/api/logs?file='+encodeURIComponent(f)+'&lines=120');
  $('log-ct').textContent=d?d.content:'No logs';
}

/* ── Packages ── */
async function lPk(){
  const pkgs=await api('/api/packages');if(!pkgs)return;
  $('pkb').innerHTML=pkgs.map(p=>\`<tr><td class="mono" style="color:var(--acc2)">\${esc(p.name)}</td><td class="mono">\${esc(p.version)}</td><td>\${esc(p.desc||'')}</td></tr>\`).join('');
}

/* ── Console ── */
async function conRun(){
  const inp=$('con-in'),out=$('con-out'),cmd=inp.value.trim();if(!cmd)return;inp.value='';
  out.innerHTML+='\\n<span class="ps">$ </span><span class="cmd">'+esc(cmd)+'</span>\\n';
  const d=await api('/api/exec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd})});
  const txt=d?d.output:'[error]';
  const cls=d?.exitCode===0?'':'err';
  out.innerHTML+='<span class="'+cls+'">'+esc(txt)+'</span>\\n';
  out.scrollTop=out.scrollHeight;
}

/* ── Quick Cmd ── */
async function qRun(){const inp=$('qcmd'),cmd=inp.value.trim();if(!cmd)return;inp.value='';await runQ(cmd)}
async function runQ(cmd){
  const out=$('qout');
  out.innerHTML='<span class="ps">$ </span><span class="cmd">'+esc(cmd)+'</span>\\n<span style="color:var(--dim)">Running…</span>';
  const d=await api('/api/exec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd})});
  out.innerHTML='<span class="ps">$ </span><span class="cmd">'+esc(cmd)+'</span>\\n'+(d?esc(d.output):'[error]');
}

/* Quick buttons */
$('quick-btns').innerHTML=[
  ['uname -a','uname -a'],['free -h','free -h'],['df -h','df -h'],
  ['top -bn1 | head -20','top snapshot'],['whoami','whoami'],
  ['cat /etc/os-release','OS info'],['ip addr','IP addresses'],
  ['ps aux --sort=-%mem | head -15','top processes'],
  ['ls -la ${WORKSPACE}','workspace'],['env | sort','env vars'],
  ['python3 --version && node --version','versions'],
  ['curl -s ifconfig.me','public IP'],['uptime','uptime'],
  ['cat /proc/cpuinfo | head -20','CPU info'],['lsb_release -a 2>/dev/null','distro'],
  ['netstat -tulnp 2>/dev/null || ss -tulnp','ports'],
  ['cat /proc/meminfo | head -10','mem info'],['w','who'],
].map(([c,l])=>\`<button class="btn btn-g btn-s" onclick="runQ('\${c}')">\${l}</button>\`).join('');

/* ── Environment ── */
async function lEnv(){
  const d=await api('/api/env');if(!d)return;
  $('env-b').innerHTML=Object.entries(d).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>\`<tr><td class="mono" style="color:var(--acc2);font-weight:600">\${esc(k)}</td><td class="mono" style="max-width:400px;overflow:hidden;text-overflow:ellipsis;word-break:break-all" title="\${esc(v)}">\${esc(v)}</td></tr>\`).join('');
}

/* ── Settings ── */
async function pKA(){await api('/keep-alive');toast('Keep-alive sent!')}
function setRI(ms){RI=parseInt(ms);if(rT)clearInterval(rT);if(RI>0)rT=setInterval(R,RI);toast('Refresh: '+(RI>0?(RI/1000)+'s':'off'))}

/* ── Init ── */
R();gU();
rT=setInterval(R,RI);
setInterval(gU,8000);
</script>
</body></html>`;
}

// ═══════════════════════════════════════════════
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\x1b[32m[✓]\x1b[0m HVM VPS Control Panel`);
  console.log(`\x1b[32m[✓]\x1b[0m Dashboard  → http://0.0.0.0:${PORT}/dashboard`);
  console.log(`\x1b[32m[✓]\x1b[0m Terminal   → http://0.0.0.0:${PORT}/terminal`);
  console.log(`\x1b[32m[✓]\x1b[0m API        → http://0.0.0.0:${PORT}/api/status`);
  console.log(`\x1b[32m[✓]\x1b[0m Health     → http://0.0.0.0:${PORT}/health`);
  console.log(`\x1b[32m[✓]\x1b[0m Mode       → Native Metal (No Docker)`);
});
