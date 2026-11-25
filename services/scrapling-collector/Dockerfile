FROM python:3.12.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/data \
    PLAYWRIGHT_BROWSERS_PATH=/opt/collector-browsers \
    PORT=10000

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gosu libatomic1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN python -m pip install --no-cache-dir uv \
    && uv pip install --system --no-cache -r requirements.txt \
    && mkdir -p /data /opt/collector-browsers \
    && useradd --create-home --uid 10001 collector \
    && chown -R collector:collector /data \
    && scrapling install
COPY app.py registry_queue.py stats.py worker.py seedhub.py dv_media_ingest.py dv_hls_ingest.py dv_hls_fmp4_assembly.py dv_source_gateway.py dv_hls_source_gateway.py ./
RUN python -c "import dv_hls_fmp4_assembly" && python dv_hls_fmp4_assembly.py --help >/dev/null
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '10000') + '/health', timeout=3)"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port \"${PORT:-10000}\" --workers 1"]
