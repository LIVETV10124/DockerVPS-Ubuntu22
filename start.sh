#!/bin/bash
set -e

# Start SSH
service ssh start

# Start filebrowser on port 8080 (default landing page)
filebrowser -r / -p 8080 &

# Start wetty (Web SSH) on port 10000
wetty --port 10000 &

# Start nginx (reverse-proxy everything to port 80)
service nginx start

# Keep container alive
tail -f /dev/null
