/**
 * HLS audio rendition inspection.
 * Reads declared CHANNELS/CODECS metadata only. A JOC marker is metadata,
 * not proof that the browser decodes Dolby Atmos objects.
 */
export type AudioChannelLayout = 'mono' | 'stereo' | '5.1' | 'unknown';
export interface HlsAudioRenditionInfo {
  groupId: string; name: string; uri: string | null; channelsRaw: string | null;
  channelCount: number | null; layout: AudioChannelLayout; codec: string | null;
  hasJocMarker: boolean; default: boolean; autoselect: boolean;
}
function parseAttributeList(line: string): Record<string, string> {
  const colon = line.indexOf(':');
  const input = colon >= 0 ? line.slice(colon + 1) : line;
  const attributes: Record<string, string> = {};
  const expression = /([A-Z0-9-]+)=(\"(?:[^\"\\]|\\.)*\"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(input)) !== null) {
    const raw = match[2].trim();
    attributes[match[1]] = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).replace(/\\(["\\])/g, '$1') : raw;
  }
  return attributes;
}
function audioCodecFromCodecs(codecs?: string): string | null {
  if (!codecs) return null;
  // Match complete codec identifiers, not arbitrary prefixes. A loose prefix
  // check can mislabel malformed/unknown tokens (for example, `ac-30`) as a
  // supported Dolby codec and pollute the diagnostics HUD.
  const supportedAudioCodec = /^(?:mp4a\.[0-9a-f]{2}\.[0-9]+|ac-4(?:\.[0-9a-f]{2}){3}|ac-3|ec-3|opus|flac|alac|dtsc|dtsh|dtse|dtsx|mlpa|lpcm|iamf(?:\.[0-9a-z]+)?)$/i;
  return codecs.split(',').map((value) => value.trim())
    .find((value) => supportedAudioCodec.test(value)) ?? null;
}
function channelLayout(count: number | null): AudioChannelLayout {
  if (count === 1) return 'mono';
  if (count === 2) return 'stereo';
  return 'unknown';
}
function parseChannelDeclaration(raw: string | null): { channelCount: number | null; hasJocMarker: boolean } {
  const match = raw ? /^(\d+)(?:\/(.*))?$/.exec(raw) : null;
  const count = match ? Number(match[1]) : null;
  return {
    channelCount: Number.isInteger(count) && count! > 0 ? count : null,
    hasJocMarker: Boolean(match?.[2] && /JOC/i.test(match[2])),
  };
}
export interface HlsAudioTrackLike {
  id?: number; name?: string; groupId?: string; lang?: string; url?: string;
  channels?: string; audioCodec?: string; default?: boolean; autoselect?: boolean;
}
export function inspectHlsAudioTrack(track: HlsAudioTrackLike): HlsAudioRenditionInfo {
  const channelsRaw = track.channels ?? null;
  const parsed = parseChannelDeclaration(channelsRaw);
  const codec = audioCodecFromCodecs(track.audioCodec ?? undefined);
  const hasJocCodecMarker = Boolean(track.audioCodec && /(?:^|[-.,\s])joc(?:$|[-.,\s])/i.test(track.audioCodec));
  return {
    groupId: track.groupId ?? '', name: track.name ?? '', uri: track.url ?? null,
    channelsRaw, channelCount: parsed.channelCount, layout: channelLayout(parsed.channelCount),
    codec, hasJocMarker: parsed.hasJocMarker || hasJocCodecMarker,
    default: Boolean(track.default), autoselect: Boolean(track.autoselect),
  };
}
export function parseHlsAudioRenditions(manifest: string): HlsAudioRenditionInfo[] {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const audioGroups = new Map<string, Set<string>>();
  const audioGroupJocDeclarations = new Map<string, Set<boolean>>();
  const renditions: HlsAudioRenditionInfo[] = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributeList(line);
      if (attrs.AUDIO) {
        const codec = audioCodecFromCodecs(attrs.CODECS);
        if (codec) {
          const declared = audioGroups.get(attrs.AUDIO) ?? new Set<string>();
          declared.add(codec);
          audioGroups.set(attrs.AUDIO, declared);
        }
        const jocDeclarations = audioGroupJocDeclarations.get(attrs.AUDIO) ?? new Set<boolean>();
        jocDeclarations.add(Boolean(attrs.CODECS && /(?:^|[-.,\s])joc(?:$|[-.,\s])/i.test(attrs.CODECS)));
        audioGroupJocDeclarations.set(attrs.AUDIO, jocDeclarations);
      }
      continue;
    }
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = parseAttributeList(line);
    if (attrs.TYPE !== 'AUDIO') continue;
    const channelsRaw = attrs.CHANNELS ?? null;
    const parsed = parseChannelDeclaration(channelsRaw);
    renditions.push({
      groupId: attrs['GROUP-ID'] ?? '', name: attrs.NAME ?? '', uri: attrs.URI ?? null,
      channelsRaw, channelCount: parsed.channelCount, layout: channelLayout(parsed.channelCount),
      codec: null, hasJocMarker: parsed.hasJocMarker, default: attrs.DEFAULT === 'YES',
      autoselect: attrs.AUTOSELECT === 'YES',
    });
  }
  return renditions.map((rendition) => {
    const declaredCodecs = audioGroups.get(rendition.groupId);
    // A GROUP-ID can be referenced by multiple variants. Only expose a codec
    // when every observed declaration for that group agrees; otherwise fail closed.
    const codec = declaredCodecs?.size === 1 ? [...declaredCodecs][0] : null;
    const jocDeclarations = audioGroupJocDeclarations.get(rendition.groupId);
    const hasConsistentJocDeclaration = jocDeclarations?.size === 1 && jocDeclarations.has(true);
    return {
      ...rendition,
      codec,
      hasJocMarker: rendition.hasJocMarker || Boolean(hasConsistentJocDeclaration),
    };
  });
}
