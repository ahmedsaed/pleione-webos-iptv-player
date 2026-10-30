# The demo Xtream server with its media encoded at build time, so the
# container starts at once and serves a read-only catalog.
# Build from the repository root:
#   docker build -f scripts/xtream-demo/Dockerfile -t pleione-xtream-demo .
FROM node:22-alpine

# The clips draw their labels with drawtext, which needs a Sans font.
RUN apk add --no-cache ffmpeg font-dejavu fontconfig

WORKDIR /app
COPY scripts/cli-args.mjs scripts/xtream-demo-server.mjs scripts/
COPY scripts/xtream-demo/ scripts/xtream-demo/

ARG XTREAM_DEMO_SIZE=small
ENV XTREAM_DEMO_SIZE=${XTREAM_DEMO_SIZE} \
    XTREAM_DEMO_CACHE=/app/cache \
    XTREAM_DEMO_HOST=0.0.0.0 \
    XTREAM_DEMO_PORT=8090 \
    XTREAM_DEMO_USERNAME=demo \
    XTREAM_DEMO_PASSWORD=demo

RUN mkdir -p /app/cache && chown node /app/cache
USER node
RUN node scripts/xtream-demo-server.mjs --prepare

EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${XTREAM_DEMO_PORT}/player_api.php?username=${XTREAM_DEMO_USERNAME}&password=${XTREAM_DEMO_PASSWORD}" | grep -q '"auth":1'
CMD ["node", "scripts/xtream-demo-server.mjs"]
