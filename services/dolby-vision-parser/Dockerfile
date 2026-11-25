FROM node:24-bookworm-slim

ARG DOVI_TOOL_VERSION=2.3.4
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tar ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/quietvoid/dovi_tool/releases/download/${DOVI_TOOL_VERSION}/dovi_tool-${DOVI_TOOL_VERSION}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/dovi_tool.tar.gz \
    && mkdir -p /tmp/dovi_tool \
    && tar -xzf /tmp/dovi_tool.tar.gz -C /tmp/dovi_tool \
    && binary="$(find /tmp/dovi_tool -type f -name dovi_tool -print -quit)" \
    && test -n "$binary" \
    && install -m 0755 "$binary" /usr/local/bin/dovi_tool \
    && rm -rf /tmp/dovi_tool /tmp/dovi_tool.tar.gz

WORKDIR /app
COPY scripts/dolby-vision/analyze-rpu.mjs /app/scripts/dolby-vision/analyze-rpu.mjs
COPY scripts/dolby-vision/extract-av1-rpu.mjs /app/scripts/dolby-vision/extract-av1-rpu.mjs
COPY services/dolby-vision-parser/server.mjs /app/services/dolby-vision-parser/server.mjs
RUN node --check /app/scripts/dolby-vision/extract-av1-rpu.mjs
USER node
ENV NODE_ENV=production
EXPOSE 8788
CMD ["node", "/app/services/dolby-vision-parser/server.mjs"]
