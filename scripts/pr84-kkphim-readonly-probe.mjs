import { lookup } from "node:dns/promises";
import net from "node:net";

const API_ORIGIN = "https://phimapi.com";
const TIMEOUT_MS = 10_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return /^[23]/.test(value) &&
      !value.startsWith("2001:db8:") &&
      !value.startsWith("2001:10:") &&
      !value.startsWith("2002:") &&
      !value.startsWith("::ffff:");
  }
  return false;
}

async function assertPublicHttps(raw, allowedHost) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("URL must be HTTPS without credentials or a custom port");
  }
  if (allowedHost && url.hostname !== allowedHost) {
    throw new Error("Unexpected API hostname");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error("Host did not resolve exclusively to public addresses");
  }
  return url;
}

async function readLimited(response, limit) {
  if (!response.ok) throw new Error("HTTP " + response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty upstream response");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Upstream response exceeded size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function getJson(url) {
  await assertPublicHttps(url, "phimapi.com");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": "LibreTV-PR84-ReadOnly-Probe/1.0" },
  });
  const bytes = await readLimited(response, MAX_JSON_BYTES);
  return JSON.parse(bytes.toString("utf8"));
}

async function getManifest(rawUrl) {
  const url = await assertPublicHttps(rawUrl);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*" },
  });
  const bytes = await readLimited(response, MAX_MANIFEST_BYTES);
  const text = bytes.toString("utf8");
  if (!text.trimStart().startsWith("#EXTM3U")) {
    throw new Error("Playback URL did not return an HLS manifest");
  }
  return { status: response.status, contentType: response.headers.get("content-type") || "", text, url };
}

function getItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

function getPlaybackLinks(detail) {
  const episodes = Array.isArray(detail?.episodes)
    ? detail.episodes
    : Array.isArray(detail?.movie?.episodes)
      ? detail.movie.episodes
      : [];
  const links = [];
  for (const server of episodes) {
    for (const item of Array.isArray(server?.server_data) ? server.server_data : []) {
      const value = typeof item?.link_m3u8 === "string" ? item.link_m3u8.trim() : "";
      if (value) links.push({ server: String(server.server_name || "unknown"), episode: String(item.name || "unknown"), url: value });
    }
  }
  return links;
}

const home = await getJson(new URL("/v1/api/home", API_ORIGIN).toString());
const items = getItems(home);
if (!items.length) throw new Error("KKPhim home API returned no items");

let selected = null;
let detail = null;
let links = [];
let detailCount = 0;
for (const item of items.slice(0, 8)) {
  if (typeof item?.slug !== "string" || !item.slug.trim()) continue;
  try {
    const candidate = await getJson(new URL("/phim/" + encodeURIComponent(item.slug), API_ORIGIN).toString());
    const candidateLinks = getPlaybackLinks(candidate);
    detailCount++;
    if (candidateLinks.length) {
      selected = item;
      detail = candidate;
      links = candidateLinks;
      break;
    }
  } catch (error) {
    console.warn("KKPhim detail candidate unavailable:", String(error?.message || error).slice(0, 140));
  }
}
if (!selected || !detail || !links.length) {
  throw new Error("No tested KKPhim detail among the first eight home items exposed an HLS URL");
}

let manifestResult = null;
let manifestError = null;
for (const link of links.slice(0, 6)) {
  try {
    manifestResult = await getManifest(link.url);
    break;
  } catch (error) {
    manifestError = error;
  }
}
if (!manifestResult) throw new Error("KKPhim HLS manifest probe failed: " + String(manifestError?.message || manifestError));

const lines = manifestResult.text.split(/\r?\n/);
const variants = [];
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
  const resolution = lines[i].match(/RESOLUTION=(\d+x\d+)/i)?.[1] || "unknown";
  const next = lines.slice(i + 1).find((line) => line.trim() && !line.startsWith("#"));
  if (next) variants.push({ resolution, url: new URL(next.trim(), manifestResult.url).toString() });
}

console.log("PASS KKPhim read-only API probe:", JSON.stringify({
  homeItems: items.length,
  detailItemsChecked: detailCount,
  matchedMovie: String(selected.name || "").slice(0, 80),
  year: selected.year ?? detail?.movie?.year ?? null,
  declaredQuality: detail?.movie?.quality ?? null,
  episodeServers: Array.isArray(detail?.episodes) ? detail.episodes.length : 0,
  hlsLinksFound: links.length,
  testedServer: links[0]?.server ?? null,
  testedEpisode: links[0]?.episode ?? null,
  manifestHttpStatus: manifestResult.status,
  manifestContentType: manifestResult.contentType,
  manifestType: variants.length ? "master" : "media",
  declaredResolutions: variants.map((variant) => variant.resolution),
  playbackHost: new URL(manifestResult.url).hostname,
  defaultSourceEnabled: false,
}));
