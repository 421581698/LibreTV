import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

function jsonError(error: string, status: number) {
  return Response.json({ error }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES + 64 * 1024) {
    return jsonError("录音文件超过 15 MB 限制", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("无法读取录音表单", 400);
  }

  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size <= 0) {
    return jsonError("没有收到有效录音文件", 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return jsonError("录音文件超过 15 MB 限制", 413);
  }
  if (!audio.type.startsWith("audio/")) {
    return jsonError("上传文件不是受支持的音频类型", 415);
  }

  let env: Record<string, string | undefined>;
  try {
    const context = getCloudflareContext();
    env = context.env as unknown as Record<string, string | undefined>;
  } catch {
    return jsonError("服务器运行环境不可用", 500);
  }

  const endpoint = env.ASR_API_URL;
  const apiKey = env.ASR_API_KEY;
  const model = env.ASR_MODEL || "whisper-1";

  if (!endpoint || !apiKey) {
    return jsonError("ASR 尚未配置：请设置 ASR_API_URL 和 ASR_API_KEY", 503);
  }

  let target: URL;
  try {
    target = new URL(endpoint);
    if (target.protocol !== "https:" && target.hostname !== "localhost") {
      return jsonError("ASR_API_URL 必须使用 HTTPS", 500);
    }
  } catch {
    return jsonError("ASR_API_URL 配置不是有效 URL", 500);
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", audio, audio.name || "voice-test-audio");
  upstreamForm.append("model", model);
  upstreamForm.append("language", "zh");

  try {
    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      console.error("[VoiceTest] ASR upstream error:", upstream.status, raw.slice(0, 500));
      return jsonError(`ASR 服务返回错误（HTTP ${upstream.status}）`, 502);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return jsonError("ASR 服务返回的不是有效 JSON", 502);
    }

    const data = payload as { text?: unknown; transcription?: unknown };
    const text = typeof data.text === "string"
      ? data.text
      : typeof data.transcription === "string"
        ? data.transcription
        : "";

    return Response.json({ text }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[VoiceTest] ASR request failed:", error);
    return jsonError("连接 ASR 服务失败或请求超时", 502);
  }
}
