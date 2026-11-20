class LibreTVSpatialChannelProbe extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lastChannels = -1;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const channels = input.length;

    if (channels !== this.lastChannels) {
      this.lastChannels = channels;
      this.port.postMessage({ channels });
    }

    for (let channel = 0; channel < output.length; channel += 1) {
      const destination = output[channel];
      const source = input[channel];
      if (source) destination.set(source);
      else destination.fill(0);
    }
    return true;
  }
}

registerProcessor('libretv-channel-probe', LibreTVSpatialChannelProbe);
