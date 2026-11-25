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
        this.started = false;
        this.underrunQuanta = 0;
        this.underrunSent = false;
        this.port.postMessage({ type: 'queued', frames: 0 });
        return;
      }
      if (data.type === 'clock' && Number.isFinite(data.ptsSamples)) {
        this.clockPtsSamples = data.ptsSamples;
        if (this.expectedPtsSamples === null) this.expectedPtsSamples = data.ptsSamples;
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

    // Follow the video media clock gently. A large seek/discontinuity reanchors
    // the queue; small drift is corrected gradually to avoid audible jumps.
    const drift = this.clockPtsSamples - this.expectedPtsSamples;
    if (Math.abs(drift) > 2400) this.expectedPtsSamples = this.clockPtsSamples;
    else this.expectedPtsSamples += Math.max(-120, Math.min(120, drift * 0.1));

    let written = 0;
    while (written < left.length && this.queue.length > 0) {
      const chunk = this.queue[0];
      const chunkFrames = chunk.samples.length / 2;
      const chunkPts = chunk.ptsSamples + chunk.offset;
      const delta = chunkPts - this.expectedPtsSamples;

      // Do not play future audio early. Drop late audio only beyond the 20 ms tolerance.
      if (delta > 960) break;
      if (delta < -960) {
        const skip = Math.min(chunkFrames - chunk.offset, Math.ceil(-delta));
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
      this.queuedFrames -= count;
      this.expectedPtsSamples += count;
      if (chunk.offset >= chunkFrames) this.queue.shift();
    }

    if (written > 0) {
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
