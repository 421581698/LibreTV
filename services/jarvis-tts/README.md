# Friday JARVIS Piper TTS service

This sidecar runs the MIT-licensed `jgkawell/jarvis` Piper voice (British English, `en_GB`, high quality). The ONNX model is downloaded during image build and loaded once when the service starts.

## Run

```bash
docker build -t friday-jarvis-tts ./services/jarvis-tts
docker run --rm -p 8000:8000 -e JARVIS_TTS_TOKEN='replace-with-a-long-random-secret' friday-jarvis-tts
```

Expose it only through HTTPS. Do not expose port 8000 publicly without a TLS reverse proxy. Configure the same token as the Cloudflare Worker secret `JARVIS_TTS_TOKEN`, and configure `JARVIS_TTS_URL` as the HTTPS base URL of this service:

```bash
npx wrangler secret put JARVIS_TTS_TOKEN
npx wrangler secret put JARVIS_TTS_URL
```

The TTS URL should be a base URL such as `https://voice.example.com`, not a URL ending in `/v1/tts`.

## Health check

`GET /health` reports readiness after the model has loaded. The synthesis endpoint requires a bearer token and accepts at most 1,200 characters per request. Audio is returned as WAV and is not stored.

The JARVIS model is English-only. Friday continues to use the browser's configured Chinese voice when the UI language is Chinese. No claim is made that the English model can synthesize Mandarin.
