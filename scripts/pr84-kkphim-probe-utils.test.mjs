import test from "node:test";
import assert from "node:assert/strict";
import { getItems, getMovieDetail, getPlaybackLinks, getEmbedMediaUrls, sampleIndexes } from "./pr84-kkphim-probe-utils.mjs";

test("reads legacy and v1 home list shapes", () => {
  assert.equal(getItems({ items: [{ slug: "old" }] })[0].slug, "old");
  assert.equal(getItems({ data: { items: [{ slug: "v1" }] } })[0].slug, "v1");
  assert.deepEqual(getItems({ data: { items: "invalid" } }), []);
});

test("reads legacy and v1 detail wrappers", () => {
  const movie = { slug: "movie", episodes: [] };
  assert.equal(getMovieDetail({ data: { item: movie } }), movie);
  const legacy = { movie: { slug: "legacy", episodes: [] } };
  assert.equal(getMovieDetail(legacy), legacy);
});

test("collects both HLS and embed links across every server and episode", () => {
  const payload = { data: { item: { episodes: [
    { server_name: "A", server_data: [{ name: "E1", link_m3u8: "https://cdn.test/a.m3u8", link_embed: "https://player.test/?url=https%3A%2F%2Fcdn.test%2Fb.m3u8" }] },
    { server_name: "B", server_data: [{ name: "E2", link_embed: "https://player.test/embed/2" }] },
  ] } } };
  const links = getPlaybackLinks(payload);
  assert.equal(links.length, 3);
  assert.deepEqual(links.map((item) => item.kind), ["hls", "embed", "embed"]);
  assert.equal(links[2].server, "B");
});

test("handles empty servers and missing playback fields", () => {
  assert.deepEqual(getPlaybackLinks({ data: { item: { episodes: [{ server_name: "empty", server_data: [] }] } } }), []);
});

test("extracts nested and page-embedded m3u8 candidates", () => {
  const input = "https://player.phimapi.com/player/?url=https%3A%2F%2Fcdn.test%2Fmain.m3u8";
  const urls = getEmbedMediaUrls(input, 'const source="https://cdn.test/variant.m3u8?token=x";');
  assert.deepEqual(urls, ["https://cdn.test/main.m3u8", "https://cdn.test/variant.m3u8?token=x"]);
});

test("samples first, middle and last episode without duplicates", () => {
  assert.deepEqual(sampleIndexes(1), [0]);
  assert.deepEqual(sampleIndexes(4), [0, 1, 3]);
  assert.deepEqual(sampleIndexes(0), []);
});
