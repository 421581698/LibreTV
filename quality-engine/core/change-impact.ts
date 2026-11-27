export type ImpactArea =
  | "homepage"
  | "search"
  | "player"
  | "media"
  | "subtitle-audio"
  | "friday"
  | "navigation"
  | "api"
  | "quality-engine"
  | "unknown";

export interface ChangeImpact {
  areas: ImpactArea[];
  requiresBrowser: boolean;
  requiresMedia: boolean;
  requiresPhysicalIPhone: boolean;
  requiresPhysicalIPad: boolean;
  matchedPaths: string[];
}

const RULES: Array<{ area: ImpactArea; pattern: RegExp }> = [
  { area: "quality-engine", pattern: /^(quality-engine|testsprite|scripts\/quality-engine|\.github\/workflows\/quality-engine)/ },
  { area: "player", pattern: /(player|watch|cinema)/i },
  { area: "media", pattern: /(hls|mpegts|mux|mse|media|stream|demux|codec)/i },
  { area: "subtitle-audio", pattern: /(subtitle|caption|audio|jassub|ass\/)/i },
  { area: "friday", pattern: /(friday|assistant|speech|voice|tts|asr|vad)/i },
  { area: "search", pattern: /(search|douban|bangumi)/i },
  { area: "homepage", pattern: /(home|recommend|hot-list)/i },
  { area: "navigation", pattern: /(navigation|header|sidebar|router|layout)/i },
  { area: "api", pattern: /(^src\/app\/api\/|\/api\/)/i },
];

export function analyzeChangeImpact(paths: string[]): ChangeImpact {
  const areas = new Set<ImpactArea>();
  const matchedPaths: string[] = [];
  for (const path of paths) {
    let matched = false;
    for (const rule of RULES) {
      if (rule.pattern.test(path)) {
        areas.add(rule.area);
        matchedPaths.push(path);
        matched = true;
      }
    }
    if (!matched) areas.add("unknown");
  }
  const list = [...areas];
  const has = (...values: ImpactArea[]) => values.some((value) => areas.has(value));
  const mobileRelevant = has("player", "media", "subtitle-audio", "friday", "navigation");
  return {
    areas: list.length ? list : ["unknown"],
    requiresBrowser: has("homepage", "search", "player", "navigation", "friday", "media", "subtitle-audio"),
    requiresMedia: has("player", "media", "subtitle-audio"),
    requiresPhysicalIPhone: mobileRelevant,
    requiresPhysicalIPad: mobileRelevant,
    matchedPaths: [...new Set(matchedPaths)],
  };
}
