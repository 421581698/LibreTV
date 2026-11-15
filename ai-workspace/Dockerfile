# syntax=docker/dockerfile:1.7
# Independent FCC service image. It does not build or run LibreTV.
FROM python:3.14.10-slim AS runtime

ARG FCC_UPSTREAM_REF=dd8b21c3861cd844715a37949fe45bc2bd3790da
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /opt/free-claude-code
RUN git init \
    && git remote add origin https://github.com/Alishahryar1/free-claude-code.git \
    && git fetch --depth=1 origin ${FCC_UPSTREAM_REF} \
    && git checkout --detach FETCH_HEAD

RUN uv sync --no-dev --locked

# FCC starts its own FastAPI/admin service. Configure its supported bind,
# port, and data paths for the selected upstream release before publishing.
CMD ["uv", "run", "--no-sync", "fcc-server"]
