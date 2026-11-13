import { lookup } from "node:dns/promises";
import net from "node:net";
import {
  getEmbedMediaUrls,
  getItems,
  getMovieDetail,
  getPlaybackLinks,
  sampleIndexes,
} from "./pr84-kkphim-probe-utils.mjs";

const API_ORIGIN = "https://phimapi.com";
const PLAYER_HOST = "player.phimapi.com";
const TIMEOUT_MS = 8_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_SEGMENT_BYTES = 1024 * 1024;
const MAX_HOME_PAGES = 2;
const MAX_MOVIES = 12;
const MAX_LINKS = 72;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return /^[23]/.test(value) && !value.startsWith("2001:db8:") &&
      !value.startsWith("2001:10:") && !value.startsWith("2002:") && !value.startsWith("::ffff:");
  }
  return false;
}

async function assertPublicHttps(raw, allowedHost) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("URL must be HTTPS without credentials or a custom port");
  }
  if (allowedHost && url.hostname !== allowedHost) throw new Error("Unexpected host");
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

async function getResponse(rawUrl, { allowedHost, accept, range } = {}) {
  const url = await assertPublicHttps(rawUrl, allowedHost);
  const headers = { accept: accept || "*/*", "user-agent": UA, referer: "https://phimapi.com/", origin: "https://phimapi.com" };
  if (range) headers.range = range;
  return { url, response: await fetch(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), headers }) };
}

async function getJson(rawUrl) {
  const { response } = await getResponse(rawUrl, { allowedHost: "phimapi.com", accept: "application/json" });
  return JSON.parse((await readLimited(response, MAX_JSON_BYTES)).toString("utf8"));
}

async function getManifest(rawUrl) {
  const { url, response } = await getResponse(rawUrl, { accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*" });
  const bytes = await readLimited(response, MAX_MANIFEST_BYTES);
  const text = bytes.toString("utf8");
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("Response is not an HLS manifest");
  return { url, status: response.status, contentType: response.headers.get("content-type") || "", text };
}

async function getEmbedPageMedia(rawUrl) {
  const { response } = await getResponse(rawUrl, { allowedHost: PLAYER_HOST, accept: "text/html,application/xhtml+xml" });
  const html = (await readLimited(response, MAX_HTML_BYTES)).toString("utf8");
  return getEmbedMediaUrls(rawUrl, html);
}

async function verifyManifestAndSegment(rawUrl) {
  let manifest = await getManifest(rawUrl);
  const masterLines = manifest.text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < masterLines.length; i++) {
    if (!masterLines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const resolution = masterLines[i].match(/RESOLUTION=(\d+x\d+)/i)?.[1] || "unknown";
    const next = masterLines.slice(i + 1).find((line) => line.trim() && !line.startsWith("#"));
    if (next) variants.push({ resolution, url: new URL(next.trim(), manifest.url).toString() });
  }
  if (variants.length) manifest = await getManifest(variants[0].url);

  const segmentLine = manifest.text.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#"));
  if (!segmentLine) throw new Error("HLS media playlist contains no segment URI");
  const segmentUrl = new URL(segmentLine.trim(), manifest.url).toString();
  const { response } = await getResponse(segmentUrl, { range: "bytes=0-65535" });
  const bytes = await readLimited(response, MAX_SEGMENT_BYTES);
  if (!bytes.length) throw new Error("HLS segment response was empty");
  return {
    manifestStatus: manifest.status,
    manifestContentType: manifest.contentType,
    segmentStatus: response.status,
    segmentBytes: bytes.length,
    segmentHost: new URL(segmentUrl).hostname,
    variants,
  };
}

const homeItems = new Map();
let homePagesChecked = 0;
for (let page = 1; page <= MAX_HOME_PAGES; page++) {
  const payload = await getJson(new URL("/v1/api/home?page=" + page, API_ORIGIN).toString());
  homePagesChecked++;
  for (const item of getItems(payload)) {
    if (typeof item?.slug === "string" && item.slug.trim()) homeItems.set(item.slug, item);
  }
}
const items = [...homeItems.values()].slice(0, MAX_MOVIES);
if (!items.length) throw new Error("KKPhim home API returned no movie items across sampled pages");

const diagnostics = [];
const candidates = [];
let detailV1Count = 0;
let detailLegacyCount = 0;
for (const item of items) {
  const slug = item.slug;
  let payload = null;
  let detailFormat = "v1";
  try {
    payload = await getJson(new URL("/v1/api/phim/" + encodeURIComponent(slug), API_ORIGIN).toString());
    if (!getPlaybackLinks(payload).length) throw new Error("V1 detail returned no episode playback links");
    detailV1Count++;
  } catch (v1Error) {
    try {
      payload = await getJson(new URL("/phim/" + encodeURIComponent(slug), API_ORIGIN).toString());
      detailFormat = "legacy";
      if (!getPlaybackLinks(payload).length) throw new Error("Legacy detail returned no episode playback links");
      detailLegacyCount++;
    } catch (legacyError) {
      diagnostics.push({ slug, detail: "unavailable", v1Error: String(v1Error?.message || v1Error).slice(0, 100), legacyError: String(legacyError?.message || legacyError).slice(0, 100) });
      continue;
    }
  }
  const links = getPlaybackLinks(payload);
  const byServerAndKind = new Map();
  for (const link of links) {
    const key = link.server + "::" + link.kind;
    if (!byServerAndKind.has(key)) byServerAndKind.set(key, []);
    byServerAndKind.get(key).push(link);
  }
  for (const groupedLinks of byServerAndKind.values()) {
    for (const index of sampleIndexes(groupedLinks.length)) {
      candidates.push({ item, detail: getMovieDetail(payload), detailFormat, link: groupedLinks[index] });
      if (candidates.length >= MAX_LINKS) break;
    }
    if (candidates.length >= MAX_LINKS) break;
  }
  diagnostics.push({ slug, detailFormat, servers: new Set(links.map((link) => link.server)).size, playbackKinds: [...new Set(links.map((link) => link.kind))], episodeLinks: links.length });
  if (candidates.length >= MAX_LINKS) break;
}
if (!candidates.length) throw new Error("No playback candidates found across sampled KKPhim details");

let success = null;
let tested = 0;
const failures = [];
for (const candidate of candidates) {
  tested++;
  const link = candidate.link;
  try {
    const attemptedMediaUrls = new Set();
    let lastError = null;
    const testMediaUrls = async (mediaUrls) => {
      for (const mediaUrl of mediaUrls) {
        if (attemptedMediaUrls.has(mediaUrl)) continue;
        attemptedMediaUrls.add(mediaUrl);
        try {
          const verified = await verifyManifestAndSegment(mediaUrl);
          success = { ...candidate, mediaUrl, verified };
          return;
        } catch (error) {
          lastError = error;
        }
      }
    };

    if (link.kind === "hls") {
      await testMediaUrls([link.url]);
    } else {
      await testMediaUrls(getEmbedMediaUrls(link.url));
      // A stale nested URL can 404 while the player page still resolves a fresh media URL.
      if (!success) {
        const pageMediaUrls = await getEmbedPageMedia(link.url);
        await testMediaUrls(pageMediaUrls);
        if (!pageMediaUrls.length && !lastError) {
          lastError = new Error("Embed page exposed no direct HLS URL; embed HTTP response alone is not playback proof");
        }
      }
    }
    if (success) break;
    throw lastError || new Error("No extracted HLS media URL passed verification");
  } catch (error) {
    failures.push({ slug: candidate.item.slug, server: link.server, episode: link.episode, kind: link.kind, error: String(error?.message || error).slice(0, 140) });
  }
}

const report = {
  homePagesChecked,
  uniqueHomeItems: homeItems.size,
  detailItemsChecked: diagnostics.filter((entry) => entry.detailFormat).length,
  detailV1Count,
  detailLegacyCount,
  candidatesFound: candidates.length,
  uniqueCandidateMovies: new Set(candidates.map((candidate) => candidate.item.slug)).size,
  candidatesTested: tested,
  failedCandidates: failures.length,
  successfulPlayback: Boolean(success),
  testedMovie: success?.item.name || null,
  testedSlug: success?.item.slug || null,
  detailFormat: success?.detailFormat || null,
  testedServer: success?.link.server || null,
  testedEpisode: success?.link.episode || null,
  playbackPath: success?.link.kind || null,
  manifestHttpStatus: success?.verified.manifestStatus || null,
  manifestContentType: success?.verified.manifestContentType || null,
  segmentHttpStatus: success?.verified.segmentStatus || null,
  segmentBytes: success?.verified.segmentBytes || 0,
  segmentHost: success?.verified.segmentHost || null,
  declaredQuality: success?.detail?.quality || success?.item.quality || null,
  sourceEnabled: false,
  diagnostics: diagnostics.slice(0, 12),
  failureSamples: failures.slice(0, 12),
};
console.log("KKPhim read-only probe report:", JSON.stringify(report));
if (!success) throw new Error("KKPhim had no candidate with a valid HLS manifest and non-empty segment after " + tested + " candidates");
console.log("PASS KKPhim API + HLS manifest + segment read-only probe; default source remains disabled pending browser decode verification.");
