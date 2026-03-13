FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y \
curl wget git sudo bash \
openssh-server nginx \
&& apt clean

# install ttyd
RUN wget https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64 \
-O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# install code-server
RUN curl -fsSL https://code-server.dev/install.sh | sh

# install filebrowser
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash

# setup ssh
RUN mkdir /var/run/sshd
RUN echo "root:root" | chpasswd

COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh

RUN chmod +x /start.sh

EXPOSE 10000

CMD ["/start.sh"]
