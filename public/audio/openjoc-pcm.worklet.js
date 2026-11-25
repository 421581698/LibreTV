class OpenJocPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000;
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.droppedFrames = 0;
    this.port.onmessage = event => {
      const data = event.data;
      if (!data || data.type !== 'pcm' || !(data.samples instanceof Float32Array)) return;
      const samples = data.samples;
      if (samples.length === 0 || samples.length % 2 !== 0 || data.sampleRate !== 48000 || data.channels !== 2) return;
      const frames = samples.length / 2;
      if (frames > this.capacity) {
        this.droppedFrames += frames;
        return;
      }
      const overflow = Math.max(0, this.available + frames - this.capacity);
      if (overflow) {
        this.readIndex = (this.readIndex + overflow) % this.capacity;
        this.available -= overflow;
        this.droppedFrames += overflow;
      }
      for (let i = 0; i < frames; i += 1) {
        const index = (this.writeIndex + i) % this.capacity;
        this.left[index] = samples[i * 2];
        this.right[index] = samples[i * 2 + 1];
      }
      this.writeIndex = (this.writeIndex + frames) % this.capacity;
      this.available += frames;
      this.port.postMessage({ type: 'queued', frames: this.available, droppedFrames: this.droppedFrames });
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    const count = Math.min(left.length, this.available);
    for (let i = 0; i < count; i += 1) {
      const index = (this.readIndex + i) % this.capacity;
      left[i] = this.left[index];
      right[i] = this.right[index];
    }
    left.fill(0, count);
    right.fill(0, count);
    this.readIndex = (this.readIndex + count) % this.capacity;
    this.available -= count;
    return true;
  }
}

registerProcessor('openjoc-pcm', OpenJocPcmProcessor);
