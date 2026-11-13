import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { publicBootstrapExactInputs, publicBootstrapInputRoots, isPublicBootstrapInput } from "./public-bootstrap-inputs.mjs";

const packageRoot = fileURLToPath(new URL("./", import.meta.url));
const generated = ["public-bootstrap.json", "seed-values.json", "authoring-catalogue.json", "local-bootstrap.json"].map(name =>
  fileURLToPath(new URL(`./src/lib/generated/${name}`, import.meta.url)).replaceAll("\\", "/"));
const repository = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const exact = new Set(publicBootstrapExactInputs.map(path => `${repository}${path}`));
const roots = publicBootstrapInputRoots.map(path => `${repository}${path}/`);
const parseCache = `${repository}implementations/typescript/engine/src/generated/parse-cache.generated.ts`;
const parseCachePart = "\0fenel-parse-cache-part:";

const engineModules = `${repository}implementations/typescript/engine/src/engine-modules.ts`;
const compiledExports = ["MANIFEST_HASH", "IDENTITY_DOMAIN", "RUNTIME_INPUT_HASH", "BOOTSTRAP_RUNTIME_INPUT_HASH",
  "SHARDS", "ENTRY_CODES", "CLOSURE_IDS", "REQUIRED_NATIVES", "FN_BODIES"];
const compiledArtifacts = ["parser", "resolver"].map(kind => ({
  target: `generated/compiled-${kind}.generated`,
  binding: `__m_generated_compiled_${kind}_generated`,
  keys: compiledExports.map(suffix => `${kind.toUpperCase()}_${suffix}`),
}));

function packagingPath(id) {
  const normalized = id.replaceAll("\\", "/"), queryStart = normalized.indexOf("?");
  const params = new URLSearchParams(queryStart < 0 ? "" : normalized.slice(queryStart + 1));
  if (["raw", "url", "worker", "sharedworker"].some(key => params.has(key))) return;
  return (queryStart < 0 ? normalized : normalized.slice(0, queryStart)).replace(/^\/(?=[A-Za-z]:\/)/, "");
}

/** C2 registration ABI only. Named imports retain the original immutable export
 * values; the literal record prevents Rolldown namespace getters from crossing
 * the strict own-data identity boundary. No arbitrary namespace is read/copied. */
function packageCompiledRegistrations(code, parse) {
  const fail = () => { throw new Error("Unexpected generated compiled-artifact registration shape."); };
  const body = parse(code).body, bindings = new Set(), imports = new Map(), calls = [];
  for (const statement of body) {
    if (statement.type === "ImportDeclaration" && typeof statement.source.value === "string") {
      for (const specifier of statement.specifiers) {
        if (bindings.has(specifier.local.name)) fail();
        bindings.add(specifier.local.name);
      }
      const source = statement.source.value;
      if (imports.has(source)) fail();
      imports.set(source, statement);
    } else {
      const call = statement.type === "ExpressionStatement" && statement.expression;
      if (!call || call.type !== "CallExpression" || call.callee.type !== "Identifier"
        || call.callee.name !== "registerEngineModule" || call.optional || call.arguments.length !== 2
        || call.arguments[0].type !== "Literal" || typeof call.arguments[0].value !== "string"
        || call.arguments[1].type !== "Identifier") fail();
      calls.push({ statement, target: call.arguments[0].value, binding: call.arguments[1].name });
    }
  }
  const registration = imports.get("./engine-require");
  if (!registration || registration.specifiers.length !== 1
    || registration.specifiers[0].type !== "ImportSpecifier"
    || registration.specifiers[0].imported.name !== "registerEngineModule"
    || registration.specifiers[0].local.name !== "registerEngineModule" || bindings.has("Object")) fail();
  const edits = [];
  for (const artifact of compiledArtifacts) {
    const declaration = imports.get(`./${artifact.target}`);
    const registrations = calls.filter(call => call.target === artifact.target || call.binding === artifact.binding);
    if (!declaration || declaration.specifiers.length !== 1
      || declaration.attributes?.length || declaration.assertions?.length || declaration.phase != null
      || declaration.specifiers[0].type !== "ImportNamespaceSpecifier"
      || declaration.specifiers[0].local.name !== artifact.binding || registrations.length !== 1
      || registrations[0].target !== artifact.target || registrations[0].binding !== artifact.binding) fail();
    const aliases = artifact.keys.map(key => `${artifact.binding}_${key}`);
    if (aliases.some(alias => bindings.has(alias))) fail();
    const named = artifact.keys.map((key, index) => `${key} as ${aliases[index]}`).join(", ");
    const fields = artifact.keys.map((key, index) => `${key}: ${aliases[index]}`).join(", ");
    edits.push({ start: declaration.start, end: declaration.end,
      text: `import { ${named} } from ${JSON.stringify(`./${artifact.target}`)};` });
    const statement = registrations[0].statement;
    edits.push({ start: statement.start, end: statement.end,
      text: `registerEngineModule(${JSON.stringify(artifact.target)}, Object.freeze({ ${fields} }));` });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  return { code, map: null };
}


/** Existing app/worker data chunk names, including build-only cache pieces. */
export function generatedDataChunk(id, prefix) {
  if (id.startsWith(parseCachePart)) {
    const part = /^([a-f0-9]{64}):([0-9]+)$/.exec(id.slice(parseCachePart.length));
    return part ? `${prefix}parse-cache-part-${part[1]}-${part[2]}` : undefined;
  }
  const normalized = id.split("?")[0].replace(/\\/g, "/");
  if (!normalized.includes("/engine/src/generated/")) return;
  if (!normalized.endsWith(".generated.ts") && !normalized.endsWith(".json")) return;
  return `${prefix}${normalized.slice(normalized.lastIndexOf("/") + 1)
    .replace(/\.(?:generated\.ts|json)$/, "")}`;
}

/** C2 packaging only: the generated cache keeps its exact synchronous string
 * export. Separate static data chunks fit the existing 25 MiB asset limit;
 * large source/literal pools stay Latin1 while small Unicode islands retain
 * exact native String contents. The facade uses only ordered refs and join.
 * The same app/worker build boundary packages the two immutable compiled
 * artifact registrations as own data while retaining every original export. */
export function generatedDataBuildPlugin({ carrierBytes = 8 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(carrierBytes) || carrierBytes < 32 || carrierBytes > 8 * 1024 * 1024) {
    throw new Error("Invalid generated cache carrier budget.");
  }
  // Content-addressed entries survive watch rebuilds which reuse a facade.
  // Each worker build receives its own factory instance, without ensure hooks.
  // Watched source revisions retain their earlier entries until this instance closes.
  const parts = new Map();
  return {
    name: "generated-data-build-parts",
    apply: "build",
    resolveId(id) { if (parts.has(id)) return id; },
    load(id) { return parts.get(id); },
    moduleParsed(info) {
      const path = packagingPath(info.id);
      const artifact = compiledArtifacts.find(artifact => path === `${repository}implementations/typescript/engine/src/${artifact.target}.ts`);
      if (!artifact) return;
      const fail = () => { throw new Error("Unexpected generated compiled-artifact const exports."); };
      if (info.exports.length !== artifact.keys.length || artifact.keys.some(key => !info.exports.includes(key))) fail();
      // The bundler has already removed TypeScript. Parse only the carrier's
      // outer declarations; serialized Fenel lowering remains inert Strings.
      // A fixed roster of live `let` exports must not become a data snapshot.
      const body = this.parse(info.code).body, declarations = [];
      for (const statement of body) {
        const declaration = statement.type === "ExportNamedDeclaration" && statement.declaration;
        if (!declaration || declaration.type !== "VariableDeclaration" || declaration.kind !== "const"
          || declaration.declarations.length !== 1 || declaration.declarations[0].id.type !== "Identifier") fail();
        declarations.push(declaration.declarations[0].id.name);
      }
      if (declarations.length !== artifact.keys.length || artifact.keys.some(key => !declarations.includes(key))) fail();
    },
    outputOptions(output) {
      const name = output.manualChunks;
      if (typeof name !== "function" || output.codeSplitting !== undefined || output.advancedChunks !== undefined) {
        throw new Error("Generated cache packaging requires its existing manual chunk naming owner.");
      }
      // Rolldown's manualChunks compatibility group otherwise pulls the
      // facade's private imports back into the same oversized data chunk.
      // Only existing generated data/private pieces lose dependency capture;
      // non-data decisions retain the caller's original naming and behavior.
      return { ...output, manualChunks: undefined, codeSplitting: { groups: [
        { test: id => generatedDataChunk(id, "") !== undefined, name, includeDependenciesRecursively: false },
        { test: id => generatedDataChunk(id, "") === undefined, name },
      ] } };
    },
    transform: {
      order: "pre",
      handler(code, id) {
        const target = packagingPath(id);
        if (target === engineModules) return packageCompiledRegistrations(code, source => this.parse(source));
        const normalized = id.replaceAll("\\", "/"), queryStart = normalized.indexOf("?");
        const path = queryStart < 0 ? normalized : normalized.slice(0, queryStart);
        const query = queryStart < 0 ? "" : normalized.slice(queryStart + 1);
        if (path.replace(/^\/(?=[A-Za-z]:\/)/, "") !== parseCache) return;
        const params = new URLSearchParams(query);
        if (["raw", "url", "worker", "sharedworker"].some(key => params.has(key))) return;
        const marker = "export const PARSE_CACHE_JSON = ";
        const start = code.indexOf(marker);
        const prefix = code.slice(0, start);
        const declarations = /(?:^|\n)export const PARSE_CACHE_VERSION = ([0-9]+);\r?\nexport const PARSE_CACHE_COUNT = ([0-9]+);\r?\n$/.exec(prefix);
        const header = declarations && prefix.slice(0, declarations.index);
        const end = code.lastIndexOf(";");
        if (start < 0 || !declarations || !header.startsWith("// GENERATED by scripts/generate-parse-cache.ts")
          || !header.split(/\r?\n/).every(line => !line.trim() || line.startsWith("//") || line === "/* eslint-disable */")
          || !/^;\s*$/.test(code.slice(end))) throw new Error("Unexpected generated parse-cache module shape.");
        let value;
        try { value = JSON.parse(code.slice(start + marker.length, end)); }
        catch { throw new Error("Unexpected generated parse-cache JSON string."); }
        if (typeof value !== "string") throw new Error("Generated parse-cache data must remain a string.");
        const owner = createHash("sha256").update(id).update("\0").update(code).digest("hex");
        const imports = [], references = [], carriers = [], current = { narrow: undefined, wide: undefined };
        let active;
        const createCarrier = kind => {
          const index = carriers.length, partId = `${parseCachePart}${owner}:${index}`;
          const carrier = { kind, id: partId, alias: `cachePart${index}`, literals: [], bytes: 19 };
          carriers.push(carrier); current[kind] = carrier;
          imports.push(`import ${carrier.alias} from ${JSON.stringify(partId)};\n`);
          return carrier;
        };
        const finish = last => {
          if (!active) return;
          const { carrier, first } = active;
          references.push(`${carrier.alias}[${carrier.literals.length}]`);
          carrier.literals.push(JSON.stringify(value.slice(first, last)));
          active = undefined;
        };
        // Exact JSON.stringify UTF-8 widths in one pass; do not repeatedly
        // escape large candidate slices or split a surrogate pair.
        for (let index = 0; index < value.length;) {
          const unit = value.charCodeAt(index), next = value.charCodeAt(index + 1);
          const pair = unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
          const width = unit === 34 || unit === 92 || unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13 ? 2
            : unit < 32 || unit >= 0xd800 && unit <= 0xdfff && !pair ? 6
              : unit < 0x80 ? 1 : unit < 0x800 ? 2 : pair ? 4 : 3;
          const kind = unit <= 255 ? "narrow" : "wide";
          if (active?.carrier.kind !== kind) finish(index);
          if (!active) {
            let carrier = current[kind] ?? createCarrier(kind);
            const overhead = 2 + (carrier.literals.length ? 1 : 0);
            if (carrier.bytes + overhead + width > carrierBytes) carrier = createCarrier(kind);
            carrier.bytes += 2 + (carrier.literals.length ? 1 : 0);
            active = { carrier, first: index };
          } else if (active.carrier.bytes + width > carrierBytes) {
            finish(index); const carrier = createCarrier(kind); carrier.bytes += 2;
            active = { carrier, first: index };
          }
          active.carrier.bytes += width; index += pair ? 2 : 1;
        }
        finish(value.length);
        if (!carriers.length) { const carrier = createCarrier("narrow"); carrier.literals.push('""'); carrier.bytes += 2; references.push(`${carrier.alias}[0]`); }
        for (const carrier of carriers) {
          const text = `export default [${carrier.literals.join(",")}];\n`;
          if (Buffer.byteLength(text) !== carrier.bytes || carrier.bytes > carrierBytes) throw new Error("Generated cache carrier exceeds its byte budget.");
          if (carrier.kind === "narrow" && /[^\x00-\xff]/.test(text)) throw new Error("Generated narrow carrier contains wide source units.");
          parts.set(carrier.id, text);
        }
        return { code: imports.join("") + prefix + marker + `[${references.join(",")}].join("")` + code.slice(end), map: null };
      },
    },
  };
}

function generatedDataPath(id) {
  const normalized = id.split("?")[0].replaceAll("\\", "/");
  const engineData = normalized.includes("/engine/src/generated/")
    && (normalized.endsWith(".generated.ts") || normalized.endsWith(".json"));
  return generated.includes(normalized) || engineData ? normalized : undefined;
}

function runGenerator(mode, log) {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["scripts/generate-public-bootstrap.mjs", mode], {
      cwd: packageRoot, windowsHide: true, env: { ...process.env, FENEL_PARSER_LEGACY: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const started = Date.now();
    // A stale snapshot makes --ensure rebuild the checked registries (minutes
    // to tens of minutes) while the build itself waits idle: say so, and keep
    // saying so, so the wait is never mistaken for a hang.
    log?.(`public bootstrap: ${mode} (generator pid ${child.pid})`);
    const heartbeat = log && setInterval(() => log(`public bootstrap: still running ${mode} after ${Math.round((Date.now() - started) / 1000)} s (generator pid ${child.pid}); stale snapshots are regenerated before the bundle starts`), 60_000);
    heartbeat?.unref?.();
    const relay = bytes => {
      output += bytes;
      if (log) for (const line of String(bytes).split(/\r?\n/)) if (line.trim()) log(`public bootstrap: ${line.trim()}`);
    };
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    child.on("error", error => { if (heartbeat) clearInterval(heartbeat); reject(error); });
    child.on("exit", code => {
      if (heartbeat) clearInterval(heartbeat);
      log?.(`public bootstrap: ${mode} finished in ${Math.round((Date.now() - started) / 1000)} s (exit ${code})`);
      return code === 0 ? resolve() : reject(new Error(output || `Public bootstrap generator exited ${code}.`));
    });
  });
}

/** GP-19 / C2: stale repository projections fail at the serving boundary. */
export function publicBootstrapPlugin() {
  let checked = false;
  let serving = false;
  const pre = {
    name: "public-bootstrap",
    configResolved(config) { serving = config.command === "serve"; },
    async buildStart() { await runGenerator("--ensure", message => (typeof this.info === "function" ? this.info(message) : console.log(message))); checked = true; },
    configureServer(server) {
      server.watcher.add([...exact, ...roots]);
      const changed = path => {
        const normalized = path.replaceAll("\\", "/");
        if (normalized.startsWith(repository) && isPublicBootstrapInput(normalized.slice(repository.length))) {
          checked = false;
          for (const target of generated) {
            const module = server.moduleGraph.getModuleById(target);
            if (module) server.moduleGraph.invalidateModule(module);
          }
          server.ws.send({ type: "full-reload" });
        } else if (generated.includes(normalized)) {
          checked = false;
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("change", changed);
      server.watcher.on("add", changed);
      server.watcher.on("unlink", changed);
    },
    transform: {
      // Vite's native JSON map precedes normal hooks and discards a later
      // empty-map sentinel. Mark these generated data before that transform;
      // Vite keeps its normal JSON exports without adding an inline map.
      // Engine data retains the previous .generated.ts/.json path policy;
      // only the three public snapshots use this owner's freshness gate.
      order: "pre",
      async handler(code, id) {
        const normalized = generatedDataPath(id);
        if (!normalized) return;
        const publicSnapshot = generated.includes(normalized);
        if (publicSnapshot && !checked) { await runGenerator("--check"); checked = true; }
        return serving ? { code, map: { mappings: "" } } : null;
      },
    },
  };
  const post = {
    name: "generated-data-inline-maps",
    apply: "serve",
    transform: {
      order: "post",
      handler(code, id) {
        if (!serving || !generatedDataPath(id)) return null;
        let end = code.length;
        for (;;) {
          const inline = code.lastIndexOf("\n//# sourceMappingURL=data:", end - 1);
          if (inline < 0) break;
          // Only a complete trailing standard base64 map line is metadata.
          // Quotes, backticks and following code cannot match this grammar;
          // marker text inside generated string/template data stays intact.
          const suffix = code.slice(inline + 1, end);
          if (!/^\/\/# sourceMappingURL=data:(?:application|text)\/json(?:;charset=[A-Za-z0-9._-]+)?;base64,[A-Za-z0-9+/_-]+={0,2}[ \t]*(?:\r?\n)*$/.test(suffix)) break;
          end = inline;
        }
        return end === code.length ? null : { code: code.slice(0, end), map: { mappings: "" } };
      },
    },
  };
  return [pre, post];
}
