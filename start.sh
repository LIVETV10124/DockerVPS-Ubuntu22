#!/bin/bash
set -e

# ----------------------------
# Start SSH
# ----------------------------
service ssh start

# ----------------------------
# Start Nginx
# ----------------------------
service nginx start

# ----------------------------
# Start Filebrowser (Web File Manager)
# ----------------------------
filebrowser -r / -p 8080 &

# ----------------------------
# Start ttyd (Web SSH terminal)
# ----------------------------
ttyd -p 10000 bash
