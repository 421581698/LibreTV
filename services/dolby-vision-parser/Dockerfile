FROM rust:1.95-bookworm AS dovi-builder

ARG DOVI_TOOL_COMMIT=41dae646193c12de152333ff5dbc33579cb9ef4a
COPY scripts/dolby-vision/av1-rpu-converter.rs /tmp/av1-rpu-converter.rs
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && git clone https://github.com/quietvoid/dovi_tool.git /src/dovi_tool \
    && git -C /src/dovi_tool checkout --detach "${DOVI_TOOL_COMMIT}" \
    && mkdir -p /src/dovi_tool/src/bin \
    && cp /tmp/av1-rpu-converter.rs /src/dovi_tool/src/bin/av1-rpu-converter.rs \
    && cd /src/dovi_tool \
    && cargo build --locked --release --no-default-features --features internal-font --bin dovi_tool --bin av1-rpu-converter

FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dovi-builder /src/dovi_tool/target/release/dovi_tool /usr/local/bin/dovi_tool
COPY --from=dovi-builder /src/dovi_tool/target/release/av1-rpu-converter /usr/local/bin/av1-rpu-converter

WORKDIR /app
COPY scripts/dolby-vision/analyze-rpu.mjs /app/scripts/dolby-vision/analyze-rpu.mjs
COPY scripts/dolby-vision/extract-av1-rpu.mjs /app/scripts/dolby-vision/extract-av1-rpu.mjs
COPY scripts/dolby-vision/hevc-frame-mapper.mjs /app/scripts/dolby-vision/hevc-frame-mapper.mjs
COPY scripts/dolby-vision/hevc-frame-mapper.test.mjs /app/scripts/dolby-vision/hevc-frame-mapper.test.mjs
RUN node --check /app/scripts/dolby-vision/hevc-frame-mapper.mjs && node --test /app/scripts/dolby-vision/hevc-frame-mapper.test.mjs
COPY services/dolby-vision-parser/server.mjs /app/services/dolby-vision-parser/server.mjs
RUN node --check /app/scripts/dolby-vision/extract-av1-rpu.mjs
USER node
ENV NODE_ENV=production
ENV AV1_RPU_CONVERTER_BIN=/usr/local/bin/av1-rpu-converter
EXPOSE 8788
CMD ["node", "/app/services/dolby-vision-parser/server.mjs"]
