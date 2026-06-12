// Сборка бинарного аудио-фрейма для WebSocket (ТЗ §6.3).
//
// Структура кадра:
//   [0–3] uint32 BE = 0x4C414100  ("LAA\0")
//   [4–7] uint32 LE = sampleRate  (реальная частота AudioContext)
//   [8+ ] float32 LE = моно-PCM   (сами сэмплы)

export const LAA_MAGIC = 0x4c414100; // "LAA\0"

/** Оборачивает PCM-буфер (Float32 сэмплы) в бинарный кадр протокола soundsight. */
export function buildAudioFrame(pcm: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const header = new ArrayBuffer(8);
  const v = new DataView(header);
  v.setUint32(0, LAA_MAGIC, false); // Big-Endian
  v.setUint32(4, sampleRate, true); // Little-Endian

  const frame = new Uint8Array(8 + pcm.byteLength);
  frame.set(new Uint8Array(header), 0);
  frame.set(new Uint8Array(pcm), 8);
  return frame.buffer;
}

/** URL WebSocket-эндпоинта субтитров: wss на https, иначе ws (ТЗ §6.3). */
export function subtitlesWsUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws/subtitles`;
}
