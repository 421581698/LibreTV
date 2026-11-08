export type PlaybackRecommendation = {
  title: string;
  year?: string;
  candidateId: string;
  sourceId: string;
  resolutionHeight: number | null;
  selectionBasis: "decoded-playback" | "source-probe" | "reachable-only";
  playbackSampleCount?: number | null;
  alternativeCount: number;
};

export type PlaybackQualityEvidence = {
  candidateId?: string;
  sourceId: string;
  title?: string;
  year?: string;
  resolutionHeight: number | null;
  decodedVideoHeight?: number | null;
  resolutionSource?: "decoded_playback" | "playlist_or_segment" | "unknown";
  playbackSampleCount?: number | null;
};

export type PlaybackSourceEvidence = {
  candidateId?: string;
  reachable: boolean;
};

/**
 * Re-ranks a completed recommendation list when the player contributes a new
 * decoded videoHeight. A decoded sample always outranks a manifest declaration;
 * equal decoded heights use the accumulated sample count as confidence.
 */
export function applyDecodedPlaybackEvidence(
  recommendations: PlaybackRecommendation[],
  qualityChecks: PlaybackQualityEvidence[],
  sourceChecks: PlaybackSourceEvidence[],
): PlaybackRecommendation[] {
  const next = [...recommendations];
  for (const item of qualityChecks) {
    const height = item.decodedVideoHeight ??
      (item.resolutionSource === "decoded_playback" ? item.resolutionHeight ?? undefined : undefined);
    if (!item.candidateId || !item.title || !height || height < 1) continue;
    const reachable = sourceChecks.some((source) =>
      source.candidateId === item.candidateId && source.reachable,
    );
    if (!reachable) continue;
    const index = next.findIndex((recommendation) =>
      recommendation.title === item.title && (recommendation.year ?? "") === (item.year ?? ""),
    );
    const existing = index >= 0 ? next[index] : undefined;
    const currentRank = existing?.selectionBasis === "decoded-playback" ? 2 :
      existing?.selectionBasis === "source-probe" ? 1 : existing ? 0 : -1;
    const sampleCount = item.playbackSampleCount ?? 1;
    const wins = !existing || currentRank < 2 ||
      (currentRank === 2 && (
        height > (existing.resolutionHeight ?? 0) ||
        (height === existing.resolutionHeight && sampleCount > (existing.playbackSampleCount ?? 0))
      ));
    if (!wins) continue;
    const recommendation: PlaybackRecommendation = {
      title: item.title,
      year: item.year,
      candidateId: item.candidateId,
      sourceId: item.sourceId,
      resolutionHeight: height,
      selectionBasis: "decoded-playback",
      playbackSampleCount: sampleCount,
      alternativeCount: existing?.alternativeCount ?? 0,
    };
    if (index >= 0) next[index] = recommendation;
    else next.push(recommendation);
  }
  return next;
}
