type PiperTtsOptions = {
  text: string;
  signal?: AbortSignal;
  baseUrl?: string;
  token?: string;
};

export async function createPiperTtsResponse({
  text,
  signal,
  baseUrl = process.env.JARVIS_TTS_URL,
  token = process.env.JARVIS_TTS_TOKEN,
}: PiperTtsOptions): Promise<Response> {
  if (!baseUrl || !token) {
    throw new Error("JARVIS TTS is not configured.");
  }

  const endpoint = new URL("/v1/tts", baseUrl);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
    throw new Error("JARVIS TTS must use HTTPS.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "audio/wav",
    },
    body: JSON.stringify({ text }),
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`JARVIS TTS request failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("audio/wav") || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("JARVIS TTS returned an unsupported audio format.");
  }

  return response;
}
