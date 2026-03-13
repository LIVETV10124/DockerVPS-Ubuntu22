#!/bin/bash
# Extra tools (best-effort, non-fatal)

which htop    >/dev/null 2>&1 || pip install --user glances 2>/dev/null || true
which neofetch>/dev/null 2>&1 || true

# Create workspace structure
mkdir -p workspace/{projects,scripts,downloads,notes}

cat > workspace/README.md << 'HEREDOC'
# 🖥️ HVM VPS Workspace

Welcome to your VPS workspace!

## Directories
- `projects/`  — Your project files
- `scripts/`   — Custom scripts
- `downloads/` — Downloaded files
- `notes/`     — Quick notes

## Quick Start
1. Open Terminal from the dashboard
2. Navigate to `/workspace`
3. Start building!

## Pre-installed
- Node.js + npm
- Python 3 + pip
- Git, curl, wget
- And more…
HEREDOC

cat > workspace/scripts/hello.py << 'HEREDOC'
#!/usr/bin/env python3
"""Sample Python script"""
import platform, os, datetime

print("=" * 50)
print("  🖥️  HVM VPS — System Info")
print("=" * 50)
print(f"  OS       : {platform.system()} {platform.release()}")
print(f"  Arch     : {platform.machine()}")
print(f"  Python   : {platform.python_version()}")
print(f"  User     : {os.environ.get('USER', 'root')}")
print(f"  Time     : {datetime.datetime.now()}")
print(f"  Hostname : {platform.node()}")
print("=" * 50)
HEREDOC

cat > workspace/scripts/hello.js << 'HEREDOC'
#!/usr/bin/env node
/** Sample Node.js script */
const os = require('os');
console.log('═'.repeat(50));
console.log('  🖥️  HVM VPS — Node.js Info');
console.log('═'.repeat(50));
console.log(`  Node     : ${process.version}`);
console.log(`  Arch     : ${os.arch()}`);
console.log(`  CPUs     : ${os.cpus().length}`);
console.log(`  Memory   : ${(os.totalmem()/1048576).toFixed(0)} MB`);
console.log(`  Hostname : ${os.hostname()}`);
console.log(`  Uptime   : ${(os.uptime()/3600).toFixed(1)} hours`);
console.log('═'.repeat(50));
HEREDOC

echo "✓ Workspace initialized"
