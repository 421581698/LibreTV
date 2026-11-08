import { describe, expect, it } from "vitest";
import { applyDecodedPlaybackEvidence, applyPlaybackFeedbackToWorkflow, type PlaybackRecommendation } from "./playback-feedback";
import { recordPlaybackEvidence } from "./movie-workflow";
import { TaskRuntime, type TaskEvent, type TaskEventStore } from "./task-runtime";

class MemoryStore implements TaskEventStore {
  private events = new Map<string, TaskEvent[]>();
  async append(event: TaskEvent) {
    const list = this.events.get(event.taskId) ?? [];
    list.push(event);
    this.events.set(event.taskId, list);
  }
  async read(taskId: string) {
    return [...(this.events.get(taskId) ?? [])];
  }
}

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


describe("player-to-Friday playback feedback integration", () => {
  it("routes a decoded player event into the live recommendation and persisted Agent audit", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    const initial = {
      sourceChecks: [{ candidateId: "alpha:arrival", reachable: true }],
      qualityChecks: [{
        candidateId: "alpha:arrival",
        sourceId: "alpha",
        title: "Arrival",
        status: "resolution_detected" as const,
        resolutionHeight: 2160,
        decodedVideoHeight: null,
        decodedResolutionHeight: null,
        sourceResolutionHeight: 2160,
        resolutionSource: "playlist_or_segment" as const,
      }],
      playbackRecommendations: [{
        title: "Arrival",
        candidateId: "alpha:arrival",
        sourceId: "alpha",
        resolutionHeight: 2160,
        selectionBasis: "source-probe" as const,
        alternativeCount: 0,
      }],
    };
    let visible = initial;
    let persisted: Promise<{ taskId: string }> | undefined;
    const playerEvents = new EventTarget();
    playerEvents.addEventListener("friday-player-quality", (event) => {
      const detail = (event as CustomEvent<{
        candidateId: string; sourceKey: string; vodId: string; height: number;
        playbackSampleCount: number; playbackMinHeight: number; playbackMaxHeight: number; observedAt: string;
      }>).detail;
      visible = applyPlaybackFeedbackToWorkflow(visible, detail);
      persisted = recordPlaybackEvidence({
        runtime,
        parentTaskId: "friday-parent.playback",
        evidence: {
          candidateId: detail.candidateId,
          sourceId: detail.sourceKey,
          vodId: detail.vodId,
          decodedHeight: detail.height,
          sampleCount: detail.playbackSampleCount,
          minHeight: detail.playbackMinHeight,
          maxHeight: detail.playbackMaxHeight,
          observedAt: detail.observedAt,
        },
      });
    });

    playerEvents.dispatchEvent(new CustomEvent("friday-player-quality", {
      detail: {
        candidateId: "alpha:arrival",
        sourceKey: "alpha",
        vodId: "arrival",
        height: 720,
        playbackSampleCount: 3,
        playbackMinHeight: 480,
        playbackMaxHeight: 1080,
        observedAt: "2026-11-08T12:00:00.000Z",
      },
    }));
    const audit = await persisted;

    expect(visible.qualityChecks?.[0]).toMatchObject({
      resolutionHeight: 720,
      decodedVideoHeight: 720,
      resolutionSource: "decoded_playback",
      playbackSampleCount: 3,
    });
    expect(visible.playbackRecommendations?.[0]).toMatchObject({
      candidateId: "alpha:arrival",
      resolutionHeight: 720,
      selectionBasis: "decoded-playback",
      playbackSampleCount: 3,
    });
    const auditEvents = await store.read(audit.taskId);
    expect(auditEvents.map((item) => item.type)).toEqual([
      "task.created", "task.started", "task.checkpoint", "task.succeeded",
    ]);
    expect(auditEvents[0].parentTaskId).toBe("friday-parent.playback");
  });
});
