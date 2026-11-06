import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { guardRequest } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(1200),
});

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

  let serviceUrl = "";
  let serviceToken = "";
  try {
    const { env } = getCloudflareContext();
    const bindings = env as { JARVIS_TTS_URL?: string; JARVIS_TTS_TOKEN?: string };
    serviceUrl = (bindings.JARVIS_TTS_URL || "").trim();
    serviceToken = (bindings.JARVIS_TTS_TOKEN || "").trim();
  } catch (error) {
    console.error("[Friday TTS] Cloudflare bindings unavailable:", error);
    return jsonError("JARVIS voice service is not configured.", 503);
  }

  if (!serviceUrl || !serviceToken) {
    return jsonError("JARVIS voice service is not configured.", 503);
  }

  let upstream: URL;
  try {
    upstream = new URL(serviceUrl);
    if (upstream.protocol !== "https:" && upstream.hostname !== "localhost") {
      return jsonError("JARVIS voice service must use HTTPS.", 500);
    }
  } catch {
    return jsonError("JARVIS voice service URL is invalid.", 500);
  }

  const controller = new AbortController();
  const abortUpstream = () => controller.abort();
  request.signal.addEventListener("abort", abortUpstream, { once: true });

  try {
    const response = await fetch(new URL("/v1/tts", upstream), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceToken}`,
        "Content-Type": "application/json",
        "Accept": "audio/wav",
      },
      body: JSON.stringify({ text: payload.text }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("[Friday TTS] Upstream synthesis failed:", response.status);
      return jsonError("JARVIS voice synthesis is temporarily unavailable.", 502);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("audio/wav")) {
      return jsonError("JARVIS voice service returned an invalid audio format.", 502);
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[Friday TTS] Upstream request failed:", error);
    return jsonError("Could not reach the JARVIS voice service.", 502);
  } finally {
    request.signal.removeEventListener("abort", abortUpstream);
  }
}
