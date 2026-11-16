FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOST=0.0.0.0 \
    PORT=8787 \
    MEDIA_PROBE_ROOT=/tmp/libretv-media-probe

WORKDIR /service
COPY pyproject.toml README.md ./
COPY app ./app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/libretv-media-probe \
    && chmod 700 /tmp/libretv-media-probe \
    && pip install --upgrade pip \
    && pip install .

EXPOSE 8787
# HOST and PORT are shared with app.config; a non-loopback bind requires SCRAPLING_API_KEY.
CMD ["sh", "-c", "uvicorn app.main:app --host \"$HOST\" --port \"$PORT\""]
