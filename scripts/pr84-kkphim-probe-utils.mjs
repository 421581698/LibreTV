export function getItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  return [];
}

export function getMovieDetail(payload) {
  return payload?.data?.item ?? payload?.item ?? payload;
}

export function getPlaybackLinks(payload) {
  const movie = getMovieDetail(payload);
  const episodes = Array.isArray(movie?.episodes)
    ? movie.episodes
    : Array.isArray(movie?.movie?.episodes)
      ? movie.movie.episodes
      : [];
  const links = [];
  for (const server of episodes) {
    for (const item of Array.isArray(server?.server_data) ? server.server_data : []) {
      const common = {
        server: String(server.server_name || "unknown"),
        episode: String(item.name || "unknown"),
      };
      for (const [kind, field] of [["hls", "link_m3u8"], ["embed", "link_embed"]]) {
        const value = typeof item?.[field] === "string" ? item[field].trim() : "";
        if (value) links.push({ ...common, kind, url: value });
      }
    }
  }
  return links;
}

export function getEmbedMediaUrls(rawUrl, html = "") {
  const urls = [];
  try {
    const page = new URL(rawUrl);
    const nested = page.searchParams.get("url");
    if (nested) urls.push(nested);
  } catch {}
  const normalized = String(html).replaceAll("\\/", "/").replaceAll("\\u0026", "&");
  const matches = normalized.match(/https?:[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi) || [];
  urls.push(...matches.map((value) => value.replace(/[),;]+$/, "")));
  return [...new Set(urls)];
}

export function sampleIndexes(length) {
  if (!length) return [];
  return [...new Set([0, Math.floor((length - 1) / 2), length - 1])];
}
