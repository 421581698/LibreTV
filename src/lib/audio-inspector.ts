/**
 * HLS audio rendition inspection.
 *
 * Reads declared CHANNELS metadata only. It does not infer surround from codec
 * names, and a JOC marker is metadata evidence, not proof that the browser
 * decodes Dolby Atmos objects.
 */

export type AudioChannelLayout = 'mono' | 'stereo' | '5.1' | 'unknown';

export interface HlsAudioRenditionInfo {
  groupId: string;
  name: string;
  uri: string | null;
  channelsRaw: string | null;
  channelCount: number | null;
  layout: AudioChannelLayout;
  codec: string | null;
  hasJocMarker: boolean;
  default: boolean;
  autoselect: boolean;
}

function parseAttributeList(line: string): Record<string, string> {
  const colon = line.indexOf(':');
  const input = colon >= 0 ? line.slice(colon + 1) : line;
  const attributes: Record<string, string> = {};
  const expression = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(input)) !== null) {
    const raw = match[2].trim();
    attributes[match[1]] = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).replace(/\\(["\\])/g, '$1')
      : raw;
  }
  return attributes;
}

function audioCodecFromCodecs(codecs: string | undefined): string | null {
  if (!codecs) return null;
  const candidates = codecs.split(',').map((value) => value.trim());
  return candidates.find((value) => /^(mp4a|ac-3|ec-3|opus|flac|alac|dts|mlpa)/i.test(value)) ?? null;
}

function channelLayout(channelCount: number | null): AudioChannelLayout {
  if (channelCount === 1) return 'mono';
  if (channelCount === 2) return 'stereo';
  // CHANNELS=6 (including 6/JOC) gives a count, not a trustworthy speaker order.
  // Keep it unknown until a source supplies an explicit, verified layout.
  return 'unknown';
}

function parseChannelDeclaration(channelsRaw: string | null): {
  channelCount: number | null;
  hasJocMarker: boolean;
} {
  const match = channelsRaw ? /^(\d+)(?:\/(.*))?$/.exec(channelsRaw) : null;
  const count = match ? Number(match[1]) : null;
  return {
    channelCount: Number.isInteger(count) && count! > 0 ? count : null,
    hasJocMarker: Boolean(match?.[2] && /JOC/i.test(match[2])),
  };
}

export interface HlsAudioTrackLike {
  id?: number;
  name?: string;
  groupId?: string;
  lang?: string;
  url?: string;
  channels?: string;
  audioCodec?: string;
  default?: boolean;
  autoselect?: boolean;
}

/** Normalize the audio track metadata exposed by hls.js 1.7.x. */
export function inspectHlsAudioTrack(track: HlsAudioTrackLike): HlsAudioRenditionInfo {
  const channelsRaw = track.channels ?? null;
  const parsed = parseChannelDeclaration(channelsRaw);
  return {
    groupId: track.groupId ?? '',
    name: track.name ?? '',
    uri: track.url ?? null,
    channelsRaw,
    channelCount: parsed.channelCount,
    layout: channelLayout(parsed.channelCount),
    codec: track.audioCodec ?? null,
    hasJocMarker: parsed.hasJocMarker,
    default: Boolean(track.default),
    autoselect: Boolean(track.autoselect),
  };
}

export function parseHlsAudioRenditions(manifest: string): HlsAudioRenditionInfo[] {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const audioGroups = new Map<string, string | null>();
  const renditions: HlsAudioRenditionInfo[] = [];

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributeList(line);
      const group = attrs.AUDIO;
      if (group) audioGroups.set(group, audioCodecFromCodecs(attrs.CODECS));
      continue;
    }
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = parseAttributeList(line);
    if (attrs.TYPE !== 'AUDIO') continue;

    const channelsRaw = attrs.CHANNELS ?? null;
    const parsedChannels = parseChannelDeclaration(channelsRaw);
    renditions.push({
      groupId: attrs['GROUP-ID'] ?? '',
      name: attrs.NAME ?? '',
      uri: attrs.URI ?? null,
      channelsRaw,
      channelCount: parsedChannels.channelCount,
      layout: channelLayout(parsedChannels.channelCount),
      codec: null,
      hasJocMarker: parsedChannels.hasJocMarker,
      default: attrs.DEFAULT === 'YES',
      autoselect: attrs.AUTOSELECT === 'YES',
    });
  }

  return renditions.map((rendition) => ({
    ...rendition,
    codec: audioGroups.get(rendition.groupId) ?? null,
  }));
}
