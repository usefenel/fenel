// C1/C2 host tooling: transport compiler/diagnostic bytes through standard Node
// filesystem IO. Bun's Windows artifact writes can stall after creating a file.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const executable = fileURLToPath(import.meta.url);
const repository = fileURLToPath(new URL("../../", import.meta.url));

function scopedPath(path) {
  const target = resolve(path);
  const within = relative(repository, target);
  if (!within || within === ".." || within.startsWith("../") || within.startsWith("..\\") || isAbsolute(within)) {
    throw new Error("Artifact destination must be a file inside this repository");
  }
  return target;
}

async function bounded(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(message)), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

/** @param {string} destination @param {Uint8Array} bytes @param {{timeoutMs?: number}} [options] */
export async function writeVerifiedArtifact(destination, bytes, { timeoutMs = 30_000 } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Artifact bytes must be a Uint8Array");
  const target = scopedPath(destination);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const expected = { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
  const child = spawn("node", [executable, "--receive", target, temporary, String(expected.bytes), expected.sha256, String(timeoutMs)], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let stdout = "", stderr = "", timer, succeeded = false;
  const closed = new Promise(done => { child.once("close", done); });
  child.stdout.setEncoding("utf8").on("data", text => { stdout += text; });
  child.stderr.setEncoding("utf8").on("data", text => { stderr = (stderr + text).slice(-16_384); });
  const completed = new Promise((done, fail) => {
    child.once("error", fail);
    child.once("close", code => {
      if (code !== 0) fail(new Error(`Artifact writer exited ${code}: ${stderr.trim()}`));
      else {
        try { done(JSON.parse(stdout)); }
        catch { fail(new Error(`Artifact writer returned an unreadable receipt: ${stdout.slice(0, 1000)}`)); }
      }
    });
  });
  const streamed = pipeline(Readable.from((function* () {
    for (let offset = 0; offset < bytes.byteLength; offset += 65_536) yield bytes.subarray(offset, offset + 65_536);
  })()), child.stdin);
  const deadline = new Promise((_, fail) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error(`Artifact writer exceeded ${timeoutMs}ms: ${target}`));
    }, timeoutMs);
  });
  try {
    const [receipt] = await Promise.race([Promise.all([completed, streamed]), deadline]);
    if (receipt.bytes !== expected.bytes || receipt.sha256 !== expected.sha256 || receipt.path !== target) {
      throw new Error("Artifact writer receipt differs from the emitted bytes");
    }
    succeeded = true;
    return receipt;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await bounded(closed, 2000, `Artifact writer did not close after termination: ${temporary}`);
    if (!succeeded) await bounded(unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }),
      5000, `Could not remove failed artifact temporary file: ${temporary}`);
  }
}

async function receiveArtifact() {
  const target = scopedPath(process.argv[3]);
  const temporary = scopedPath(process.argv[4]);
  if (!temporary.startsWith(`${target}.tmp-`)) throw new Error("Artifact temporary file must belong to its destination");
  const expectedLength = Number(process.argv[5]);
  const expectedHash = process.argv[6];
  const timeoutMs = Number(process.argv[7]);
  let stage = "stdin", length = 0;
  const deadline = setTimeout(() => {
    console.error(`Artifact writer timed out during ${stage}`);
    process.exit(1);
  }, Math.max(1000, timeoutMs - 1000));
  try {
    await mkdir(dirname(target), { recursive: true });
    const incoming = createHash("sha256");
    const verify = new Transform({ transform(chunk, _encoding, done) {
      length += chunk.length;
      if (length > expectedLength) { done(new Error("Artifact stdin exceeds the emitted length")); return; }
      incoming.update(chunk);
      done(null, chunk);
    } });
    await pipeline(process.stdin, verify, createWriteStream(temporary, { flags: "wx" }));
    if (length !== expectedLength || incoming.digest("hex") !== expectedHash) throw new Error("Artifact stdin differs from the emitted bytes");
    stage = "read-back";
    const written = createHash("sha256");
    let writtenLength = 0;
    for await (const chunk of createReadStream(temporary)) { writtenLength += chunk.length; written.update(chunk); }
    if (writtenLength !== expectedLength || written.digest("hex") !== expectedHash) throw new Error("Written artifact differs from the emitted bytes");
    stage = "rename";
    await rename(temporary, target);
    process.stdout.write(JSON.stringify({ path: target, bytes: length, sha256: expectedHash }));
  } finally {
    clearTimeout(deadline);
    await unlink(temporary).catch(() => {});
  }
}

if (process.argv[2] === "--receive" && resolve(process.argv[1]) === executable) {
  await receiveArtifact().catch(error => { console.error(error); process.exitCode = 1; });
}
