# Minecraft as a Service

A self-hosted website to create and manage minecraft servers, with a mostly scalable architecture.

## Why
To self host minecraft servers!

## What it has
- Automatic server shutdown and startup
- A mostly unmodified minecraft server that preserves vanilla behavior
- An efficient system for storing the server jars that avoids duplicating dependencies or copying them per launch (read only mount to the store of dependencies for every container)

## What it does not have yet
- Cpu bandwidth caps
- Optimized jvm flags
- Running mod loaders+mods or bukkit based servers + plugins
- Admin interface
- Multi-node instances

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