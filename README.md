# Minecraft as a Service

A self-hosted website to create and manage minecraft servers, with a mostly scalable architecture.

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