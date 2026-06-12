// Streaming recorder: ships small fixed frames (~0.5s) continuously.
// The backend accumulates them into an utterance, re-transcribes live for
// interim captions, and finalises on a pause. Keeping frames small here keeps
// the interim/endpoint latency low.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const r = sampleRate; // actual AudioContext rate (global in worklet scope)
    this._rate = r;
    this._buf = [];
    this._n = 0;
    this._target = Math.round(r * 0.5); // 0.5s transport frame
    this.port.postMessage({ type: "init", sampleRate: r });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    this._buf.push(new Float32Array(input[0]));
    this._n += input[0].length;

    if (this._n >= this._target) {
      const merged = new Float32Array(this._n);
      let o = 0;
      for (const b of this._buf) { merged.set(b, o); o += b.length; }
      this._buf = [];
      this._n = 0;
      this.port.postMessage(
        { type: "chunk", buffer: merged.buffer, sampleRate: this._rate },
        [merged.buffer]
      );
    }

    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
