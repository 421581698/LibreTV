class OpenJocPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000;
    this.queue = [];
    this.queuedFrames = 0;
    this.droppedFrames = 0;
    this.playing = false;
    this.started = false;
    this.underrunQuanta = 0;
    this.underrunSent = false;
    this.clockPtsSamples = null;
    this.expectedPtsSamples = null;
    this.pendingClockReanchor = false;
    this.maxQueueFrames = 48000;
    this.port.onmessage = event => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'start') {
        this.playing = true;
        return;
      }
      if (data.type === 'stop') {
        this.playing = false;
        return;
      }
      if (data.type === 'clear') {
        this.queue = [];
        this.queuedFrames = 0;
        this.expectedPtsSamples = this.clockPtsSamples;
        this.pendingClockReanchor = true;
        this.started = false;
        this.underrunQuanta = 0;
        this.underrunSent = false;
        this.port.postMessage({ type: 'queued', frames: 0 });
        return;
      }
      if (data.type === 'clock' && Number.isFinite(data.ptsSamples)) {
        this.clockPtsSamples = data.ptsSamples;
        if (this.expectedPtsSamples === null || this.pendingClockReanchor) {
          this.expectedPtsSamples = data.ptsSamples;
          this.pendingClockReanchor = false;
        }
        return;
      }
      if (data.type !== 'pcm' || !(data.samples instanceof Float32Array)) return;
      const samples = data.samples;
      if (samples.length === 0 || samples.length % 2 !== 0 || data.sampleRate !== 48000 ||
          data.channels !== 2 || !Number.isFinite(data.ptsSamples)) return;
      const frames = samples.length / 2;
      if (frames > this.maxQueueFrames || this.queuedFrames + frames > this.maxQueueFrames) {
        this.port.postMessage({ type: 'overflow', frames: this.queuedFrames, rejectedFrames: frames });
        return;
      }
      this.queue.push({ samples, offset: 0, ptsSamples: data.ptsSamples });
      this.queuedFrames += frames;
      this.port.postMessage({ type: 'queued', frames: this.queuedFrames });
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    left.fill(0);
    right.fill(0);
    if (!this.playing || this.clockPtsSamples === null || this.expectedPtsSamples === null) return true;

    // Correct small clock drift without discarding the packet timeline.
    // Large discontinuities stop the software lane and restore native audio;
    // silently reanchoring queued samples would skip or replay old content.
    const drift = this.clockPtsSamples - this.expectedPtsSamples;
    if (Math.abs(drift) > 2400) {
      this.playing = false;
      this.port.postMessage({ type: 'clock-discontinuity', driftSamples: drift });
      return true;
    }
    // Small correction is quantized to complete PCM samples.
    this.expectedPtsSamples += Math.round(Math.max(-120, Math.min(120, drift * 0.1)));

    let written = 0;
    let rendered = 0;
    while (written < left.length && this.queue.length > 0) {
      const chunk = this.queue[0];
      const chunkFrames = chunk.samples.length / 2;
      const chunkPts = chunk.ptsSamples + chunk.offset;
      const delta = chunkPts - this.expectedPtsSamples;

      // Keep the actual PCM sample positions aligned with the media clock.
      // Earlier tolerance logic emitted slightly future audio early and never
      // inserted silence for positive gaps; both can accumulate audible drift.
      // A future chunk must wait, with silence filling only the gap.
      if (delta > 0) {
        const silence = Math.min(left.length - written, Math.ceil(delta));
        written += silence;
        this.expectedPtsSamples += silence;
        if (written === left.length) break;
      }
      // Drop already-expired samples rather than playing them late.
      const remainingDelta = chunkPts - this.expectedPtsSamples;
      if (remainingDelta < 0) {
        const skip = Math.min(chunkFrames - chunk.offset, Math.ceil(-remainingDelta));
        chunk.offset += skip;
        this.queuedFrames -= skip;
        this.droppedFrames += skip;
        if (chunk.offset >= chunkFrames) this.queue.shift();
        continue;
      }

      const available = chunkFrames - chunk.offset;
      const count = Math.min(left.length - written, available);
      for (let i = 0; i < count; i += 1) {
        const source = (chunk.offset + i) * 2;
        left[written + i] = chunk.samples[source];
        right[written + i] = chunk.samples[source + 1];
      }
      chunk.offset += count;
      written += count;
      rendered += count;
      this.queuedFrames -= count;
      this.expectedPtsSamples += count;
      if (chunk.offset >= chunkFrames) this.queue.shift();
    }

    // The audio clock advances through every silent quantum as well as PCM.
    // Otherwise underruns and future-PTS gaps compound timing errors.
    this.expectedPtsSamples += left.length - written;
    if (rendered > 0) {
      this.underrunQuanta = 0;
      this.underrunSent = false;
      if (!this.started) {
        this.started = true;
        this.port.postMessage({ type: 'started' });
      }
    } else if (this.started && this.queue.length === 0) {
      this.underrunQuanta += 1;
      if (this.underrunQuanta >= 12 && !this.underrunSent) {
        this.underrunSent = true;
        this.port.postMessage({ type: 'underrun' });
      }
    }
    this.port.postMessage({ type: 'queued', frames: this.queuedFrames, droppedFrames: this.droppedFrames });
    return true;
  }
}

registerProcessor('openjoc-pcm', OpenJocPcmProcessor);
