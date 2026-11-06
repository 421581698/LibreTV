/**
 * Friday Edge TTS adapter for Cloudflare Workers.
 * The Sec-MS-GEC v2 CS64/SHA-256 construction is adapted from MsEdgeTTS
 * (MIT License, Copyright (c) 2023 Migushthe2nd); see THIRD_PARTY_NOTICES.md.
 * Microsoft Edge Read Aloud is an undocumented third-party endpoint and may change.
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_VERSION = "155.0.4283.45";
const EDGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0";
const AUDIO_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const WIN_EPOCH_SECONDS = 11644473600;
const EDGE_COPYRIGHT = "Copyright (C) Microsoft Corporation. All rights reserved.";

type UpgradeResponse = Response & { webSocket?: WebSocket };
type WorkerSocket = WebSocket & { accept: () => void };

type TtsOptions = {
  text: string;
  voice: "zh-CN-XiaoxiaoNeural" | "en-US-AvaMultilingualNeural";
  signal?: AbortSignal;
};

const SWAP_FIRST = { word: 0xef0569fb, sum: 0x76f50f34, product: 0xc3efea97 };
const SWAP_SECOND = { word: 0xc31713db, sum: 0x1881ce3c, product: 0x35bd1ec9 };
const MIX_FIRST = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83];
const MIX_SECOND = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69];

function swapHalves(value: number): number {
  return ((value << 16) | (value >>> 16)) >>> 0;
}

function swapTerm(word: number, key: number, multipliers: { word: number; sum: number; product: number }): number {
  const sum = Math.imul(word, key) + Math.imul(swapHalves(word), multipliers.word);
  const product = Math.imul(swapHalves(sum), multipliers.sum) >>> 0;
  return (Math.imul(swapHalves(product), multipliers.product) + product) >>> 0;
}

function swapAndMultiply(value: number, multipliers: number[]): number {
  for (const multiplier of multipliers) value = Math.imul(swapHalves(value), multiplier) >>> 0;
  return value;
}

function toUpperHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function hashSecMsGecV2(ticksAndToken: string): Promise<string> {
  const message = new TextEncoder().encode(EDGE_COPYRIGHT + ticksAndToken);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", message));
  const digestView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const firstKey = (digestView.getUint32(0, true) | 1) >>> 0;
  const secondKey = (digestView.getUint32(4, true) | 1) >>> 0;
  const padded = new Uint8Array(Math.ceil(message.length / 8) * 8);
  padded.set(message);
  const words = new DataView(padded.buffer);
  let swapSum = 0;
  let lastSwap = 0;
  let mix = 0;
  let mixSum = 0;

  for (let offset = 0; offset < padded.length; offset += 8) {
    const firstWord = words.getUint32(offset, true);
    const secondWord = words.getUint32(offset + 4, true);
    const firstSwap = swapTerm(firstWord, firstKey, SWAP_FIRST);
    lastSwap = swapTerm(secondWord, secondKey, SWAP_SECOND);
    swapSum = (swapSum + firstSwap + lastSwap) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + firstWord, firstKey), MIX_FIRST);
    mixSum = (mixSum + mix) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + secondWord, secondKey), MIX_SECOND);
    mixSum = (mixSum + mix) >>> 0;
  }

  const checksum = new Uint8Array(8);
  const checksumView = new DataView(checksum.buffer);
  checksumView.setUint32(0, lastSwap ^ mix, true);
  checksumView.setUint32(4, swapSum ^ mixSum, true);
  return `${toUpperHex(checksum)}-${toUpperHex(digest)}`;
}

async function generateSecMsGec(): Promise<string> {
  let ticks = Date.now() / 1000 + WIN_EPOCH_SECONDS;
  ticks -= ticks % 300;
  ticks *= 1e7;
  return hashSecMsGecV2(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`);
}

function makeId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function makeMuid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("").toUpperCase();
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, -1);
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseHeaders(value: string): Record<string, string> {
  const headerText = value.split("\r\n\r\n", 1)[0] || "";
  const headers: Record<string, string> = {};
  for (const line of headerText.split("\r\n")) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return headers;
}

function buildSpeechConfig(): string {
  return `X-Timestamp:${timestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${AUDIO_FORMAT}"}}}}\r\n`;
}

function buildSsml(requestId: string, voice: TtsOptions["voice"], text: string): string {
  const locale = voice.startsWith("zh-") ? "zh-CN" : "en-US";
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">${escapeXml(text)}</prosody></voice></speak>`;
  return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
}

function parseAudioFrame(data: ArrayBuffer): Uint8Array | null {
  const bytes = new Uint8Array(data);
  if (bytes.length < 2) throw new Error("Edge TTS returned a truncated audio frame.");
  const headerLength = (bytes[0] << 8) | bytes[1];
  if (bytes.length < headerLength + 2) throw new Error("Edge TTS returned an invalid audio frame.");
  const headers = parseHeaders(new TextDecoder().decode(bytes.subarray(2, headerLength + 2)));
  if (headers.Path !== "audio") return null;
  if (headers["Content-Type"] !== "audio/mpeg") return null;
  const audio = bytes.slice(headerLength + 2);
  return audio.length ? audio : null;
}

export async function createEdgeTtsStream({ text, voice, signal }: TtsOptions): Promise<ReadableStream<Uint8Array>> {
  if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");

  const token = await generateSecMsGec();
  const url = new URL("https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1");
  url.searchParams.set("TrustedClientToken", TRUSTED_CLIENT_TOKEN);
  url.searchParams.set("Sec-MS-GEC", token);
  url.searchParams.set("Sec-MS-GEC-Version", `2-${EDGE_VERSION}`);
  url.searchParams.set("ConnectionId", makeId());

  const response = (await fetch(url.toString(), {
    headers: {
      "User-Agent": EDGE_USER_AGENT,
      "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "Upgrade": "websocket",
      "Cookie": `muid=${makeMuid()};`,
    },
    signal,
  })) as UpgradeResponse;

  const socket = response.webSocket as WorkerSocket | undefined;
  if (response.status !== 101 || !socket) {
    throw new Error(`Edge TTS WebSocket handshake failed (HTTP ${response.status}).`);
  }

  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let settled = false;
  let receivedAudio = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
    socket.removeEventListener("error", onError);
    signal?.removeEventListener("abort", onAbort);
  };

  const closeSocket = () => {
    try { socket.close(1000, "complete"); } catch { /* best effort */ }
  };

  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    try { socket.close(1011, "synthesis failed"); } catch { /* best effort */ }
    streamController?.error(error instanceof Error ? error : new Error("Edge TTS synthesis failed."));
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    if (!receivedAudio) {
      streamController?.error(new Error("Edge TTS completed without returning audio."));
      return;
    }
    streamController?.close();
  };

  const onMessage = (event: Event) => {
    if (settled) return;
    const data = (event as MessageEvent).data;
    if (typeof data === "string") {
      const headers = parseHeaders(data);
      if (headers.Path === "turn.end") closeSocket();
      else if (!["response", "turn.start", "audio.metadata"].includes(headers.Path || "")) {
        fail(new Error("Edge TTS returned an unexpected protocol message."));
      }
      return;
    }
    if (data instanceof ArrayBuffer) {
      try {
        const audio = parseAudioFrame(data);
        if (audio) {
          receivedAudio = true;
          streamController?.enqueue(audio);
        }
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => {
        if (settled) return;
        try {
          const audio = parseAudioFrame(buffer);
          if (audio) {
            receivedAudio = true;
            streamController?.enqueue(audio);
          }
        } catch (error) {
          fail(error);
        }
      }).catch(fail);
    }
  };

  const onClose = () => finish();
  const onError = () => fail(new Error("Edge TTS WebSocket connection failed."));
  const onAbort = () => fail(new DOMException("The request was aborted.", "AbortError"));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      timeoutId = setTimeout(() => fail(new Error("Edge TTS synthesis timed out.")), 45000);
      socket.accept();
      socket.send(buildSpeechConfig());
      socket.send(buildSsml(makeId(), voice, text));
    },
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
      try { socket.close(1000, "client cancelled"); } catch { /* best effort */ }
    },
  });

  return stream;
}
