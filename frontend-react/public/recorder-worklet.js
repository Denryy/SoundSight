// SoundSight AudioWorklet — захват аудио и нарезка на кадры ~0.5 с (ТЗ §6.5).
// Файл грузится как есть (AudioWorklet не поддерживает модули сборки),
// поэтому лежит в public/ и подключается через audioCtx.audioWorklet.addModule('/recorder-worklet.js').

const FRAME_SECONDS = 0.5; // ТЗ §6.3: ~0.5 с аудио на фрейм

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate — глобал в AudioWorkletGlobalScope, реальная частота AudioContext.
    this._actualRate = sampleRate;
    this._buffer = [];
    this._samples = 0;
    this._target = Math.round(this._actualRate * FRAME_SECONDS);
    // Сообщаем реальную частоту в основной поток для заголовка фрейма.
    this.port.postMessage({ type: "init", sampleRate: this._actualRate });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];
    this._buffer.push(new Float32Array(channel));
    this._samples += channel.length;

    if (this._samples >= this._target) {
      const merged = new Float32Array(this._samples);
      let offset = 0;
      for (const buf of this._buffer) {
        merged.set(buf, offset);
        offset += buf.length;
      }
      this._buffer = [];
      this._samples = 0;
      // Передаём буфер без копирования (transferable).
      this.port.postMessage(
        { type: "chunk", buffer: merged.buffer, sampleRate: this._actualRate },
        [merged.buffer]
      );
    }

    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
