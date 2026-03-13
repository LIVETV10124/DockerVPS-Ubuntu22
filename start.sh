#!/bin/bash

# start ssh
/usr/sbin/sshd

# start web terminal
ttyd -p 7681 bash &

# start vscode
code-server --bind-addr 0.0.0.0:8080 --auth none &

# start file manager
filebrowser -r / -p 8081 &

# start nginx reverse proxy
nginx

tail -f /dev/null
