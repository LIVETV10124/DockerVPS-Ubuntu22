FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Base deps + SSH + Node.js for wetty
RUN apt update && apt install -y --no-install-recommends \
    curl wget git sudo bash openssh-server nginx ca-certificates nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# Setup SSH
RUN mkdir -p /var/run/sshd \
    && echo "root:root" | chpasswd

# ----------------------------
# Install wetty (lightweight web SSH terminal)
# ----------------------------
RUN npm install -g wetty

# ----------------------------
# Install filebrowser (Web File Manager)
# ----------------------------
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash

# Nginx config + startup script
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose single port
EXPOSE 80

CMD ["/start.sh"]
