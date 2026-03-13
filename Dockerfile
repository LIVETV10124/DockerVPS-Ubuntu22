FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1

RUN apt update && apt install -y \
    xfce4 xfce4-goodies \
    tightvncserver \
    novnc websockify \
    supervisor \
    curl wget sudo git \
    bash \
    && apt clean

# install ttyd web terminal
RUN wget https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64 \
    -O /usr/local/bin/ttyd \
 && chmod +x /usr/local/bin/ttyd

# root password
RUN echo "root:root" | chpasswd

# VNC setup
RUN mkdir -p /root/.vnc \
 && echo "root" | vncpasswd -f > /root/.vnc/passwd \
 && chmod 600 /root/.vnc/passwd

# supervisor config
RUN mkdir -p /etc/supervisor/conf.d

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080

CMD ["/start.sh"]
