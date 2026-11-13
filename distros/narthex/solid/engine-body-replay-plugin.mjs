// S1b — browser wiring of the engine-body replay artifact (design/tcb-ledger.md
// row engine.memo.engine-body-replay; host build glue under the S1 approval).
//
// Production builds and the dev server. The authoring catalogue worker imports
// `virtual:fenel-engine-body-replay`; this plugin answers it with the pin
//   { artifactUrl, artifactSha256, textDigest, sourceEpoch }
// computed HERE from the tree being bundled, never copied from the recorder's
// stamp:
//   - sourceEpoch: `computeEngineBodyReplaySourceEpoch` (the artifact-bytes.ts
//     universe plus the artifact tool files) captured at the client build's
//     START, and again at its END (after every worker sub-build, in
//     generateBundle): a different digest, or a hashed file dated after the
//     build started, FAILS the build (the bundle may hold other bytes than the
//     ones the epoch names);
//   - the artifact (recorded by
//     implementations/typescript/engine/scripts/record-engine-body-replay.ts)
//     is admitted only when its recorder integrity stamp matches its bytes and
//     its header names that same epoch; its gzip bytes
//     are emitted as a content-named asset whose SHA-256 is `artifactSha256`
//     and `textDigest` is the plugin's own digest of the decompressed text,
//     decoded exactly as the browser decodes it (`strictArtifactText`: one
//     gzip member, nothing after it, fatal UTF-8, no byte order mark), so
//     those bytes determine that text. The worker's engine checks the SHA-256
//     of the exact bytes it decompressed against `artifactSha256` (the
//     `bytes-digest` pin), or, for a malformed `artifactSha256`, the text
//     digest after DecompressionStream.
// Without an admissible artifact the module is `undefined`: the artifact is
// OFF (the engine refuses an undefined epoch). On the dev server the epoch is
// bound once at server start and the artifact switches off for the server's
// life at the first change in the universe (see engineBodyReplayPlugins).
//
// The artifact source is a RECORDED FILE (simplest sound option; the umbrella
// regeneration phase is deferred): `FENEL_ENGINE_BODY_REPLAY_ARTIFACT`, default
// `distros/narthex/solid/.engine-body-replay/seed.gz` (gitignored), written by
//   bun implementations/typescript/engine/scripts/record-engine-body-replay.ts \
//     distros/narthex/solid/.engine-body-replay/seed.gz seed
// A missing or stale file only switches the artifact off (a build warning).
//
// The worker half also checks the emitted worker graph: the authoring
// catalogue worker's entry chunk must statically load nothing but the
// Proxy-tracking install and its inert state leaf (and bundler runtime), so it
// evaluates before any engine module; anything else fails the build.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";
import { computeEngineBodyReplaySourceEpoch, ENGINE_BODY_REPLAY_TOOL_FILES } from "../../../implementations/typescript/engine/scripts/lib/engine-body-replay-epoch.ts";
import { REPOSITORY_BYTE_UNIVERSE } from "../../../implementations/typescript/engine/scripts/lib/artifact-bytes.ts";

export const ENGINE_BODY_REPLAY_MODULE = "virtual:fenel-engine-body-replay";
const RESOLVED = `\0${ENGINE_BODY_REPLAY_MODULE}`;
const ARTIFACT_SCHEMA = "fenel.engine-body-replay.v1";
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const defaultArtifact = fileURLToPath(new URL("./.engine-body-replay/seed.gz", import.meta.url));

/** The worker entries whose static graph must start with the install. */
export const TRACKED_WORKER_ENTRIES = Object.freeze(["src/lib/expression-runner/authoring-catalog.worker.ts"]);
const INSTALL_MODULE = "implementations/typescript/engine/src/proxy-tracking-install.ts";
const TRACKING_STATE_MODULE = "implementations/typescript/engine/src/proxy-tracking-state.ts";

/** SHA-256 of a string's UTF-16LE code units (engine `sha256OfEncoding`). */
export function encodingDigest(text) {
  return createHash("sha256").update(Buffer.from(text, "utf16le")).digest("hex");
}

/**
 * The artifact text exactly as a browser obtains it from these bytes
 * (`DecompressionStream("gzip")` then `Response.text()`), or a throw. The
 * browser decodes ONE gzip member and fails on any trailing byte, while Node's
 * gunzip concatenates further members; its `Response.text()` strips a leading
 * byte order mark and replaces malformed UTF-8, while `Buffer#toString` keeps
 * the mark and replaces differently. So: exactly one RFC 1952 member (header,
 * one deflate stream, a CRC-32 and size trailer that match) and nothing after
 * it, decoded as fatal UTF-8 with the mark kept (`ignoreBOM: true`) and then
 * refused. Valid UTF-8 without a leading mark decodes to the same text in both
 * (1c, engine.memo.engine-body-replay "Browser pin by integrity").
 */
export function strictArtifactText(gzip) {
  const bytes = gzip instanceof Uint8Array ? gzip : new Uint8Array(gzip);
  const fail = reason => { throw new Error(`not a single-member gzip artifact: ${reason}`); };
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) fail("no gzip header");
  if (bytes[2] !== 8) fail("not deflate");
  const flags = bytes[3];
  if (flags & 0xe0) fail("reserved header flags");
  let at = 10;
  if (flags & 4) {
    if (at + 2 > bytes.length) fail("truncated extra field");
    at += 2 + (bytes[at] | (bytes[at + 1] << 8));
  }
  for (const flag of [8, 16]) {
    if (!(flags & flag)) continue;
    const end = bytes.indexOf(0, at);
    if (end < 0) fail("unterminated header string");
    at = end + 1;
  }
  if (flags & 2) {
    if (at + 2 > bytes.length) fail("truncated header CRC");
    if ((crc32(bytes.subarray(0, at)) & 0xffff) !== (bytes[at] | (bytes[at + 1] << 8))) fail("header CRC differs");
    at += 2;
  }
  if (at + 8 > bytes.length) fail("truncated");
  let inflated;
  try { inflated = inflateRawSync(bytes.subarray(at), { info: true }); } catch (error) { fail(`deflate stream (${error?.message ?? error})`); }
  const { buffer: data, engine } = inflated;
  // The raw inflater stops at the end of the deflate stream; what it consumed
  // locates the trailer, which must be the last 8 bytes.
  if (at + engine.bytesWritten + 8 !== bytes.length) fail("bytes after the first member (another member or trailing data)");
  const trailer = Buffer.from(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8);
  if (crc32(data) !== trailer.readUInt32LE(0)) fail("CRC-32 differs");
  if ((data.length >>> 0) !== trailer.readUInt32LE(4)) fail("size differs");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); } catch { throw new Error("the artifact is not valid UTF-8"); }
  if (text.charCodeAt(0) === 0xfeff) throw new Error("the artifact starts with a byte order mark");
  return text;
}

const normalized = id => id.split("?")[0].replaceAll("\\", "/");
const bundlerRuntime = id => id.startsWith("\0") && /rolldown|runtime|vite\//.test(id);

/**
 * Check one worker build's output: every tracked entry chunk's STATIC import
 * closure holds only the entry, the install, its import-free state leaf and
 * bundler runtime helpers. Their exact static edges and emitted order preserve
 * installation before the deferred engine graph.
 */
export function checkTrackedWorkerEntries(bundle, getModuleInfo) {
  const chunks = Object.values(bundle).filter(item => item.type === "chunk");
  const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const problems = [];
  const checked = [];
  for (const entry of chunks) {
    const facade = entry.facadeModuleId && normalized(entry.facadeModuleId);
    if (!entry.isEntry || !facade || !TRACKED_WORKER_ENTRIES.some(path => facade.endsWith(`/distros/narthex/solid/${path}`))) continue;
    const closure = [], stack = [entry.fileName], seen = new Set();
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const chunk = byFile.get(file);
      if (!chunk) { problems.push(`${facade}: statically imported chunk ${file} is missing`); continue; }
      closure.push(chunk);
      stack.push(...chunk.imports);
    }
    const modules = closure.flatMap(chunk => chunk.moduleIds.map(normalized));
    const install = modules.filter(id => id.endsWith(`/${INSTALL_MODULE}`));
    const state = modules.filter(id => id.endsWith(`/${TRACKING_STATE_MODULE}`));
    const others = modules.filter(id => id !== facade && !id.endsWith(`/${INSTALL_MODULE}`)
      && !id.endsWith(`/${TRACKING_STATE_MODULE}`) && !bundlerRuntime(id));
    if (install.length !== 1) problems.push(`${facade}: the Proxy-tracking install module is not in the entry's static graph`);
    if (state.length !== 1) problems.push(`${facade}: the Proxy-tracking state leaf must occur exactly once in the entry's static graph`);
    if (others.length) problems.push(`${facade}: the entry statically loads ${others.slice(0, 5).join(", ")}${others.length > 5 ? ", ..." : ""} — only the install and its state leaf may precede the dynamic import`);
    if (install.length === 1 && state.length === 1) {
      if (state[0] !== install[0].replace(/proxy-tracking-install\.ts$/, "proxy-tracking-state.ts")) {
        problems.push(`${facade}: the install and state leaf come from different engine copies`);
      }
      const expected = new Map([[facade, [install[0]]], [install[0], [state[0]]], [state[0], []]]);
      for (const [id, imports] of expected) {
        const info = getModuleInfo?.(id);
        if (!info || !Array.isArray(info.importedIds) || !Array.isArray(info.dynamicallyImportedIds)
          || JSON.stringify(info.importedIds.map(normalized)) !== JSON.stringify(imports)
          || id !== facade && info.dynamicallyImportedIds.length !== 0) {
          problems.push(`${facade}: unexpected Proxy-tracking bootstrap dependencies for ${id}`);
        }
      }
      const order = new Map([[state[0], 0], [install[0], 1], [facade, 2]]);
      for (const chunk of closure) {
        const positions = chunk.moduleIds.map(normalized).filter(id => order.has(id)).map(id => order.get(id));
        if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
          problems.push(`${facade}: the state leaf and install module do not evaluate first in ${chunk.fileName}`);
        }
      }
    }
    if (!entry.dynamicImports.length) problems.push(`${facade}: the entry has no dynamic import of the real worker`);
    checked.push({ entry: entry.fileName, staticChunks: closure.map(chunk => chunk.fileName), modules, dynamicImports: [...entry.dynamicImports] });
  }
  return { problems, checked };
}

/**
 * Engine or Fenel source modules of a bundle that do NOT come from the hashed
 * tree (`repositoryRoot`): a `node_modules/@fenel/*` path the resolver did not
 * follow, or an engine/Fenel file of another checkout (a worktree whose
 * workspace links point into the main checkout, or a nested checkout below
 * the repository root). Only this checkout's engine and Fenel source roots
 * belong to its epoch; sharing a repository-wide prefix is insufficient.
 */
export function foreignSourceModules(bundle, repositoryRoot) {
  const root = normalized(repositoryRoot).replace(/\/?$/, "/").toLowerCase();
  const engineRoot = `${root}implementations/typescript/engine/`;
  const fenelRoot = `${root}fenel/`;
  const ids = new Set(Object.values(bundle).filter(item => item.type === "chunk").flatMap(chunk => chunk.moduleIds.map(normalized)));
  return [...ids].filter(id => {
    if (id.startsWith("\0")) return false;
    const path = id.toLowerCase();
    return path.includes("/node_modules/@fenel/")
      || (path.includes("/implementations/typescript/engine/") && !path.startsWith(engineRoot))
      || (path.endsWith(".fenel") && !path.startsWith(fenelRoot));
  });
}


/** The epoch universe as repository-relative paths for the dev watcher.
 * Admission reuses the exact epoch hasher, including additions and deletions. */
export function replayUniverse(repositoryRoot) {
  const excluded = new Set(REPOSITORY_BYTE_UNIVERSE.exclusions);
  const roots = REPOSITORY_BYTE_UNIVERSE.recursiveRoots.map(root => `${root}/`);
  const files = new Set([...REPOSITORY_BYTE_UNIVERSE.exactFiles, ...ENGINE_BODY_REPLAY_TOOL_FILES]);
  const rootPath = normalized(repositoryRoot).replace(/\/?$/, "/");
  const relative = absolute => {
    const path = normalized(absolute);
    return path.toLowerCase().startsWith(rootPath.toLowerCase()) ? path.slice(rootPath.length) : undefined;
  };
  const contains = absolute => {
    const path = relative(absolute);
    return path !== undefined && !excluded.has(path) && (files.has(path) || roots.some(root => path.startsWith(root)));
  };
  const watched = [...REPOSITORY_BYTE_UNIVERSE.recursiveRoots, ...files].map(path => join(repositoryRoot, path));
  return { contains, watched };
}

/**
 * Metadata fingerprint of the epoch universe (same roots, exact files, tool
 * files and exclusions as the epoch hasher): every path with its size, file
 * id and modification/change times in nanoseconds. Non-blocking, and reads no
 * file contents. Captured BEFORE the content epoch at dev start, so equality
 * later means no universe file was written, replaced, added or deleted since
 * the bytes that epoch hashed were read: any write moves the change time, and
 * a replacement also moves the file id. `latestMtimeMs` mirrors the epoch's.
 * Throws on an unreadable path or a non-regular file, like the hasher.
 */
export async function replayUniverseFingerprint(repositoryRoot) {
  const excluded = new Set(REPOSITORY_BYTE_UNIVERSE.exclusions);
  const paths = [];
  const walk = async relative => {
    const entries = await readdir(join(repositoryRoot, relative), { withFileTypes: true });
    await Promise.all(entries.map(async entry => {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) { if (!excluded.has(child)) paths.push(child); }
      else throw new Error(`engine-body-replay fingerprint: not a regular file: ${child}`);
    }));
  };
  await Promise.all(REPOSITORY_BYTE_UNIVERSE.recursiveRoots.map(walk));
  for (const file of [...REPOSITORY_BYTE_UNIVERSE.exactFiles, ...ENGINE_BODY_REPLAY_TOOL_FILES]) if (!excluded.has(file)) paths.push(file);
  paths.sort();
  let latestMtimeMs = 0;
  const rows = await Promise.all(paths.map(async path => {
    const stats = await stat(join(repositoryRoot, path), { bigint: true });
    if (!stats.isFile()) throw new Error(`engine-body-replay fingerprint: not a regular file: ${path}`);
    latestMtimeMs = Math.max(latestMtimeMs, Number(stats.mtimeMs));
    return `${path}\0${stats.size}\0${stats.ino}\0${stats.mtimeNs}\0${stats.ctimeNs}`;
  }));
  return { digest: createHash("sha256").update(rows.join("\n")).digest("hex"), latestMtimeMs, fileCount: rows.length };
}

/**
 * The content epoch computed in a child Bun process, so the dev server keeps
 * serving during the full read (minutes on a busy disk). Same hasher as the
 * synchronous path; any failure rejects.
 */
export function computeEpochInChild(repositoryRoot) {
  const helper = fileURLToPath(new URL("../../../implementations/typescript/engine/scripts/lib/engine-body-replay-epoch.ts", import.meta.url));
  const script = `const { computeEngineBodyReplaySourceEpoch } = await import(${JSON.stringify(helper.replaceAll("\\", "/"))});`
    + ` process.stdout.write(JSON.stringify(computeEngineBodyReplaySourceEpoch(${JSON.stringify(repositoryRoot)})));`;
  return new Promise((resolve, reject) => {
    execFile("bun", ["--no-env-file", "-e", script], { cwd: repositoryRoot, maxBuffer: 1 << 20, windowsHide: true, timeout: 180_000 }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stderr: stderr.slice(0, 1000) }));
      try {
        const epoch = JSON.parse(stdout);
        if (typeof epoch?.digest !== "string" || !/^[0-9a-f]{64}$/.test(epoch.digest) || typeof epoch.latestMtimeMs !== "number") throw new Error("malformed epoch");
        resolve(epoch);
      } catch (cause) { reject(new Error(`Unreadable replay epoch child output: ${JSON.stringify(stdout.slice(0, 256))}; stderr: ${stderr.slice(0, 1000)}`, { cause })); }
    });
  });
}

/**
 * `{ main, worker }`: `main` goes into the app's plugins (it owns the epoch
 * capture, the asset and the dev-server binding), `worker()` into
 * `worker.plugins` (it answers the virtual module in worker builds and checks
 * the emitted worker entry graph). They share one state.
 *
 * Dev server (serve mode): the epoch is computed once, when the server
 * starts, in a child process after a metadata fingerprint of the same
 * universe; the artifact is served from memory under `${base}__fenel/` and the
 * pin carries a `statusUrl`. The artifact switches OFF for the server's life
 * (no re-binding) as soon as the watcher reports a change in the universe,
 * and the status answer, which the worker boot reads after its whole module
 * graph has loaded and before installing, runs a check that starts after the
 * request: the metadata fingerprint again (sizes, file ids, modification and
 * change times; no contents), compared with the one captured before the
 * startup epoch. It never blocks the server. Since owner decision B
 * (2026-10-30) the status no longer recomputes the content epoch (~20 s per
 * worker boot): a worker that loaded bytes written by any ordinary writer
 * never installs, even before watcher delivery; only a writer forging both
 * change times and file ids escapes the dev check.
 */
export function engineBodyReplayPlugins(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? repository;
  const artifactPath = options.artifactPath ?? (process.env.FENEL_ENGINE_BODY_REPLAY_ARTIFACT || defaultArtifact);
  const epochOf = options.computeEpoch ?? computeEngineBodyReplaySourceEpoch;
  // Dev server: the startup content epoch off the event loop, and a metadata
  // fingerprint for the status rechecks (see replayUniverseFingerprint).
  const epochOfAsync = options.computeEpochAsync
    ?? (options.computeEpoch ? async root => options.computeEpoch(root) : computeEpochInChild);
  const fingerprintOf = options.fingerprint ?? replayUniverseFingerprint;
  const universe = options.universe ?? replayUniverse(repositoryRoot);
  const now = options.now ?? Date.now;
  const state = { command: "serve", base: "/", assetsDir: "assets", started: undefined, pin: undefined, off: undefined,
    workerChecks: [], served: undefined, ready: undefined, invalidate: () => {}, reportCheckFailure: () => {} };

  /** Bind the epoch and admit the recorded artifact; `warn` reports why not. */
  const bind = warn => {
    const startedAt = now();
    return admit(startedAt, epochOf(repositoryRoot), undefined, warn);
  };
  /** Dev start: fingerprint first, then the content epoch, both non-blocking. */
  const bindAsync = async warn => {
    const startedAt = now();
    const fingerprint = await fingerprintOf(repositoryRoot);
    return admit(startedAt, await epochOfAsync(repositoryRoot), fingerprint, warn);
  };
  const admit = (startedAt, epoch, fingerprint, warn) => {
    state.started = { at: startedAt, epoch, fingerprint };
    const off = reason => { state.off = reason; warn(`engine-body replay artifact OFF: ${reason}`); };
    if (fingerprint && fingerprint.latestMtimeMs > startedAt) return off("a hashed source file is dated after the start");
    if (epoch.latestMtimeMs > startedAt) return off("a hashed source file is dated after the start");
    if (!existsSync(artifactPath)) return off(`no recorded artifact at ${artifactPath}`);
    let gzip, text, stamp;
    try {
      gzip = readFileSync(artifactPath);
      stamp = JSON.parse(readFileSync(`${artifactPath}.stamp.json`, "utf8"));
    } catch { return off("the recorded artifact or its integrity stamp is unreadable"); }
    const artifactSha256 = createHash("sha256").update(gzip).digest("hex");
    if (stamp?.schema !== "fenel.engine-body-replay.stamp.v1" || stamp.artifactSha256 !== artifactSha256) {
      return off("the recorded artifact differs from its recorder integrity stamp");
    }
    try {
      text = strictArtifactText(gzip);
    } catch (error) { return off(`the recorded artifact is unreadable (${error instanceof Error ? error.message : String(error)})`); }
    let header;
    try { header = JSON.parse(text.slice(0, text.indexOf("\n"))); } catch { return off("the recorded artifact has no header"); }
    if (header?.schema !== ARTIFACT_SCHEMA) return off("the recorded artifact has another schema");
    if (header.sourceEpoch !== epoch.digest) return off(`the artifact was recorded from other source bytes (${String(header.sourceEpoch).slice(0, 12)}…, this tree ${epoch.digest.slice(0, 12)}…): re-record it`);
    const textDigest = encodingDigest(text);
    if (stamp.textDigest !== textDigest || stamp.sourceEpoch !== epoch.digest || stamp.keyFormat !== header.keyFormat) {
      return off("the recorded artifact metadata differs from its recorder integrity stamp");
    }
    return { gzip, artifactSha256, textDigest, sourceEpoch: epoch.digest };
  };
  const switchOff = reason => {
    if (state.off === undefined) state.off = reason;
    if (state.pin === undefined) return;
    state.pin = undefined;
    state.served = undefined;
    state.invalidate();
  };
  const moduleText = async () => {
    if (state.command === "serve") await state.ready;
    return `export default ${state.pin && state.off === undefined ? `Object.freeze(${JSON.stringify(state.pin)})` : "undefined"};\n`;
  };
  const virtual = {
    resolveId(id) { if (id === ENGINE_BODY_REPLAY_MODULE) return RESOLVED; },
    load(id) { if (id === RESOLVED) return moduleText(); },
  };
  // One check: the metadata fingerprint only, compared with the one captured
  // BEFORE the startup content epoch (owner decision B, 2026-10-30: the
  // content rehash took ~20 s on the critical path of every worker boot). Any
  // ordinary write, save, checkout, copy or replacement moves a change time
  // or a file id; only a writer that forges both escapes, which is outside
  // the dev threat model (residual stated in design/tcb-ledger.md). Production
  // builds still hash bytes at build start and end. A changed or later-dated
  // source retires the pin; a check that could not finish (an unreadable
  // file) proves nothing either way, so it refuses only the requests waiting
  // on it and the next request runs a fresh check. It answers that refusal,
  // or undefined.
  const runCheck = async () => {
    try {
      const current = await fingerprintOf(repositoryRoot);
      if (current.digest !== state.started.fingerprint.digest || current.latestMtimeMs > state.started.at) {
        switchOff("a source file changed since the dev server started");
      }
    } catch (error) {
      state.reportCheckFailure(`engine-body replay metadata check failed: ${JSON.stringify({
        name: error?.name, message: error?.message ?? String(error), code: error?.code,
        syscall: error?.syscall, path: error?.path, killed: error?.killed, signal: error?.signal, stderr: error?.stderr,
      })}`);
      return "the source files could not be checked";
    }
    return undefined;
  };
  // An answer must come from a check that STARTED after its request arrived:
  // the running check may have read files before the asking worker loaded
  // newer bytes. Requests arriving during a check share the next one.
  let running, queued;
  const startCheck = () => (running = runCheck().finally(() => { running = undefined; }));
  const recheck = () => {
    if (!running) return startCheck();
    queued ??= running.then(() => { queued = undefined; return startCheck(); });
    return queued;
  };
  /** Dev middleware: the artifact bytes and the status the boot checks. The
   * status recheck is an async metadata walk (no contents read), so it never
   * blocks the server. */
  const devMiddleware = async (request, response, next) => {
    const path = (request.url ?? "").split("?")[0];
    if (!path.startsWith(`${state.base}__fenel/engine-body-replay`)) return next();
    response.setHeader("Cache-Control", "no-store");
    if (path === `${state.base}__fenel/engine-body-replay-status`) {
      const refusal = state.pin !== undefined && state.off === undefined ? await recheck() : undefined;
      const on = state.pin !== undefined && state.off === undefined && refusal === undefined;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(on ? { on: true, sourceEpoch: state.started.epoch.digest } : { on: false, reason: refusal ?? state.off ?? "off" }));
      return;
    }
    if (state.served && path === state.served.path) {
      response.setHeader("Content-Type", "application/octet-stream");
      response.end(state.served.gzip);
      return;
    }
    response.statusCode = 404;
    response.end();
  };
  const main = {
    name: "fenel-engine-body-replay",
    enforce: "pre",
    // A persisted prebundle need not contain the source bytes bound at this
    // server start. Keep the engine as source modules in dev, where every
    // loaded path can be checked against the bound repository.
    config() { return { optimizeDeps: { exclude: ["@fenel/engine"] } }; },
    configResolved(config) {
      state.command = config.command;
      state.base = config.base ?? "/";
      state.assetsDir = config.build?.assetsDir ?? "assets";
    },
    applyToEnvironment(environment) { return environment.name === "client"; },
    ...virtual,
    transform(_code, id) {
      if (state.command !== "serve" || state.off !== undefined) return;
      if (foreignSourceModules({ source: { type: "chunk", moduleIds: [id] } }, repositoryRoot).length) {
        switchOff(`a loaded engine/Fenel source is outside the hashed tree (${normalized(id)})`);
      }
    },
    configureServer(server) {
      const log = message => server.config?.logger?.warn?.(message);
      state.reportCheckFailure = log;
      const graphs = () => [server.moduleGraph, ...Object.values(server.environments ?? {}).map(environment => environment.moduleGraph)].filter(Boolean);
      state.invalidate = () => {
        for (const graph of graphs()) {
          const module = graph.getModuleById?.(RESOLVED);
          if (module) graph.invalidateModule(module);
        }
        // Existing workers keep their already-loaded engine graph. Retire
        // those realms with the ordinary Vite page reload; future workers
        // receive no pin. Never modify replay state during a running job.
        server.ws?.send?.({ type: "full-reload" });
      };
      if (server.config?.server?.watch === null || !server.watcher?.add || !server.watcher?.on) {
        switchOff("the source watcher is unavailable");
      }
      server.watcher?.add?.(universe.watched);
      server.watcher?.on?.("all", (_event, path) => {
        if (universe.contains(path)) switchOff(`a source file changed since the dev server started (${normalized(path).split("/").slice(-2).join("/")}); restart the dev server to re-bind`);
      });
      server.watcher?.on?.("error", () => switchOff("the source watcher failed"));
      server.middlewares.use(devMiddleware);
      // Bound at server start without blocking it; the virtual module waits.
      state.ready = (async () => {
        try {
          const bound = state.off === undefined ? await bindAsync(log) : undefined;
          if (bound && state.off === undefined) {
            const path = `${state.base}__fenel/engine-body-replay-${bound.artifactSha256.slice(0, 16)}.bin`;
            state.served = { path, gzip: bound.gzip };
            state.pin = { artifactUrl: path, artifactSha256: bound.artifactSha256, textDigest: bound.textDigest,
              sourceEpoch: bound.sourceEpoch, statusUrl: `${state.base}__fenel/engine-body-replay-status` };
          }
        } catch (error) {
          state.off = `the source epoch could not be computed (${error instanceof Error ? error.message : String(error)})`;
          log(`engine-body replay artifact OFF: ${state.off}`);
        }
      })();
    },
    buildStart() {
      if (state.command !== "build" || state.started) return;
      const bound = bind(message => this.warn(message));
      if (!bound) return;
      const fileName = `${state.assetsDir}/engine-body-replay-${bound.artifactSha256.slice(0, 16)}.bin`;
      this.emitFile({ type: "asset", fileName, source: bound.gzip });
      state.pin = { artifactUrl: `${state.base}${fileName}`, artifactSha256: bound.artifactSha256, textDigest: bound.textDigest, sourceEpoch: bound.sourceEpoch };
    },
    generateBundle() {
      if (state.command !== "build" || !state.started || !state.pin) return;
      const epoch = epochOf(repositoryRoot);
      if (epoch.digest !== state.started.epoch.digest || epoch.latestMtimeMs > state.started.at) {
        this.error("engine-body replay: the source bytes changed during the build (epoch differs or a file was modified); refusing to emit a bundle bound to them");
      }
      if (state.workerChecks.length === 0) this.error("engine-body replay: no tracked worker entry was built and checked");
    },
  };
  const worker = () => ({
    name: "fenel-engine-body-replay-worker",
    ...virtual,
    generateBundle(_output, bundle) {
      if (state.command !== "build") return;
      const { problems, checked } = checkTrackedWorkerEntries(bundle, id => this.getModuleInfo(id));
      if (problems.length) this.error(`engine-body replay worker entry order: ${problems.join("; ")}`);
      const pinned = Object.values(bundle).some(item => item.type === "chunk" && item.moduleIds.includes(RESOLVED));
      const foreign = pinned && state.pin ? foreignSourceModules(bundle, repositoryRoot) : [];
      if (foreign.length) this.error(`engine-body replay: the worker bundles engine/Fenel sources outside the hashed tree ${repositoryRoot} (${foreign.slice(0, 3).join(", ")}${foreign.length > 3 ? ", ..." : ""}); its epoch cannot describe them`);
      state.workerChecks.push(...checked);
    },
  });
  return { main, worker, state, devMiddleware };
}
