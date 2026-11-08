import { describe, expect, it } from "vitest";
import { applyDecodedPlaybackEvidence, type PlaybackRecommendation } from "./playback-feedback";

const sourceProbe: PlaybackRecommendation = {
  title: "Arrival",
  candidateId: "source-b:1",
  sourceId: "source-b",
  resolutionHeight: 2160,
  selectionBasis: "source-probe",
  alternativeCount: 1,
};

describe("applyDecodedPlaybackEvidence", () => {
  it("prefers decoded playback over a higher manifest resolution", () => {
    const result = applyDecodedPlaybackEvidence([sourceProbe], [{
      candidateId: "source-a:1",
      sourceId: "source-a",
      title: "Arrival",
      resolutionHeight: 720,
      decodedVideoHeight: 720,
      resolutionSource: "decoded_playback",
      playbackSampleCount: 2,
    }], [{ candidateId: "source-a:1", reachable: true }]);
    expect(result[0]).toMatchObject({
      candidateId: "source-a:1",
      resolutionHeight: 720,
      selectionBasis: "decoded-playback",
      playbackSampleCount: 2,
    });
  });

  it("uses sample count to break ties between equal decoded heights", () => {
    const existing: PlaybackRecommendation = {
      ...sourceProbe,
      candidateId: "source-a:1",
      sourceId: "source-a",
      resolutionHeight: 1080,
      selectionBasis: "decoded-playback",
      playbackSampleCount: 1,
    };
    const result = applyDecodedPlaybackEvidence([existing], [{
      candidateId: "source-b:1",
      sourceId: "source-b",
      title: "Arrival",
      resolutionHeight: 1080,
      decodedVideoHeight: 1080,
      resolutionSource: "decoded_playback",
      playbackSampleCount: 4,
    }], [{ candidateId: "source-b:1", reachable: true }]);
    expect(result[0]).toMatchObject({ candidateId: "source-b:1", playbackSampleCount: 4 });
  });

  it("does not promote unreachable candidates", () => {
    const result = applyDecodedPlaybackEvidence([sourceProbe], [{
      candidateId: "source-a:1",
      sourceId: "source-a",
      title: "Arrival",
      resolutionHeight: 2160,
      decodedVideoHeight: 2160,
      resolutionSource: "decoded_playback",
    }], [{ candidateId: "source-a:1", reachable: false }]);
    expect(result).toEqual([sourceProbe]);
  });

  it("does not mix different release years with the same title", () => {
    const result = applyDecodedPlaybackEvidence([{
      ...sourceProbe,
      year: "2021",
    }], [{
      candidateId: "source-a:1",
      sourceId: "source-a",
      title: "Dune",
      year: "1984",
      resolutionHeight: 720,
      decodedVideoHeight: 720,
      resolutionSource: "decoded_playback",
    }], [{ candidateId: "source-a:1", reachable: true }]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.year)).toEqual(["2021", "1984"]);
  });
});
