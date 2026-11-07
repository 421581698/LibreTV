import { z } from "zod";
import { guardRequest } from "@/lib/api-guard";
import { createEdgeTtsStream } from "@/lib/friday/edgeTts";
import { createPiperTtsResponse } from "@/lib/friday/piperTts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestTimes = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

function isRateLimited(request: Request): boolean {
  const key = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown-client";
  const now = Date.now();
  const recent = (requestTimes.get(key) || []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestTimes.set(key, recent);
    return true;
  }
  recent.push(now);
  requestTimes.set(key, recent);
  if (requestTimes.size > 500) {
    for (const [client, times] of requestTimes) {
      if (!times.some((time) => now - time < RATE_LIMIT_WINDOW_MS)) requestTimes.delete(client);
      if (requestTimes.size <= 400) break;
    }
  }
  return false;
}

const requestSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  language: z.enum(["zh", "en"]).default("zh"),
});

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function primeAudioStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const firstChunk = await reader.read();
  if (firstChunk.done || !firstChunk.value?.byteLength) {
    await reader.cancel();
    throw new Error("Edge TTS returned an empty audio stream.");
  }

  let firstChunkPending = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (firstChunkPending) {
          firstChunkPending = false;
          controller.enqueue(firstChunk.value);
          return;
        }
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

export async function POST(request: Request) {
  const authError = guardRequest(request);
  if (authError) return authError;

  if (isRateLimited(request)) return jsonError("Too many speech requests. Please wait and try again.", 429);

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Unsupported content type.", 415);
  }

  let payload: z.infer<typeof requestSchema>;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("Invalid speech request.", 400);
    payload = parsed.data;
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  if (request.signal.aborted) return new Response(null, { status: 499 });

  // Piper JARVIS is an optional English-only voice. Chinese always stays on
  // Microsoft Edge Xiaoxiao; if Piper is unavailable, English falls back to
  // Microsoft Edge Ava rather than breaking voice output.
  if (payload.language === "en" && process.env.JARVIS_TTS_URL && process.env.JARVIS_TTS_TOKEN) {
    try {
      const piper = await createPiperTtsResponse({ text: payload.text, signal: request.signal });
      if (!piper.body) throw new Error("JARVIS TTS returned an empty body.");
      const audio = await primeAudioStream(piper.body);
      return new Response(audio, {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Friday-TTS-Engine": "piper-jarvis",
        },
      });
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      console.warn("[Friday TTS] Optional Piper JARVIS unavailable; falling back to Edge TTS:", error);
    }
  }

  try {
    const stream = await createEdgeTtsStream({
      text: payload.text,
      voice: payload.language === "zh"
        ? "zh-CN-XiaoxiaoNeural"
        : "en-US-AvaMultilingualNeural",
      signal: request.signal,
    });
    const audio = await primeAudioStream(stream);

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Friday-TTS-Engine": "microsoft-edge",
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[Friday TTS] Edge TTS synthesis failed:", error);
    return jsonError("Friday voice synthesis is temporarily unavailable.", 502);
  }
}
