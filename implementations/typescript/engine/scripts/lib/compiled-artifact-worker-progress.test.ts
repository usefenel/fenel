import { expect, test } from "bun:test";
import { captureWorkerDiagnostics } from "./compiled-artifact-worker-progress";

test("worker stage progress is visible before exit while exact diagnostics remain intact", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const reports: string[] = [];
  let seen!: () => void;
  const firstReport = new Promise<void>((resolve) => { seen = resolve; });
  const capturing = captureWorkerDiagnostics(stream, (line) => { reports.push(line); seen(); });
  const start = "[compiled-parser:progress] imports: étape ready\n";
  const bytes = new TextEncoder().encode(start);
  const accent = bytes.indexOf(0xc3);
  controller.enqueue(bytes.slice(0, accent + 1));
  controller.enqueue(bytes.slice(accent + 1));
  await firstReport;
  expect(reports).toEqual([start.trimEnd()]);
  const rest = [
    "ordinary diagnostic stays captured only",
    "[compiled-parser:progress] compile: start — 1/27 engine:a",
    "[compiled-parser:progress] compile: ready — 2/27 engine:b",
    "[compiled-parser:progress] compile: ready — 25/27 engine:y",
    "[compiled-parser:progress] compile: ready — 27/27 engine:z",
    "[compiled-parser:progress] final stage",
  ].join("\n");
  controller.enqueue(new TextEncoder().encode(rest));
  controller.close();
  expect(new TextDecoder().decode(await capturing)).toBe(start + rest);
  expect(reports).toEqual([
    start.trimEnd(),
    "[compiled-parser:progress] compile: start — 1/27 engine:a",
    "[compiled-parser:progress] compile: ready — 25/27 engine:y",
    "[compiled-parser:progress] compile: ready — 27/27 engine:z",
    "[compiled-parser:progress] final stage",
  ]);
});
