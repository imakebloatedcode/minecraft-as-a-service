FROM oven/bun:canary-alpine AS build

ARG APP_NAME

COPY . ./

RUN cd apps/${APP_NAME} && \
    bun install && \
    filePath="$(bun ./build-server.ts | grep 'Output file path:' | cut -d':' -f2- | sed 's/^ //')" && \
    mv "${filePath}" "/bin/entrypoint"

FROM alpine:latest

RUN apk add --no-cache libstdc++ libgcc

COPY --from=build /bin/entrypoint /bin/entrypoint

RUN mkdir /workdir
WORKDIR "/workdir"

CMD ["/bin/entrypoint"]