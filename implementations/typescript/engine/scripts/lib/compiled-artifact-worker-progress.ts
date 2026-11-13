/** Relay bounded stage progress while retaining exact stderr for diagnostics.
 * Worker stdout remains the single, strictly decoded artifact result record. */
export async function captureWorkerDiagnostics(
  stream: ReadableStream<Uint8Array>,
  report: (line: string) => void = (line) => console.error(line),
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let pending = "";
  let byteLength = 0;
  const line = (value: string) => {
    if (value.length > 4096) return;
    if (!/^\[compiled-(?:parser|resolver):progress\] /u.test(value)) return;
    const compile = /compile: (start|ready) — (\d+)\/(\d+)/u.exec(value);
    if (compile && !(compile[1] === "start" && compile[2] === "1")
      && !(compile[1] === "ready" && (Number(compile[2]) % 25 === 0 || compile[2] === compile[3]))) return;
    report(value);
  };
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const bytes = Uint8Array.from(next.value);
      chunks.push(bytes); byteLength += bytes.byteLength;
      pending += decoder.decode(bytes, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, end).replace(/\r$/u, ""));
        pending = pending.slice(end + 1);
      }
    }
    pending += decoder.decode();
    if (pending) line(pending);
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
