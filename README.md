# Minecraft as a Service

A self-hosted website to create and manage minecraft servers, with a mostly scalable architecture.
This was created in order to allow me to self-host minecraft servers, but I decided to put it on github because why not. It currently does not have any measures to restrict hosting minecraft servers to specific users, but those could be implemented quickly.
It is intended to host large numbers of minecraft servers, and therefore shuts down unused minecraft servers until players join to save resources.
Unlike most minecraft hosting programs, it uses the vanilla minecraft server instead of paper which breaks redstone and other game physics, which is part of why I made this.

## Setup

Clone this repository, then run
```sh
sh ./build-java.sh
```
to build the java components and then run 
```sh
RUSTFS_ACCESS_KEY=user RUSTFS_SECRET_KEY="$(head -c 20 /dev/urandom | base64)" WEB_HOSTNAME=127.0.0.1 WEB_PROTOCOL=http RUSTFS_PROTOCOL=http RUSTFS_HOSTNAME=127.0.0.1:9000 docker compose up --build -d
```
to build and start everything else