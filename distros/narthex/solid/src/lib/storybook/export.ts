// ---------------------------------------------------------------------------
// Browser-side encoders for downloadable media. The engine declares which
// formats a type supports via the `Exportable` typeclass; this file does
// the actual serialisation.
//
// PNG: render an Image record to a <canvas>, call .toBlob('image/png').
// WAV: write a 16-bit PCM WAV file from an AudioBuffer record.
//
// SVG / GIF / WebM / animated-PNG would land here later; v1 covers the
// two most-used formats.
// ---------------------------------------------------------------------------

type ColorRec = { r: number; g: number; b: number; a: number };
type ImageRec = { width: number; height: number; pixels: ColorRec[] };
type AmpRec = { l: number; r: number };
type AudioBufRec = { sampleRate: number; channels: number; samples: AmpRec[] };

function clampByte(n: unknown): number {
  const x = typeof n === "number" ? n : 0;
  if (x < 0) return 0;
  if (x > 255) return 255;
  return Math.round(x);
}

/** Encode an Image record as a PNG Blob using the browser canvas API. */
export function imageToPngBlob(img: ImageRec): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return resolve(null);
    const data = ctx.createImageData(img.width, img.height);
    for (let i = 0; i < img.width * img.height; i++) {
      const p = img.pixels[i] ?? { r: 0, g: 0, b: 0, a: 0 };
      data.data[i * 4 + 0] = clampByte(p.r);
      data.data[i * 4 + 1] = clampByte(p.g);
      data.data[i * 4 + 2] = clampByte(p.b);
      data.data[i * 4 + 3] = clampByte(p.a);
    }
    ctx.putImageData(data, 0, 0);
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/** Encode an AudioBuffer record as a 16-bit PCM WAV Blob.
 *
 * Format reference: standard RIFF/WAVE container, 44-byte header followed
 * by interleaved Int16 samples. Channel layout matches the buffer's
 * channels field (1 = mono, 2 = stereo); channel data is sourced from
 * each amplitude record's `l` and `r` fields. */
export function audioBufferToWavBlob(buf: AudioBufRec): Blob {
  const channels = Math.max(1, Math.min(2, buf.channels || 2));
  const sampleRate = buf.sampleRate;
  const sampleCount = buf.samples.length;
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = sampleCount * channels * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeAscii(view, 8, "WAVE");

  // fmt chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);                  // PCM fmt chunk size
  view.setUint16(20, 1, true);                   // PCM format = 1
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  view.setUint16(32, channels * bytesPerSample, true);              // block align
  view.setUint16(34, bytesPerSample * 8, true);                     // bits per sample

  // data chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleaved Int16 samples — clamp to [-1, 1] then scale.
  let off = headerSize;
  for (let i = 0; i < sampleCount; i++) {
    const s = buf.samples[i] ?? { l: 0, r: 0 };
    const l = Math.max(-1, Math.min(1, s.l));
    view.setInt16(off, Math.round(l * 32767), true);
    off += 2;
    if (channels > 1) {
      const r = Math.max(-1, Math.min(1, s.r));
      view.setInt16(off, Math.round(r * 32767), true);
      off += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    view.setUint8(offset + i, s.charCodeAt(i));
  }
}

/** Trigger a browser download for a Blob with the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke a tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
