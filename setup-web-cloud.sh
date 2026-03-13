#!/bin/bash

echo "Updating system..."
apt update -y

echo "Installing Docker..."
apt install -y docker.io curl

systemctl enable docker
systemctl start docker

echo "Creating workspace..."
mkdir -p ~/web-cloud
cd ~/web-cloud

echo "Creating Dockerfile..."

cat > Dockerfile << 'EOF'
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y \
    xfce4 xfce4-goodies \
    tightvncserver \
    novnc websockify \
    supervisor \
    curl wget sudo bash git \
    && apt clean

# install ttyd web terminal
RUN wget https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64 -O /usr/local/bin/ttyd \
 && chmod +x /usr/local/bin/ttyd

# root password
RUN echo "root:root" | chpasswd

# VNC setup
RUN mkdir ~/.vnc
RUN echo "root" | vncpasswd -f > ~/.vnc/passwd
RUN chmod 600 ~/.vnc/passwd

# supervisor config
RUN mkdir -p /etc/supervisor/conf.d

RUN echo "[supervisord]" > /etc/supervisor/conf.d/supervisord.conf
RUN echo "nodaemon=true" >> /etc/supervisor/conf.d/supervisord.conf

RUN echo "[program:vnc]" >> /etc/supervisor/conf.d/supervisord.conf
RUN echo "command=/usr/bin/vncserver :1 -geometry 1280x720 -depth 24" >> /etc/supervisor/conf.d/supervisord.conf

RUN echo "[program:novnc]" >> /etc/supervisor/conf.d/supervisord.conf
RUN echo "command=/usr/share/novnc/utils/novnc_proxy --vnc localhost:5901 --listen 6080" >> /etc/supervisor/conf.d/supervisord.conf

RUN echo "[program:webterminal]" >> /etc/supervisor/conf.d/supervisord.conf
RUN echo "command=/usr/local/bin/ttyd -p 7681 bash" >> /etc/supervisor/conf.d/supervisord.conf

EXPOSE 6080
EXPOSE 7681

CMD ["/usr/bin/supervisord","-c","/etc/supervisor/conf.d/supervisord.conf"]
EOF

echo "Building container..."
docker build -t web-cloud .

echo "Running container..."
docker run -d \
-p 6080:6080 \
-p 7681:7681 \
--name web-cloud \
web-cloud

echo ""
echo "======================================"
echo "Your Cloud Server is Ready 🚀"
echo ""
echo "Desktop (noVNC):"
echo "http://localhost:6080"
echo ""
echo "Web Terminal:"
echo "http://localhost:7681"
echo ""
echo "Login:"
echo "user: root"
echo "pass: root"
echo "======================================"
