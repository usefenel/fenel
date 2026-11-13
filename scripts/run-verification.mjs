import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import ts from "typescript";
import { captureStableEpoch } from "../implementations/typescript/engine/scripts/lib/artifact-bytes.ts";

// C2 tooling harness. This orchestrates existing checks; it owns no Fenel semantics.
// Discovery uses Git's canonical tracked inventory, never a recursive bun/vitest glob.
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;
const CANONICAL_ROOT = /^(?:implementations\/typescript\/[^/]+\/|distros\/narthex\/solid\/|scripts\/)/u;
const EXCLUDED_DIRECTORY = /(?:^|\/)(?:node_modules|dist|archives?|worktrees?|__fixtures__|fixtures|\.git|\.tmp[^/]*)\//u;
export const SUPPLEMENTAL_TRACKED_TESTS = Object.freeze([
  "workstreams/signature-substrate/notes/phase-4-slice-3i0-census/harness/premise-licence.test.ts",
  "workstreams/signature-substrate/notes/phase-4-slice-3i0-census/harness/refutation-precedence.test.ts",
  "workstreams/term-substrate/notes/harness/differential-fixtures.test.ts",
  "workstreams/ux-parity/scripts/definition-wire-boundary.test.ts",
]);
const SUPPLEMENTAL_SET = new Set(SUPPLEMENTAL_TRACKED_TESTS);
const TERM_DIFFERENTIAL_TEST = "workstreams/term-substrate/notes/harness/differential-fixtures.test.ts";
const DEFAULT_FENEL_PARSER_TESTS = new Set([
  "implementations/typescript/engine/scripts/self-host-matrix-report.test.ts",
  "implementations/typescript/engine/src/authoring/source-module.test.ts",
]);
// Explicit experimental admission only; no automatic grouping of the roster.
export const WARM_PILOT_FILES = Object.freeze([
  "implementations/typescript/engine/src/bytes-membership.test.ts",
  "implementations/typescript/engine/src/field-key-publication.test.ts",
]);
const SCHEMA = "fenel.verification-run.v1";
const BUN = "bun";

export function containedPath(root, path, mustExist = false) {
  const target = resolve(root, path);
  const inside = (value) => {
    const rel = relative(root, value);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!inside(target)) throw new Error(`Path escapes repository: ${path}`);
  if (mustExist && !existsSync(target)) throw new Error(`Missing repository file: ${path}`);
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!inside(realpathSync(ancestor))) throw new Error(`Linked path escapes repository: ${path}`);
  return target;
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

export function captureTrackedState(root = REPOSITORY_ROOT) {
  const result = spawnSync("git", ["diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--"], {
    cwd: root, windowsHide: true, maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Cannot capture tracked diff: ${result.error?.message ?? result.stderr?.toString()}`);
  return { head: git(root, ["rev-parse", "HEAD"]).trim(), trackedDiffDigest: createHash("sha256").update(result.stdout).digest("hex") };
}

export function sameTrackedState(before, after) {
  return before.head === after.head && before.trackedDiffDigest === after.trackedDiffDigest;
}

export async function captureRawRepositoryState(root = REPOSITORY_ROOT) {
  const repositoryRoot = containedPath(REPOSITORY_ROOT, root, true);
  const started = performance.now();
  // Reuse the owner's complete raw-byte inventory and stable A/B capture.
  // The controller closes its watcher and removes its temporary sentinel.
  const result = await captureStableEpoch({ repositoryRoot });
  if (!result.ok) throw new Error(`Cannot capture raw repository epoch: ${JSON.stringify(result.issue)}`);
  return {
    repositoryEpoch: result.value.repositoryEpoch,
    fileCount: result.value.repository.fileCount,
    byteLength: result.value.repository.byteLength,
    captureMs: Math.round(performance.now() - started),
  };
}

export function sameSourceState(beforeTracked, afterTracked, beforeRaw, afterRaw) {
  return sameTrackedState(beforeTracked, afterTracked) && beforeRaw.repositoryEpoch === afterRaw.repositoryEpoch;
}

export const RECEIPT_RENAME_BACKOFF_MS = Object.freeze([25, 50, 100, 200, 400, 800, 1600]);

export function createReceiptWriter({ root, path, pending, platform = process.platform, write = writeFileSync, rename = renameSync, pause = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const target = containedPath(root, path), temporary = containedPath(root, pending);
  if (target === temporary || dirname(target) !== dirname(temporary)) throw new Error("Receipt publication requires distinct same-directory pending and target paths");
  let failed = false, failure;
  return async (receipt) => {
    if (failed) throw failure;
    try {
      const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
      // One complete pending write per logical save; retries only publish those bytes.
      write(temporary, bytes);
      for (let retry = 0; ; retry++) {
        try { rename(temporary, target); return; }
        catch (error) {
          const sharingFailure = platform === "win32" && ["EPERM", "EBUSY", "EACCES"].includes(error?.code);
          if (!sharingFailure || retry === RECEIPT_RENAME_BACKOFF_MS.length) throw error;
          await pause(RECEIPT_RENAME_BACKOFF_MS[retry]);
        }
      }
    } catch (error) {
      // A terminal publication failure cannot be cleared by a later/final save.
      failed = true; failure = error;
      throw error;
    }
  };
}

export function selectCanonicalTests(paths) {
  return [...new Set(paths)].filter((path) => TEST_FILE.test(path) && (CANONICAL_ROOT.test(path) || SUPPLEMENTAL_SET.has(path)) && !EXCLUDED_DIRECTORY.test(path)).sort();
}

export function discoverTests(root = REPOSITORY_ROOT) {
  const files = selectCanonicalTests(git(root, ["ls-files", "-z", "--cached", "--deduplicate"]).split("\0"));
  for (const file of files) {
    const path = containedPath(root, file, true);
    if (!lstatSync(path).isFile()) throw new Error(`Test is not a plain file: ${file}`);
  }
  return files;
}

export function tokenizeCommand(source) {
  const words = [];
  let word = "", quote = "", active = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = "";
      else word += char;
      active = true;
    } else if (char === "'" || char === '"') { quote = char; active = true; }
    else if (/\s/u.test(char)) { if (active) { words.push(word); word = ""; active = false; } }
    else if (/[;&|<>`]/u.test(char)) throw new Error(`Unsupported workflow shell syntax: ${source}`);
    else { word += char; active = true; }
  }
  if (quote) throw new Error(`Unclosed workflow quote: ${source}`);
  if (active) words.push(word);
  return words;
}

const step = (id, args, timeoutMs = 600_000, extra = {}) => ({ id, executable: BUN, args, timeoutMs, ...extra });
const scriptStep = (id, file, args = [], timeoutMs = 600_000) => step(id, ["--no-env-file", file, ...args], timeoutMs);

export function localGates() {
  const projects = ["engine", "runtime", "db", "core", "api", "bot"];
  const checks = projects.map((name) => step(`typecheck:${name}`, ["--no-env-file", "node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", `.tmp-tsc/${name}.tsbuildinfo`, "-p", `implementations/typescript/${name}/tsconfig.json`]));
  checks.push(step("typecheck:scripts", ["--no-env-file", "node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", ".tmp-tsc/scripts.tsbuildinfo", "-p", "implementations/typescript/engine/tsconfig.scripts.json", "--pretty", "false"]));
  checks.push(step("typecheck:solid", ["--no-env-file", "distros/narthex/solid/node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", ".tmp-tsc/solid.tsbuildinfo", "-p", "distros/narthex/solid/tsconfig.json", "--pretty", "false"]));
  checks.push(scriptStep("effects", "implementations/typescript/engine/scripts/audit-effects.ts", ["--no-laws", "--ci"], 1_800_000));
  checks.push(scriptStep("ambient-census", "implementations/typescript/engine/scripts/ambient-read-census.ts", ["--check"]));
  return checks;
}

export function declaredTimeoutMs(source, filename = "test.ts") {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const constants = new Map();
  const value = (node) => {
    if (!node) return undefined;
    if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", ""));
    if (ts.isIdentifier(node)) return constants.get(node.text);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return value(node.expression);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusToken) return value(node.operand);
    if (ts.isBinaryExpression(node)) {
      const left = value(node.left), right = value(node.right);
      if (left === undefined || right === undefined) return undefined;
      if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
      if (node.operatorToken.kind === ts.SyntaxKind.MinusToken) return left - right;
      if (node.operatorToken.kind === ts.SyntaxKind.SlashToken && right !== 0) return left / right;
    }
    return undefined;
  };
  const visit = (node, callback) => { callback(node); ts.forEachChild(node, (child) => visit(child, callback)); };
  // Repeated declarations/shadowing choose the larger constant conservatively.
  for (let pass = 0; pass < 3; pass++) visit(tree, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const candidate = value(node.initializer);
      if (Number.isFinite(candidate)) constants.set(node.name.text, Math.max(constants.get(node.name.text) ?? 0, candidate));
    }
  });
  let maximum = 0;
  const admit = (node) => {
    const candidate = value(node);
    if (Number.isFinite(candidate) && candidate > maximum) maximum = candidate;
  };
  const callName = (node) => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) return callName(node.expression);
    return "";
  };
  visit(tree, (node) => {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name === "setDefaultTimeout") admit(node.arguments[0]);
      else if (["beforeAll", "beforeEach", "afterAll", "afterEach"].includes(name) && node.arguments.length >= 2) admit(node.arguments.at(-1));
      else if (["test", "it", "describe"].includes(name) && node.arguments.length >= 3) admit(node.arguments.at(-1));
    }
    if (ts.isPropertyAssignment(node) && ["timeout", "testTimeout", "hookTimeout"].includes(node.name.getText(tree).replaceAll(/['"]/gu, ""))) admit(node.initializer);
  });
  return Math.ceil(maximum);
}

export function testStep(file, options = {}, env = {}, suffix = "", declaredTimeout = 0) {
  let timeoutMs = options.fileTimeoutMs ?? 600_000;
  if (options.fileTimeoutMs === undefined) {
    if (/(?:runtime\/src\/(?:evaluator|rights-|persistence-)|engine\/src\/(?:compile-|type-substrate|decide-|synthesize)|engine\/scripts\/(?:self-host|compile-)|solid\/src\/lib\/account-field-registry\.test)/u.test(file)) timeoutMs = 1_800_000;
    // Multiple fresh product children make this file cumulative; keep each
    // authored test/child deadline and require its complete footer.
    if (file === "implementations/typescript/runtime/src/durable-runtime-regressions.test.ts") timeoutMs = 1_800_000;
    // The sentinel explicitly allows 40 minutes for its test; keep the file bound outside it.
    if (file.endsWith("/execute-registry-boot.test.ts")) timeoutMs = 2_700_000;
    // A file deadline must allow its longest authored test/hook plus startup.
    // The watchdog remains independent from Bun's timer, including synchronous hangs.
    timeoutMs = Math.max(timeoutMs, Math.ceil(declaredTimeout * 1.25) + 60_000);
  }
  const testTimeoutMs = options.testTimeoutMs ?? (file === TERM_DIFFERENTIAL_TEST ? 120_000 : 60_000);
  // Frontend tests exercise the same staged client graph as the app. Solid's
  // default server export omits reactive propagation and effect application.
  const conditions = file.startsWith("distros/narthex/solid/")
    ? ["--conditions=browser", "--conditions=development"]
    : [];
  // These two files assert provenance through the default cache-miss selector;
  // the ordinary registry bootstrap profile remains legacy elsewhere.
  const testEnv = DEFAULT_FENEL_PARSER_TESTS.has(file)
    ? { ...env, FENEL_PARSER_LEGACY: null }
    : env;
  return step(`test:${file}${suffix}`, ["--no-env-file", ...conditions, "test", "--timeout", String(testTimeoutMs), `./${file}`], timeoutMs, { kind: "test", file, env: testEnv, declaredTimeoutMs: declaredTimeout });
}

function workflowInventory(root, canonical) {
  const result = { tests: [], checks: [], prerequisites: [] };
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const workflow of ["audit", "parser-artifacts"]) {
    const doc = parseYaml(readFileSync(join(root, `.github/workflows/${workflow}.yml`), "utf8"));
    for (const [jobName, job] of Object.entries(doc.jobs)) {
      if (jobName === "law-audit") continue;
      if (job.if) throw new Error(`Review conditional CI job before admitting it: ${jobName}`);
      for (const [index, entry] of job.steps.entries()) {
        if (!entry.run) continue;
        let tokens = tokenizeCommand(entry.run);
        if (tokens[0] === "bun" && tokens[1] === "run" && packageJson.scripts[tokens[2]]) {
          tokens = [...tokenizeCommand(packageJson.scripts[tokens[2]]), ...tokens.slice(3)];
        }
        if (tokens[0] === "bun" && (tokens[1] === "install" || tokens[1] === "x")) {
          result.prerequisites.push({ workflow, job: jobName, name: entry.name, command: tokens });
          continue;
        }
        const id = `ci:${workflow}:${jobName}:${index}`;
        const descriptor = { id, name: entry.name, executable: tokens[0], args: tokens.slice(1), timeoutMs: (entry["timeout-minutes"] ?? job["timeout-minutes"] ?? 45) * 60_000, env: entry.env ?? {} };
        if (!["bun", "node"].includes(descriptor.executable)) throw new Error(`Unsupported CI executable in ${id}`);
        if (tokens.includes("test")) {
          const files = tokens.filter((token) => TEST_FILE.test(token.replace(/^\.\//u, ""))).map((file) => file.replace(/^\.\//u, ""));
          if (!files.length) throw new Error(`CI test command has no exact named files: ${id}`);
          for (const file of files) {
            if (!canonical.has(file)) throw new Error(`Named CI test is missing from canonical inventory: ${file}`);
            result.tests.push({ file, env: descriptor.env, source: id });
          }
        } else result.checks.push(descriptor);
      }
    }
  }
  return result;
}

// C2 command inventory, separate from the historical per-file `ci` projection.
// Setup actions/installers are prerequisites; this is not a GitHub job emulator.
export const CI_COMMAND_PROFILE = Object.freeze({
  scheduling: "serial workflow/job/step declaration order; later commands still run after a failure",
  provisioning: "workflow actions and dependency/browser installation are recorded prerequisites, not executed",
  localEnvironment: "Bun --no-env-file; repository temp; plain logs; Chromium channel; exported DB settings removed before declared env",
  parserProfile: "default parser when YAML leaves FENEL_PARSER_LEGACY undeclared; declared values are preserved",
  limits: "No remote OS/toolchain/provisioning, package-runner environment, parallel-job, job-timeout, failure-skip or full environment equivalence; unmodeled parent environment remains inherited",
});

function mergedWorkflowEnvironment(...levels) {
  const result = {};
  for (const level of levels) {
    if (level === undefined) continue;
    if (!level || typeof level !== "object" || Array.isArray(level)) throw new Error("Workflow env must be a scalar-valued mapping");
    for (const [name, value] of Object.entries(level)) {
      if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`Unsupported workflow env value: ${name}`);
      result[name] = String(value);
    }
  }
  return result;
}

function workflowTestSelection(tokens, canonical, id) {
  if (tokens[0] !== "bun") {
    if (tokens[1]?.startsWith("-") || !/\.(?:[cm]?[jt]s)$/u.test(tokens[1] ?? "") || TEST_FILE.test(tokens[1])) {
      throw new Error(`Review Node command entrypoint before ci-commands admission: ${id}`);
    }
    return null;
  }
  let commandIndex = 1;
  while (tokens[commandIndex] === "--no-env-file" || tokens[commandIndex]?.startsWith("--conditions=")) commandIndex++;
  if (tokens[commandIndex] !== "test") {
    if (tokens[commandIndex]?.startsWith("-")
      || !(/\.(?:[cm]?[jt]sx?)$/u.test(tokens[commandIndex] ?? "") || /(?:^|\/)node_modules\/typescript\/bin\/tsc$/u.test(tokens[commandIndex] ?? ""))
      || TEST_FILE.test(tokens[commandIndex])) throw new Error(`Review Bun command entrypoint or startup flags before ci-commands admission: ${id}`);
    return null;
  }
  const files = [], testNamePatterns = [];
  let bail = false;
  for (let index = commandIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "-t" || token === "--test-name-pattern") {
      if (tokens[index + 1] === undefined) throw new Error(`Missing test-name pattern in ${id}`);
      testNamePatterns.push(tokens[++index]);
    } else if (token.startsWith("--test-name-pattern=")) testNamePatterns.push(token.slice(20));
    else if (token === "--timeout") {
      if (!/^\d+$/u.test(tokens[++index] ?? "")) throw new Error(`Invalid test timeout in ${id}`);
    } else if (/^--timeout=\d+$/u.test(token)) { /* preserve the authored argument */ }
    else if (token === "--bail") {
      bail = true;
      if (/^\d+$/u.test(tokens[index + 1] ?? "")) index++;
    } else if (/^--bail=\d+$/u.test(token)) bail = true;
    else {
      const file = token.replace(/^\.\//u, "");
      if (!TEST_FILE.test(file) || !canonical.has(file)) throw new Error(`CI command requires an exact canonical test file or reviewed flag in ${id}: ${token}`);
      if (files.includes(file)) throw new Error(`Duplicate CI command test file in ${id}: ${file}`);
      files.push(file);
    }
  }
  if (!files.length) throw new Error(`CI test command has no exact named files: ${id}`);
  return { files, testNamePatterns, bail };
}

export function workflowCommandInventory(root, canonical) {
  const result = { commands: [], prerequisites: [], tests: [], checks: [] };
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const workflow of ["audit", "parser-artifacts"]) {
    const workflowPath = `.github/workflows/${workflow}.yml`;
    const doc = parseYaml(readFileSync(join(root, workflowPath), "utf8"));
    if (doc.defaults !== undefined) throw new Error(`Review workflow defaults before ci-commands admission: ${workflow}`);
    for (const [jobName, job] of Object.entries(doc.jobs)) {
      if (jobName === "law-audit") continue;
      for (const key of ["if", "defaults", "strategy", "needs", "container", "services", "uses", "continue-on-error"]) {
        if (job[key] !== undefined) throw new Error(`Review CI job ${key} before ci-commands admission: ${jobName}`);
      }
      for (const [index, entry] of job.steps.entries()) {
        const id = `ci-command:${workflow}:${jobName}:${index}`;
        for (const key of ["if", "working-directory", "shell", "continue-on-error"]) {
          if (entry[key] !== undefined) throw new Error(`Review CI step ${key} before ci-commands admission: ${id}`);
        }
        const declaredEnv = mergedWorkflowEnvironment(doc.env, job.env, entry.env);
        const origin = { workflow, workflowPath, job: jobName, stepIndex: index, name: entry.name, declaredEnv };
        if (entry.uses) {
          if (entry.run !== undefined) throw new Error(`CI step has both uses and run: ${id}`);
          result.prerequisites.push({ ...origin, uses: entry.uses, with: entry.with ?? {} });
          continue;
        }
        if (typeof entry.run !== "string" || !entry.run.trim()) throw new Error(`CI step needs a nonempty run command or setup action: ${id}`);
        if (/[\r\n]/u.test(entry.run.trim())) throw new Error(`Multiline shell commands require review: ${id}`);
        if (/'[^']*\$[^']*'/u.test(entry.run)) throw new Error(`Quoted dollar literals require review: ${id}`);
        const declaredCommand = tokenizeCommand(entry.run);
        let tokens = [...declaredCommand], packageScript;
        if (tokens[0] === "bun" && tokens[1] === "run") {
          const name = tokens[2], body = packageJson.scripts?.[name];
          if (typeof body !== "string" || packageJson.scripts?.[`pre${name}`] || packageJson.scripts?.[`post${name}`]) {
            throw new Error(`Review package script and lifecycle hooks before ci-commands admission: ${name}`);
          }
          packageScript = { name, body };
          if (/[\r\n]/u.test(body.trim())) throw new Error(`Multiline package scripts require review: ${name}`);
          if (/'[^']*\$[^']*'/u.test(body)) throw new Error(`Quoted dollar literals require review: ${name}`);
          tokens = [...tokenizeCommand(body), ...tokens.slice(3)];
          if (tokens[0] === "bun" && tokens[1] === "run") throw new Error(`Nested package script requires review: ${id}`);
        }
        if (tokens[0] === "bun" && ["install", "x"].includes(tokens[1])) {
          if (!["bun install --frozen-lockfile", "bun x --bun playwright install --with-deps chromium"].includes(tokens.join(" "))) {
            throw new Error(`Unreviewed installer or bun-x command in ${id}`);
          }
          result.prerequisites.push({ ...origin, declaredRun: entry.run, command: tokens, packageScript });
          continue;
        }
        if (!["bun", "node"].includes(tokens[0])) throw new Error(`Unsupported CI executable in ${id}`);
        for (const bound of [entry["timeout-minutes"], job["timeout-minutes"]]) {
          if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound) || bound <= 0)) throw new Error(`Invalid CI command watchdog in ${id}`);
        }
        const timeoutMs = (entry["timeout-minutes"] ?? job["timeout-minutes"] ?? 45) * 60_000;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error(`Invalid CI command watchdog in ${id}`);
        const selection = workflowTestSelection(tokens, canonical, id);
        result.commands.push({
          ...origin, id, executable: tokens[0], args: tokens.slice(1), env: declaredEnv,
          declaredRun: entry.run, declaredCommand, expandedCommand: tokens, packageScript,
          timeoutMs, outerTimeoutScope: "command",
          timeoutBasis: entry["timeout-minutes"] !== undefined ? "declared-step" : job["timeout-minutes"] !== undefined ? "local-command-bound-from-job" : "local-default-45-minutes",
          declaredJobTimeoutMs: job["timeout-minutes"] === undefined ? null : job["timeout-minutes"] * 60_000,
          kind: selection ? "ci-test-command" : "check",
          ...(selection ? { ...selection, coverageScope: "command-aggregate", selectionScope: selection.testNamePatterns.length ? "test-name-filter" : "named-files" } : {}),
        });
      }
    }
  }
  return result;
}

function normalizeWorkflowCommand(descriptor, head, output) {
  const replace = (token) => {
    token = token.replaceAll(/\$GITHUB_SHA(?![A-Za-z0-9_])/gu, () => head)
      .replaceAll(/\$RUNNER_TEMP(?![A-Za-z0-9_])/gu, () => `${output}/temp`);
    token = token.replaceAll(".tmp-m3b-ci/audit-compiled-resolver", `${output}/check-packages/compiled-resolver`);
    token = token.replaceAll(".tmp-m4-ci/check-packages/compiled-parser", `${output}/check-packages/compiled-parser`);
    if (token.includes("$")) throw new Error(`Unreviewed CI substitution: ${token}`);
    return token;
  };
  const args = descriptor.args.map(replace);
  const addedNoEnvFile = descriptor.executable === "bun" && args[0] !== "--no-env-file";
  if (addedNoEnvFile) args.unshift("--no-env-file");
  const env = Object.fromEntries(Object.entries(descriptor.declaredEnv).map(([key, value]) => {
    // YAML env scalars do not undergo shell expansion. Keep the admitted literal
    // values exact; dynamic/quoted-dollar forms need a separate reviewed grammar.
    if (value.includes("$")) throw new Error(`Unreviewed CI environment expression: ${key}`);
    return [key, value];
  }));
  const defaultParserOverride = !Object.hasOwn(env, "FENEL_PARSER_LEGACY");
  if (defaultParserOverride) env.FENEL_PARSER_LEGACY = null;
  return { ...descriptor, args, env, localAdaptations: { addedNoEnvFile, defaultParserOverride,
    controlledPathSubstitutions: ["GITHUB_SHA", "RUNNER_TEMP", "compiled-resolver package output", "compiled-parser package output"] } };
}

function normalizeCheck(descriptor, head, output) {
  const replace = (token) => {
    token = token.replaceAll(/\$GITHUB_SHA(?![A-Za-z0-9_])/gu, () => head)
      .replaceAll(/\$RUNNER_TEMP(?![A-Za-z0-9_])/gu, () => `${output}/temp`);
    token = token.replaceAll(".tmp-m3b-ci/audit-compiled-resolver", `${output}/check-packages/compiled-resolver`);
    token = token.replaceAll(".tmp-m4-ci/check-packages/compiled-parser", `${output}/check-packages/compiled-parser`);
    if (token.includes("$")) throw new Error(`Unreviewed CI substitution: ${token}`);
    return token;
  };
  const args = descriptor.args.map(replace);
  if (descriptor.executable === "bun" && args[0] !== "--no-env-file") args.unshift("--no-env-file");
  const env = Object.fromEntries(Object.entries(descriptor.env).map(([key, value]) => [key, replace(String(value))]));
  // --check is a full source-parser reproduction, not legacy-parser cache reuse.
  if (args.includes("implementations/typescript/engine/scripts/generate-parse-cache.ts")) env.FENEL_PARSER_LEGACY = null;
  return { ...descriptor, args, env };
}

// This constructor also serves inert controls. buildPlan owns production group
// admission and never accepts a caller-supplied eligibility list from a manifest.
export function makeTestGroup(group, members) {
  if (!group || typeof group !== "object" || Array.isArray(group)
    || Object.keys(group).some((key) => !["id", "files", "timeoutMs"].includes(key))
    || typeof group.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(group.id)) {
    throw new Error("Test group requires an id, files and explicit timeoutMs only");
  }
  if (!Array.isArray(group.files) || group.files.length !== 2
    || new Set(group.files).size !== 2
    || group.files.some((file) => typeof file !== "string" || file.includes("\\") || file.split("/").some((part) => ["", ".", ".."].includes(part))
      || !selectCanonicalTests([file]).includes(file))) {
    throw new Error("Test group requires two distinct canonical file paths");
  }
  if (!Number.isSafeInteger(group.timeoutMs) || group.timeoutMs <= 0 || group.timeoutMs > 2_147_483_647) {
    throw new Error("Test group timeoutMs must be an integer from 1 to 2147483647");
  }
  if (!Array.isArray(members) || members.length !== 2 || members.some((member, index) =>
    member?.kind !== "test" || member.file !== group.files[index] || member.args.at(-1) !== `./${member.file}`)) {
    throw new Error("Test group members must be the matching single-file commands in requested order");
  }
  const profile = (member) => JSON.stringify({ executable: member.executable, args: member.args.slice(0, -1),
    env: Object.fromEntries(Object.entries(member.env ?? {}).sort(([a], [b]) => a.localeCompare(b))) });
  if (profile(members[0]) !== profile(members[1])) {
    throw new Error("Test group command profiles differ; parser, client, environment and case budgets must match");
  }
  return {
    id: `test-group:${group.id}`, kind: "test-group", executable: members[0].executable,
    args: [...members[0].args.slice(0, -1), ...group.files.map((file) => `./${file}`)],
    env: { ...members[0].env }, files: [...group.files], requestedFileOrder: [...group.files],
    timeoutMs: group.timeoutMs, outerTimeoutScope: "group", coverageScope: "aggregate-only",
    // A group watchdog replaces the isolated outer watchdogs for this pilot;
    // authored Bun case/hook budgets remain. These are metadata, not live timers.
    memberIsolatedBudgets: members.map(({ file, timeoutMs, declaredTimeoutMs }) => ({ file, timeoutMs, declaredTimeoutMs })),
  };
}

export function buildPlan({ root = REPOSITORY_ROOT, suite = "all-tests", output = ".tmp-diag/verification", head, testTimeoutMs, fileTimeoutMs, runBudgetMs, manifest, fullLaws = false,
  readTestTimeout = (path, file) => declaredTimeoutMs(readFileSync(path, "utf8"), file),
} = {}) {
  const tests = discoverTests(root);
  const canonical = new Set(tests);
  if (typeof readTestTimeout !== "function") throw new Error("readTestTimeout must be a function");
  if (manifest !== undefined) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || !Array.isArray(manifest.tests) || !Array.isArray(manifest.checks)) {
      throw new Error("Selection manifest requires an object with tests and checks arrays");
    }
    if ([...manifest.tests, ...manifest.checks].some((value) => typeof value !== "string")) {
      throw new Error("Selection manifest tests and checks must contain strings");
    }
    if (manifest.groups !== undefined && !Array.isArray(manifest.groups)) throw new Error("Selection manifest groups must be an array");
    for (const group of manifest.groups ?? []) {
      if (!group || !Array.isArray(group.files) || group.files.some((file) => typeof file !== "string")) {
        throw new Error("Selection manifest groups require files arrays of strings");
      }
    }
    if (manifest.commands !== undefined && (!Array.isArray(manifest.commands) || manifest.commands.some((id) => typeof id !== "string"))) {
      throw new Error("Selection manifest commands must be an array of strings");
    }
  }
  const selectedTests = manifest === undefined ? null
    : new Set([...manifest.tests, ...(manifest.groups ?? []).flatMap((group) => group.files)]);
  if (suite === "ci-commands" && (testTimeoutMs !== undefined || fileTimeoutMs !== undefined || fullLaws)) {
    throw new Error("ci-commands preserves declared test budgets; use --run-budget-ms and keep full laws separate");
  }
  const workflows = suite === "ci-commands" ? workflowCommandInventory(root, canonical) : workflowInventory(root, canonical);
  const knownHead = head ?? git(root, ["rev-parse", "HEAD"]).trim();
  const gates = localGates();
  const ciChecks = workflows.checks.map((check) => normalizeCheck(check, knownHead, output));
  const remainingCiChecks = ciChecks.filter((check) => !check.args.some((arg) => /(?:typescript\/bin\/tsc|audit-effects\.ts)$/u.test(arg)) || check.args.includes("implementations/typescript/runtime/tsconfig.tests.json"));
  const options = { testTimeoutMs, fileTimeoutMs };
  const timeoutCache = new Map();
  const makeTest = (file, env = {}, suffix = "") => {
    if (!timeoutCache.has(file)) {
      // Retain every canonical/special-arm path check. Only timeout AST parsing
      // is deferred for descriptors that the selection will discard below.
      const path = containedPath(root, file, true);
      if (!lstatSync(path).isFile()) throw new Error(`Test is not a plain file: ${file}`);
      timeoutCache.set(file, selectedTests === null || selectedTests.has(file) ? readTestTimeout(path, file) : 0);
    }
    return testStep(file, options, env, suffix, timeoutCache.get(file));
  };
  let plan;
  const distinctCiTests = [...new Map(workflows.tests.map((test) => [`${test.file}:${JSON.stringify(test.env)}`, test])).values()];
  const makeCiTests = () => distinctCiTests.map((test) => makeTest(test.file, test.env, test.env.FENEL_LEGACY_DISPATCH ? ":legacy" : ""));
  if (suite === "ci-commands") plan = workflows.commands.map((command) => normalizeWorkflowCommand(command, knownHead, output));
  else if (suite === "all-tests" || suite === "full") {
    plan = [...gates, ...(suite === "full" ? remainingCiChecks : []), ...tests.map((file) => makeTest(file))];
    plan.push(makeTest("implementations/typescript/runtime/src/rights-perform-loading-dock.test.ts", { FENEL_LEGACY_DISPATCH: "1" }, ":legacy"));
  } else if (suite === "tests") plan = tests.map((file) => makeTest(file));
  else if (suite === "gates") plan = gates;
  else if (suite === "ci") plan = [...ciChecks, ...makeCiTests(), scriptStep("ambient-census", "implementations/typescript/engine/scripts/ambient-read-census.ts", ["--check"])];
  else if (suite === "ci-checks") {
    // Local gates already cover all production typecheck scopes, content audit and census.
    plan = remainingCiChecks;
  } else throw new Error(`Unknown suite: ${suite}`);
  if (fullLaws) plan.push(scriptStep("full-laws", "implementations/typescript/engine/scripts/audit-effects.ts", ["--ci"], 9_000_000));
  if (manifest && suite === "ci-commands") {
    if (!Array.isArray(manifest.tests) || manifest.tests.length || !Array.isArray(manifest.checks) || manifest.checks.length
      || !Array.isArray(manifest.commands) || !manifest.commands.length
      || (manifest.groups !== undefined && (!Array.isArray(manifest.groups) || manifest.groups.length))) {
      throw new Error("ci-commands selection requires empty tests/checks, exact commands IDs and no warm groups");
    }
    const wanted = new Set(manifest.commands);
    if (wanted.size !== manifest.commands.length) throw new Error("Duplicate CI command selection");
    for (const id of wanted) if (!plan.some((entry) => entry.id === id)) throw new Error(`Unknown CI command: ${id}`);
    // Manifest order cannot reorder the original workflow commands.
    plan = plan.filter((entry) => wanted.has(entry.id));
  } else if (manifest) {
    if (manifest.commands !== undefined) throw new Error("Manifest commands require --suite=ci-commands");
    if (!Array.isArray(manifest.tests) || !Array.isArray(manifest.checks)) throw new Error("Selection manifest requires tests and checks arrays");
    const wantedTests = new Set(manifest.tests), wantedChecks = new Set(manifest.checks);
    if (manifest.groups !== undefined && !Array.isArray(manifest.groups)) throw new Error("Selection manifest groups must be an array");
    const groups = manifest.groups ?? [];
    if (groups.length && (suite !== "tests" || fullLaws || manifest.checks.length)) {
      throw new Error("Experimental test groups require --suite=tests without checks or full laws");
    }
    const groupIds = new Set(), groupedFiles = new Set(), groupSteps = [];
    for (const group of groups) {
      if (!Array.isArray(group?.files) || group.files.length !== WARM_PILOT_FILES.length
        || new Set(group.files).size !== WARM_PILOT_FILES.length
        || group.files.some((file) => !WARM_PILOT_FILES.includes(file))) {
        throw new Error("Only the reviewed Bytes/FieldKey pair may be grouped, in either requested order");
      }
      if (groupIds.has(group.id)) throw new Error(`Duplicate test group id: ${group.id}`);
      groupIds.add(group.id);
      for (const file of group.files) {
        if (!canonical.has(file)) throw new Error(`Group test is outside canonical inventory: ${file}`);
        if (wantedTests.has(file) || groupedFiles.has(file)) throw new Error(`Overlapping test group selection: ${file}`);
        groupedFiles.add(file);
      }
      groupSteps.push(makeTestGroup(group, group.files.map((file) => makeTest(file))));
    }
    for (const file of wantedTests) if (!canonical.has(file)) throw new Error(`Manifest test is outside canonical inventory: ${file}`);
    for (const id of wantedChecks) if (!plan.some((entry) => entry.id === id && entry.kind !== "test")) throw new Error(`Unknown manifest check: ${id}`);
    plan = plan.filter((entry) => entry.kind === "test" ? wantedTests.has(entry.file) : wantedChecks.has(entry.id));
    for (const file of wantedTests) if (!plan.some((entry) => entry.file === file)) throw new Error(`Manifest test is outside selected suite: ${file}`);
    plan.push(...groupSteps);
  }
  if (!plan.length) throw new Error("Verification selection is empty");
  return { head: knownHead, suite, runBudgetMs: runBudgetMs ?? null, canonicalTestCount: tests.length, canonicalTests: tests,
    prerequisites: workflows.prerequisites, ...(suite === "ci-commands" ? { ciCommandProfile: CI_COMMAND_PROFILE } : {}), steps: plan };
}

export function inspectLog(log, isTest, expectedFiles) {
  const clean = log.replace(/\x1b\[[0-9;]*m/gu, "");
  const counts = {};
  for (const match of clean.matchAll(/^\s*(\d+) (pass|fail|skip|todo)\s*$/gmu)) counts[match[2]] = Number(match[1]);
  const finalLine = clean.trimEnd().split(/\r?\n/u).at(-1)?.trim() ?? "";
  const footer = /^Ran (\d+) tests? across (\d+) files?\.(?:\s+\[[^\]\r\n]+\])?$/u.exec(finalLine);
  const summary = (expectedFiles === undefined ? /^Ran \d+ tests? across 1 file\./u.test(finalLine) : footer !== null)
    && Number.isInteger(counts.pass) && Number.isInteger(counts.fail);
  const crashLines = clean.split(/\r?\n/u).filter((line) => /(?:^panic:|^Bun has crashed|^Segmentation fault|^fatal error:|^FATAL ERROR:|^Illegal instruction|^Assertion failed:|^Aborted(?:\s|$))/iu.test(line)).slice(0, 20);
  if (expectedFiles === undefined) return { counts, summaryPresent: isTest ? summary : null, crashLines };
  const observedFileOrder = [...clean.matchAll(/^([^\r\n]+\.(?:test|spec)\.(?:[cm]?[jt]sx?)):\r?$/gmu)]
    .map((match) => match[1].replaceAll("\\", "/").replace(/^\.\//u, ""));
  const reportedFileCount = footer ? Number(footer[2]) : null;
  const reportedTestCount = footer ? Number(footer[1]) : null;
  const fileSectionsMatch = observedFileOrder.length === expectedFiles.length
    && new Set(observedFileOrder).size === expectedFiles.length
    && observedFileOrder.every((file) => expectedFiles.includes(file));
  const fileOrderMatchesRequested = fileSectionsMatch && observedFileOrder.every((file, index) => file === expectedFiles[index]);
  return {
    counts, summaryPresent: isTest ? summary : null, crashLines,
    reportedFileCount, reportedTestCount, observedFileOrder, fileSectionsMatch, fileOrderMatchesRequested,
    groupReportComplete: summary && reportedFileCount === expectedFiles.length && fileSectionsMatch
      && reportedTestCount > 0 && reportedTestCount === ["pass", "fail", "skip", "todo"].reduce((sum, key) => sum + (counts[key] ?? 0), 0),
  };
}

export function inspectCiTestLog(log, entry) {
  const { groupReportComplete, ...report } = inspectLog(log, true, entry.files);
  const knownFileSections = new Set(report.observedFileOrder).size === report.observedFileOrder.length
    && report.observedFileOrder.every((file) => entry.files.includes(file));
  const filtered = entry.testNamePatterns.length > 0;
  const totalsMatch = report.reportedTestCount > 0 && report.reportedTestCount
    === ["pass", "fail", "skip", "todo"].reduce((sum, key) => sum + (report.counts[key] ?? 0), 0);
  return { ...report,
    // A filter may leave a named file without a reported case/file section.
    // This certifies one command's aggregate report, never every authored case.
    commandReportComplete: filtered
      ? report.summaryPresent && knownFileSections && totalsMatch
        && report.reportedFileCount === report.observedFileOrder.length && report.observedFileOrder.length > 0
      : groupReportComplete,
    unobservedFiles: entry.files.filter((file) => !report.observedFileOrder.includes(file)),
  };
}

export function commandEnvironment(temp, extra = {}) {
  const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, FENEL_PARSER_LEGACY: "1", FENEL_TEST_BROWSER_CHANNEL: "chromium", NO_COLOR: "1", FORCE_COLOR: "0" };
  // Match CI's DB-less checks even when an operator exports staging settings.
  delete env.DATABASE_URL;
  delete env.FENEL_STORAGE_DB_FIRST;
  delete env.FENEL_LEGACY_DISPATCH;
  for (const [key, value] of Object.entries(extra)) {
    if (value === null) delete env[key];
    else env[key] = String(value);
  }
  return env;
}

export async function runCommand(entry, { root, logPath, temp, signal, heartbeat = () => {}, environment, startup, stdoutLogPath }) {
  // C1 callers may preserve their existing environment and report startup on fd 3.
  // Defaults, stdout/stderr log descriptors and canonical receipts stay unchanged.
  if (startup && (!Number.isSafeInteger(startup.timeoutMs) || startup.timeoutMs <= 0
    || startup.timeoutMs > 2_147_483_647 || typeof startup.marker !== "string" || !startup.marker.length
    || startup.marker.length > 1024 || /[^\x00-\x7f]/u.test(startup.marker))) {
    throw new Error("startup requires a positive bounded timeout and an ASCII marker of 1 to 1024 bytes");
  }
  if (stdoutLogPath) {
    if (entry.kind && entry.kind !== "check") throw new Error("Separate stdout logs are supported only for check commands");
    containedPath(root, stdoutLogPath);
    if (resolve(stdoutLogPath) === resolve(logPath)) throw new Error("stdoutLogPath must differ from logPath");
    if (startup && resolve(stdoutLogPath) === resolve(`${logPath}.startup`)) throw new Error("stdoutLogPath must differ from the startup marker path");
  }
  containedPath(root, logPath);
  containedPath(root, temp);
  const startedAt = new Date().toISOString(), start = performance.now();
  const fd = openSync(logPath, "wx");
  let child, deadline, pulse, cleanupDeadline, interrupted = false, timedOut = false, killError, cleanupIncomplete = false, termination;
  let treeTermination = "not-requested";
  const startupLogPath = startup ? `${logPath}.startup` : undefined;
  let stdoutFd, startupFd, startupDeadline, startupReady = false, startupObservedAfterMs = null, startupTimedOut = false;
  let release;
  const terminate = async () => {
    if (!child?.pid) { treeTermination = "not-spawned"; return; }
    if (child.exitCode !== null || child.signalCode !== null) { treeTermination = "already-closed"; return; }
    treeTermination = "pending";
    if (process.platform === "win32") {
      await new Promise((done) => {
        const killer = spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true, shell: false, stdio: "ignore" });
        const helperDeadline = setTimeout(() => { treeTermination = "failed"; killError = "taskkill did not close within 10 seconds"; killer.kill(); done(); }, 10_000);
        killer.once("error", (error) => { treeTermination = "failed"; clearTimeout(helperDeadline); killError = error.message; child.kill("SIGKILL"); done(); });
        killer.once("close", (code) => { treeTermination = code === 0 && !killError ? "succeeded" : "failed"; clearTimeout(helperDeadline); if (code !== 0 && child.exitCode === null) { killError = `taskkill exit ${code}`; child.kill("SIGKILL"); } done(); });
      });
    } else {
      try { process.kill(-child.pid, "SIGKILL"); treeTermination = "signal-sent"; }
      catch (error) { treeTermination = error.code === "ESRCH" ? "absent" : "failed"; if (error.code !== "ESRCH") killError = error.message; }
    }
  };
  const stop = () => {
    if (termination) return;
    // Refuse to start another command if termination cannot be established.
    cleanupDeadline = setTimeout(() => { cleanupIncomplete = true; release?.(); }, 20_000);
    termination = terminate();
  };
  const abort = () => { interrupted = true; stop(); };
  let status = null, exitSignal = null, error;
  const observeStartup = () => {
    if (!startup || startupReady || startupFd === undefined) return;
    try {
      const size = fstatSync(startupFd).size;
      if (size > 65_536) throw new Error("Child startup marker exceeds 64KiB");
      const bytes = Buffer.alloc(size);
      let length = 0;
      while (length < size) {
        const read = readSync(startupFd, bytes, length, size - length, length);
        if (!read) break;
        length += read;
      }
      if (bytes.subarray(0, length).toString("latin1").includes(startup.marker)) {
        startupReady = true; startupObservedAfterMs = Math.round(performance.now() - start);
        clearTimeout(startupDeadline);
      }
    } catch (failure) { error = failure.message; stop(); }
  };
  try {
    if (stdoutLogPath) stdoutFd = openSync(stdoutLogPath, "wx");
    if (startup) startupFd = openSync(startupLogPath, "wx+");
    if (signal?.aborted) interrupted = true;
    else await new Promise((done) => {
      release = done;
      child = spawn(entry.executable, entry.args, { cwd: root, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: startup ? ["ignore", stdoutFd ?? fd, fd, startupFd] : ["ignore", stdoutFd ?? fd, fd], env: environment ?? commandEnvironment(temp, entry.env) });
      child.once("error", (failure) => { error = failure.message; done(); });
      child.once("close", (code, sig) => { observeStartup(); status = code; exitSignal = sig; done(); });
      if (startup) {
        // Read at deadline or settlement: no polling and no Windows extra-pipe ABI.
        startupDeadline = setTimeout(() => {
          observeStartup();
          if (!startupReady) { startupTimedOut = true; timedOut = true; stop(); }
        }, startup.timeoutMs);
      }
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      deadline = setTimeout(() => { timedOut = true; stop(); observeStartup(); }, entry.timeoutMs);
      pulse = setInterval(() => heartbeat({ id: entry.id, pid: child.pid, elapsedMs: Math.round(performance.now() - start) }), 30_000);
    });
  } finally {
    if (termination) await termination;
    clearTimeout(deadline); clearTimeout(cleanupDeadline); clearInterval(pulse);
    clearTimeout(startupDeadline);
    signal?.removeEventListener("abort", abort);
    closeSync(fd);
    if (stdoutFd !== undefined) closeSync(stdoutFd);
    if (startupFd !== undefined) { const closingFd = startupFd; startupFd = undefined; closeSync(closingFd); }
  }
  const isGroup = entry.kind === "test-group", isCiTest = entry.kind === "ci-test-command", isTest = entry.kind === "test" || isGroup || isCiTest;
  const log = (stdoutLogPath ? readFileSync(stdoutLogPath, "utf8") + "\n" : "") + readFileSync(logPath, "utf8");
  const diagnostics = isCiTest ? inspectCiTestLog(log, entry) : inspectLog(log, isTest, isGroup ? entry.files : undefined);
  const passed = status === 0 && !timedOut && !interrupted && !error && !killError && !cleanupIncomplete && diagnostics.crashLines.length === 0
    && (!startup || startupReady)
    && (!isTest || (diagnostics.summaryPresent && diagnostics.counts.fail === 0))
    && (!isGroup || (diagnostics.groupReportComplete && diagnostics.fileOrderMatchesRequested))
    && (!isCiTest || diagnostics.commandReportComplete);
  const groupEvidence = isGroup ? { files: entry.files, requestedFileOrder: entry.requestedFileOrder,
    outerTimeoutScope: "group", coverageScope: "aggregate-only", memberIsolatedBudgets: entry.memberIsolatedBudgets } : {};
  const ciEvidence = entry.workflowPath ? {
    workflow: entry.workflow, workflowPath: entry.workflowPath, job: entry.job, stepIndex: entry.stepIndex,
    declaredRun: entry.declaredRun, declaredCommand: entry.declaredCommand, expandedCommand: entry.expandedCommand,
    packageScript: entry.packageScript, declaredEnv: entry.declaredEnv, localAdaptations: entry.localAdaptations,
    outerTimeoutScope: "command", timeoutBasis: entry.timeoutBasis, declaredJobTimeoutMs: entry.declaredJobTimeoutMs,
    ...(isCiTest ? { files: entry.files, testNamePatterns: entry.testNamePatterns, bail: entry.bail,
      coverageScope: "command-aggregate", selectionScope: entry.selectionScope } : {}),
  } : {};
  const startupEvidence = startup ? { startup: { timeoutMs: startup.timeoutMs, ready: startupReady, observedAfterMs: startupObservedAfterMs, timedOut: startupTimedOut, logPath: relative(root, startupLogPath).replaceAll("\\", "/") } } : {};
  const stdoutEvidence = stdoutLogPath ? { stdoutLogPath: relative(root, stdoutLogPath).replaceAll("\\", "/") } : {};
  const environmentEvidence = environment == null ? {} : { environmentSource: "caller" };
  return { id: entry.id, kind: entry.kind ?? "check", file: entry.file, ...groupEvidence, ...ciEvidence, ...startupEvidence, ...stdoutEvidence, ...environmentEvidence, executable: entry.executable, args: entry.args, env: entry.env ?? {}, timeoutMs: entry.timeoutMs, pid: child?.pid, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), exitCode: status, signal: exitSignal, timedOut, interrupted, error, killError, cleanupIncomplete, treeTermination, logPath: relative(root, logPath).replaceAll("\\", "/"), ...diagnostics, passed };
}

export function compareReceipts(previous, current) {
  if (previous.schema !== SCHEMA || current.schema !== SCHEMA) throw new Error("Baseline must be a verification-run.v1 receipt");
  const sameRoster = previous.rosterDigest === current.rosterDigest;
  const bothComplete = previous.complete === true && current.complete === true;
  return { sameRoster, bothComplete, sameHead: previous.head === current.head, bothPassed: previous.passed && current.passed, previousElapsedMs: previous.elapsedMs, currentElapsedMs: current.elapsedMs, observedDifferenceMs: sameRoster && bothComplete ? previous.elapsedMs - current.elapsedMs : null, note: "Difference requires matching rosters and complete plan attempts; source, cache, case coverage and host conditions may differ. This is not an isolated causal speedup." };
}

function receiptDigest(plan, output) {
  return createHash("sha256").update(JSON.stringify(plan.steps.map((entry) => ({ ...entry, args: entry.args.map((arg) => arg.replaceAll(output, "<OUTPUT>").replaceAll(`--source-commit=${plan.head}`, "--source-commit=<HEAD>")) })))).digest("hex");
}

// C2 process orchestration only. The budget starts at main entry, but synchronous
// planning/capture and mandatory cleanup/final evidence can outlive the deadline.
// An exhausted run is incomplete; authored case and file budgets are unchanged.
export async function runPlanSteps(steps, {
  root, temp, outputPath, signal, runBudgetMs, started = performance.now(),
  onResult = async () => {}, progress = () => {}, run = runCommand,
}) {
  if (runBudgetMs !== undefined && (!Number.isSafeInteger(runBudgetMs) || runBudgetMs <= 0 || runBudgetMs > 2_147_483_647)) {
    throw new Error("runBudgetMs must be an integer from 1 to 2147483647");
  }
  const results = [];
  let stopReason = null;
  for (const [index, entry] of steps.entries()) {
    if (signal?.aborted) { stopReason = "operator"; break; }
    const remaining = runBudgetMs === undefined ? undefined : runBudgetMs - (performance.now() - started);
    if (remaining !== undefined && remaining <= 0) { stopReason = "run-budget"; break; }
    const controller = new AbortController();
    let timer, interruptedBy = null;
    const interrupt = (reason) => {
      if (controller.signal.aborted) return;
      interruptedBy = reason;
      controller.abort();
    };
    const operator = () => interrupt("operator");
    signal?.addEventListener("abort", operator, { once: true });
    if (signal?.aborted) operator();
    if (remaining !== undefined) timer = setTimeout(() => interrupt("run-budget"), remaining);
    let result;
    try {
      progress(`[verification] ${index + 1}/${steps.length} start ${entry.id}`);
      const filename = `${String(index + 1).padStart(4, "0")}-${entry.id.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 150)}.log`;
      result = await run(entry, {
        root, temp, signal: controller.signal, logPath: join(outputPath, filename),
        heartbeat: ({ id, elapsedMs }) => progress(`[verification] running ${id} ${Math.round(elapsedMs / 1000)}s`),
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", operator);
    }
    result.interruptionReason = result.interrupted ? interruptedBy : null;
    results.push(result);
    await onResult(result, index);
    progress(`[verification] ${result.passed ? "PASS" : "FAIL"} ${entry.id} exit=${result.exitCode} wall=${result.elapsedMs}ms timeout=${result.timedOut}`);
    if (result.cleanupIncomplete || result.killError) { stopReason = "cleanup-refused"; break; }
    if (interruptedBy) { stopReason = interruptedBy; break; }
    if (signal?.aborted) { stopReason = "operator"; break; }
    if (runBudgetMs !== undefined && performance.now() - started >= runBudgetMs) { stopReason = "run-budget"; break; }
  }
  return {
    results, stopReason,
    complete: results.length === steps.length && stopReason === null,
    unattemptedStepIds: steps.slice(results.length).map((entry) => entry.id),
  };
}

function parseOptions(args) {
  const options = { suite: "all-tests" };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--list" || arg === "--dry-run") options.list = true;
    else if (arg === "--full-laws") options.fullLaws = true;
    else if (arg.startsWith("--suite=")) options.suite = arg.slice(8);
    else if (arg.startsWith("--output=")) options.output = arg.slice(9);
    else if (arg.startsWith("--manifest=")) options.manifestPath = arg.slice(11);
    else if (arg.startsWith("--baseline=")) options.baselinePath = arg.slice(11);
    else if (arg.startsWith("--test-timeout-ms=")) options.testTimeoutMs = Number(arg.slice(18));
    else if (arg.startsWith("--file-timeout-ms=")) options.fileTimeoutMs = Number(arg.slice(18));
    else if (arg.startsWith("--run-budget-ms=")) options.runBudgetMs = Number(arg.slice(16));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ["testTimeoutMs", "fileTimeoutMs"]) if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key] <= 0)) throw new Error(`${key} must be a positive integer`);
  if (options.runBudgetMs !== undefined && (!Number.isSafeInteger(options.runBudgetMs) || options.runBudgetMs <= 0 || options.runBudgetMs > 2_147_483_647)) throw new Error("runBudgetMs must be an integer from 1 to 2147483647");
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString(), started = performance.now();
  const options = parseOptions(args);
  if (options.help) {
    console.log("--suite=ci-commands preserves declared YAML command grouping/flags and merged workflow/job/step env, with local no-env/temp/DB safeguards and default parser unless YAML specifies legacy. Select whole command IDs with {tests:[],checks:[],commands:[...]}. Setup/install remain prerequisites; local serial execution does not reproduce GitHub provisioning, parallel jobs, job deadlines or failure skipping. Unmodeled parent env remains inherited. Existing --suite=ci remains a per-file inventory.");
    console.log("Optional --run-budget-ms=<milliseconds> limits cumulative execution from command entry. Budget exhaustion retains results, lists unattempted steps and exits nonzero. Planning, source capture, owned-child cleanup and final receipt publication can exceed this deadline.");
    console.log("Experimental manifest groups require --suite=tests and only admit the Bytes/FieldKey pair. Shape: groups:[{id:'bytes-field-key',files:[...],timeoutMs:180000}]. Group receipts retain aggregate counts and observed file order; a group watchdog replaces isolated file watchdogs for this pilot. Authored case/hook budgets remain. A requested order not observed fails the pilot.");
    console.log("Usage: bun --no-env-file scripts/run-verification.mjs [--suite=all-tests|tests|gates|ci|ci-commands|ci-checks|full] [--list] [--manifest=<repo JSON>] [--output=<repo directory>] [--baseline=<receipt>] [--test-timeout-ms=60000] [--file-timeout-ms=<budget>] [--run-budget-ms=<budget>] [--full-laws]\nAll commands are serial. all-tests runs tracked canonical tests and local gates; full also runs non-test normal CI checks. ci-checks runs remaining normal CI checks after local gates. CI dependency/browser installation is a recorded prerequisite, not rerun. Selection JSON: {\"tests\":[\"scripts/tests/example.test.mjs\"],\"checks\":[\"effects\"]}. Full laws are opt-in. Regeneration is a separate mutation transaction; this runner checks artifacts. Output directories must be new and repository-contained.");
    return 0;
  }
  const root = REPOSITORY_ROOT;
  const output = options.output ?? `.tmp-diag/verification-${new Date().toISOString().replace(/[:.]/gu, "-")}-${process.pid}`;
  const outputPath = containedPath(root, output);
  const manifest = options.manifestPath ? JSON.parse(readFileSync(containedPath(root, options.manifestPath, true), "utf8")) : undefined;
  const baseline = options.baselinePath ? JSON.parse(readFileSync(containedPath(root, options.baselinePath, true), "utf8")) : undefined;
  const plan = buildPlan({ ...options, root, output, manifest });
  if (options.list) { console.log(JSON.stringify(plan, null, 2)); return 0; }
  const trackedStateBefore = captureTrackedState(root);
  if (trackedStateBefore.head !== plan.head) throw new Error("Git HEAD changed during verification planning");
  const rawRepositoryBefore = await captureRawRepositoryState(root);
  if (existsSync(outputPath)) throw new Error(`Output directory already exists: ${output}`);
  mkdirSync(outputPath, { recursive: true });
  const temp = join(outputPath, "temp"); mkdirSync(temp);
  mkdirSync(containedPath(root, ".tmp-tsc"), { recursive: true });
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  const receipt = { schema: SCHEMA, head: plan.head, trackedStateBefore, rawRepositoryBefore, suite: plan.suite, rosterDigest: receiptDigest(plan, output), startedAt, command: ["bun", "--no-env-file", "scripts/run-verification.mjs", ...args], gitStatusBefore: git(root, ["status", "--porcelain=v1", "-uno"]), canonicalTestCount: plan.canonicalTestCount, plannedSteps: plan.steps, prerequisites: plan.prerequisites,
    ...(plan.ciCommandProfile ? { ciCommandProfile: plan.ciCommandProfile } : {}),
    results: [], complete: false, passed: false, elapsedMs: 0, runBudgetMs: options.runBudgetMs ?? null, stopReason: null, unattemptedStepIds: plan.steps.map((entry) => entry.id) };
  const publishReceipt = createReceiptWriter({ root, path: join(outputPath, "receipt.json"), pending: join(outputPath, "receipt.pending.json") });
  const save = async () => {
    receipt.elapsedMs = Math.round(performance.now() - started);
    await publishReceipt(receipt);
  };
  let finalReceiptPublished = false;
  try {
    await save();
    const execution = await runPlanSteps(plan.steps, {
      root, temp, outputPath, signal: controller.signal, started, runBudgetMs: options.runBudgetMs,
      progress: (message) => console.log(message),
      onResult: async (result, index) => {
        receipt.results.push(result);
        receipt.unattemptedStepIds = plan.steps.slice(index + 1).map((entry) => entry.id);
        await save();
      },
    });
    receipt.complete = execution.complete;
    receipt.stopReason = execution.stopReason;
    receipt.unattemptedStepIds = execution.unattemptedStepIds;
    receipt.finishedAt = new Date().toISOString();
    receipt.gitStatusAfter = git(root, ["status", "--porcelain=v1", "-uno"]);
    receipt.trackedStateAfter = captureTrackedState(root);
    receipt.rawRepositoryAfter = await captureRawRepositoryState(root);
    receipt.headAfter = receipt.trackedStateAfter.head;
    receipt.sourceStateUnchanged = sameSourceState(receipt.trackedStateBefore, receipt.trackedStateAfter, receipt.rawRepositoryBefore, receipt.rawRepositoryAfter) && receipt.gitStatusBefore === receipt.gitStatusAfter;
    receipt.passed = receipt.complete && receipt.results.every((result) => result.passed) && receipt.sourceStateUnchanged;
    if (!receipt.sourceStateUnchanged) console.log("[verification] REFUSED: raw covered-source epoch, Git HEAD, tracked diff bytes or tracked status changed during the read-only suite");
    receipt.elapsedMs = Math.round(performance.now() - started);
    if (baseline) receipt.comparison = compareReceipts(baseline, receipt);
    await save();
    finalReceiptPublished = true;
    console.log(`[verification] ${receipt.passed ? "PASS" : "FAIL"} ${receipt.results.length}/${plan.steps.length} steps wall=${receipt.elapsedMs}ms receipt=${relative(root, join(outputPath, "receipt.json"))}`);
    return controller.signal.aborted ? 130 : receipt.passed ? 0 : 1;
  } finally {
    try { if (!finalReceiptPublished) await save(); }
    finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`[verification] ${error.stack ?? error}`); process.exitCode = 1; });
}
