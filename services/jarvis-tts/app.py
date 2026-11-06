import hmac
import io
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from piper import PiperVoice

MODEL_PATH = Path(os.environ.get("PIPER_MODEL", "/models/jarvis-high.onnx"))
CONFIG_PATH = Path(os.environ.get("PIPER_CONFIG", "/models/jarvis-high.onnx.json"))
TOKEN = os.environ.get("JARVIS_TTS_TOKEN", "")

if not TOKEN:
    raise RuntimeError("JARVIS_TTS_TOKEN must be configured")
if not MODEL_PATH.is_file() or not CONFIG_PATH.is_file():
    raise RuntimeError("Piper JARVIS model and matching JSON config are required")

# Load once at process start; do not reload a 114 MB model for every request.
voice = PiperVoice.load(str(MODEL_PATH), config_path=str(CONFIG_PATH))
app = FastAPI(title="Friday JARVIS Piper TTS", docs_url=None, redoc_url=None)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1200)


@app.get("/health")
def health():
    return {"ok": True, "engine": "piper", "voice": "en_GB-jgkawell-jarvis-high"}


@app.post("/v1/tts")
def synthesize(payload: SpeechRequest, authorization: str | None = Header(default=None)):
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not supplied or not hmac.compare_digest(supplied, TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Keep the model's input bounded and reject control characters.
    text = " ".join(payload.text.split())
    if not text or any(ord(char) < 32 and char not in "\t\n\r" for char in text):
        raise HTTPException(status_code=400, detail="Invalid text")

    output = io.BytesIO()
    voice.synthesize_wav(text, output)
    return Response(
        content=output.getvalue(),
        media_type="audio/wav",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
