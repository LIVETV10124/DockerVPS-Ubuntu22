#!/bin/bash

PORT=${PORT:-8080}

echo "Starting VNC server..."
vncserver :1 -geometry 1280x720 -depth 24

echo "Starting noVNC..."
websockify --web=/usr/share/novnc $PORT localhost:5901 &

echo "Starting Web Terminal..."
ttyd -p 7681 bash &

echo "Container ready"
echo "Desktop: /vnc.html"
echo "Terminal: :7681"

wait
