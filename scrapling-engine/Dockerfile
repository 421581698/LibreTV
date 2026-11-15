FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOST=0.0.0.0 \
    PORT=8787

WORKDIR /service
COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --upgrade pip && pip install .

EXPOSE 8787
# HOST and PORT are shared with app.config; a non-loopback bind requires SCRAPLING_API_KEY.
CMD ["sh", "-c", "uvicorn app.main:app --host \"$HOST\" --port \"$PORT\""]
