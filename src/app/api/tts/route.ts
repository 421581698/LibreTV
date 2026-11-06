import { z } from "zod";
import { guardRequest } from "@/lib/api-guard";
import { createEdgeTtsStream } from "@/lib/friday/edgeTts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[Friday TTS] Edge TTS synthesis failed:", error);
    return jsonError("Friday voice synthesis is temporarily unavailable.", 502);
  }
}
