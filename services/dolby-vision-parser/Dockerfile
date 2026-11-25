FROM rust:1.95-bookworm AS dovi-builder

ARG DOVI_TOOL_COMMIT=41dae646193c12de152333ff5dbc33579cb9ef4a
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && git clone https://github.com/quietvoid/dovi_tool.git /src/dovi_tool \
    && git -C /src/dovi_tool checkout --detach "${DOVI_TOOL_COMMIT}" \
    && cd /src/dovi_tool \
    && cargo build --locked --release --no-default-features --features internal-font --bin dovi_tool

FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dovi-builder /src/dovi_tool/target/release/dovi_tool /usr/local/bin/dovi_tool

WORKDIR /app
COPY scripts/dolby-vision/analyze-rpu.mjs /app/scripts/dolby-vision/analyze-rpu.mjs
COPY scripts/dolby-vision/extract-av1-rpu.mjs /app/scripts/dolby-vision/extract-av1-rpu.mjs
COPY services/dolby-vision-parser/server.mjs /app/services/dolby-vision-parser/server.mjs
RUN node --check /app/scripts/dolby-vision/extract-av1-rpu.mjs
USER node
ENV NODE_ENV=production
EXPOSE 8788
CMD ["node", "/app/services/dolby-vision-parser/server.mjs"]
