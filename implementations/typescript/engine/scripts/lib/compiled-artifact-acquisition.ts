/**
 * Recursive, byte-only acquisition census for an isolated compiled-artifact worker.
 *
 * The caller supplies one race-stable capture plus any fixed materialized stubs.
 * This module never consults the live filesystem or ambient module resolver.
 */

import {
  compareUtf8Paths,
  repositoryRelativePath,
  sha256Raw,
  type CapturedByteStore,
  type RepositoryRelativePath,
  type Sha256Hex,
} from "./artifact-bytes";

export const COMPILED_ARTIFACT_ACQUISITION_SCHEMA =
  "fenel.compiled-artifact-acquisition.v1" as const;

export const DEFAULT_COMPILED_ARTIFACT_WORKER_BUILTINS = Object.freeze([
  "node:crypto",
  "node:util",
] as const);

const ENGINE_SOURCE_ROOT = "implementations/typescript/engine/src";
const SOURCE_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const);
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const ABSOLUTELY_FORBIDDEN_BUILTINS = new Set([
  "node:child_process",
  "node:cluster",
  "node:dgram",
  "node:dns",
  "node:dns/promises",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:http2",
  "node:https",
  "node:inspector",
  "node:module",
  "node:net",
  "node:process",
  "node:repl",
  "node:tls",
  "node:v8",
  "node:vm",
  "node:worker_threads",
  "bun:ffi",
  "bun:sqlite",
]);
const FILE_READ_CALLEES = new Set([
  "file",
  "readFile",
  "readFileSync",
  "readText",
  "readTextFile",
]);
const DIRECTORY_READ_CALLEES = new Set([
  "opendir",
  "opendirSync",
  "readdir",
  "readdirSync",
]);
const GLOB_CALLEES = new Set(["Glob", "glob", "globSync"]);
const FILESYSTEM_CAPABILITY_CALLEES = new Set([
  "Glob",
  "glob",
  "globSync",
  "opendir",
  "opendirSync",
  "readFile",
  "readFileSync",
  "readText",
  "readTextFile",
  "readdir",
  "readdirSync",
]);
const PERMITTED_PROCESS_MEMBERS = new Set([
  "arch",
  "argv",
  "cwd",
  "env",
  "execPath",
  "exit",
  "platform",
  "stdin",
  "stdout",
]);
const MATRIX_LLVM_BUN_CAPABILITY_PATH =
  "implementations/typescript/engine/src/compile-llvm-self-host-classifier.ts";
const MATRIX_LLVM_BUN_ALIAS_DECLARATIONS = Object.freeze([
  Object.freeze({
    source: "const bun = (globalThis as { Bun?: { which: (n: string) => string | null } }).Bun;",
    expectedCount: 1,
  }),
  Object.freeze({
    source: "const bun = (globalThis as { Bun?: BunNamespace }).Bun;",
    expectedCount: 2,
  }),
] as const);
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const DYNAMIC_FUNCTION_IDENTIFIERS = new Set([
  "AsyncFunction",
  "AsyncGeneratorFunction",
  "Function",
  "GeneratorFunction",
]);

type DynamicCodePin = {
  readonly expectedCount: number;
  readonly matches: (tokens: readonly LexToken[], functionIndex: number) => boolean;
};

export type CompiledArtifactAcquisitionErrorCode =
  | "ambiguous-resolution"
  | "computed-environment-access"
  | "dynamic-code-evaluation"
  | "duplicate-input"
  | "forbidden-builtin"
  | "forbidden-runtime-introspection"
  | "host-sensitive-operation"
  | "invalid-entrypoint"
  | "invalid-source"
  | "invalid-utf8"
  | "missing-input"
  | "non-node-bare-package"
  | "undeclared-environment-key"
  | "unresolved-computed-acquisition"
  | "unsupported-source-kind";

export class CompiledArtifactAcquisitionError extends Error {
  constructor(
    readonly code: CompiledArtifactAcquisitionErrorCode,
    message: string,
    readonly path?: RepositoryRelativePath,
  ) {
    super(message);
    this.name = "CompiledArtifactAcquisitionError";
  }
}

export interface MaterializedAcquisitionFile {
  readonly path: RepositoryRelativePath;
  readonly bytes: Uint8Array;
}

export type RuntimeAcquisitionKind =
  | "commonjs-module"
  | "dynamic-module"
  | "engine-require"
  | "literal-directory"
  | "literal-glob"
  | "literal-read"
  | "module-resolve"
  | "runtime-worker-asset"
  | "static-module";

export interface LexicalAcquisitionRow {
  readonly kind: RuntimeAcquisitionKind;
  readonly specifier: string;
}

export type ComputedFileAcquisitionKind =
  | "literal-directory"
  | "literal-glob"
  | "literal-read";

export interface ComputedFileAcquisitionObservation {
  readonly path: RepositoryRelativePath;
  readonly kind: ComputedFileAcquisitionKind;
  readonly callee: string;
  readonly offset: number;
  readonly expression: string;
}

export interface DynamicCodeConstructorObservation {
  readonly path: RepositoryRelativePath;
  readonly callee: string;
  readonly offset: number;
  readonly expression: string;
}

export interface MemberAccessObservation {
  readonly path: RepositoryRelativePath;
  readonly object: string;
  readonly member: string;
  readonly offset: number;
}

export interface IdentifierObservation {
  readonly path: RepositoryRelativePath;
  readonly identifier: string;
  readonly offset: number;
}

export interface SourceAcquisitionCensusOptions {
  readonly allowComputedFileAcquisition?: (
    observation: ComputedFileAcquisitionObservation,
  ) => boolean;
  readonly allowDynamicCodeConstructor?: (
    observation: DynamicCodeConstructorObservation,
  ) => boolean;
  readonly observeMemberAccess?: (observation: MemberAccessObservation) => void;
  readonly observeIdentifier?: (observation: IdentifierObservation) => void;
}

export interface LexicalSourceAcquisitionCensus {
  readonly acquisitions: readonly LexicalAcquisitionRow[];
  readonly computedFileAcquisitions: readonly ComputedFileAcquisitionObservation[];
  readonly dynamicCodeConstructors: readonly DynamicCodeConstructorObservation[];
  readonly hostSensitiveOperations: readonly HostSensitiveOperationRow[];
  readonly typeOnlySpecifiers: readonly string[];
}

export interface RuntimeAcquisitionEdge {
  readonly from: RepositoryRelativePath;
  readonly kind: RuntimeAcquisitionKind;
  readonly specifier: string;
  readonly raw: boolean;
  readonly builtin: string | null;
  readonly targets: readonly RepositoryRelativePath[];
}

export interface TypeOnlyAcquisitionEdge {
  readonly from: RepositoryRelativePath;
  readonly specifier: string;
  readonly target: RepositoryRelativePath | null;
}

export interface AcquiredSourceRow {
  readonly path: RepositoryRelativePath;
  readonly role: "code" | "data" | "raw";
  readonly byteLength: number;
  readonly sha256: Sha256Hex;
}

export type HostSensitiveOperationKind =
  | "absolute-path"
  | "current-time"
  | "directory-order"
  | "locale-format"
  | "locale-order"
  | "platform-architecture"
  | "randomness";

export interface HostSensitiveOperationRow {
  readonly path: RepositoryRelativePath;
  readonly kind: HostSensitiveOperationKind;
  readonly offset: number;
}

export interface ClosedCompiledArtifactAcquisition {
  readonly schema: typeof COMPILED_ARTIFACT_ACQUISITION_SCHEMA;
  readonly entrypoints: readonly RepositoryRelativePath[];
  readonly sourceRows: readonly AcquiredSourceRow[];
  readonly runtimeEdges: readonly RuntimeAcquisitionEdge[];
  readonly typeOnlyEdges: readonly TypeOnlyAcquisitionEdge[];
  readonly builtins: readonly string[];
  readonly allowedBuiltins: readonly string[];
  readonly declaredEnvironmentKeys: readonly string[];
  readonly observedEnvironmentKeys: readonly string[];
  readonly hostSensitiveOperations: readonly HostSensitiveOperationRow[];
  readonly digest: Sha256Hex;
}

export interface CloseCompiledArtifactAcquisitionInput {
  readonly entrypoints: readonly RepositoryRelativePath[];
  readonly bytes: CapturedByteStore;
  readonly materializedFiles?: readonly MaterializedAcquisitionFile[];
  readonly declaredEnvironmentKeys: readonly string[];
}

type LexToken = {
  readonly kind: "computed-template" | "identifier" | "number" | "punct" | "string";
  readonly value: string;
  readonly offset: number;
  readonly templateSegments?: readonly string[];
};

type ModuleScanImport = {
  readonly kind: string;
  readonly path: string;
};

function fail(
  code: CompiledArtifactAcquisitionErrorCode,
  message: string,
  path?: RepositoryRelativePath,
): never {
  throw new CompiledArtifactAcquisitionError(code, message, path);
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return difference;
  }
  return a.byteLength - b.byteLength;
}

function sortedUniqueStrings(values: readonly string[]): readonly string[] {
  const sorted = [...values].sort(compareUtf8);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1] === sorted[index]) {
      fail("duplicate-input", `duplicate acquisition declaration ${JSON.stringify(sorted[index])}`);
    }
  }
  return Object.freeze(sorted);
}

function directoryOf(path: RepositoryRelativePath): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function normalizeSegments(base: string, value: string): RepositoryRelativePath {
  if (
    value.length === 0
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/u.test(value)
    || value.includes("\0")
  ) {
    fail("unresolved-computed-acquisition", `non-portable acquisition path ${JSON.stringify(value)}`);
  }
  const output = base.length === 0 ? [] : base.split("/");
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (output.length === 0) {
        fail("unresolved-computed-acquisition", `acquisition escapes repository: ${value}`);
      }
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return repositoryRelativePath(output.join("/"));
}

function normalizeGlob(value: string): string {
  if (
    value.length === 0
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/u.test(value)
    || value.includes("\0")
  ) {
    fail("unresolved-computed-acquisition", `non-portable literal glob ${JSON.stringify(value)}`);
  }
  const output: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (output.length === 0) {
        fail("unresolved-computed-acquisition", `literal glob escapes repository: ${value}`);
      }
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return output.join("/");
}

function decodeEscape(source: string, index: number): { readonly value: string; readonly next: number } {
  const marker = source[index];
  if (marker === undefined) return { value: "", next: index };
  const simple: Readonly<Record<string, string>> = Object.freeze({
    "0": "\0",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  });
  const simpleValue = simple[marker];
  if (simpleValue !== undefined) return { value: simpleValue, next: index + 1 };
  if (marker === "\n") return { value: "", next: index + 1 };
  if (marker === "\r") {
    return { value: "", next: source[index + 1] === "\n" ? index + 2 : index + 1 };
  }
  if (marker === "x") {
    const digits = source.slice(index + 1, index + 3);
    if (!/^[0-9A-Fa-f]{2}$/u.test(digits)) return { value: marker, next: index + 1 };
    return { value: String.fromCodePoint(Number.parseInt(digits, 16)), next: index + 3 };
  }
  if (marker === "u") {
    if (source[index + 1] === "{") {
      const end = source.indexOf("}", index + 2);
      const digits = end < 0 ? "" : source.slice(index + 2, end);
      if (!/^[0-9A-Fa-f]{1,6}$/u.test(digits)) return { value: marker, next: index + 1 };
      return { value: String.fromCodePoint(Number.parseInt(digits, 16)), next: end + 1 };
    }
    const digits = source.slice(index + 1, index + 5);
    if (!/^[0-9A-Fa-f]{4}$/u.test(digits)) return { value: marker, next: index + 1 };
    return { value: String.fromCodePoint(Number.parseInt(digits, 16)), next: index + 5 };
  }
  return { value: marker, next: index + 1 };
}

function tokenAllowsRegex(token: LexToken | undefined): boolean {
  if (token === undefined) return true;
  if (token.kind === "punct") {
    return "([{,:;=!?&|+-*%^~<>".includes(token.value);
  }
  return token.kind === "identifier" && new Set([
    "await",
    "case",
    "delete",
    "do",
    "else",
    "in",
    "instanceof",
    "new",
    "of",
    "return",
    "throw",
    "typeof",
    "void",
    "yield",
  ]).has(token.value);
}

function lexSource(source: string, path: RepositoryRelativePath): readonly LexToken[] {
  let index = 0;

  const scanCode = (stopAtTemplateBrace: boolean): LexToken[] => {
    const tokens: LexToken[] = [];
    let braceDepth = 0;
    while (index < source.length) {
      const character = source[index]!;
      if (/\s/u.test(character)) {
        index += 1;
        continue;
      }
      if (character === "}" && stopAtTemplateBrace && braceDepth === 0) {
        index += 1;
        return tokens;
      }
      if (character === "/" && source[index + 1] === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
        continue;
      }
      if (character === "/" && source[index + 1] === "*") {
        const end = source.indexOf("*/", index + 2);
        if (end < 0) fail("invalid-source", `unterminated comment in ${path}`, path);
        index = end + 2;
        continue;
      }
      if (character === "'" || character === '"') {
        const start = index;
        const quote = character;
        let value = "";
        index += 1;
        let closed = false;
        while (index < source.length) {
          const item = source[index]!;
          if (item === quote) {
            index += 1;
            closed = true;
            break;
          }
          if (item === "\\") {
            const decoded = decodeEscape(source, index + 1);
            value += decoded.value;
            index = decoded.next;
            continue;
          }
          if (item === "\n" || item === "\r") {
            fail("invalid-source", `unterminated string literal in ${path}`, path);
          }
          value += item;
          index += 1;
        }
        if (!closed) fail("invalid-source", `unterminated string literal in ${path}`, path);
        tokens.push({ kind: "string", value, offset: start });
        continue;
      }
      if (character === "`") {
        const start = index;
        index += 1;
        let value = "";
        let computed = false;
        const templateSegments = [""];
        const expressions: LexToken[] = [];
        let closed = false;
        while (index < source.length) {
          const item = source[index]!;
          if (item === "`") {
            index += 1;
            closed = true;
            break;
          }
          if (item === "\\") {
            const decoded = decodeEscape(source, index + 1);
            value += decoded.value;
            templateSegments[templateSegments.length - 1] += decoded.value;
            index = decoded.next;
            continue;
          }
          if (item === "$" && source[index + 1] === "{") {
            computed = true;
            index += 2;
            expressions.push(...scanCode(true));
            templateSegments.push("");
            continue;
          }
          value += item;
          templateSegments[templateSegments.length - 1] += item;
          index += 1;
        }
        if (!closed) fail("invalid-source", `unterminated template literal in ${path}`, path);
        tokens.push({
          kind: computed ? "computed-template" : "string",
          value,
          offset: start,
          templateSegments: computed ? Object.freeze(templateSegments) : undefined,
        });
        tokens.push(...expressions);
        continue;
      }
      if (
        character === "/"
        && source[index + 1] !== "="
        && tokenAllowsRegex(tokens.at(-1))
      ) {
        index += 1;
        let inClass = false;
        let closed = false;
        while (index < source.length) {
          const item = source[index]!;
          if (item === "\\") {
            index += 2;
            continue;
          }
          if (item === "[") inClass = true;
          if (item === "]") inClass = false;
          if (item === "/" && !inClass) {
            index += 1;
            while (/[A-Za-z]/u.test(source[index] ?? "")) index += 1;
            closed = true;
            break;
          }
          if (item === "\n" || item === "\r") break;
          index += 1;
        }
        if (!closed) fail("invalid-source", `unterminated regular expression in ${path}`, path);
        continue;
      }
      if (
        character === "\\"
        && source[index + 1] === "u"
        && (
          /^[0-9A-Fa-f]{4}/u.test(source.slice(index + 2))
          || /^\{[0-9A-Fa-f]{1,6}\}/u.test(source.slice(index + 2))
        )
      ) {
        fail("invalid-source", `Unicode identifier escape in code at ${path}@${index}`, path);
      }
      if (/[A-Za-z_$]/u.test(character)) {
        const start = index;
        index += 1;
        while (/[A-Za-z0-9_$]/u.test(source[index] ?? "")) index += 1;
        tokens.push({ kind: "identifier", value: source.slice(start, index), offset: start });
        continue;
      }
      if (/[0-9]/u.test(character)) {
        const start = index;
        index += 1;
        while (/[0-9A-Za-z_.]/u.test(source[index] ?? "")) index += 1;
        tokens.push({ kind: "number", value: source.slice(start, index), offset: start });
        continue;
      }
      if (character === "{") braceDepth += 1;
      if (character === "}") braceDepth -= 1;
      tokens.push({ kind: "punct", value: character, offset: index });
      index += 1;
    }
    if (stopAtTemplateBrace) fail("invalid-source", `unterminated template expression in ${path}`, path);
    return tokens;
  };

  return scanCode(false);
}

function tokenIs(token: LexToken | undefined, value: string): boolean {
  return token?.value === value;
}

function environmentMutationOperatorAt(
  tokens: readonly LexToken[],
  index: number,
): boolean {
  const first = tokens[index]?.value;
  const second = tokens[index + 1]?.value;
  const third = tokens[index + 2]?.value;
  const fourth = tokens[index + 3]?.value;
  if (first === "=") return second !== "=" && second !== ">";
  if (first === "+" || first === "-") return second === first || second === "=";
  if (first === "/" || first === "%" || first === "^") return second === "=";
  if (first === "*") return second === "=" || (second === "*" && third === "=");
  if (first === "&" || first === "|") {
    return second === "=" || (second === first && third === "=");
  }
  if (first === "?") return second === "?" && third === "=";
  if (first === "<") return second === "<" && third === "=";
  if (first === ">") {
    return (second === ">" && third === "=")
      || (second === ">" && third === ">" && fourth === "=");
  }
  return false;
}

function environmentPrefixMutationAt(
  tokens: readonly LexToken[],
  index: number,
): boolean {
  return tokenIsKind(tokens[index - 1], "identifier", "delete")
    || (tokenIs(tokens[index - 2], "+") && tokenIs(tokens[index - 1], "+"))
    || (tokenIs(tokens[index - 2], "-") && tokenIs(tokens[index - 1], "-"));
}

function tokenIsKind(
  token: LexToken | undefined,
  kind: LexToken["kind"],
  value: string,
): boolean {
  return token?.kind === kind && token.value === value;
}

function tokenIsComputedTemplate(
  token: LexToken | undefined,
  value: string,
  segments: readonly string[],
): boolean {
  if (token?.kind !== "computed-template" || token.value !== value) return false;
  const templateSegments = token.templateSegments;
  return templateSegments?.length === segments.length
    && templateSegments.every((segment, index) => segment === segments[index]);
}

function matchesNamespaceDynamicCodePin(
  tokens: readonly LexToken[],
  functionIndex: number,
): boolean {
  return tokenIsKind(tokens[functionIndex - 6], "identifier", "$ns")
    && tokenIs(tokens[functionIndex - 5], "[")
    && tokenIsKind(tokens[functionIndex - 4], "identifier", "code")
    && tokenIs(tokens[functionIndex - 3], "]")
    && tokenIs(tokens[functionIndex - 2], "=")
    && tokenIsKind(tokens[functionIndex - 1], "identifier", "new")
    && tokenIsKind(tokens[functionIndex], "identifier", "Function")
    && tokenIs(tokens[functionIndex + 1], "(")
    && tokenIsKind(tokens[functionIndex + 2], "string", "$ns")
    && tokenIs(tokens[functionIndex + 3], ",")
    && tokenIsComputedTemplate(
      tokens[functionIndex + 4],
      "with($ns){ return (); }",
      ["with($ns){ return (", "); }"],
    )
    && tokenIsKind(tokens[functionIndex + 5], "identifier", "body")
    && tokenIs(tokens[functionIndex + 6], ")")
    && tokenIs(tokens[functionIndex + 7], "(")
    && tokenIsKind(tokens[functionIndex + 8], "identifier", "$ns")
    && tokenIs(tokens[functionIndex + 9], ")");
}

function matchesSerializedDynamicCodePin(
  tokens: readonly LexToken[],
  functionIndex: number,
  runtimeName: string,
): boolean {
  return tokenIsKind(tokens[functionIndex - 4], "identifier", "const")
    && tokenIsKind(tokens[functionIndex - 3], "identifier", "fn")
    && tokenIs(tokens[functionIndex - 2], "=")
    && tokenIsKind(tokens[functionIndex - 1], "identifier", "new")
    && tokenIsKind(tokens[functionIndex], "identifier", "Function")
    && tokenIs(tokens[functionIndex + 1], "(")
    && tokenIsKind(tokens[functionIndex + 2], "string", "$fenel")
    && tokenIs(tokens[functionIndex + 3], ",")
    && tokenIsComputedTemplate(
      tokens[functionIndex + 4],
      "return ;",
      ["return ", ";"],
    )
    && tokenIsKind(tokens[functionIndex + 5], "identifier", "serialized")
    && tokenIs(tokens[functionIndex + 6], ".")
    && tokenIsKind(tokens[functionIndex + 7], "identifier", "_0")
    && tokenIs(tokens[functionIndex + 8], ",")
    && tokenIs(tokens[functionIndex + 9], ")")
    && tokenIs(tokens[functionIndex + 10], "(")
    && tokenIsKind(tokens[functionIndex + 11], "identifier", runtimeName)
    && tokenIs(tokens[functionIndex + 12], ")")
    && tokenIsKind(tokens[functionIndex + 13], "identifier", "as");
}

const DYNAMIC_CODE_PINS: Readonly<Record<string, DynamicCodePin>> = Object.freeze({
  "implementations/typescript/engine/src/engine-bodies-dispatch.ts": Object.freeze({
    expectedCount: 2,
    matches: matchesNamespaceDynamicCodePin,
  }),
  "fenel/modules/evaluator-strategies/ffi/evaluator-strategies-ffi.ts": Object.freeze({
    expectedCount: 1,
    matches: (tokens: readonly LexToken[], functionIndex: number): boolean =>
      matchesSerializedDynamicCodePin(tokens, functionIndex, "JIT_FENEL_RUNTIME"),
  }),
  "fenel/modules/prover/ffi/prover-ffi.ts": Object.freeze({
    expectedCount: 1,
    matches: (tokens: readonly LexToken[], functionIndex: number): boolean =>
      matchesSerializedDynamicCodePin(tokens, functionIndex, "COMPILABLE_PROVER_FENEL"),
  }),
});

type CompiledArtifactBuiltinGrant = {
  readonly specifier: string;
  readonly declaration: string;
  readonly expectedCount: number;
};

const COMPILED_ARTIFACT_BUILTIN_GRANTS: ReadonlyMap<
  RepositoryRelativePath,
  readonly CompiledArtifactBuiltinGrant[]
> = new Map<RepositoryRelativePath, readonly CompiledArtifactBuiltinGrant[]>([
  [repositoryRelativePath("fenel/modules/crypto/ffi/crypto-ffi.ts"), Object.freeze([
    Object.freeze({
      specifier: "node:crypto",
      declaration:
        'const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");',
      expectedCount: 1,
    }),
  ])],
  [repositoryRelativePath("implementations/typescript/engine/src/engine-bodies-dispatch.ts"), Object.freeze([
    Object.freeze({
      specifier: "node:crypto",
      declaration: 'const { createHash } = require("node:crypto") as typeof import("node:crypto");',
      expectedCount: 6,
    }),
    Object.freeze({
      specifier: "node:util",
      declaration: 'const candidate = (require("node:util") as typeof import("node:util")).types.isProxy;',
      expectedCount: 1,
    }),
  ])],
]);

function assertCompiledArtifactBuiltinGrants(
  path: RepositoryRelativePath,
  source: string,
  acquisitions: readonly LexicalAcquisitionRow[],
): void {
  const observed = new Map<string, number>();
  for (const edge of acquisitions) {
    const specifier = edge.specifier.endsWith("?raw")
      ? edge.specifier.slice(0, -4)
      : edge.specifier;
    if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
      observed.set(specifier, (observed.get(specifier) ?? 0) + 1);
    }
  }
  const grants = COMPILED_ARTIFACT_BUILTIN_GRANTS.get(path) ?? Object.freeze([]);
  const expected = new Map<string, number>();
  let masked = source;
  for (const grant of grants) {
    expected.set(grant.specifier, (expected.get(grant.specifier) ?? 0) + grant.expectedCount);
    const declarationCount = source.split(grant.declaration).length - 1;
    if (declarationCount !== grant.expectedCount) {
      fail(
        "forbidden-builtin",
        `${path} builtin declaration changed: ${grant.specifier} has ${declarationCount} exact forms; expected ${grant.expectedCount}`,
        path,
      );
    }
    masked = masked.replaceAll(grant.declaration, grant.declaration.replace(/[^\r\n]/gu, " "));
  }
  let residual: LexicalSourceAcquisitionCensus;
  try {
    residual = censusSourceAcquisitions(path, masked);
  } catch (error) {
    if (error instanceof CompiledArtifactAcquisitionError) throw error;
    fail("forbidden-builtin", `${path} builtin grant masking failed: ${String(error)}`, path);
  }
  const residualBuiltins = residual.acquisitions
    .map((edge) => edge.specifier.endsWith("?raw") ? edge.specifier.slice(0, -4) : edge.specifier)
    .filter((specifier) => specifier.startsWith("node:") || specifier.startsWith("bun:"));
  if (residualBuiltins.length !== 0) {
    fail(
      "forbidden-builtin",
      `${path} has builtin acquisitions outside executable exact grants: ${residualBuiltins.join(", ")}`,
      path,
    );
  }
  for (const specifier of new Set([...observed.keys(), ...expected.keys()])) {
    const observedCount = observed.get(specifier) ?? 0;
    const expectedCount = expected.get(specifier) ?? 0;
    if (observedCount !== expectedCount) {
      fail(
        "forbidden-builtin",
        `${path} builtin acquisition changed: ${specifier} has ${observedCount} runtime edges; expected ${expectedCount}`,
        path,
      );
    }
  }
}

const BENIGN_CONSTRUCTOR_COMPARISON_PATH =
  "implementations/typescript/engine/src/json-logic.ts";
const BENIGN_CONSTRUCTOR_COMPARISON_STATEMENT =
  "if ((a as { constructor: unknown }).constructor !== (b as { constructor: unknown }).constructor) return false;";
const CODEC_GLOBAL_ALIAS_PATH = "fenel/modules/codec/ffi/codec-ffi.ts";
const CODEC_GLOBAL_ALIAS_DECLARATION = "const g = globalThis as unknown as GlobalCodecs;";
const CODEC_GLOBAL_ALIAS_DECLARATION_COUNT = 2;
const CODEC_GLOBAL_ALIAS_MEMBER_COUNTS = Object.freeze({
  Buffer: 4,
  atob: 2,
  btoa: 2,
} as const);
const ENGINE_REQUIRE_ALIAS_PATH = "implementations/typescript/engine/src/engine-require.ts";
const ENGINE_REQUIRE_ALIAS_DECLARATION = [
  "const req: ((p: string) => unknown) | undefined =",
  "    !hostRequireUnavailable() ? (require as (p: string) => unknown) : undefined;",
].join("\n");
const ENGINE_REQUIRE_NATIVE_HOST_DECLARATION = [
  'const nativeHost = typeof process !== "undefined"',
  '    && (typeof process.versions?.node === "string" || typeof process.versions?.bun === "string");',
].join("\n");
const IMAGE_GLOBAL_ALIAS_PATH = "implementations/typescript/engine/src/image-data.ts";
const IMAGE_GLOBAL_ALIAS_DECLARATION =
  "const g = globalThis as unknown as { atob?: (s: string) => string; Buffer?: { from(s: string, enc: string): Uint8Array } };";
const IMAGE_GLOBAL_ALIAS_MEMBER_COUNTS = Object.freeze({
  Buffer: 2,
  atob: 2,
} as const);

function benignConstructorComparisonOffsets(
  path: RepositoryRelativePath,
  source: string,
): ReadonlySet<number> {
  if (path !== BENIGN_CONSTRUCTOR_COMPARISON_PATH) return new Set<number>();
  const statementOffset = source.indexOf(BENIGN_CONSTRUCTOR_COMPARISON_STATEMENT);
  if (
    statementOffset < 0
    || source.indexOf(BENIGN_CONSTRUCTOR_COMPARISON_STATEMENT, statementOffset + 1) >= 0
  ) return new Set<number>();
  const offsets: number[] = [];
  let cursor = 0;
  while (true) {
    const memberOffset = BENIGN_CONSTRUCTOR_COMPARISON_STATEMENT.indexOf(".constructor", cursor);
    if (memberOffset < 0) break;
    offsets.push(statementOffset + memberOffset + 1);
    cursor = memberOffset + ".constructor".length;
  }
  return offsets.length === 2 ? new Set(offsets) : new Set<number>();
}

/**
 * Host-sensitive APIs that are present in the complete worker closure but are
 * deliberately confined to runtime FFI or non-render registry surfaces. The
 * worker preload makes these APIs fail if a render unexpectedly reaches them;
 * this path/kind/count ledger makes every source occurrence reviewable and
 * makes an injected occurrence fail before materialization.
 */
const FIELD_IDENTITY_WORKER_CLIENT_PATH =
  "implementations/typescript/engine/src/field-identity-worker-client.ts";
const FIELD_IDENTITY_WORKER_ASSET = "./field-identity-worker.ts";
const FIELD_IDENTITY_WORKER_STATEMENT =
  'const worker = new Worker(new URL("./field-identity-worker.ts", import.meta.url), { type: "module" });';
const FIELD_IDENTITY_WORKER_PROBE = 'typeof Worker === "undefined"';

/** The asynchronous registry's asset URL is not a render input value. Pin its
 * exact consumer and its only availability probe, rather than granting this
 * source permission to observe one arbitrary host path. Token offsets also
 * reject comment decoys and local Worker/URL bindings that could bypass the
 * render preload's denied global Worker read. */
function fieldIdentityWorkerAssetOffsets(
  path: RepositoryRelativePath,
  source: string,
  tokens: readonly LexToken[],
): { readonly workers: ReadonlySet<number>; readonly url: number } | undefined {
  if (path !== FIELD_IDENTITY_WORKER_CLIENT_PATH) return undefined;
  const unique = (text: string): number => {
    const offset = source.indexOf(text);
    if (offset < 0 || source.indexOf(text, offset + 1) >= 0) {
      fail("host-sensitive-operation", `${path} changed its exact runtime-worker asset shape`, path);
    }
    return offset;
  };
  const statement = unique(FIELD_IDENTITY_WORKER_STATEMENT);
  const probe = unique(FIELD_IDENTITY_WORKER_PROBE);
  const workers = new Set([
    statement + FIELD_IDENTITY_WORKER_STATEMENT.indexOf("Worker"),
    probe + FIELD_IDENTITY_WORKER_PROBE.indexOf("Worker"),
  ]);
  const url = statement + FIELD_IDENTITY_WORKER_STATEMENT.indexOf("URL");
  const required = new Map([...workers].map((offset) => [offset, "Worker"]));
  required.set(url, "URL");
  for (const token of tokens) {
    if (token.kind !== "identifier" || (token.value !== "Worker" && token.value !== "URL")) continue;
    if (required.get(token.offset) !== token.value) {
      fail("host-sensitive-operation", `${path} has an unpinned or shadowed runtime-worker capability at ${location(path, token)}`, path);
    }
    required.delete(token.offset);
  }
  if (required.size > 0) {
    fail("host-sensitive-operation", `${path} does not execute the exact runtime-worker asset shape`, path);
  }
  return Object.freeze({ workers, url });
}

const HOST_SENSITIVITY_PINS: Readonly<
  Record<string, Readonly<Partial<Record<HostSensitiveOperationKind, number>>>>
> = Object.freeze({
  "fenel/modules/crypto/ffi/crypto-ffi.ts": Object.freeze({ randomness: 6 }),
  "fenel/modules/dispatch/ffi/dispatch-ffi.ts": Object.freeze({ "current-time": 1 }),
  "fenel/modules/std/ffi/std-ffi.ts": Object.freeze({
    "current-time": 1,
    "locale-format": 2,
  }),
  "fenel/modules/time/ffi/time-ffi.ts": Object.freeze({ "current-time": 2 }),
  "implementations/typescript/engine/src/engine-bodies-dispatch.ts": Object.freeze({
    "current-time": 2,
  }),
  // Valid only with fieldIdentityWorkerAssetOffsets' exact consumer/asset pin.
  // The render preload denies reading Worker before URL arguments execute.
  [FIELD_IDENTITY_WORKER_CLIENT_PATH]: Object.freeze({ "absolute-path": 1 }),
});

const RANDOMNESS_IDENTIFIERS = new Set([
  "DiffieHellman",
  "ECDH",
  "createDiffieHellman",
  "createDiffieHellmanGroup",
  "createECDH",
  "generateKey",
  "generateKeyPair",
  "generateKeyPairSync",
  "generateKeySync",
  "generateKeys",
  "generatePrime",
  "generatePrimeSync",
  "getDiffieHellman",
  "getRandomValues",
  "randomBytes",
  "randomFill",
  "randomFillSync",
  "randomInt",
  "randomUUID",
  "randomUUIDv7",
]);

function memberToken(tokens: readonly LexToken[], index: number): boolean {
  const token = tokens[index];
  return (token?.kind === "identifier" && tokenIs(tokens[index - 1], "."))
    || (token?.kind === "string"
      && tokenIs(tokens[index - 1], "[")
      && tokenIs(tokens[index + 1], "]"));
}

function computedMemberProperty(
  tokens: readonly LexToken[],
  objectIndex: number,
): { readonly property: string | undefined } | undefined {
  let cursor = objectIndex + 1;
  if (tokenIs(tokens[cursor], "?") && tokenIs(tokens[cursor + 1], ".")) cursor += 2;
  if (!tokenIs(tokens[cursor], "[")) return undefined;
  cursor += 1;
  let property = "";
  let sawLiteral = false;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (tokenIs(token, "]")) {
      return Object.freeze({ property: sawLiteral ? property : undefined });
    }
    if (token?.kind !== "string") return Object.freeze({ property: undefined });
    property += token.value;
    sawLiteral = true;
    cursor += 1;
    if (tokenIs(tokens[cursor], "]")) {
      return Object.freeze({ property });
    }
    if (!tokenIs(tokens[cursor], "+")) return Object.freeze({ property: undefined });
    cursor += 1;
  }
  return Object.freeze({ property: undefined });
}

const HOST_SENSITIVE_COMPUTED_OBJECTS = new Set([
  "Bun",
  "Date",
  "Intl",
  "Math",
  "navigator",
  "performance",
  "process",
]);

function computedHostSensitivity(
  tokens: readonly LexToken[],
  objectIndex: number,
): HostSensitiveOperationKind | "computed-host-object" | undefined {
  const computed = computedMemberProperty(tokens, objectIndex);
  if (computed === undefined) return undefined;
  const object = tokens[objectIndex];
  const property = computed.property;
  if (object?.kind === "identifier" && HOST_SENSITIVE_COMPUTED_OBJECTS.has(object.value)) {
    if (property === "platform" || property === "arch") return "platform-architecture";
    if ((object.value === "Date" || object.value === "performance") && property === "now") {
      return "current-time";
    }
    if (object.value === "Math" && property === "random") return "randomness";
    if (object.value === "Bun" && property === "randomUUIDv7") return "randomness";
    if (object.value === "Intl") return "locale-format";
    if (object.value === "Bun" || object.value === "process") return undefined;
    return "computed-host-object";
  }
  if (property === "localeCompare") return "locale-order";
  if (property?.startsWith("toLocale") === true) return "locale-format";
  return undefined;
}

function hostSensitiveOperation(
  tokens: readonly LexToken[],
  index: number,
): HostSensitiveOperationKind | undefined {
  const token = tokens[index]!;
  const memberProperty = token.kind === "identifier"
    ? literalMemberProperty(tokens, index)
    : undefined;

  if (
    (token.kind === "identifier" || token.kind === "string")
    && token.value === "localeCompare"
    && memberToken(tokens, index)
  ) return "locale-order";
  if (
    (token.kind === "identifier" || token.kind === "string")
    && token.value.startsWith("toLocale")
    && memberToken(tokens, index)
  ) return "locale-format";
  if (token.kind === "identifier" && token.value === "Intl") return "locale-format";

  if (
    token.kind === "identifier"
    && ((token.value === "Date" && memberProperty === "now")
      || (token.value === "performance" && memberProperty === "now"))
  ) return "current-time";
  if (
    token.kind === "identifier"
    && token.value === "Date"
    && tokenIs(tokens[index + 1], "(")
    && (!tokenIs(tokens[index - 1], "new") || tokenIs(tokens[index + 2], ")"))
  ) return "current-time";

  if (
    token.kind === "identifier"
    && ((token.value === "Math" && memberProperty === "random")
      || RANDOMNESS_IDENTIFIERS.has(token.value))
  ) return "randomness";

  if (
    token.kind === "identifier"
    && (token.value === "process" || token.value === "Bun" || token.value === "navigator")
    && (memberProperty === "platform" || memberProperty === "arch")
  ) return "platform-architecture";

  if (
    token.kind === "identifier"
    && (token.value === "__dirname" || token.value === "__filename")
  ) return "absolute-path";
  if (
    token.kind === "identifier"
    && token.value === "process"
    && memberProperty === "cwd"
  ) return "absolute-path";
  if (
    token.kind === "identifier"
    && token.value === "import"
    && tokenIs(tokens[index + 1], ".")
    && tokenIs(tokens[index + 2], "meta")
    && tokenIs(tokens[index + 3], ".")
    && ["dir", "path", "url"].includes(tokens[index + 4]?.value ?? "")
  ) return "absolute-path";

  if (
    token.kind === "identifier"
    && DIRECTORY_READ_CALLEES.has(token.value)
    && tokenIs(tokens[index + 1], "(")
  ) return "directory-order";
  return undefined;
}

function constructorMemberIsInvoked(
  tokens: readonly LexToken[],
  constructorIndex: number,
): boolean {
  let cursor = constructorIndex + 1;
  if (tokens[constructorIndex]?.kind === "string") cursor += 1;
  while (tokenIs(tokens[cursor], ")")) cursor += 1;
  if (tokenIs(tokens[cursor], "!") && tokenIs(tokens[cursor + 1], "(")) return true;
  if (tokenIs(tokens[cursor], "?") && tokenIs(tokens[cursor + 1], ".")) cursor += 2;
  if (tokenIs(tokens[cursor], "(")) return true;
  if (tokenIs(tokens[cursor], ".") && tokens[cursor + 1]?.kind === "identifier") {
    return ["apply", "bind", "call", "constructor"].includes(tokens[cursor + 1]!.value);
  }
  if (
    tokenIs(tokens[cursor], "[")
    && tokens[cursor + 1]?.kind === "string"
    && tokenIs(tokens[cursor + 2], "]")
  ) {
    return ["apply", "bind", "call", "constructor"].includes(tokens[cursor + 1]!.value);
  }
  return false;
}

function isInvokedConstructorMember(tokens: readonly LexToken[], index: number): boolean {
  const token = tokens[index];
  if (tokenIsKind(token, "identifier", "constructor") && tokenIs(tokens[index - 1], ".")) {
    return constructorMemberIsInvoked(tokens, index);
  }
  return tokenIsKind(token, "string", "constructor")
    && tokenIs(tokens[index - 1], "[")
    && tokenIs(tokens[index + 1], "]")
    && constructorMemberIsInvoked(tokens, index);
}

function isConstructorMemberReference(tokens: readonly LexToken[], index: number): boolean {
  const token = tokens[index];
  return (tokenIsKind(token, "identifier", "constructor") && tokenIs(tokens[index - 1], "."))
    || (tokenIsKind(token, "string", "constructor")
      && tokenIs(tokens[index - 1], "[")
      && tokenIs(tokens[index + 1], "]"))
    || computedMemberProperty(tokens, index)?.property === "constructor";
}

function literalMemberProperty(
  tokens: readonly LexToken[],
  baseIndex: number,
): string | undefined {
  let cursor = baseIndex + 1;
  if (tokenIs(tokens[cursor], "?") && tokenIs(tokens[cursor + 1], ".")) cursor += 1;
  if (tokenIs(tokens[cursor], ".") && tokens[cursor + 1]?.kind === "identifier") {
    return tokens[cursor + 1]!.value;
  }
  if (
    tokenIs(tokens[cursor], "[")
    && tokens[cursor + 1]?.kind === "string"
    && tokenIs(tokens[cursor + 2], "]")
  ) {
    return tokens[cursor + 1]!.value;
  }
  return undefined;
}

function computedMemberAccess(tokens: readonly LexToken[], baseIndex: number): boolean {
  let cursor = baseIndex + 1;
  if (tokenIs(tokens[cursor], "?") && tokenIs(tokens[cursor + 1], ".")) cursor += 2;
  if (!tokenIs(tokens[cursor], "[")) return false;
  return !(
    tokens[cursor + 1]?.kind === "string"
    && tokenIs(tokens[cursor + 2], "]")
  );
}

function codecGlobalCapabilityOffsets(
  path: RepositoryRelativePath,
  source: string,
  tokens: readonly LexToken[],
): ReadonlySet<number> {
  if (path !== CODEC_GLOBAL_ALIAS_PATH) return new Set<number>();
  const allowed = new Set<number>();
  let declarationCount = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      !tokenIsKind(token, "identifier", "g")
      || !tokenIsKind(tokens[index - 1], "identifier", "const")
      || !tokenIs(tokens[index + 1], "=")
    ) continue;
    let end = index + 2;
    while (end < tokens.length && !tokenIs(tokens[end], ";")) end += 1;
    if (end >= tokens.length) {
      fail("forbidden-runtime-introspection", `unterminated codec global alias at ${location(path, token)}`, path);
    }
    const declaration = source.slice(tokens[index - 1]!.offset, tokens[end]!.offset + 1);
    if (declaration !== CODEC_GLOBAL_ALIAS_DECLARATION) {
      fail("forbidden-runtime-introspection", `unpinned codec global alias at ${location(path, token)}`, path);
    }
    declarationCount += 1;
    for (let cursor = index - 1; cursor <= end; cursor += 1) {
      const candidate = tokens[cursor]!;
      if (candidate.value === "g" || candidate.value === "globalThis") allowed.add(candidate.offset);
    }
  }

  const memberCounts = new Map<string, number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!tokenIsKind(token, "identifier", "g") || allowed.has(token.offset)) continue;
    const member = literalMemberProperty(tokens, index);
    if (member === undefined || !(member in CODEC_GLOBAL_ALIAS_MEMBER_COUNTS)) {
      fail("forbidden-runtime-introspection", `codec global alias escape at ${location(path, token)}`, path);
    }
    memberCounts.set(member, (memberCounts.get(member) ?? 0) + 1);
    allowed.add(token.offset);
  }
  if (declarationCount !== CODEC_GLOBAL_ALIAS_DECLARATION_COUNT) {
    fail(
      "forbidden-runtime-introspection",
      `${path} has ${declarationCount} exact codec global aliases; expected ${CODEC_GLOBAL_ALIAS_DECLARATION_COUNT}`,
      path,
    );
  }
  for (const [member, expected] of Object.entries(CODEC_GLOBAL_ALIAS_MEMBER_COUNTS)) {
    const observed = memberCounts.get(member) ?? 0;
    if (observed !== expected) {
      fail(
        "forbidden-runtime-introspection",
        `${path} has ${observed} codec global ${member} references; expected ${expected}`,
        path,
      );
    }
  }
  return allowed;
}

function engineRequireCapabilityOffsets(
  path: RepositoryRelativePath,
  source: string,
  tokens: readonly LexToken[],
): ReadonlySet<number> {
  if (path !== ENGINE_REQUIRE_ALIAS_PATH) return new Set<number>();
  const allowed = new Set<number>();
  let declarationCount = 0;
  let guardCount = 0;
  let callCount = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      !tokenIsKind(token, "identifier", "req")
      || !tokenIsKind(tokens[index - 1], "identifier", "const")
      || !tokenIs(tokens[index + 1], ":")
    ) continue;
    let end = index + 2;
    while (end < tokens.length && !tokenIs(tokens[end], ";")) end += 1;
    if (end >= tokens.length) {
      fail("forbidden-runtime-introspection", `unterminated engine require alias at ${location(path, token)}`, path);
    }
    const declaration = source.slice(tokens[index - 1]!.offset, tokens[end]!.offset + 1).replaceAll("\r\n", "\n");
    if (declaration !== ENGINE_REQUIRE_ALIAS_DECLARATION) {
      fail("forbidden-runtime-introspection", `unpinned engine require alias at ${location(path, token)}`, path);
    }
    declarationCount += 1;
    for (let cursor = index - 1; cursor <= end; cursor += 1) {
      const candidate = tokens[cursor]!;
      if (candidate.value === "req" || candidate.value === "require") allowed.add(candidate.offset);
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!tokenIsKind(token, "identifier", "req") || allowed.has(token.offset)) continue;
    if (tokenIs(tokens[index - 1], "(") && tokenIs(tokens[index + 1], ")") && tokenIsKind(tokens[index - 2], "identifier", "if")) {
      guardCount += 1;
      allowed.add(token.offset);
      continue;
    }
    if (
      tokenIs(tokens[index + 1], "(")
      && tokenIsKind(tokens[index + 2], "string", "./")
      && tokenIs(tokens[index + 3], "+")
      && tokenIsKind(tokens[index + 4], "identifier", "id")
      && tokenIs(tokens[index + 5], ")")
    ) {
      callCount += 1;
      allowed.add(token.offset);
      continue;
    }
    fail("forbidden-runtime-introspection", `engine require alias escape at ${location(path, token)}`, path);
  }
  if (declarationCount !== 1 || guardCount !== 1 || callCount !== 1) {
    fail(
      "forbidden-runtime-introspection",
      `${path} has engine require alias tuple ${declarationCount}/${guardCount}/${callCount}; expected 1/1/1`,
      path,
    );
  }
  return allowed;
}

/** Only the source-owned boolean loader-availability probe may inspect these
 * property types. The versions object and version strings never escape this
 * expression; general process.versions access remains a forbidden capability. */
function engineRequireHostProcessOffsets(
  path: RepositoryRelativePath,
  source: string,
  tokens: readonly LexToken[],
): ReadonlySet<number> {
  if (path !== ENGINE_REQUIRE_ALIAS_PATH) return new Set<number>();
  const allowed = new Set<number>();
  let declarations = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!tokenIsKind(token, "identifier", "nativeHost")
      || !tokenIsKind(tokens[index - 1], "identifier", "const")
      || !tokenIs(tokens[index + 1], "=")) continue;
    let end = index + 2;
    while (end < tokens.length && !tokenIs(tokens[end], ";")) end += 1;
    const declaration = end < tokens.length
      ? source.slice(tokens[index - 1]!.offset, tokens[end]!.offset + 1).replaceAll("\r\n", "\n") : "";
    if (declaration !== ENGINE_REQUIRE_NATIVE_HOST_DECLARATION) {
      fail("forbidden-runtime-introspection", `unpinned native-host boolean at ${location(path, token)}`, path);
    }
    declarations += 1;
    for (let cursor = index; cursor <= end; cursor += 1) {
      if (tokenIsKind(tokens[cursor], "identifier", "process")
        && literalMemberProperty(tokens, cursor) === "versions") allowed.add(tokens[cursor]!.offset);
    }
  }
  if (declarations !== 1 || allowed.size !== 2) {
    fail("forbidden-runtime-introspection", `${path} must retain its one exact native-host boolean probe`, path);
  }
  return allowed;
}

function imageGlobalCapabilityOffsets(
  path: RepositoryRelativePath,
  source: string,
  tokens: readonly LexToken[],
): ReadonlySet<number> {
  if (path !== IMAGE_GLOBAL_ALIAS_PATH) return new Set<number>();
  const allowed = new Set<number>();
  const aliasScopes: Array<readonly [number, number]> = [];
  let declarationCount = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      !tokenIsKind(token, "identifier", "g")
      || !tokenIsKind(tokens[index - 1], "identifier", "const")
      || !tokenIs(tokens[index + 1], "=")
    ) continue;
    const declarationStart = tokens[index - 1]!.offset;
    const declarationEnd = declarationStart + IMAGE_GLOBAL_ALIAS_DECLARATION.length;
    const declaration = source.slice(declarationStart, declarationEnd);
    if (declaration !== IMAGE_GLOBAL_ALIAS_DECLARATION) {
      fail("forbidden-runtime-introspection", `unpinned image global alias at ${location(path, token)}`, path);
    }
    declarationCount += 1;
    for (let cursor = index - 1; cursor < tokens.length && tokens[cursor]!.offset < declarationEnd; cursor += 1) {
      const candidate = tokens[cursor]!;
      if (candidate.value === "g" || candidate.value === "globalThis") allowed.add(candidate.offset);
    }
    let depth = 0;
    for (let cursor = 0; cursor <= index; cursor += 1) {
      if (tokenIs(tokens[cursor], "{")) depth += 1;
      if (tokenIs(tokens[cursor], "}")) depth -= 1;
    }
    const scopeDepth = depth;
    let scopeEnd = tokens.length;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokenIs(tokens[cursor], "{")) depth += 1;
      if (tokenIs(tokens[cursor], "}")) {
        depth -= 1;
        if (depth < scopeDepth) {
          scopeEnd = cursor;
          break;
        }
      }
    }
    aliasScopes.push(Object.freeze([index, scopeEnd] as const));
  }
  const memberCounts = new Map<string, number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      !tokenIsKind(token, "identifier", "g")
      || allowed.has(token.offset)
      || !aliasScopes.some(([start, end]) => index >= start && index < end)
    ) continue;
    const member = literalMemberProperty(tokens, index);
    if (member === undefined || !(member in IMAGE_GLOBAL_ALIAS_MEMBER_COUNTS)) {
      fail("forbidden-runtime-introspection", `image global alias escape at ${location(path, token)}`, path);
    }
    memberCounts.set(member, (memberCounts.get(member) ?? 0) + 1);
    allowed.add(token.offset);
  }
  if (declarationCount !== 1) {
    fail("forbidden-runtime-introspection", `${path} has ${declarationCount} exact image global aliases; expected 1`, path);
  }
  for (const [member, expected] of Object.entries(IMAGE_GLOBAL_ALIAS_MEMBER_COUNTS)) {
    const observed = memberCounts.get(member) ?? 0;
    if (observed !== expected) {
      fail(
        "forbidden-runtime-introspection",
        `${path} has ${observed} image global ${member} references; expected ${expected}`,
        path,
      );
    }
  }
  return allowed;
}

function matrixLlvmBunCapabilityOffsets(
  path: RepositoryRelativePath,
  source: string,
  tokens: readonly LexToken[],
): ReadonlySet<number> {
  if (path !== MATRIX_LLVM_BUN_CAPABILITY_PATH) return new Set<number>();
  const allowed = new Set<number>();
  const aliases = new Map<string, number>(
    MATRIX_LLVM_BUN_ALIAS_DECLARATIONS.map((row) => [row.source, 0] as const),
  );
  let whichCount = 0;
  let spawnSyncCount = 0;
  let undefinedGuardCount = 0;
  let whichSafeCallCount = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      tokenIsKind(token, "identifier", "bun")
      && tokenIsKind(tokens[index - 1], "identifier", "const")
      && tokenIs(tokens[index + 1], "=")
    ) {
      let end = index + 2;
      while (end < tokens.length && !tokenIs(tokens[end], ";")) end += 1;
      if (end >= tokens.length) {
        fail("forbidden-runtime-introspection", `unterminated Bun alias declaration at ${location(path, token)}`, path);
      }
      const declaration = source.slice(tokens[index - 1]!.offset, tokens[end]!.offset + 1);
      const observed = aliases.get(declaration);
      if (observed === undefined) {
        fail("forbidden-runtime-introspection", `unpinned Bun alias declaration at ${location(path, token)}`, path);
      }
      aliases.set(declaration, observed + 1);
      for (let cursor = index - 1; cursor <= end; cursor += 1) {
        const member = tokens[cursor]!;
        if (member.value === "Bun" || member.value === "bun" || member.value === "globalThis") {
          allowed.add(member.offset);
        }
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (tokenIsKind(token, "identifier", "whichSafe")) {
      if (tokenIsKind(tokens[index - 1], "identifier", "function")) continue;
      if (
        tokenIs(tokens[index + 1], "(")
        && tokenIsKind(tokens[index + 2], "string", "clang")
        && tokenIs(tokens[index + 3], ")")
      ) {
        whichSafeCallCount += 1;
        continue;
      }
      fail("forbidden-runtime-introspection", `unpinned whichSafe capability reference at ${location(path, token)}`, path);
    }
    if (!tokenIsKind(token, "identifier", "bun") || allowed.has(token.offset)) continue;
    if (
      tokenIs(tokens[index + 1], "?")
      && tokenIs(tokens[index + 2], ".")
      && tokenIsKind(tokens[index + 3], "identifier", "which")
      && tokenIs(tokens[index + 4], "(")
      && tokenIsKind(tokens[index + 5], "identifier", "name")
      && tokenIs(tokens[index + 6], ")")
    ) {
      whichCount += 1;
      allowed.add(token.offset);
      continue;
    }
    if (
      tokenIs(tokens[index + 1], ".")
      && tokenIsKind(tokens[index + 2], "identifier", "spawnSync")
      && tokenIs(tokens[index + 3], "(")
    ) {
      spawnSyncCount += 1;
      allowed.add(token.offset);
      continue;
    }
    if (
      tokenIs(tokens[index + 1], "=")
      && tokenIs(tokens[index + 2], "=")
      && tokenIs(tokens[index + 3], "=")
      && tokenIsKind(tokens[index + 4], "identifier", "undefined")
    ) {
      undefinedGuardCount += 1;
      allowed.add(token.offset);
      continue;
    }
    fail("forbidden-runtime-introspection", `Bun alias object/member escape at ${location(path, token)}`, path);
  }

  for (const pin of MATRIX_LLVM_BUN_ALIAS_DECLARATIONS) {
    if (aliases.get(pin.source) !== pin.expectedCount) {
      fail(
        "forbidden-runtime-introspection",
        `${path} has ${aliases.get(pin.source) ?? 0} exact ${JSON.stringify(pin.source)} aliases; expected ${pin.expectedCount}`,
        path,
      );
    }
  }
  for (const [member, observed, expected] of [
    ["which", whichCount, 1],
    ["spawnSync", spawnSyncCount, 2],
    ["undefined guard", undefinedGuardCount, 2],
    ["whichSafe(\"clang\")", whichSafeCallCount, 1],
  ] as const) {
    if (observed !== expected) {
      fail(
        "forbidden-runtime-introspection",
        `${path} has ${observed} pinned Bun ${member} occurrences; expected ${expected}`,
        path,
      );
    }
  }
  return allowed;
}

function validateBunCapabilityToken(
  tokens: readonly LexToken[],
  index: number,
  path: RepositoryRelativePath,
  pinnedOffsets: ReadonlySet<number>,
): void {
  const token = tokens[index];
  if (token === undefined) return;
  if (pinnedOffsets.has(token.offset)) return;
  if (tokenIsKind(token, "string", "Bun")) {
    if (tokenIs(tokens[index - 1], "[") && tokenIs(tokens[index + 1], "]")) {
      fail(
        "forbidden-runtime-introspection",
        `Bun namespace capability reference at ${location(path, token)}`,
        path,
      );
    }
    return;
  }
  if (!tokenIsKind(token, "identifier", "Bun")) return;

  const dotMember = tokenIs(tokens[index + 1], ".")
    && tokens[index + 2]?.kind === "identifier"
    ? tokens[index + 2]!.value
    : undefined;
  const bracketMember = tokenIs(tokens[index + 1], "[")
    && tokens[index + 2]?.kind === "string"
    && tokenIs(tokens[index + 3], "]")
    ? tokens[index + 2]!.value
    : undefined;
  const member = dotMember ?? bracketMember;
  fail(
    "forbidden-runtime-introspection",
    member === undefined
      ? `Bun object escape or computed capability at ${location(path, token)}`
      : `undeclared Bun capability ${member} at ${location(path, token)}`,
    path,
  );
}

function validatePrivilegedCapabilityToken(
  tokens: readonly LexToken[],
  index: number,
  path: RepositoryRelativePath,
  approvedGlobalOffsets: ReadonlySet<number>,
  approvedRequireOffsets: ReadonlySet<number>,
  staticImportIndices: ReadonlySet<number>,
  approvedProcessOffsets: ReadonlySet<number>,
): void {
  const token = tokens[index];
  if (token === undefined || token.kind !== "identifier") return;
  const member = literalMemberProperty(tokens, index);

  if (["global", "globalThis", "self", "window"].includes(token.value)) {
    if (approvedGlobalOffsets.has(token.offset)) return;
    if (
      member !== undefined
      && (DYNAMIC_FUNCTION_IDENTIFIERS.has(member)
        || ["Bun", "eval", "process"].includes(member))
    ) return;
    fail(
      "forbidden-runtime-introspection",
      `global capability object escape at ${location(path, token)}`,
      path,
    );
  }

  if (token.value === "require") {
    if (approvedRequireOffsets.has(token.offset)) return;
    const prior = tokens[index - 1];
    const directCall = tokenIs(tokens[index + 1], "(")
      && !tokenIs(prior, ".")
      && !tokenIs(prior, "]");
    const directResolve = member === "resolve"
      && tokenIs(tokens[index + 3], "(")
      && !tokenIs(prior, ".")
      && !tokenIs(prior, "]");
    if (tokenIsKind(prior, "identifier", "typeof") || directCall || directResolve) return;
    fail(
      "forbidden-runtime-introspection",
      `require capability escape at ${location(path, token)}`,
      path,
    );
  }

  if (token.value === "process") {
    if (approvedProcessOffsets.has(token.offset)) return;
    if (tokenIsKind(tokens[index - 1], "identifier", "typeof")
      && member === undefined && !tokenIs(tokens[index + 1], "[")) return;
    if (
      member !== undefined
      && !computedMemberAccess(tokens, index)
      && PERMITTED_PROCESS_MEMBERS.has(member)
    ) return;
    fail(
      "forbidden-runtime-introspection",
      member === undefined
        ? `process object escape or computed capability at ${location(path, token)}`
        : `undeclared process capability ${member} at ${location(path, token)}`,
      path,
    );
  }

  if (token.value === "navigator") {
    fail(
      "forbidden-runtime-introspection",
      `navigator host capability is forbidden at ${location(path, token)}`,
      path,
    );
  }

  if (token.value === "Reflect") {
    if (member !== undefined && !computedMemberAccess(tokens, index)) return;
    fail(
      "forbidden-runtime-introspection",
      `Reflect object escape or computed capability at ${location(path, token)}`,
      path,
    );
  }

  if (
    token.value === "module"
    && !lowercaseModuleMetadataPosition(tokens, index, staticImportIndices)
  ) {
    fail(
      "forbidden-runtime-introspection",
      `module-loader capability reference at ${location(path, token)}`,
      path,
    );
  }
  if (
    token.value === "Module"
    && (
      computedMemberAccess(tokens, index)
      || member === "_cache"
      || member === "_load"
      || member === "createRequire"
      || member === "require"
    )
  ) {
    fail(
      "forbidden-runtime-introspection",
      `module-loader capability reference at ${location(path, token)}`,
      path,
    );
  }
}

function callArgument(tokens: readonly LexToken[], openParen: number): LexToken | undefined {
  const argument = tokens[openParen + 1];
  const boundary = tokens[openParen + 2];
  return tokenIs(boundary, ",") || tokenIs(boundary, ")") ? argument : undefined;
}

type LexicalFilesystemCall = {
  readonly callee: string;
  readonly calleeIndex: number;
  readonly expressionStartIndex: number;
  readonly openParenIndex: number;
};

function lexicalFilesystemCall(
  tokens: readonly LexToken[],
  index: number,
): LexicalFilesystemCall | undefined {
  const token = tokens[index];
  if (
    token?.kind === "identifier"
    && (FILE_READ_CALLEES.has(token.value)
      || DIRECTORY_READ_CALLEES.has(token.value)
      || GLOB_CALLEES.has(token.value))
    && tokenIs(tokens[index + 1], "(")
  ) {
    return Object.freeze({
      callee: token.value,
      calleeIndex: index,
      expressionStartIndex: index,
      openParenIndex: index + 1,
    });
  }
  if (
    token?.kind !== "string"
    || (!FILE_READ_CALLEES.has(token.value)
      && !DIRECTORY_READ_CALLEES.has(token.value)
      && !GLOB_CALLEES.has(token.value))
    || !tokenIs(tokens[index - 1], "[")
    || !tokenIs(tokens[index + 1], "]")
  ) return undefined;
  let openParenIndex = index + 2;
  if (tokenIs(tokens[openParenIndex], "?") && tokenIs(tokens[openParenIndex + 1], ".")) {
    openParenIndex += 2;
  }
  if (!tokenIs(tokens[openParenIndex], "(")) return undefined;
  return Object.freeze({
    callee: token.value,
    calleeIndex: index,
    expressionStartIndex: Math.max(0, index - 2),
    openParenIndex,
  });
}

function matchingDelimiterIndex(
  tokens: readonly LexToken[],
  openIndex: number,
  open: string,
  close: string,
): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokenIs(tokens[index], open)) depth += 1;
    if (!tokenIs(tokens[index], close)) continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return undefined;
}

/** Exact token membership for static import declarations, independent of ASI. */
function staticImportTokenIndices(tokens: readonly LexToken[]): ReadonlySet<number> {
  const output = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      !tokenIsKind(tokens[index], "identifier", "import")
      || tokenIs(tokens[index + 1], "(")
      || tokenIs(tokens[index + 1], ".")
    ) continue;

    let specifierIndex: number | undefined;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor]!;
      if (tokenIs(token, ";")) break;
      if (token.kind !== "string") continue;
      const sideEffectImport = cursor === index + 1;
      const fromImport = tokenIsKind(tokens[cursor - 1], "identifier", "from");
      const importAssignment = tokenIs(tokens[cursor - 1], "(")
        && tokenIsKind(tokens[cursor - 2], "identifier", "require");
      if (sideEffectImport || fromImport || importAssignment) {
        specifierIndex = cursor;
        break;
      }
    }
    if (specifierIndex === undefined) continue;
    for (let cursor = index; cursor <= specifierIndex; cursor += 1) output.add(cursor);
  }
  return output;
}

type NamedTransferDeclaration = {
  readonly kind: "import" | "export";
  readonly open: number;
  readonly close: number;
};

function enclosingNamedTransferDeclaration(
  tokens: readonly LexToken[],
  index: number,
): NamedTransferDeclaration | undefined {
  let depth = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokenIs(tokens[cursor], "}")) {
      depth += 1;
      continue;
    }
    if (!tokenIs(tokens[cursor], "{")) continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }

    let keywordIndex = cursor - 1;
    if (tokenIsKind(tokens[keywordIndex], "identifier", "type")) keywordIndex -= 1;
    const keyword = tokens[keywordIndex];
    if (
      keyword?.kind !== "identifier"
      || (keyword.value !== "import" && keyword.value !== "export")
    ) return undefined;
    const close = matchingDelimiterIndex(tokens, cursor, "{", "}");
    if (close === undefined || index >= close) return undefined;
    return Object.freeze({ kind: keyword.value, open: cursor, close });
  }
  return undefined;
}

function enclosingDelimiterValue(
  tokens: readonly LexToken[],
  index: number,
): "(" | "[" | "{" | undefined {
  const expectedOpeners: string[] = [];
  const openerFor: Readonly<Record<string, string>> = Object.freeze({
    ")": "(",
    "]": "[",
    "}": "{",
  });
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const value = tokens[cursor]!.value;
    const opener = openerFor[value];
    if (opener !== undefined) {
      expectedOpeners.push(opener);
      continue;
    }
    if (value !== "(" && value !== "[" && value !== "{") continue;
    if (expectedOpeners.at(-1) === value) {
      expectedOpeners.pop();
      continue;
    }
    return value;
  }
  return undefined;
}

const PROPERTY_MEMBER_MODIFIERS = new Set([
  "abstract",
  "accessor",
  "declare",
  "override",
  "private",
  "protected",
  "public",
  "readonly",
  "static",
]);

function lowercaseModulePropertyKeyPosition(
  tokens: readonly LexToken[],
  index: number,
): boolean {
  if (enclosingDelimiterValue(tokens, index) !== "{") return false;
  let cursor = index - 1;
  while (
    tokens[cursor]?.kind === "identifier"
    && PROPERTY_MEMBER_MODIFIERS.has(tokens[cursor]!.value)
  ) cursor -= 1;
  return tokenIs(tokens[cursor], "{")
    || tokenIs(tokens[cursor], ",")
    || tokenIs(tokens[cursor], ";");
}

/**
 * Lowercase `module` is reserved for Bun's ambient CommonJS loader. Only
 * unambiguously non-value property metadata may spell that identifier.
 */
function lowercaseModuleMetadataPosition(
  tokens: readonly LexToken[],
  index: number,
  staticImportIndices: ReadonlySet<number>,
): boolean {
  if (
    tokenIs(tokens[index - 1], ".")
    && !tokenIs(tokens[index - 2], ".")
  ) return true;
  if (
    lowercaseModulePropertyKeyPosition(tokens, index)
    && (
      tokenIs(tokens[index + 1], ":")
      || (tokenIs(tokens[index + 1], "?") && tokenIs(tokens[index + 2], ":"))
    )
  ) return true;

  const declaration = enclosingNamedTransferDeclaration(tokens, index);
  if (declaration === undefined) return false;

  const aliasedSourceName = tokenIsKind(tokens[index + 1], "identifier", "as")
    && tokens[index + 2]?.kind === "identifier"
    && tokens[index + 2]!.value !== "module";
  if (declaration.kind === "import") {
    return staticImportIndices.has(index) && aliasedSourceName;
  }

  const aliasedExportName = tokenIsKind(tokens[index - 1], "identifier", "as")
    && tokens[index - 2]?.kind === "identifier"
    && tokens[index - 2]!.value !== "module";
  if (aliasedExportName) return true;

  const remoteReExport = tokenIsKind(tokens[declaration.close + 1], "identifier", "from")
    && tokens[declaration.close + 2]?.kind === "string";
  return remoteReExport && aliasedSourceName;
}

function isFilesystemCapabilityReference(
  tokens: readonly LexToken[],
  index: number,
): boolean {
  const token = tokens[index];
  if (token?.kind === "identifier") {
    if (FILESYSTEM_CAPABILITY_CALLEES.has(token.value)) return true;
    return token.value === "file"
      && tokenIs(tokens[index - 1], ".")
      && tokenIsKind(tokens[index - 2], "identifier", "Bun");
  }
  return token?.kind === "string"
    && (FILESYSTEM_CAPABILITY_CALLEES.has(token.value) || token.value === "file")
    && tokenIs(tokens[index - 1], "[")
    && tokenIs(tokens[index + 1], "]");
}

function matchingCallCloseIndex(
  tokens: readonly LexToken[],
  openParenIndex: number,
  path: RepositoryRelativePath,
): number {
  let depth = 0;
  for (let index = openParenIndex; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (tokenIs(token, "(")) depth += 1;
    if (!tokenIs(token, ")")) continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  fail("invalid-source", `unterminated call expression in ${path}`, path);
}

function exactCallExpression(
  source: string,
  tokens: readonly LexToken[],
  calleeIndex: number,
  openParenIndex: number,
  path: RepositoryRelativePath,
): string {
  const closeIndex = matchingCallCloseIndex(tokens, openParenIndex, path);
  return source.slice(tokens[calleeIndex]!.offset, tokens[closeIndex]!.offset + 1);
}

function exactDynamicCodeConstructorExpression(
  source: string,
  tokens: readonly LexToken[],
  calleeIndex: number,
  path: RepositoryRelativePath,
): string {
  const callee = tokens[calleeIndex]!;
  const start = tokenIsKind(tokens[calleeIndex - 1], "identifier", "new")
    ? tokens[calleeIndex - 1]!.offset
    : callee.offset;
  if (!tokenIs(tokens[calleeIndex + 1], "(")) {
    return source.slice(start, callee.offset + callee.value.length);
  }
  let closeIndex = matchingCallCloseIndex(tokens, calleeIndex + 1, path);
  if (tokenIs(tokens[closeIndex + 1], "(")) {
    closeIndex = matchingCallCloseIndex(tokens, closeIndex + 1, path);
  }
  return source.slice(start, tokens[closeIndex]!.offset + 1);
}

function location(path: RepositoryRelativePath, token: LexToken): string {
  return `${path}@${token.offset}`;
}

function typeOnlyDeclarations(tokens: readonly LexToken[]): readonly { specifier: string }[] {
  const output: Array<{ specifier: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const keyword = tokens[index];
    if (keyword?.kind !== "identifier" || (keyword.value !== "import" && keyword.value !== "export")) {
      continue;
    }
    if (tokenIs(tokens[index + 1], "(")) continue;
    let cursor = index + 1;
    let explicitlyTypeOnly = tokenIs(tokens[cursor], "type");
    if (explicitlyTypeOnly) cursor += 1;
    let braceOnlyType = tokenIs(tokens[cursor], "{");
    let sawBraceRuntimeName = false;
    let braceDepth = 0;
    let expectSpecifier = braceOnlyType;
    let specifier: string | undefined;
    for (; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.value === ";") break;
      if (token.value === "{") {
        braceDepth += 1;
        continue;
      }
      if (token.value === "}") {
        braceDepth -= 1;
        continue;
      }
      if (braceOnlyType && braceDepth === 1 && expectSpecifier && token.kind === "identifier") {
        if (token.value !== "type") sawBraceRuntimeName = true;
        expectSpecifier = false;
      }
      if (braceOnlyType && braceDepth === 1 && token.value === ",") expectSpecifier = true;
      if (token.value === "from" && tokens[cursor + 1]?.kind === "string") {
        specifier = tokens[cursor + 1]!.value;
        break;
      }
    }
    braceOnlyType = braceOnlyType && !sawBraceRuntimeName;
    if ((explicitlyTypeOnly || braceOnlyType) && specifier !== undefined) {
      output.push(Object.freeze({ specifier }));
    }
  }
  return output;
}

function scanLoader(path: RepositoryRelativePath): "js" | "jsx" | "ts" | "tsx" {
  const extension = extensionOf(path);
  if (extension === ".tsx") return "tsx";
  if (extension === ".jsx") return "jsx";
  if ([".ts", ".mts", ".cts"].includes(extension)) return "ts";
  return "js";
}

function runtimeImportKind(kind: string): RuntimeAcquisitionKind {
  if (kind === "import-statement") return "static-module";
  if (kind === "dynamic-import") return "dynamic-module";
  if (kind === "require-call") return "commonjs-module";
  fail("unresolved-computed-acquisition", `unsupported Bun acquisition kind ${JSON.stringify(kind)}`);
}

type SourceAcquisitionCensusHooks = {
  readonly allowComputedFileAcquisition?: (
    observation: ComputedFileAcquisitionObservation,
  ) => boolean;
  readonly allowDynamicCodeConstructor?: (
    observation: DynamicCodeConstructorObservation,
  ) => boolean;
  readonly observeMemberAccess?: (observation: MemberAccessObservation) => void;
  readonly observeIdentifier?: (observation: IdentifierObservation) => void;
  readonly onAcquisition?: (row: LexicalAcquisitionRow) => void;
  readonly onTypeOnlySpecifier?: (specifier: string) => void;
  readonly onHostSensitiveOperation?: (
    kind: HostSensitiveOperationKind,
    offset: number,
  ) => void;
  readonly onCompiledCapabilityToken?: (
    tokens: readonly LexToken[],
    index: number,
    approvedProcessOffsets: ReadonlySet<number>,
  ) => void;
  readonly onCompiledEnvironmentToken?: (
    tokens: readonly LexToken[],
    index: number,
  ) => void;
  readonly validateCompiledHostSensitivity?: () => void;
};

function censusSourceAcquisitionsWithHooks(
  path: RepositoryRelativePath,
  source: string,
  hooks: SourceAcquisitionCensusHooks,
): LexicalSourceAcquisitionCensus {
  let scannedImports: readonly ModuleScanImport[];
  try {
    scannedImports = new Bun.Transpiler({ loader: scanLoader(path) }).scanImports(source);
  } catch (error) {
    fail("invalid-source", `Bun could not scan ${path}: ${String(error)}`, path);
  }
  const tokens = lexSource(source, path);
  const runtimeWorkerAsset = fieldIdentityWorkerAssetOffsets(path, source, tokens);
  const staticImportOffsets = staticImportTokenIndices(tokens);
  const pinnedBunCapabilityOffsets = matrixLlvmBunCapabilityOffsets(path, source, tokens);
  const approvedGlobalCapabilityOffsets = new Set([
    ...pinnedBunCapabilityOffsets,
    ...codecGlobalCapabilityOffsets(path, source, tokens),
    ...imageGlobalCapabilityOffsets(path, source, tokens),
  ]);
  const approvedRequireCapabilityOffsets = engineRequireCapabilityOffsets(path, source, tokens);
  const approvedProcessCapabilityOffsets = engineRequireHostProcessOffsets(path, source, tokens);
  const allowedConstructorComparisonOffsets = benignConstructorComparisonOffsets(path, source);
  const acquisitions: LexicalAcquisitionRow[] = [];
  const computedFileAcquisitions: ComputedFileAcquisitionObservation[] = [];
  const dynamicCodeConstructors: DynamicCodeConstructorObservation[] = [];
  const hostSensitiveOperations: HostSensitiveOperationRow[] = [];
  const typeOnlySpecifiers: string[] = [];
  const runtimeCallCounts = new Map<string, number>();
  const dynamicCodePin = DYNAMIC_CODE_PINS[path];
  let matchedDynamicCodePins = 0;

  const observeAcquisition = (
    kind: RuntimeAcquisitionKind,
    specifier: string,
  ): void => {
    const row = Object.freeze({ kind, specifier });
    acquisitions.push(row);
    hooks.onAcquisition?.(row);
  };
  const observeTypeOnlySpecifier = (specifier: string): void => {
    typeOnlySpecifiers.push(specifier);
    hooks.onTypeOnlySpecifier?.(specifier);
  };

  if (runtimeWorkerAsset !== undefined) {
    observeAcquisition("runtime-worker-asset", FIELD_IDENTITY_WORKER_ASSET);
  }

  for (const scanned of scannedImports) {
    if (scanned.kind === "dynamic-import" || scanned.kind === "require-call") {
      const primitive = scanned.kind === "dynamic-import" ? "import" : "require";
      const key = `${primitive}\0${scanned.path}`;
      runtimeCallCounts.set(key, (runtimeCallCounts.get(key) ?? 0) + 1);
    }
    observeAcquisition(runtimeImportKind(scanned.kind), scanned.path);
  }

  for (const declaration of typeOnlyDeclarations(tokens)) {
    observeTypeOnlySpecifier(declaration.specifier);
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];
    const nextTwo = tokens[index + 2];
    const nextThree = tokens[index + 3];

    if (token.kind === "identifier" && token.value === "Worker"
      && !runtimeWorkerAsset?.workers.has(token.offset)
      && !tokenIs(tokens[index - 1], ".") && !tokenIs(next, ":")) {
      fail("host-sensitive-operation", `unreviewed runtime-worker capability at ${location(path, token)}`, path);
    }

    if (token.kind === "identifier") {
      hooks.observeIdentifier?.(Object.freeze({
        path,
        identifier: token.value,
        offset: token.offset,
      }));
    }
    const memberProperty = token.kind === "identifier"
      ? literalMemberProperty(tokens, index)
      : undefined;
    const computedSensitivity = memberProperty === undefined
      ? computedHostSensitivity(tokens, index)
      : undefined;
    if (computedSensitivity !== undefined) {
      fail(
        "host-sensitive-operation",
        `computed host-sensitive member ${computedSensitivity} at ${location(path, token)}`,
        path,
      );
    }

    const memberObjectPosition = token.kind === "identifier"
      && !tokenIs(tokens[index - 1], ".")
      && !tokenIs(tokens[index - 1], "]")
      && !tokenIs(tokens[index + 1], ":");
    if (memberObjectPosition && memberProperty !== undefined) {
      hooks.observeMemberAccess?.(Object.freeze({
        path,
        object: token.value,
        member: memberProperty,
        offset: token.offset,
      }));
    }
    const hostSensitivity = hostSensitiveOperation(tokens, index);
    if (hostSensitivity !== undefined) {
      hostSensitiveOperations.push(Object.freeze({
        path,
        kind: hostSensitivity,
        offset: token.offset,
      }));
      hooks.onHostSensitiveOperation?.(hostSensitivity, token.offset);
    }
    if (
      (token.kind === "identifier" || token.kind === "string")
      && token.value === "getBuiltinModule"
    ) {
      fail(
        "forbidden-runtime-introspection",
        `process.getBuiltinModule capability reference at ${location(path, token)}`,
        path,
      );
    }
    if (
      token.kind === "identifier"
      && ["global", "globalThis", "self", "window"].includes(token.value)
      && literalMemberProperty(tokens, index) === "process"
    ) {
      fail(
        "forbidden-runtime-introspection",
        `global process capability reference at ${location(path, token)}`,
        path,
      );
    }
    validateBunCapabilityToken(tokens, index, path, pinnedBunCapabilityOffsets);
    hooks.onCompiledCapabilityToken?.(tokens, index, approvedProcessCapabilityOffsets);
    if (
      isConstructorMemberReference(tokens, index)
      && !allowedConstructorComparisonOffsets.has(token.offset)
    ) {
      fail(
        "dynamic-code-evaluation",
        `constructor capability reference at ${location(path, token)}`,
        path,
      );
    }
    if (token.kind === "identifier" && DYNAMIC_FUNCTION_IDENTIFIERS.has(token.value)) {
      const matchesLedger = token.value === "Function"
        && dynamicCodePin !== undefined
        && dynamicCodePin.matches(tokens, index);
      if (matchesLedger) {
        matchedDynamicCodePins += 1;
      } else {
        const observation: DynamicCodeConstructorObservation = Object.freeze({
          path,
          callee: token.value,
          offset: token.offset,
          expression: exactDynamicCodeConstructorExpression(source, tokens, index, path),
        });
        if (
          dynamicCodePin !== undefined
          || hooks.allowDynamicCodeConstructor?.(observation) !== true
        ) {
          fail(
            "dynamic-code-evaluation",
            `unpinned dynamic-code constructor reference at ${location(path, token)}`,
            path,
          );
        }
        dynamicCodeConstructors.push(observation);
      }
    }
    if (
      token.kind === "string"
      && DYNAMIC_FUNCTION_IDENTIFIERS.has(token.value)
      && tokenIs(tokens[index - 1], "[")
      && tokenIs(tokens[index + 1], "]")
      && (
        constructorMemberIsInvoked(tokens, index)
        || ["global", "globalThis", "self", "window"].includes(tokens[index - 2]?.value ?? "")
      )
    ) {
      fail(
        "dynamic-code-evaluation",
        `dynamic-code constructor member reference at ${location(path, token)}`,
        path,
      );
    }
    if (isInvokedConstructorMember(tokens, index)) {
      fail(
        "dynamic-code-evaluation",
        `constructor-family dynamic-code invocation at ${location(path, token)}`,
        path,
      );
    }
    if (
      token.kind === "identifier"
      && token.value === "Reflect"
      && literalMemberProperty(tokens, index) === "construct"
    ) {
      fail(
        "dynamic-code-evaluation",
        `Reflect.construct dynamic-code surface at ${location(path, token)}`,
        path,
      );
    }
    if (
      token.kind === "identifier"
      && ((token.value === "Module" && memberProperty === "_cache")
        || (token.value === "process" && memberProperty === "moduleLoadList"))
    ) {
      fail(
        "forbidden-runtime-introspection",
        `forbidden module-loader state reference at ${location(path, token)}`,
        path,
      );
    }
    if (token.kind === "identifier" && token.value === "createRequire") {
      fail(
        "forbidden-runtime-introspection",
        `createRequire can expose mutable loader state at ${location(path, token)}`,
        path,
      );
    }
    if (
      token.kind === "identifier"
      && token.value === "require"
      && literalMemberProperty(tokens, index) === "cache"
    ) {
      fail(
        "forbidden-runtime-introspection",
        `require.cache reference at ${location(path, token)}`,
        path,
      );
    }
    if (token.kind === "identifier" && token.value === "eval") {
      const prior = tokens[index - 1];
      const domainProperty = tokenIs(prior, ".")
        || (tokenIs(next, ":") && !tokenIs(prior, "?"));
      const globalProperty = tokenIs(prior, ".")
        && ["global", "globalThis", "self", "window"].includes(tokens[index - 2]?.value ?? "");
      if (!domainProperty || globalProperty) {
        fail(
          "dynamic-code-evaluation",
          `eval reference at ${location(path, token)}`,
          path,
        );
      }
    }
    if (
      token.kind === "identifier"
      && ["global", "globalThis", "self", "window"].includes(token.value)
      && literalMemberProperty(tokens, index) === "eval"
    ) {
      fail(
        "dynamic-code-evaluation",
        `global eval reference at ${location(path, token)}`,
        path,
      );
    }
    validatePrivilegedCapabilityToken(
      tokens,
      index,
      path,
      approvedGlobalCapabilityOffsets,
      approvedRequireCapabilityOffsets,
      staticImportOffsets,
      approvedProcessCapabilityOffsets,
    );

    hooks.onCompiledEnvironmentToken?.(tokens, index);

    if (
      token.kind === "identifier"
      && (token.value === "import" || token.value === "require" || token.value === "engineRequire")
      && tokenIs(next, "(")
    ) {
      const argument = callArgument(tokens, index + 1);
      if (argument?.kind !== "string") {
        fail(
          "unresolved-computed-acquisition",
          `computed ${token.value} at ${location(path, token)}`,
          path,
        );
      }
      if (token.value === "engineRequire") {
        if (argument.value.includes("?") || argument.value.includes("#") || argument.value.startsWith(".")) {
          fail("unresolved-computed-acquisition", `invalid engineRequire id ${argument.value}`, path);
        }
        observeAcquisition("engine-require", argument.value);
      } else {
        const key = `${token.value}\0${argument.value}`;
        const remainingRuntimeCalls = runtimeCallCounts.get(key) ?? 0;
        if (remainingRuntimeCalls > 0) {
          runtimeCallCounts.set(key, remainingRuntimeCalls - 1);
        } else {
          observeTypeOnlySpecifier(argument.value);
        }
      }
    }

    const requireResolve =
      token.kind === "identifier"
      && token.value === "require"
      && tokenIs(next, ".")
      && tokenIs(nextTwo, "resolve")
      && tokenIs(nextThree, "(");
    const importMetaResolve =
      token.kind === "identifier"
      && token.value === "import"
      && tokenIs(next, ".")
      && tokenIs(nextTwo, "meta")
      && tokenIs(nextThree, ".")
      && tokenIs(tokens[index + 4], "resolve")
      && tokenIs(tokens[index + 5], "(");
    if (requireResolve || importMetaResolve) {
      const open = requireResolve ? index + 3 : index + 5;
      const argument = callArgument(tokens, open);
      if (argument?.kind !== "string") {
        fail("unresolved-computed-acquisition", `computed module resolution at ${location(path, token)}`, path);
      }
      observeAcquisition("module-resolve", argument.value);
    }

    const filesystemCall = lexicalFilesystemCall(tokens, index);
    if (filesystemCall !== undefined) {
      const { callee } = filesystemCall;
      const prior = tokens[filesystemCall.calleeIndex - 1];
      if (prior?.kind === "identifier" && ["function", "interface", "type"].includes(prior.value)) continue;
      const kind: ComputedFileAcquisitionKind = GLOB_CALLEES.has(callee)
        ? "literal-glob"
        : DIRECTORY_READ_CALLEES.has(callee)
        ? "literal-directory"
        : "literal-read";
      const argument = callArgument(tokens, filesystemCall.openParenIndex);
      if (argument?.kind !== "string") {
        const observation: ComputedFileAcquisitionObservation = Object.freeze({
          path,
          kind,
          callee,
          offset: token.offset,
          expression: exactCallExpression(
            source,
            tokens,
            filesystemCall.expressionStartIndex,
            filesystemCall.openParenIndex,
            path,
          ),
        });
        if (hooks.allowComputedFileAcquisition?.(observation) !== true) {
          fail("unresolved-computed-acquisition", `computed ${callee} acquisition at ${location(path, token)}`, path);
        }
        computedFileAcquisitions.push(observation);
        continue;
      }
      observeAcquisition(kind, argument.value);
    } else if (
      isFilesystemCapabilityReference(tokens, index)
      && !staticImportOffsets.has(index)
      && !(tokens[index - 1]?.kind === "identifier"
        && ["function", "interface", "type"].includes(tokens[index - 1]!.value))
    ) {
      fail(
        "unresolved-computed-acquisition",
        `filesystem acquisition capability escapes at ${location(path, token)}`,
        path,
      );
    }
  }
  if (
    dynamicCodePin !== undefined
    && matchedDynamicCodePins !== dynamicCodePin.expectedCount
  ) {
    fail(
      "dynamic-code-evaluation",
      `${path} has ${matchedDynamicCodePins} pinned dynamic-code constructors; expected ${dynamicCodePin.expectedCount}`,
      path,
    );
  }
  hooks.validateCompiledHostSensitivity?.();
  for (const [key, count] of runtimeCallCounts) {
    if (count !== 0) {
      fail(
        "invalid-source",
        `${path} lexical/runtime import census disagrees for ${JSON.stringify(key)}`,
        path,
      );
    }
  }
  return Object.freeze({
    acquisitions: Object.freeze(acquisitions),
    computedFileAcquisitions: Object.freeze(computedFileAcquisitions),
    dynamicCodeConstructors: Object.freeze(dynamicCodeConstructors),
    hostSensitiveOperations: Object.freeze(hostSensitiveOperations),
    typeOnlySpecifiers: Object.freeze(typeOnlySpecifiers),
  });
}

/**
 * Product-independent, source-local acquisition census.
 *
 * It performs no path resolution or filesystem access. Literal acquisition
 * rows are reported in the same deterministic order used by the compiled
 * artifact closer. Computed acquisitions, loader-state introspection, and
 * unpinned dynamic-code surfaces fail before a census is returned. A caller
 * may admit a separately modeled computed filesystem call from its frozen
 * path/kind/callee/offset/expression observation; computed module and engine
 * acquisitions are never delegated to that policy. The strict default admits
 * none. A separate callback can admit an exact direct constructor observation
 * outside the existing path-bound dynamic-code ledger; ledgered paths and
 * matches never consult it. The compiled artifact closer uses both strict
 * defaults.
 */
export function censusSourceAcquisitions(
  path: RepositoryRelativePath,
  source: string,
  options: SourceAcquisitionCensusOptions = Object.freeze({}),
): LexicalSourceAcquisitionCensus {
  return censusSourceAcquisitionsWithHooks(path, source, Object.freeze({
    allowComputedFileAcquisition: options.allowComputedFileAcquisition,
    allowDynamicCodeConstructor: options.allowDynamicCodeConstructor,
    observeMemberAccess: options.observeMemberAccess,
    observeIdentifier: options.observeIdentifier,
  }));
}

function edgeSort(left: RuntimeAcquisitionEdge, right: RuntimeAcquisitionEdge): number {
  return compareUtf8(left.from, right.from)
    || compareUtf8(left.kind, right.kind)
    || compareUtf8(left.specifier, right.specifier)
    || compareUtf8(JSON.stringify(left.targets), JSON.stringify(right.targets));
}

function typeEdgeSort(left: TypeOnlyAcquisitionEdge, right: TypeOnlyAcquisitionEdge): number {
  return compareUtf8(left.from, right.from)
    || compareUtf8(left.specifier, right.specifier)
    || compareUtf8(left.target ?? "", right.target ?? "");
}

function globRegex(pattern: string): RegExp {
  if (/[{}[\]!()]/u.test(pattern)) {
    fail("unresolved-computed-acquisition", `unsupported literal glob syntax ${JSON.stringify(pattern)}`);
  }
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          expression += "(?:[^/]+/)*";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
  }
  return new RegExp(`${expression}$`, "u");
}

export function closeCompiledArtifactAcquisition(
  input: CloseCompiledArtifactAcquisitionInput,
): ClosedCompiledArtifactAcquisition {
  const declaredEnvironmentKeys = sortedUniqueStrings(input.declaredEnvironmentKeys);
  for (const key of declaredEnvironmentKeys) {
    if (!ENVIRONMENT_KEY.test(key)) fail("duplicate-input", `invalid environment key ${JSON.stringify(key)}`);
  }
  const declaredEnvironment = new Set(declaredEnvironmentKeys);
  const allowedBuiltinList = sortedUniqueStrings(DEFAULT_COMPILED_ARTIFACT_WORKER_BUILTINS);
  const allowedBuiltins = new Set(allowedBuiltinList);
  for (const builtin of allowedBuiltinList) {
    if (!builtin.startsWith("node:") || ABSOLUTELY_FORBIDDEN_BUILTINS.has(builtin)) {
      fail("forbidden-builtin", `invalid allowed worker builtin ${JSON.stringify(builtin)}`);
    }
  }

  const additional = new Map<RepositoryRelativePath, Uint8Array>();
  for (const file of input.materializedFiles ?? []) {
    const path = repositoryRelativePath(file.path);
    if (additional.has(path) || input.bytes.has(path)) {
      fail("duplicate-input", `materialized acquisition input overlaps captured bytes: ${path}`, path);
    }
    additional.set(path, Uint8Array.from(file.bytes));
  }
  const availablePaths = Object.freeze([
    ...input.bytes.paths,
    ...additional.keys(),
  ].sort(compareUtf8Paths));
  const availableSet = new Set<RepositoryRelativePath>(availablePaths);

  const readCaptured = (path: RepositoryRelativePath): Uint8Array => {
    const extra = additional.get(path);
    if (extra !== undefined) return Uint8Array.from(extra);
    if (!input.bytes.has(path)) fail("missing-input", `acquisition input is absent: ${path}`, path);
    return input.bytes.read(path);
  };

  const resolveFile = (
    from: RepositoryRelativePath,
    specifier: string,
    engineRequire: boolean,
  ): RepositoryRelativePath => {
    const base = engineRequire
      ? normalizeSegments("", `${ENGINE_SOURCE_ROOT}/${specifier}`)
      : normalizeSegments(directoryOf(from), specifier);
    const explicitExtension = extensionOf(base);
    const directExists = availableSet.has(base);
    const candidates = directExists || SOURCE_EXTENSIONS.includes(
      explicitExtension as (typeof SOURCE_EXTENSIONS)[number],
    )
      ? [base]
      : [
        base,
        ...SOURCE_EXTENSIONS.map((extension) => repositoryRelativePath(`${base}${extension}`)),
        ...SOURCE_EXTENSIONS.map((extension) => repositoryRelativePath(`${base}/index${extension}`)),
      ];
    const matches = candidates.filter((candidate) => availableSet.has(candidate));
    if (matches.length === 0) {
      fail("missing-input", `${from} acquires missing path ${JSON.stringify(specifier)}`, from);
    }
    if (matches.length > 1) {
      fail(
        "ambiguous-resolution",
        `${from} acquisition ${JSON.stringify(specifier)} has ambiguous captured targets: ${matches.join(", ")}`,
        from,
      );
    }
    return matches[0]!;
  };

  const resolveRuntimeSpecifier = (
    from: RepositoryRelativePath,
    specifierWithQuery: string,
    kind: RuntimeAcquisitionKind,
  ): RuntimeAcquisitionEdge => {
    const raw = specifierWithQuery.endsWith("?raw");
    const specifier = raw ? specifierWithQuery.slice(0, -4) : specifierWithQuery;
    if (specifier.includes("?") || specifier.includes("#")) {
      fail("unresolved-computed-acquisition", `${from} has unsupported acquisition query ${specifierWithQuery}`, from);
    }
    if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
      if (
        raw
        || ABSOLUTELY_FORBIDDEN_BUILTINS.has(specifier)
        || !allowedBuiltins.has(specifier)
        || ((specifier === "node:crypto" || specifier === "node:util") && kind !== "commonjs-module")
      ) {
        fail("forbidden-builtin", `${from} imports forbidden worker builtin ${specifier}`, from);
      }
      return Object.freeze({ from, kind, specifier: specifierWithQuery, raw, builtin: specifier, targets: Object.freeze([]) });
    }
    if (!specifier.startsWith(".")) {
      fail("non-node-bare-package", `${from} imports non-node bare package ${JSON.stringify(specifier)}`, from);
    }
    const target = resolveFile(from, specifier, false);
    return Object.freeze({
      from,
      kind,
      specifier: specifierWithQuery,
      raw,
      builtin: null,
      targets: Object.freeze([target]),
    });
  };

  const entrypoints = Object.freeze([...input.entrypoints].map(repositoryRelativePath).sort(compareUtf8Paths));
  if (entrypoints.length === 0) fail("invalid-entrypoint", "acquisition census requires at least one entrypoint");
  for (let index = 1; index < entrypoints.length; index += 1) {
    if (entrypoints[index - 1] === entrypoints[index]) {
      fail("invalid-entrypoint", `duplicate acquisition entrypoint ${entrypoints[index]}`);
    }
  }
  for (const entrypoint of entrypoints) {
    if (!availableSet.has(entrypoint) || !CODE_EXTENSIONS.has(extensionOf(entrypoint))) {
      fail("invalid-entrypoint", `missing or non-code acquisition entrypoint ${entrypoint}`, entrypoint);
    }
  }

  const runtimeEdges: RuntimeAcquisitionEdge[] = [];
  const typeOnlyEdges: TypeOnlyAcquisitionEdge[] = [];
  const observedEnvironment = new Set<string>();
  const observedBuiltins = new Set<string>();
  const hostSensitiveOperations: HostSensitiveOperationRow[] = [];
  const acquired = new Map<RepositoryRelativePath, AcquiredSourceRow>();
  const queue: Array<{
    readonly path: RepositoryRelativePath;
    readonly execute: boolean;
  }> = entrypoints.map((path) => Object.freeze({ path, execute: true }));
  const processedCode = new Set<RepositoryRelativePath>();

  const enqueueEdge = (edge: RuntimeAcquisitionEdge): void => {
    runtimeEdges.push(edge);
    if (edge.builtin !== null) observedBuiltins.add(edge.builtin);
    const execute = !edge.raw
      && edge.kind !== "literal-directory"
      && edge.kind !== "literal-glob"
      && edge.kind !== "literal-read"
      && edge.kind !== "module-resolve";
    for (const target of edge.targets) queue.push(Object.freeze({ path: target, execute }));
  };

  while (queue.length > 0) {
    const nextAcquisition = queue.shift()!;
    const path = nextAcquisition.path;
    let row = acquired.get(path);
    const extension = extensionOf(path);
    const executableCode = nextAcquisition.execute && CODE_EXTENSIONS.has(extension);
    if (nextAcquisition.execute && !executableCode && extension !== ".json") {
      fail("unsupported-source-kind", `${path} has no declared worker module loader`, path);
    }
    if (row !== undefined && (!executableCode || processedCode.has(path))) continue;
    const bytes = readCaptured(path);
    const role: AcquiredSourceRow["role"] = executableCode
      ? "code"
      : extension === ".json"
      ? "data"
      : "raw";
    if (row === undefined || (row.role !== "code" && role === "code")) {
      row = Object.freeze({
        path,
        role,
        byteLength: bytes.byteLength,
        sha256: sha256Raw(bytes),
      });
      acquired.set(path, row);
    }
    if (!executableCode || processedCode.has(path)) continue;
    processedCode.add(path);

    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("invalid-utf8", `worker source is not strict UTF-8: ${path}`, path);
    }
    const pathHostSensitiveOperations: HostSensitiveOperationRow[] = [];
    const onHostSensitiveOperation = (
      kind: HostSensitiveOperationKind,
      offset: number,
    ): void => {
      const operation = Object.freeze({ path, kind, offset });
      hostSensitiveOperations.push(operation);
      pathHostSensitiveOperations.push(operation);
    };
    const onCompiledCapabilityToken = (
      tokens: readonly LexToken[],
      index: number,
      approvedProcessOffsets: ReadonlySet<number>,
    ): void => {
      const token = tokens[index]!;
      if (token.kind !== "identifier" || token.value !== "process") return;
      if (approvedProcessOffsets.has(token.offset)) return;
      const previous = tokens[index - 1];
      const memberProperty = literalMemberProperty(tokens, index);
      const propertyPosition = tokenIs(previous, ".")
        || (tokenIs(previous, "[") && tokenIs(tokens[index + 1], "]"))
        || tokenIs(tokens[index + 1], ":");
      if (!propertyPosition && memberProperty === undefined) {
        if (tokenIs(tokens[index + 1], "[") || !tokenIs(previous, "typeof")) {
          fail(
            "forbidden-runtime-introspection",
            `process object escape or computed capability at ${location(path, token)}`,
            path,
          );
        }
      } else if (
        !propertyPosition
        && memberProperty !== undefined
        && !["env", "argv", "stdout", "platform", "arch", "cwd"].includes(memberProperty)
      ) {
        fail(
          "forbidden-runtime-introspection",
          `undeclared process capability ${memberProperty} at ${location(path, token)}`,
          path,
        );
      }
    };
    const onCompiledEnvironmentToken = (
      tokens: readonly LexToken[],
      index: number,
    ): void => {
      const token = tokens[index]!;
      if (
        token.kind !== "identifier"
        || (token.value !== "process" && token.value !== "Bun")
      ) return;
      let cursor = index + 1;
      let isEnvironment = false;
      if (tokenIs(tokens[cursor], ".") && tokenIs(tokens[cursor + 1], "env")) {
        cursor += 2;
        isEnvironment = true;
      } else if (
        tokenIs(tokens[cursor], "[")
        && tokens[cursor + 1]?.kind === "string"
        && tokens[cursor + 1]!.value === "env"
        && tokenIs(tokens[cursor + 2], "]")
      ) {
        cursor += 3;
        isEnvironment = true;
      }
      if (!isEnvironment) return;
      if (token.value === "Bun") {
        fail(
          "forbidden-runtime-introspection",
          `Bun.env is an unreachable pinned-runtime residual at ${location(path, token)}`,
          path,
        );
      }
      if (
        environmentPrefixMutationAt(tokens, index)
        || environmentMutationOperatorAt(tokens, cursor)
      ) {
        fail(
          "computed-environment-access",
          `environment mutation at ${location(path, token)}`,
          path,
        );
      }
      const optionalProperty = tokenIs(tokens[cursor], "?") && tokenIs(tokens[cursor + 1], ".");
      if (optionalProperty) cursor += 2;
      let key: string | undefined;
      let keyEnd = cursor;
      if (optionalProperty && tokens[cursor]?.kind === "identifier") {
        key = tokens[cursor]!.value;
        keyEnd = cursor + 1;
      } else if (tokenIs(tokens[cursor], ".") && tokens[cursor + 1]?.kind === "identifier") {
        key = tokens[cursor + 1]!.value;
        keyEnd = cursor + 2;
      } else if (
        tokenIs(tokens[cursor], "[")
        && tokens[cursor + 1]?.kind === "string"
        && tokenIs(tokens[cursor + 2], "]")
      ) {
        key = tokens[cursor + 1]!.value;
        keyEnd = cursor + 3;
      } else if (tokenIs(tokens[cursor], "[")) {
        fail("computed-environment-access", `computed environment key at ${location(path, token)}`, path);
      } else {
        const booleanGuard =
          (tokenIs(tokens[cursor], "&") && tokenIs(tokens[cursor + 1], "&"))
          || (tokenIs(tokens[cursor], "|") && tokenIs(tokens[cursor + 1], "|"));
        if (!booleanGuard) {
          fail("computed-environment-access", `environment object escape/enumeration at ${location(path, token)}`, path);
        }
      }
      if (key !== undefined) {
        if (environmentMutationOperatorAt(tokens, keyEnd)) {
          fail(
            "computed-environment-access",
            `environment mutation at ${location(path, token)}`,
            path,
          );
        }
        if (!declaredEnvironment.has(key)) {
          fail("undeclared-environment-key", `${path} reads undeclared environment key ${key}`, path);
        }
        observedEnvironment.add(key);
      }
    };
    const onAcquisition = (row: LexicalAcquisitionRow): void => {
      if (
        row.kind === "static-module"
        || row.kind === "dynamic-module"
        || row.kind === "commonjs-module"
        || row.kind === "module-resolve"
        || row.kind === "runtime-worker-asset"
      ) {
        enqueueEdge(resolveRuntimeSpecifier(path, row.specifier, row.kind));
        return;
      }
      if (row.kind === "engine-require") {
        const target = resolveFile(path, row.specifier, true);
        enqueueEdge(Object.freeze({
          from: path,
          kind: row.kind,
          specifier: row.specifier,
          raw: false,
          builtin: null,
          targets: Object.freeze([target]),
        }));
        return;
      }
      if (row.kind === "literal-glob") {
        const normalized = normalizeGlob(row.specifier);
        const matcher = globRegex(normalized);
        const matches = availablePaths.filter((candidate) => matcher.test(candidate));
        enqueueEdge(Object.freeze({
          from: path,
          kind: row.kind,
          specifier: row.specifier,
          raw: true,
          builtin: null,
          targets: Object.freeze(matches),
        }));
        return;
      }
      if (row.kind === "literal-directory") {
        const normalized = normalizeSegments("", row.specifier);
        const prefix = `${normalized}/`;
        const matches = availablePaths.filter((candidate) => candidate.startsWith(prefix));
        if (matches.length === 0) {
          fail("missing-input", `${path} lists missing literal directory ${normalized}`, path);
        }
        enqueueEdge(Object.freeze({
          from: path,
          kind: row.kind,
          specifier: row.specifier,
          raw: true,
          builtin: null,
          targets: Object.freeze(matches),
        }));
        return;
      }
      const normalized = normalizeSegments("", row.specifier);
      if (!availableSet.has(normalized)) {
        fail("missing-input", `${path} reads missing literal path ${normalized}`, path);
      }
      enqueueEdge(Object.freeze({
        from: path,
        kind: row.kind,
        specifier: row.specifier,
        raw: true,
        builtin: null,
        targets: Object.freeze([normalized]),
      }));
    };
    const onTypeOnlySpecifier = (specifier: string): void => {
      let target: RepositoryRelativePath | null = null;
      if (specifier.startsWith(".")) {
        target = resolveFile(path, specifier, false);
      }
      typeOnlyEdges.push(Object.freeze({ from: path, specifier, target }));
    };
    const validateCompiledHostSensitivity = (): void => {
      const expectedHostSensitivity: Readonly<
        Partial<Record<HostSensitiveOperationKind, number>>
      > = HOST_SENSITIVITY_PINS[path] ?? Object.freeze({});
      const observedHostSensitivity = new Map<HostSensitiveOperationKind, number>();
      for (const operation of pathHostSensitiveOperations) {
        observedHostSensitivity.set(
          operation.kind,
          (observedHostSensitivity.get(operation.kind) ?? 0) + 1,
        );
      }
      const hostSensitivityKinds = new Set<HostSensitiveOperationKind>([
        ...observedHostSensitivity.keys(),
        ...Object.keys(expectedHostSensitivity) as HostSensitiveOperationKind[],
      ]);
      for (const kind of hostSensitivityKinds) {
        const observedCount = observedHostSensitivity.get(kind) ?? 0;
        const expectedCount = expectedHostSensitivity[kind] ?? 0;
        if (observedCount !== expectedCount) {
          fail(
            "host-sensitive-operation",
            `${path} has ${observedCount} ${kind} operations; expected ${expectedCount}`,
            path,
          );
        }
      }
    };
    const census = censusSourceAcquisitionsWithHooks(path, source, Object.freeze({
      onAcquisition,
      onTypeOnlySpecifier,
      onHostSensitiveOperation,
      onCompiledCapabilityToken,
      onCompiledEnvironmentToken,
      validateCompiledHostSensitivity,
    }));
    assertCompiledArtifactBuiltinGrants(path, source, census.acquisitions);
  }
  for (const grantPath of COMPILED_ARTIFACT_BUILTIN_GRANTS.keys()) {
    if (availableSet.has(grantPath) && !processedCode.has(grantPath)) {
      fail(
        "forbidden-builtin",
        `captured builtin grant path was not reached by the worker closure: ${grantPath}`,
        grantPath,
      );
    }
  }
  const sourceRows = Object.freeze([...acquired.values()].sort((left, right) => compareUtf8Paths(left.path, right.path)));
  runtimeEdges.sort(edgeSort);
  typeOnlyEdges.sort(typeEdgeSort);
  const builtins = Object.freeze([...observedBuiltins].sort(compareUtf8));
  const observedEnvironmentKeys = Object.freeze([...observedEnvironment].sort(compareUtf8));
  hostSensitiveOperations.sort((left, right) =>
    compareUtf8Paths(left.path, right.path)
    || compareUtf8(left.kind, right.kind)
    || left.offset - right.offset);
  const frozenHostSensitiveOperations = Object.freeze(hostSensitiveOperations);
  const canonical = [
    COMPILED_ARTIFACT_ACQUISITION_SCHEMA,
    entrypoints,
    sourceRows.map((row) => [row.path, row.role, row.byteLength, row.sha256]),
    runtimeEdges.map((edge) => [edge.from, edge.kind, edge.specifier, edge.raw, edge.builtin, edge.targets]),
    typeOnlyEdges.map((edge) => [edge.from, edge.specifier, edge.target]),
    builtins,
    allowedBuiltinList,
    declaredEnvironmentKeys,
    observedEnvironmentKeys,
    frozenHostSensitiveOperations.map((row) => [row.path, row.kind, row.offset]),
  ] as const;
  return Object.freeze({
    schema: COMPILED_ARTIFACT_ACQUISITION_SCHEMA,
    entrypoints,
    sourceRows,
    runtimeEdges: Object.freeze(runtimeEdges),
    typeOnlyEdges: Object.freeze(typeOnlyEdges),
    builtins,
    allowedBuiltins: allowedBuiltinList,
    declaredEnvironmentKeys,
    observedEnvironmentKeys,
    hostSensitiveOperations: frozenHostSensitiveOperations,
    digest: sha256Raw(JSON.stringify(canonical)),
  });
}

/** C2 syntax/provenance observations, NOT a semantic-cut admission.
 * Supports only standalone, unaliased loader-named calls and literal
 * identifier arrays. Unknown uses remain byte-bound. This never evaluates code.
 */
export interface DirectRawModuleLoadObservation {
  readonly importer: RepositoryRelativePath;
  readonly rawSpecifier: string;
  readonly rawBinding: string;
  readonly rawImportOffset: number;
  readonly loaderSpecifier: string | null;
  readonly loaderOffset: number | null;
  readonly fallbackName: string | null;
  readonly options: Readonly<Record<string, string | boolean>> | null;
  readonly resultBinding: string | null;
  readonly resultExported: boolean;
  readonly identifierArrays: readonly Readonly<{
    binding: string;
    exported: boolean;
    offset: number;
    members: readonly string[];
  }>[];
  readonly unknownRawUses: readonly number[];
  readonly unknownResultUses: readonly number[];
  readonly closedStandaloneShape: boolean;
  /** Resolve/import provenance must separately bind the real canonical loader. */
  readonly canonicalTargetEstablished: false;
  /** Always false here: file syntax does not establish downstream roles. */
  readonly consumerRolesEstablished: false;
}

export function censusDirectRawModuleLoads(
  path: RepositoryRelativePath,
  source: string,
): readonly DirectRawModuleLoadObservation[] {
  const tokens = lexSource(source, path);
  const depth: number[] = [];
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (const token of tokens) {
    depth.push(braces + brackets + parentheses);
    if (token.kind === "punct") {
      if (token.value === "{") braces++;
      if (token.value === "}") braces--;
      if (token.value === "[") brackets++;
      if (token.value === "]") brackets--;
      if (token.value === "(") parentheses++;
      if (token.value === ")") parentheses--;
    }
  }
  const loaderImports: Array<{ bindingIndex: number; specifier: string }> = [];
  const rawImports: Array<{ bindingIndex: number; specifier: string; importIndex: number }> = [];
  for (let index = 0; index < tokens.length; index++) {
    if (depth[index] !== 0 || tokens[index]?.kind !== "identifier" || !tokenIs(tokens[index], "import")) continue;
    let end = index + 1;
    while (end < tokens.length && !tokenIs(tokens[end], ";")) end++;
    if (end === tokens.length) continue; // ASI/import grammar outside this bounded shape.
    if (tokens[index + 1]?.kind === "identifier"
      && tokenIs(tokens[index + 2], "from") && tokens[index + 3]?.kind === "string"
      && tokens[index + 3]!.value.endsWith("?raw") && end === index + 4) {
      rawImports.push({ bindingIndex: index + 1, specifier: tokens[index + 3]!.value, importIndex: index });
    }
    if (!tokenIs(tokens[index + 1], "{")) continue;
    const close = tokens.findIndex((token, position) => position > index + 1 && position < end && token.value === "}");
    if (close < 0 || !tokenIs(tokens[close + 1], "from") || tokens[close + 2]?.kind !== "string") continue;
    for (let position = index + 2; position < close; position++) {
      if (tokenIs(tokens[position], "loadFenelModule")
        && (tokenIs(tokens[position - 1], "{") || tokenIs(tokens[position - 1], ","))
        && (tokenIs(tokens[position + 1], "}") || tokenIs(tokens[position + 1], ","))) {
        loaderImports.push({ bindingIndex: position, specifier: tokens[close + 2]!.value });
      }
    }
  }
  const loaderImport = loaderImports.length === 1 ? loaderImports[0] : undefined;
  const identifierPositions = (name: string): number[] => tokens.flatMap((token, index) =>
    token.kind === "identifier" && token.value === name ? [index] : []);
  // Refuse aliases, assignments, declarations/shadowing and reflective method
  // references. Calls alone are not admitted as a policy; they only establish
  // the syntax seat of this exact imported binding.
  const loaderBindingClosed = loaderImport !== undefined && identifierPositions("loadFenelModule").every(index =>
    index === loaderImport.bindingIndex || (tokenIs(tokens[index + 1], "(")
      && !tokenIs(tokens[index - 1], ".") && !tokenIs(tokens[index - 1], "function")
      && !tokenIs(tokens[index - 1], "new") && !tokenIs(tokens[index - 1], "{")));

  const literalArrays: Array<{ binding: string; exported: boolean; offset: number; members: string[]; memberPositions: number[] }> = [];
  for (let index = 0; index < tokens.length; index++) {
    if (depth[index] !== 0 || tokens[index]?.kind !== "identifier" || !tokenIs(tokens[index], "const") || tokens[index + 1]?.kind !== "identifier") continue;
    let equal = index + 2;
    if (tokenIs(tokens[equal], ":")) {
      while (equal < tokens.length && equal < index + 40 && !tokenIs(tokens[equal], "=") && !tokenIs(tokens[equal], ";")) equal++;
    }
    if (!tokenIs(tokens[equal], "=") || !tokenIs(tokens[equal + 1], "[")) continue;
    const members: string[] = [];
    const memberPositions: number[] = [];
    let position = equal + 2;
    let closed = true;
    while (position < tokens.length && !tokenIs(tokens[position], "]")) {
      if (tokens[position]?.kind !== "identifier") { closed = false; break; }
      members.push(tokens[position]!.value);
      memberPositions.push(position);
      position++;
      if (tokenIs(tokens[position], ",")) position++;
      else if (!tokenIs(tokens[position], "]")) { closed = false; break; }
    }
    if (closed && tokenIs(tokens[position], "]") && tokenIs(tokens[position + 1], ";")) {
      literalArrays.push({ binding: tokens[index + 1]!.value, exported: tokenIs(tokens[index - 1], "export"),
        offset: tokens[index]!.offset, members, memberPositions });
    }
  }

  return Object.freeze(rawImports.map(rawImport => {
    const rawName = tokens[rawImport.bindingIndex]!.value;
    const uses = identifierPositions(rawName).filter(index => index !== rawImport.bindingIndex);
    let loaderIndex: number | undefined;
    let fallbackName: string | null = null;
    let options: Readonly<Record<string, string | boolean>> | null = null;
    let resultIndex: number | undefined;
    let resultExported = false;
    let callClosed = false;
    if (loaderBindingClosed && uses.length === 1) {
      const argument = uses[0]!;
      const callee = argument - 2;
      if (tokenIs(tokens[callee], "loadFenelModule") && tokenIs(tokens[callee + 1], "(")
        && tokenIs(tokens[argument + 1], ",") && tokens[argument + 2]?.kind === "string") {
        let cursor = argument + 3;
        const values: Record<string, string | boolean> = Object.create(null);
        let optionsClosed = true;
        if (tokenIs(tokens[cursor], ",")) {
          cursor++;
          if (!tokenIs(tokens[cursor], "{")) optionsClosed = false;
          else {
            cursor++;
            const seenKeys = new Set<string>();
            while (cursor < tokens.length && !tokenIs(tokens[cursor], "}")) {
              const key = tokens[cursor];
              if ((key?.kind !== "identifier" && key?.kind !== "string")
                || ["__proto__", "prototype", "constructor"].includes(key.value)
                || seenKeys.has(key.value) || !tokenIs(tokens[cursor + 1], ":")) { optionsClosed = false; break; }
              const value = tokens[cursor + 2];
              if (value?.kind === "string") values[key.value] = value.value;
              else if (tokenIs(value, "true") || tokenIs(value, "false")) values[key.value] = value!.value === "true";
              else { optionsClosed = false; break; }
              seenKeys.add(key.value);
              cursor += 3;
              if (tokenIs(tokens[cursor], ",")) cursor++;
              else if (!tokenIs(tokens[cursor], "}")) { optionsClosed = false; break; }
            }
            if (tokenIs(tokens[cursor], "}")) cursor++;
            else optionsClosed = false;
          }
        }
        if (optionsClosed && tokenIs(tokens[cursor], ")") && tokenIs(tokens[cursor + 1], ";")
          && tokenIs(tokens[callee - 1], "=")) {
          let declaration = callee - 2;
          // Only `const x = ...` or `const x: Identifier = ...`.
          if (tokenIs(tokens[declaration - 1], ":")) declaration -= 2;
          if (tokens[declaration]?.kind === "identifier" && tokenIs(tokens[declaration - 1], "const")
            && depth[declaration - 1] === 0) {
            loaderIndex = callee;
            resultIndex = declaration;
            resultExported = tokenIs(tokens[declaration - 2], "export");
            fallbackName = tokens[argument + 2]!.value;
            options = Object.freeze(values);
            callClosed = true;
          }
        }
      }
    }
    const resultName = resultIndex === undefined ? null : tokens[resultIndex]!.value;
    const arrays = resultName === null ? [] : literalArrays.filter(array => array.members.includes(resultName));
    const admittedResultPositions = new Set<number>(resultIndex === undefined ? [] : [resultIndex]);
    for (const array of arrays) for (const position of array.memberPositions) {
      if (tokens[position]!.value === resultName) admittedResultPositions.add(position);
    }
    const unknownResultUses = resultName === null ? [] : identifierPositions(resultName)
      .filter(index => !admittedResultPositions.has(index)).map(index => tokens[index]!.offset);
    const unknownRawUses = uses.filter(index => !(callClosed && index === loaderIndex! + 2)).map(index => tokens[index]!.offset);
    return Object.freeze({ importer: path, rawSpecifier: rawImport.specifier, rawBinding: rawName,
      rawImportOffset: tokens[rawImport.importIndex]!.offset,
      loaderSpecifier: loaderImport?.specifier ?? null, loaderOffset: loaderIndex === undefined ? null : tokens[loaderIndex]!.offset,
      fallbackName, options, resultBinding: resultName, resultExported,
      identifierArrays: Object.freeze(arrays.map(array => Object.freeze({ binding: array.binding,
        exported: array.exported, offset: array.offset, members: Object.freeze([...array.members]) }))),
      unknownRawUses: Object.freeze(unknownRawUses), unknownResultUses: Object.freeze(unknownResultUses),
      closedStandaloneShape: callClosed && !tokens.some(token => token.kind === "computed-template")
        && unknownRawUses.length === 0 && unknownResultUses.length === 0,
      canonicalTargetEstablished: false as const,
      consumerRolesEstablished: false as const });
  }));
}
