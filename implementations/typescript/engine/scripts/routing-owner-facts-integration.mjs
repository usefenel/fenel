// C1/C2 controller. --check transpiles the child without importing the engine.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/routing-owner-facts-integration.ts", import.meta.url));
const source = await readFile(fixture, "utf8");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fixtureSha256 = sha(source);
const controllerSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
if (process.argv.includes("--check")) {
  const transpiled = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  console.log(JSON.stringify({ staticOnly: true, engineImported: false, fixtureSha256, controllerSha256,
    sourceBytes: Buffer.byteLength(source), transpiledBytes: Buffer.byteLength(transpiled) }));
  process.exit(0);
}
const orderArgument = process.argv.indexOf("--order");
const bootOrders = ["registry-first", "harness-first", "helper-first"];
const orders = orderArgument < 0 ? bootOrders : [process.argv[orderArgument + 1]];
if (orders.some(order => !bootOrders.includes(order))) throw new Error("Unknown --order");
const output = resolve(repo, ".tmp-diag/perf-20261103-followup", `owner-facts-integration-${new Date().toISOString().replace(/[:.]/g, "")}`);
const inside = relative(repo, output);
if (!inside || inside === ".." || inside.startsWith("..\\") || inside.startsWith("../") || isAbsolute(inside)) {
  throw new Error("Output escaped the repository");
}
await mkdir(output, { recursive: true });
const replay = process.env.FENEL_ENGINE_BODY_REPLAY || resolve(repo, "distros/narthex/solid/.engine-body-replay/seed.gz");
const results = [];
for (const order of orders) {
  const log = createWriteStream(resolve(output, `${order}.log`), { flags: "wx" });
  const args = ["--no-env-file", fixture, order, resolve(output, `${order}.json`)];
  const started = Date.now();
  const child = spawn(process.execPath, args, { cwd: repo, windowsHide: true,
    env: { ...process.env, FENEL_PARSER_LEGACY: "1", FENEL_ENGINE_BODY_REPLAY: replay }, stdio: ["ignore", "pipe", "pipe"] });
  let timeout = false;
  const timer = setTimeout(() => { timeout = true; child.kill(); }, 120000);
  child.stdout.on("data", bytes => { process.stdout.write(bytes); log.write(bytes); });
  child.stderr.on("data", bytes => { process.stderr.write(bytes); log.write(bytes); });
  const result = await new Promise((done, fail) => {
    child.on("error", fail);
    child.on("close", (exitCode, signal) => done({ exitCode, signal }));
  });
  clearTimeout(timer);
  await new Promise(done => log.end(done));
  results.push({ order, ...result, timeout, durationMs: Date.now() - started, childPid: child.pid,
    command: [process.execPath, ...args], replay, normalReplayAdmissionRequired: true });
  if (result.exitCode !== 0 || timeout) break;
}
const receipt = { schema: "fenel.routing-owner-facts-controller.v1", fixtureSha256, controllerSha256,
  perChildTimeoutMs: 120000, output, results };
await writeFile(resolve(output, "process-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ event: "controller-complete", output, results }));
process.exitCode = results.length === orders.length && results.every(result => result.exitCode === 0 && !result.timeout) ? 0 : 1;
