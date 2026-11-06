import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { guardRequest } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  language: z.enum(["zh", "en"]).default("en"),
});

type WorkersAiBinding = {
  run(
    model: "@cf/deepgram/aura-2-en",
    input: { text: string; speaker: "luna"; encoding: "mp3" },
  ): Promise<ReadableStream<Uint8Array>>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const authError = guardRequest(request);
  if (authError) return authError;

  if (!request.headers.get("content-type")?.includes("application/json")) {
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

  // Aura-2 is English-only. Chinese intentionally remains on the browser
  // SpeechSynthesis provider until a supported Cloudflare-hosted Mandarin
  // model is available; do not silently route Chinese text to an English voice.
  if (payload.language !== "en") {
    return jsonError("Cloudflare TTS currently supports English in this provider.", 400);
  }

  let ai: WorkersAiBinding | undefined;
  try {
    const { env } = getCloudflareContext();
    ai = (env as { AI?: WorkersAiBinding }).AI;
  } catch (error) {
    console.error("[Friday TTS] Cloudflare AI binding unavailable:", error);
    return jsonError("Cloudflare Workers AI is not configured.", 503);
  }

  if (!ai || typeof ai.run !== "function") {
    return jsonError("Cloudflare Workers AI binding is not configured.", 503);
  }

  if (request.signal.aborted) return new Response(null, { status: 499 });

  try {
    const audio = await ai.run("@cf/deepgram/aura-2-en", {
      text: payload.text,
      speaker: "luna",
      encoding: "mp3",
    });

    if (request.signal.aborted) return new Response(null, { status: 499 });

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Friday TTS] Workers AI synthesis failed:", error);
    return jsonError("Cloudflare voice synthesis is temporarily unavailable.", 502);
  }
}
