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
  if (channelCount === 6) return '5.1';
  return 'unknown';
}

export function parseHlsAudioRenditions(manifest: string): HlsAudioRenditionInfo[] {
  const lines = manifest.split(/\\r?\\n/).map((line) => line.trim());
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
    const channelsMatch = channelsRaw ? /^(\\d+)(?:\\/(.*))?$/.exec(channelsRaw) : null;
    const channelCount = channelsMatch ? Number(channelsMatch[1]) : null;
    const hasJocMarker = Boolean(channelsMatch?.[2] && /JOC/i.test(channelsMatch[2]));
    renditions.push({
      groupId: attrs['GROUP-ID'] ?? '',
      name: attrs.NAME ?? '',
      uri: attrs.URI ?? null,
      channelsRaw,
      channelCount: Number.isInteger(channelCount) && channelCount! > 0 ? channelCount : null,
      layout: channelLayout(Number.isInteger(channelCount) && channelCount! > 0 ? channelCount : null),
      codec: null,
      hasJocMarker,
      default: attrs.DEFAULT === 'YES',
      autoselect: attrs.AUTOSELECT === 'YES',
    });
  }

  return renditions.map((rendition) => ({
    ...rendition,
    codec: audioGroups.get(rendition.groupId) ?? null,
  }));
}
