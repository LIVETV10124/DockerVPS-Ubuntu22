FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# ----------------------------
# Base dependencies + SSH + curl/wget/git
# ----------------------------
RUN apt update && apt install -y --no-install-recommends \
    curl wget git sudo bash openssh-server nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ----------------------------
# Setup SSH
# ----------------------------
RUN mkdir -p /var/run/sshd \
    && echo "root:root" | chpasswd

# ----------------------------
# Install ttyd (Web SSH terminal), code-server, and filebrowser
# Combined into one layer for speed
# ----------------------------
RUN set -eux; \
    # ttyd
    wget -q https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64 -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd; \
    # code-server
    curl -fsSL https://code-server.dev/install.sh | sh; \
    # filebrowser
    curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash

# ----------------------------
# Nginx config + startup
# ----------------------------
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh

# ----------------------------
# Ports
# ----------------------------
EXPOSE 10000

# ----------------------------
# Start all services
# ----------------------------
CMD ["/start.sh"]
