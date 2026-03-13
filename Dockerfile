FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# ----------------------------
# Base deps + SSH + Node.js
# ----------------------------
RUN apt update && apt install -y --no-install-recommends \
    curl wget git sudo bash openssh-server nginx ca-certificates nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# ----------------------------
# Setup SSH
# ----------------------------
RUN mkdir -p /var/run/sshd && echo "root:root" | chpasswd

# ----------------------------
# Install Wetty (Web SSH)
# ----------------------------
RUN npm install -g wetty

# ----------------------------
# Install Filebrowser (Web File Manager)
# ----------------------------
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash

# ----------------------------
# Install SSHX (Web SSH alternative)
# ----------------------------
RUN curl -sSf https://sshx.io/get | sh -s run

# ----------------------------
# Install Express for backend
# ----------------------------
RUN npm install express

# ----------------------------
# Copy dashboard & scripts
# ----------------------------
COPY index.html /usr/share/nginx/html/index.html
COPY start.sh /start.sh
COPY backend.js /backend.js
COPY nginx.conf /etc/nginx/nginx.conf
RUN chmod +x /start.sh

# ----------------------------
# Expose port
# ----------------------------
EXPOSE 80

CMD ["/start.sh"]
