import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RECOVERABLE_OUTPUT_EXCLUSIONS,
  repositoryRelativePath,
  type CapturedByteStore,
  type RepositoryRelativePath,
} from "./artifact-bytes";
import {
  censusSourceAcquisitions,
  closeCompiledArtifactAcquisition,
  CompiledArtifactAcquisitionError,
  type MaterializedAcquisitionFile,
  type SourceAcquisitionCensusOptions,
} from "./compiled-artifact-acquisition";
import { compiledArtifactRecoveryStubs } from "./compiled-artifact-certificate";

const UTF8 = new TextEncoder();
const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../../..");
const DECLARED_ENVIRONMENT = Object.freeze([
  "FENEL_PARSE_CACHE",
  "FENEL_PARSER_LEGACY",
  "FENEL_PARSER_INTERPRETED",
  "FENEL_RESOLVER_INTERPRETED",
  "NODE_ENV",
  "TZ",
  "LANG",
  "LC_ALL",
  "TEMP",
  "TMP",
  "TMPDIR",
  "FENEL_SIMULATE_BROWSER",
  "FENEL_DISPATCH_FENEL_PASSES",
  "FENEL_REGEX_SHIM_DEBUG",
]);
const OBSERVED_ENVIRONMENT = Object.freeze([
  "FENEL_DISPATCH_FENEL_PASSES",
  "FENEL_PARSER_INTERPRETED",
  "FENEL_PARSER_LEGACY",
  "FENEL_PARSE_CACHE",
  "FENEL_REGEX_SHIM_DEBUG",
  "FENEL_RESOLVER_INTERPRETED",
  "FENEL_SIMULATE_BROWSER",
  "NODE_ENV",
]);
const ENGINE_DISPATCH_DYNAMIC_CODE_PIN =
  '$ns[code] = new Function("$ns", `with($ns){ return (${body}); }`)($ns);';
const ENGINE_DISPATCH_CRYPTO_GRANT =
  'const { createHash } = require("node:crypto") as typeof import("node:crypto");';
const ENGINE_DISPATCH_PROXY_GRANT =
  'const candidate = (require("node:util") as typeof import("node:util")).types.isProxy;';
const EVALUATOR_DYNAMIC_CODE_PIN =
  'const fn = new Function("$fenel", `return ${serialized._0};`,)(JIT_FENEL_RUNTIME) as (...args: unknown[]) => unknown;';
const PROVER_DYNAMIC_CODE_PIN =
  'const fn = new Function("$fenel", `return ${serialized._0};`,)(COMPILABLE_PROVER_FENEL) as (...callArgs: unknown[]) => unknown;';
const ENGINE_DISPATCH_PATH =
  "implementations/typescript/engine/src/engine-bodies-dispatch.ts";
const EVALUATOR_FFI_PATH =
  "fenel/modules/evaluator-strategies/ffi/evaluator-strategies-ffi.ts";
const PROVER_FFI_PATH = "fenel/modules/prover/ffi/prover-ffi.ts";
const COMPILE_JS_CLASSIFIER_PATH =
  "implementations/typescript/engine/src/compile-js-self-host-classifier.ts";
const COMPILE_JS_CLASSIFIER_CONSTRUCTOR =
  'new Function("$fenel", `return ${serialised._0};`)(runtime)';
const COMPILE_LLVM_CLASSIFIER_PATH =
  "implementations/typescript/engine/src/compile-llvm-self-host-classifier.ts";
const LLVM_BUN_CAPABILITY_FIXTURE = `function whichSafe(name: string): string | null {
  const bun = (globalThis as { Bun?: { which: (n: string) => string | null } }).Bun;
  return bun?.which(name) ?? null;
}
const CLANG_PATH = whichSafe("clang");
type BunNamespace = { spawnSync: (...args: unknown[]) => unknown };
function compile(): unknown {
  const bun = (globalThis as { Bun?: BunNamespace }).Bun;
  if (bun === undefined) throw new Error("Bun namespace not available");
  return bun.spawnSync([]);
}
function run(): unknown {
  const bun = (globalThis as { Bun?: BunNamespace }).Bun;
  if (bun === undefined) return null;
  return bun.spawnSync([]);
}
`;
const JSON_LOGIC_PATH = "implementations/typescript/engine/src/json-logic.ts";
const BENIGN_CONSTRUCTOR_COMPARISON =
  "if ((a as { constructor: unknown }).constructor !== (b as { constructor: unknown }).constructor) return false;";
const PARSER_FIXITIES_PATH =
  "implementations/typescript/engine/src/parser-fixities.ts";
const FIELD_WORKER_CLIENT_PATH =
  "implementations/typescript/engine/src/field-identity-worker-client.ts";
const FIELD_WORKER_ASSET_PATH =
  "implementations/typescript/engine/src/field-identity-worker.ts";
const FIELD_WORKER_STATEMENT =
  'const worker = new Worker(new URL("./field-identity-worker.ts", import.meta.url), { type: "module" });';
const FIELD_WORKER_CLIENT_FIXTURE = [
  "export function prepare() {",
  '  if (typeof Worker === "undefined") return undefined;',
  `  ${FIELD_WORKER_STATEMENT}`,
  "  return worker;",
  "}",
].join("\n");

class MemoryByteStore implements CapturedByteStore {
  readonly paths: readonly RepositoryRelativePath[];
  readonly #values: ReadonlyMap<RepositoryRelativePath, Uint8Array>;

  constructor(entries: ReadonlyMap<RepositoryRelativePath, Uint8Array>) {
    this.#values = new Map(
      [...entries].map(([path, bytes]) => [path, Uint8Array.from(bytes)] as const),
    );
    this.paths = Object.freeze([...this.#values.keys()].sort());
  }

  has(path: RepositoryRelativePath): boolean {
    return this.#values.has(path);
  }

  read(path: RepositoryRelativePath): Uint8Array {
    const value = this.#values.get(path);
    if (value === undefined) throw new RangeError(`missing memory byte ${path}`);
    return Uint8Array.from(value);
  }
}

function store(entries: Readonly<Record<string, string | Uint8Array>>): CapturedByteStore {
  return new MemoryByteStore(new Map(
    Object.entries(entries).map(([path, value]) => [
      repositoryRelativePath(path),
      typeof value === "string" ? UTF8.encode(value) : value,
    ] as const),
  ));
}

function acquisitionErrorCodeAtPath(
  path: string,
  source: string,
  entries: Readonly<Record<string, string>> = {},
): string | undefined {
  const entrypoint = repositoryRelativePath(path);
  try {
    closeCompiledArtifactAcquisition({
      entrypoints: [entrypoint],
      bytes: store({ [entrypoint]: source, ...entries }),
      declaredEnvironmentKeys: ["FIXED"],
    });
    return undefined;
  } catch (error) {
    return error instanceof CompiledArtifactAcquisitionError ? error.code : undefined;
  }
}

function acquisitionErrorCode(source: string, entries: Readonly<Record<string, string>> = {}): string | undefined {
  return acquisitionErrorCodeAtPath("worker/entry.ts", source, entries);
}

function lexicalCensusErrorCode(
  source: string,
  path = "worker/entry.ts",
  options?: SourceAcquisitionCensusOptions,
): string | undefined {
  try {
    censusSourceAcquisitions(repositoryRelativePath(path), source, options);
    return undefined;
  } catch (error) {
    return error instanceof CompiledArtifactAcquisitionError ? error.code : undefined;
  }
}

function collectRepositoryBytes(): CapturedByteStore {
  const excluded = new Set<string>(RECOVERABLE_OUTPUT_EXCLUSIONS);
  const entries = new Map<RepositoryRelativePath, Uint8Array>();
  const visit = (relative: string): void => {
    for (const entry of readdirSync(resolve(REPOSITORY_ROOT, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`.replaceAll("\\", "/");
      if (entry.isSymbolicLink()) throw new Error(`test fixture contains a forbidden symlink: ${child}`);
      if (entry.isDirectory()) {
        visit(child);
      } else if (entry.isFile() && !excluded.has(child)) {
        entries.set(repositoryRelativePath(child), readFileSync(resolve(REPOSITORY_ROOT, child)));
      }
    }
  };
  visit("fenel");
  visit("implementations/typescript/engine/src");
  for (const worker of [
    "implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts",
    "implementations/typescript/engine/scripts/generate-compiled-resolver-worker.ts",
  ]) {
    entries.set(repositoryRelativePath(worker), readFileSync(resolve(REPOSITORY_ROOT, worker)));
  }
  return new MemoryByteStore(entries);
}

describe("product-independent lexical acquisition census", () => {
  test("enumerates literal module, filesystem, directory, glob, and engine acquisitions", () => {
    const result = censusSourceAcquisitions(
      repositoryRelativePath("worker/entry.ts"),
      [
        'import "./static";',
        'export * from "./exported";',
        'import type { Only } from "./types-only";',
        'type Query = typeof import("./query-type");',
        'void import("./dynamic");',
        'void require("./common");',
        'void require.resolve("./resolved");',
        'void import.meta.resolve("./meta");',
        'void engineRequire("engine/id");',
        'void readFileSync("fixtures/file.txt");',
        'void readdirSync("fixtures");',
        'void glob("fixtures/**/*.fenel");',
        "void process.exit(0);",
        "void Date.now();",
      ].join("\n"),
    );

    expect(result).toEqual({
      acquisitions: [
        { kind: "static-module", specifier: "./static" },
        { kind: "static-module", specifier: "./exported" },
        { kind: "dynamic-module", specifier: "./dynamic" },
        { kind: "commonjs-module", specifier: "./common" },
        { kind: "module-resolve", specifier: "./resolved" },
        { kind: "module-resolve", specifier: "./meta" },
        { kind: "engine-require", specifier: "engine/id" },
        { kind: "literal-read", specifier: "fixtures/file.txt" },
        { kind: "literal-directory", specifier: "fixtures" },
        { kind: "literal-glob", specifier: "fixtures/**/*.fenel" },
      ],
      computedFileAcquisitions: [],
      dynamicCodeConstructors: [],
      hostSensitiveOperations: [
        { path: repositoryRelativePath("worker/entry.ts"), kind: "directory-order", offset: 335 },
        { path: repositoryRelativePath("worker/entry.ts"), kind: "current-time", offset: 421 },
      ],
      typeOnlySpecifiers: ["./types-only", "./query-type"],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.acquisitions)).toBe(true);
    expect(result.acquisitions.every(Object.isFrozen)).toBe(true);
  });

  test.each([
    ["Math randomness", 'void Math["ran" + "dom"]();'],
    ["Date clock", 'void Date["n" + "ow"]();'],
    ["performance clock", 'void performance["n" + "ow"]();'],
    ["navigator platform", 'void navigator["plat" + "form"];'],
    ["Bun randomness", 'void Bun["randomUUID" + "v7"]();'],
    ["computed locale ordering", 'void value["locale" + "Compare"](other);'],
    ["computed locale formatting", 'void value["toLocale" + "String"]();'],
  ])("rejects computed host-sensitive member: %s", (_name, source) => {
    expect(lexicalCensusErrorCode(source)).toBe("host-sensitive-operation");
  });

  test("enumerates literal bracket filesystem calls", () => {
    const result = censusSourceAcquisitions(
      repositoryRelativePath("worker/entry.ts"),
      [
        'void fs["readFileSync"]("fixtures/file.txt");',
        'void fs["readdirSync"]("fixtures");',
        'void fs["glob"]("fixtures/**/*.fenel");',
      ].join("\n"),
    );
    expect(result.acquisitions).toEqual([
      { kind: "literal-read", specifier: "fixtures/file.txt" },
      { kind: "literal-directory", specifier: "fixtures" },
      { kind: "literal-glob", specifier: "fixtures/**/*.fenel" },
    ]);
  });

  test("admits only caller-pinned computed filesystem observations", () => {
    const path = repositoryRelativePath("worker/entry.ts");
    const observations: unknown[] = [];
    const result = censusSourceAcquisitions(
      path,
      'void readFileSync(MATRIX_PATH, "utf8");',
      {
        allowComputedFileAcquisition: (observation) => {
          observations.push(observation);
          return observation.path === path
            && observation.kind === "literal-read"
            && observation.callee === "readFileSync"
            && observation.offset === 5
            && observation.expression === 'readFileSync(MATRIX_PATH, "utf8")';
        },
      },
    );

    expect(result.computedFileAcquisitions).toEqual([{
      path,
      kind: "literal-read",
      callee: "readFileSync",
      offset: 5,
      expression: 'readFileSync(MATRIX_PATH, "utf8")',
    }]);
    expect(observations).toEqual([...result.computedFileAcquisitions]);
    expect(result.computedFileAcquisitions.every(Object.isFrozen)).toBe(true);
    expect(lexicalCensusErrorCode('void readFileSync(MATRIX_PATH, "utf8");')).toBe(
      "unresolved-computed-acquisition",
    );
  });

  test("admits and reports one exact unledgered dynamic-code constructor", () => {
    const path = repositoryRelativePath(COMPILE_JS_CLASSIFIER_PATH);
    const source = `const fn = ${COMPILE_JS_CLASSIFIER_CONSTRUCTOR} as (...args: unknown[]) => unknown;`;
    const observations: unknown[] = [];
    const result = censusSourceAcquisitions(path, source, {
      allowDynamicCodeConstructor: (observation) => {
        observations.push(observation);
        return observation.path === path
          && observation.callee === "Function"
          && observation.offset === source.indexOf("Function")
          && observation.expression === COMPILE_JS_CLASSIFIER_CONSTRUCTOR;
      },
    });

    expect(result.dynamicCodeConstructors).toEqual([{
      path,
      callee: "Function",
      offset: source.indexOf("Function"),
      expression: COMPILE_JS_CLASSIFIER_CONSTRUCTOR,
    }]);
    expect(observations).toEqual([...result.dynamicCodeConstructors]);
    expect(Object.isFrozen(result.dynamicCodeConstructors)).toBe(true);
    expect(result.dynamicCodeConstructors.every(Object.isFrozen)).toBe(true);
    expect(lexicalCensusErrorCode(source, COMPILE_JS_CLASSIFIER_PATH)).toBe(
      "dynamic-code-evaluation",
    );
  });

  test("an exact dynamic-code admission policy rejects wrong shape, path, and count", () => {
    const exactPolicy = (expectedPath: string, maxCount = 1): SourceAcquisitionCensusOptions => {
      let admitted = 0;
      return {
        allowDynamicCodeConstructor: (observation) => {
          const matches = observation.path === expectedPath
            && observation.callee === "Function"
            && observation.expression === COMPILE_JS_CLASSIFIER_CONSTRUCTOR
            && admitted < maxCount;
          if (matches) admitted += 1;
          return matches;
        },
      };
    };
    const exactSource = `void ${COMPILE_JS_CLASSIFIER_CONSTRUCTOR};`;
    const wrongShape = exactSource.replace("serialised._0", "serialised.value");
    expect(lexicalCensusErrorCode(
      wrongShape,
      COMPILE_JS_CLASSIFIER_PATH,
      exactPolicy(COMPILE_JS_CLASSIFIER_PATH),
    )).toBe("dynamic-code-evaluation");
    expect(lexicalCensusErrorCode(
      exactSource,
      "worker/entry.ts",
      exactPolicy(COMPILE_JS_CLASSIFIER_PATH),
    )).toBe("dynamic-code-evaluation");
    expect(lexicalCensusErrorCode(
      `${exactSource}\n${exactSource}`,
      COMPILE_JS_CLASSIFIER_PATH,
      exactPolicy(COMPILE_JS_CLASSIFIER_PATH),
    )).toBe("dynamic-code-evaluation");
  });

  test("rejects a hidden constructor even beside one admitted classifier constructor", () => {
    const path = repositoryRelativePath(COMPILE_JS_CLASSIFIER_PATH);
    let callbackCount = 0;
    const source = [
      `const fn = ${COMPILE_JS_CLASSIFIER_CONSTRUCTOR} as (...args: unknown[]) => unknown;`,
      "const Hidden = (() => {}).constructor;",
      'void Hidden("return 0")();',
    ].join("\n");
    expect(lexicalCensusErrorCode(source, COMPILE_JS_CLASSIFIER_PATH, {
      allowDynamicCodeConstructor: (observation) => {
        callbackCount += 1;
        return observation.path === path
          && observation.callee === "Function"
          && observation.expression === COMPILE_JS_CLASSIFIER_CONSTRUCTOR;
      },
    })).toBe("dynamic-code-evaluation");
    expect(callbackCount).toBe(1);
  });

  test("preserves only the exact benign constructor comparison", () => {
    expect(lexicalCensusErrorCode(BENIGN_CONSTRUCTOR_COMPARISON, JSON_LOGIC_PATH)).toBeUndefined();
    expect(lexicalCensusErrorCode(BENIGN_CONSTRUCTOR_COMPARISON)).toBe("dynamic-code-evaluation");
    expect(lexicalCensusErrorCode(
      BENIGN_CONSTRUCTOR_COMPARISON.replace("!==", "==="),
      JSON_LOGIC_PATH,
    )).toBe("dynamic-code-evaluation");
  });

  test("the shared 2+1+1 ledger never consults the admission callback", () => {
    let callbackCount = 0;
    const options: SourceAcquisitionCensusOptions = {
      allowDynamicCodeConstructor: () => {
        callbackCount += 1;
        return true;
      },
    };
    const exact = censusSourceAcquisitions(
      repositoryRelativePath(ENGINE_DISPATCH_PATH),
      [ENGINE_DISPATCH_DYNAMIC_CODE_PIN, ENGINE_DISPATCH_DYNAMIC_CODE_PIN].join("\n"),
      options,
    );
    expect(exact.dynamicCodeConstructors).toEqual([]);
    expect(callbackCount).toBe(0);
    expect(lexicalCensusErrorCode(
      EVALUATOR_DYNAMIC_CODE_PIN.replace("serialized._0", "serialized.value"),
      EVALUATOR_FFI_PATH,
      options,
    )).toBe("dynamic-code-evaluation");
    expect(callbackCount).toBe(0);
  });

  test("never delegates computed module acquisitions to the filesystem policy", () => {
    let callbackCount = 0;
    try {
      censusSourceAcquisitions(
        repositoryRelativePath("worker/entry.ts"),
        'void import(target);',
        {
          allowComputedFileAcquisition: () => {
            callbackCount += 1;
            return true;
          },
        },
      );
      throw new Error("computed import unexpectedly passed the lexical census");
    } catch (error) {
      expect(error).toBeInstanceOf(CompiledArtifactAcquisitionError);
      expect((error as CompiledArtifactAcquisitionError).code).toBe("unresolved-computed-acquisition");
    }
    expect(callbackCount).toBe(0);
  });

  test.each([
    ["computed dynamic import", 'const target = "./x"; void import(target);', "unresolved-computed-acquisition"],
    ["computed CommonJS require", 'const target = "./x"; void require(target);', "unresolved-computed-acquisition"],
    ["computed engineRequire", 'const target = "x"; void engineRequire(target);', "unresolved-computed-acquisition"],
    ["computed literal read", 'const target = "x"; void readFileSync(target);', "unresolved-computed-acquisition"],
    ["literal-prefix computed read", 'void readFileSync("captured/a" + suffix);', "unresolved-computed-acquisition"],
    ["computed bracket read", 'void fs["readFileSync"](target);', "unresolved-computed-acquisition"],
    ["computed literal directory", 'const target = "x"; void readdirSync(target);', "unresolved-computed-acquisition"],
    ["computed literal glob", 'const target = "x"; void glob(target);', "unresolved-computed-acquisition"],
    ["computed module resolution", 'const target = "./x"; void require.resolve(target);', "unresolved-computed-acquisition"],
    ["Module._cache", "void Module._cache;", "forbidden-runtime-introspection"],
    ["require.cache", "void require.cache;", "forbidden-runtime-introspection"],
    ["createRequire", "void createRequire(import.meta.url);", "forbidden-runtime-introspection"],
    ["require alias", "const load = require; void load(\"node:fs\");", "forbidden-runtime-introspection"],
    ["module computed require", 'void module["re" + "quire"]("node:fs");', "forbidden-runtime-introspection"],
    ["module namespace alias", 'const m = module; const load = m["re" + "quire"]; load("bun:sqlite");', "forbidden-runtime-introspection"],
    ["module require destructure", 'const { "require": load } = module; load("bun:sqlite");', "forbidden-runtime-introspection"],
    ["module object spread escape", 'const copied = { ...module }; void copied["re" + "quire"];', "forbidden-runtime-introspection"],
    ["module casing isolation", 'const Module = {}; const load = module["re" + "quire"]; load("bun:sqlite");', "forbidden-runtime-introspection"],
    ["module object default", "const { x = module } = {}; void x;", "forbidden-runtime-introspection"],
    ["module array default", "const [x = module] = []; void x;", "forbidden-runtime-introspection"],
    ["module parameter default", "function inspect({ x = module } = {}) { return x; }", "forbidden-runtime-introspection"],
    ["module computed key", "const { [module]: x } = {}; void x;", "forbidden-runtime-introspection"],
    ["module after type arrow", 'type T = (module: string) => string\nvoid module["re" + "quire"];', "forbidden-runtime-introspection"],
    ["module after annotated type arrow", 'const x: (module: string) => string = value\nvoid module["re" + "quire"];', "forbidden-runtime-introspection"],
    ["module contextual declaration word", "const type = module; void type;", "forbidden-runtime-introspection"],
    ["module contextual property word", "obj.const(module);", "forbidden-runtime-introspection"],
    ["module after unbraced loop", "for (const value of values) consume(value); void module;", "forbidden-runtime-introspection"],
    ["module after expression arrow", "const inspect = (value: unknown) => value; void module;", "forbidden-runtime-introspection"],
    ["computed constructor alias", 'const Hidden = (() => {})["con" + "structor"]; Hidden("Bun.sleepSync(1)")();', "dynamic-code-evaluation"],
    ["computed constructor invocation", '(((() => {}) as any)["con" + "structor"]("Bun.sleepSync(1)"))();', "dynamic-code-evaluation"],
    ["optional computed constructor", 'void (() => {})?.["con" + "structor"]("return 1")();', "dynamic-code-evaluation"],
    ["ASI filesystem identifier alias", 'import "./helper"\nconst list = readdirSync; list(".");', "unresolved-computed-acquisition"],
    ["ASI filesystem member alias", 'import "./helper"\nconst list = fs.readdirSync; list(".");', "unresolved-computed-acquisition"],
    ["ASI filesystem bracket alias", 'import "./helper"\nconst list = fs["readdirSync"]; list(".");', "unresolved-computed-acquisition"],
    ["computed global Function", 'globalThis["Fun" + "ction"]("return 1")();', "forbidden-runtime-introspection"],
    ["computed global process", 'void globalThis["pro" + "cess"].platform;', "forbidden-runtime-introspection"],
    ["computed global Bun", 'void globalThis["B" + "un"].version;', "forbidden-runtime-introspection"],
    ["navigator alias", "const escaped = navigator; void escaped;", "forbidden-runtime-introspection"],
    ["global object alias", "const escaped = globalThis; void escaped;", "forbidden-runtime-introspection"],
    ["process object alias", "const escaped = process; void escaped;", "forbidden-runtime-introspection"],
    ["Reflect object alias", "const escaped = Reflect; void escaped;", "forbidden-runtime-introspection"],
    ["computed Reflect member", 'void Reflect["con" + "struct"](() => {}, []);', "forbidden-runtime-introspection"],
    ["getBuiltinModule", 'void process.getBuiltinModule("node:fs");', "forbidden-runtime-introspection"],
    ["moduleLoadList", "void process.moduleLoadList;", "forbidden-runtime-introspection"],
    ["filesystem identifier alias", "const read = readFileSync; void read(target);", "unresolved-computed-acquisition"],
    ["filesystem member alias", "const read = fs.readFileSync; void read(target);", "unresolved-computed-acquisition"],
    ["filesystem bracket alias", 'const read = fs["readFileSync"]; void read(target);', "unresolved-computed-acquisition"],
    ["Bun fetch", 'void Bun.fetch("https://example.invalid");', "forbidden-runtime-introspection"],
    ["Bun bracket fetch", 'void Bun["fetch"]("https://example.invalid");', "forbidden-runtime-introspection"],
    ["computed Bun member", "void Bun[capability];", "forbidden-runtime-introspection"],
    ["Bun object escape", "const escaped = Bun; void escaped;", "forbidden-runtime-introspection"],
    ["unneeded Bun data member", "void Bun.version;", "forbidden-runtime-introspection"],
    ["global bracket Bun escape", 'const escaped = globalThis["Bun"]; void escaped;', "forbidden-runtime-introspection"],
    ["Unicode-escaped Function", '\\u0046unction("return 1")();', "invalid-source"],
    ["Unicode-escaped eval", '\\u0065val("void 0");', "invalid-source"],
    ["eval", 'eval("void 0");', "dynamic-code-evaluation"],
    ["Function", 'new Function("return 1");', "dynamic-code-evaluation"],
    ["aliased constructor", 'const Hidden = (() => {}).constructor; void Hidden("return 1")();', "dynamic-code-evaluation"],
  ])("rejects %s without a resolver or byte store", (_name, source, expected) => {
    expect(lexicalCensusErrorCode(source)).toBe(expected);
  });

  test("admits only the exact matrix LLVM Bun capability ledger", () => {
    expect(lexicalCensusErrorCode(
      LLVM_BUN_CAPABILITY_FIXTURE,
      COMPILE_LLVM_CLASSIFIER_PATH,
    )).toBeUndefined();
    const actual = readFileSync(resolve(REPOSITORY_ROOT, COMPILE_LLVM_CLASSIFIER_PATH), "utf8");
    expect(lexicalCensusErrorCode(actual, COMPILE_LLVM_CLASSIFIER_PATH)).toBeUndefined();
  });

  test("pins the only production global and host-require aliases by path, shape, member, and count", () => {
    const codecPath = "fenel/modules/codec/ffi/codec-ffi.ts";
    const codec = readFileSync(resolve(REPOSITORY_ROOT, codecPath), "utf8");
    expect(lexicalCensusErrorCode(codec, codecPath)).toBeUndefined();
    expect(lexicalCensusErrorCode(
      codec.replace("if (g.Buffer) {", "void g.Function;\n    if (g.Buffer) {"),
      codecPath,
    )).toBe("forbidden-runtime-introspection");

    const imagePath = "implementations/typescript/engine/src/image-data.ts";
    const image = readFileSync(resolve(REPOSITORY_ROOT, imagePath), "utf8");
    expect(lexicalCensusErrorCode(image, imagePath)).toBeUndefined();
    expect(lexicalCensusErrorCode(
      image.replace("if (g.Buffer) {", "void g.Function;\n  if (g.Buffer) {"),
      imagePath,
    )).toBe("forbidden-runtime-introspection");

    const engineRequirePath = "implementations/typescript/engine/src/engine-require.ts";
    const engineRequire = readFileSync(resolve(REPOSITORY_ROOT, engineRequirePath), "utf8");
    expect(lexicalCensusErrorCode(engineRequire, engineRequirePath)).toBeUndefined();
    expect(lexicalCensusErrorCode(
      engineRequire.replace('loaded = req("./" + id);', "loaded = req(id);"),
      engineRequirePath,
    )).toBe("forbidden-runtime-introspection");
  });

  test("admits only engine-require's owned boolean native-host version probes", () => {
    const path = "implementations/typescript/engine/src/engine-require.ts";
    const source = readFileSync(resolve(REPOSITORY_ROOT, path), "utf8").replaceAll("\r\n", "\n");
    const declaration = [
      'const nativeHost = typeof process !== "undefined"',
      '    && (typeof process.versions?.node === "string" || typeof process.versions?.bun === "string");',
    ].join("\n");
    const check = (value: string): string | undefined => {
      try {
        closeCompiledArtifactAcquisition({ entrypoints: [repositoryRelativePath(path)],
          bytes: store({ [path]: value }), declaredEnvironmentKeys: DECLARED_ENVIRONMENT });
        return undefined;
      } catch (error) {
        return error instanceof CompiledArtifactAcquisitionError ? error.code : String(error);
      }
    };
    expect(source).toContain(declaration);
    expect(lexicalCensusErrorCode(source, path)).toBeUndefined();
    expect(check(source)).toBeUndefined();
    const mutations = [
      source.replace("process.versions?.node", "process.versions?.v8"),
      source.replace('typeof process.versions?.node === "string"', "process.versions?.node"),
      source.replace(declaration, "const nativeHost = process.versions;"),
      source.replace(declaration, "const nativeHost = true;"),
      source.replace(declaration, `${declaration}\n{ ${declaration} }`),
      source.replace(declaration, `/* ${declaration} */\nconst nativeHost = true;`),
      `${source}\nconst escaped = process.versions;`,
      `${source}\nconst leaked = process.versions.node;`,
      `${source}\nvoid typeof process.versions?.bun;`,
      `${source}\nvoid process["versions"];`,
    ];
    for (const mutated of mutations) {
      expect(lexicalCensusErrorCode(mutated, path)).toBe("forbidden-runtime-introspection");
      expect(check(mutated)).toBe("forbidden-runtime-introspection");
    }
    expect(lexicalCensusErrorCode(declaration)).toBe("forbidden-runtime-introspection");
    expect(acquisitionErrorCode(declaration)).toBe("forbidden-runtime-introspection");
  });

  test("admits only the owned node:util.types.isProxy CommonJS declaration", () => {
    const source = [
      ...Array.from({ length: 6 }, () => `{ ${ENGINE_DISPATCH_CRYPTO_GRANT} }`),
      ENGINE_DISPATCH_PROXY_GRANT,
      ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
      ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
      "void Date.now();",
      "void Date.now();",
    ].join("\n");
    const close = (body: string) => closeCompiledArtifactAcquisition({
      entrypoints: [repositoryRelativePath(ENGINE_DISPATCH_PATH)],
      bytes: store({ [ENGINE_DISPATCH_PATH]: body }),
      declaredEnvironmentKeys: [],
    });
    const result = close(source);
    expect(readFileSync(resolve(REPOSITORY_ROOT, ENGINE_DISPATCH_PATH), "utf8"))
      .toContain(ENGINE_DISPATCH_PROXY_GRANT);
    expect(result.builtins).toEqual(["node:crypto", "node:util"]);
    expect(result.allowedBuiltins).toEqual(["node:crypto", "node:util"]);
    expect(result.runtimeEdges.filter(edge => edge.builtin === "node:util")).toEqual([{
      from: repositoryRelativePath(ENGINE_DISPATCH_PATH), kind: "commonjs-module",
      specifier: "node:util", raw: false, builtin: "node:util", targets: [],
    }]);
    const mutations = [
      ["missing", source.replace(ENGINE_DISPATCH_PROXY_GRANT, "")],
      ["different member", source.replace(".types.isProxy;", ".types.isDate;")],
      ["types escape", source.replace(".types.isProxy;", ".types;")],
      ["namespace escape", source.replace(ENGINE_DISPATCH_PROXY_GRANT, 'const candidate = require("node:util");')],
      ["renamed binding", source.replace("const candidate =", "const escaped =")],
      ["computed member", source.replace(".types.isProxy;", '["types"]["isProxy"];')],
      ["duplicate", `${source}\n{ ${ENGINE_DISPATCH_PROXY_GRANT} }`],
      ["extra acquisition", `${source}\nvoid require("node:util");`],
      ["comment decoy", source.replace(ENGINE_DISPATCH_PROXY_GRANT, `/* ${ENGINE_DISPATCH_PROXY_GRANT} */`)],
      ["ESM namespace", source.replace(ENGINE_DISPATCH_PROXY_GRANT, 'import * as util from "node:util"; const candidate = util.types.isProxy;')],
      ["ESM named", source.replace(ENGINE_DISPATCH_PROXY_GRANT, 'import { types } from "node:util"; const candidate = types.isProxy;')],
      ["dynamic import", source.replace(ENGINE_DISPATCH_PROXY_GRANT, 'void import("node:util");')],
      ["re-export", source.replace(ENGINE_DISPATCH_PROXY_GRANT, 'export { types } from "node:util";')],
    ] as const;
    for (const [name, mutated] of mutations) {
      expect(acquisitionErrorCodeAtPath(ENGINE_DISPATCH_PATH, mutated), name).toBe("forbidden-builtin");
    }
    expect(acquisitionErrorCodeAtPath(ENGINE_DISPATCH_PATH,
      source.replace('require("node:util")', 'require("node:" + "util")')))
      .toBe("unresolved-computed-acquisition");
    expect(acquisitionErrorCodeAtPath(ENGINE_DISPATCH_PATH,
      source.replace(ENGINE_DISPATCH_PROXY_GRANT, 'const load = require; const candidate = load("node:util").types.isProxy;')))
      .toBe("forbidden-runtime-introspection");
    expect(acquisitionErrorCode(ENGINE_DISPATCH_PROXY_GRANT)).toBe("forbidden-builtin");
    expect(acquisitionErrorCodeAtPath("implementations/typescript/engine/src/another.ts", ENGINE_DISPATCH_PROXY_GRANT))
      .toBe("forbidden-builtin");
  });

  test.each([
    ["member", LLVM_BUN_CAPABILITY_FIXTURE.replace("bun.spawnSync([])", "bun.fetch([])")],
    ["count", LLVM_BUN_CAPABILITY_FIXTURE.replace("return bun.spawnSync([]);", "return null;")],
    ["alias", LLVM_BUN_CAPABILITY_FIXTURE.replace(
      "const bun = (globalThis as { Bun?: BunNamespace }).Bun;",
      "const escaped = (globalThis as { Bun?: BunNamespace }).Bun;",
    )],
    ["object escape", LLVM_BUN_CAPABILITY_FIXTURE.replace(
      "if (bun === undefined) return null;",
      "if (bun === undefined) return null;\n  void bun;",
    )],
    ["tool name", LLVM_BUN_CAPABILITY_FIXTURE.replace('whichSafe("clang")', 'whichSafe("llvm-as")')],
    ["extra member count", LLVM_BUN_CAPABILITY_FIXTURE.replace(
      "return bun.spawnSync([]);",
      "bun.spawnSync([]);\n  return bun.spawnSync([]);",
    )],
  ])("rejects matrix LLVM Bun ledger drift: %s", (_name, source) => {
    expect(lexicalCensusErrorCode(source, COMPILE_LLVM_CLASSIFIER_PATH))
      .toBe("forbidden-runtime-introspection");
  });

  test("retains the exact path-bound dynamic-code authority pins", () => {
    expect(lexicalCensusErrorCode(
      [ENGINE_DISPATCH_DYNAMIC_CODE_PIN, ENGINE_DISPATCH_DYNAMIC_CODE_PIN].join("\n"),
      ENGINE_DISPATCH_PATH,
    )).toBeUndefined();
    expect(lexicalCensusErrorCode(
      ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
      ENGINE_DISPATCH_PATH,
    )).toBe("dynamic-code-evaluation");
    expect(lexicalCensusErrorCode(
      EVALUATOR_DYNAMIC_CODE_PIN,
      "worker/entry.ts",
    )).toBe("dynamic-code-evaluation");
  });
});

describe("compiled artifact static acquisition census", () => {
  test("closes imports, exports, raw bytes, engineRequire, literal reads/globs, and environment", () => {
    const bytes = store({
      "worker/entry.ts": [
        'import "./runtime";',
        'export { value } from "./reexport";',
        'import type { Only } from "./types-only";',
        'import { type Other } from "./other-type";',
        'type Queried = typeof import("./query-type");',
        'import RAW from "./asset.ts?raw";',
        'void import("./dynamic");',
        'void require.resolve("./resolved");',
        'void engineRequire("synthetic/bridge");',
        'void readFileSync("fixtures/direct.txt");',
        'void glob("fixtures/**/*.fenel");',
        "void process.env && process.env.FIXED;",
        'void process.env?.["ABSENT"];',
        "void RAW;",
      ].join("\n"),
      "worker/runtime.ts": 'export { leaf } from "./leaf";\n',
      "worker/leaf.ts": "export const leaf = 1;\n",
      "worker/reexport.ts": "export const value = 2;\n",
      "worker/types-only.ts": 'import "not-a-runtime-package"; export type Only = string;\n',
      "worker/other-type.ts": 'import "also-not-runtime"; export type Other = string;\n',
      "worker/query-type.ts": 'import "query-not-runtime"; export type Queried = string;\n',
      "worker/asset.ts": "this is deliberately not valid TypeScript {{\n",
      "worker/dynamic.ts": "export default 3;\n",
      "worker/resolved.ts": "also deliberately invalid {{\n",
      "implementations/typescript/engine/src/synthetic/bridge.ts": "export const bridge = true;\n",
      "fixtures/direct.txt": "direct\n",
      "fixtures/a.fenel": "a\n",
      "fixtures/nested/b.fenel": "b\n",
      "fixtures/nested/c.txt": "not matched\n",
    });
    const result = closeCompiledArtifactAcquisition({
      entrypoints: [repositoryRelativePath("worker/entry.ts")],
      bytes,
      declaredEnvironmentKeys: ["FIXED", "ABSENT"],
    });

    expect(result.builtins).toEqual([]);
    expect(result.observedEnvironmentKeys).toEqual(["ABSENT", "FIXED"]);
    expect(result.sourceRows.map((row) => String(row.path))).toEqual([
      "fixtures/a.fenel",
      "fixtures/direct.txt",
      "fixtures/nested/b.fenel",
      "implementations/typescript/engine/src/synthetic/bridge.ts",
      "worker/asset.ts",
      "worker/dynamic.ts",
      "worker/entry.ts",
      "worker/leaf.ts",
      "worker/reexport.ts",
      "worker/resolved.ts",
      "worker/runtime.ts",
    ]);
    expect(result.sourceRows.find((row) => row.path === "worker/asset.ts")?.role).toBe("raw");
    expect(result.sourceRows.find((row) => row.path === "worker/resolved.ts")?.role).toBe("raw");
    expect(result.typeOnlyEdges.map((edge) => ({
      from: String(edge.from),
      specifier: edge.specifier,
      target: edge.target === null ? null : String(edge.target),
    }))).toEqual([
      {
        from: "worker/entry.ts",
        specifier: "./other-type",
        target: "worker/other-type.ts",
      },
      {
        from: "worker/entry.ts",
        specifier: "./query-type",
        target: "worker/query-type.ts",
      },
      {
        from: "worker/entry.ts",
        specifier: "./types-only",
        target: "worker/types-only.ts",
      },
    ]);
    expect(result.runtimeEdges.find((edge) => edge.kind === "literal-glob")?.targets.map(String)).toEqual([
      "fixtures/a.fenel",
      "fixtures/nested/b.fenel",
    ]);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  test.each([
    ["computed dynamic import", 'const target = "./x"; void import(target);', "unresolved-computed-acquisition"],
    ["computed require", 'const target = "./x"; void require(target);', "unresolved-computed-acquisition"],
    ["computed engineRequire", 'const target = "x"; void engineRequire(target);', "unresolved-computed-acquisition"],
    ["computed read", 'const target = "x"; void readFileSync(target);', "unresolved-computed-acquisition"],
    ["literal-prefix computed read", 'void readFileSync("captured/a" + suffix);', "unresolved-computed-acquisition"],
    ["computed bracket read", 'void fs["readFileSync"](target);', "unresolved-computed-acquisition"],
    ["computed glob", 'const target = "x"; void glob(target);', "unresolved-computed-acquisition"],
    ["directory-order dependency", 'void readdirSync("fixtures");', "host-sensitive-operation"],
    ["computed environment key", "const key = 'FIXED'; void process.env[key];", "computed-environment-access"],
    ["environment escape", "const escaped = process.env; void escaped;", "computed-environment-access"],
    ["environment object replacement", "process.env = {};", "computed-environment-access"],
    ["declared environment assignment", "process.env.FIXED = 'changed';", "computed-environment-access"],
    ["declared environment bracket assignment", "process.env['FIXED'] = 'changed';", "computed-environment-access"],
    ["declared environment compound assignment", "process.env.FIXED += 'changed';", "computed-environment-access"],
    ["declared environment postfix mutation", "process.env.FIXED++;", "computed-environment-access"],
    ["declared environment prefix mutation", "++process.env.FIXED;", "computed-environment-access"],
    ["declared environment delete", "delete process.env.FIXED;", "computed-environment-access"],
    ["environment defineProperty", "Object.defineProperty(process.env, 'FIXED', { value: 'changed' });", "computed-environment-access"],
    ["environment Reflect defineProperty", "Reflect.defineProperty(process.env, 'FIXED', { value: 'changed' });", "computed-environment-access"],
    ["environment prototype mutation", "Object.setPrototypeOf(process.env, null);", "computed-environment-access"],
    ["environment Reflect prototype mutation", "Reflect.setPrototypeOf(process.env, null);", "computed-environment-access"],
    ["environment preventExtensions", "Object.preventExtensions(process.env);", "computed-environment-access"],
    ["environment freeze", "Object.freeze(process.env);", "computed-environment-access"],
    ["Bun environment read", "void Bun.env.FIXED;", "forbidden-runtime-introspection"],
    ["Bun environment assignment", "Bun.env.FIXED = 'changed';", "forbidden-runtime-introspection"],
    ["Bun environment defineProperty", "Object.defineProperty(Bun.env, 'FIXED', { value: 'changed' });", "forbidden-runtime-introspection"],
    ["undeclared environment key", "void process.env.SURPRISE;", "undeclared-environment-key"],
    ["bare package", 'import "left-pad";', "non-node-bare-package"],
    ["filesystem builtin", 'import "node:fs";', "forbidden-builtin"],
    ["process builtin", 'import "node:child_process";', "forbidden-builtin"],
    ["network builtin", 'import "node:https";', "forbidden-builtin"],
    ["native builtin", 'import "bun:ffi";', "forbidden-builtin"],
    ["privileged preload builtin", 'import "node:module";', "forbidden-builtin"],
    ["ESM crypto named import", 'import { generateKeyPairSync as generate } from "node:crypto"; void generate;', "forbidden-builtin"],
    ["ESM crypto default import", 'import crypto from "node:crypto"; void crypto["generate" + "KeyPairSync"];', "forbidden-builtin"],
    ["dynamic crypto import", 'void import("node:crypto");', "forbidden-builtin"],
    ["ungranted CommonJS crypto import", 'void require("node:crypto");', "forbidden-builtin"],
    ["direct crypto key generation", 'void require("node:crypto").generateKeyPairSync("ed25519");', "host-sensitive-operation"],
    ["direct crypto ECDH", 'void require("node:crypto").createECDH("secp256k1");', "host-sensitive-operation"],
    ["node webcrypto key generation", 'void require("node:crypto").webcrypto.subtle.generateKey({}, true, []);', "host-sensitive-operation"],
    ["Diffie-Hellman group acquisition", 'void require("node:crypto").getDiffieHellman("modp14");', "host-sensitive-operation"],
    ["Module._cache read", "void Module._cache;", "forbidden-runtime-introspection"],
    ["Module bracket-cache tamper", 'Module["_cache"] = {};', "forbidden-runtime-introspection"],
    ["require.cache read", "void require.cache;", "forbidden-runtime-introspection"],
    ["require bracket-cache tamper", 'delete require["cache"].entry;', "forbidden-runtime-introspection"],
    ["require alias", "const load = require; void load(\"node:fs\");", "forbidden-runtime-introspection"],
    ["module computed require", 'void module["re" + "quire"]("node:fs");', "forbidden-runtime-introspection"],
    ["module namespace alias", 'const m = module; const load = m["re" + "quire"]; load("bun:sqlite");', "forbidden-runtime-introspection"],
    ["module require destructure", 'const { "require": load } = module; load("bun:sqlite");', "forbidden-runtime-introspection"],
    ["module object spread escape", 'const copied = { ...module }; void copied["re" + "quire"];', "forbidden-runtime-introspection"],
    ["computed constructor alias", 'const Hidden = (() => {})["con" + "structor"]; Hidden("Bun.sleepSync(1)")();', "dynamic-code-evaluation"],
    ["computed constructor invocation", '(((() => {}) as any)["con" + "structor"]("Bun.sleepSync(1)"))();', "dynamic-code-evaluation"],
    ["optional computed constructor", 'void (() => {})?.["con" + "structor"]("return 1")();', "dynamic-code-evaluation"],
    ["ASI filesystem identifier alias", 'import "./helper"\nconst list = readdirSync; list(".");', "unresolved-computed-acquisition"],
    ["ASI filesystem member alias", 'import "./helper"\nconst list = fs.readdirSync; list(".");', "unresolved-computed-acquisition"],
    ["ASI filesystem bracket alias", 'import "./helper"\nconst list = fs["readdirSync"]; list(".");', "unresolved-computed-acquisition"],
    ["computed global Function", 'globalThis["Fun" + "ction"]("return 1")();', "forbidden-runtime-introspection"],
    ["computed global process", 'void globalThis["pro" + "cess"].platform;', "forbidden-runtime-introspection"],
    ["computed global Bun", 'void globalThis["B" + "un"].version;', "forbidden-runtime-introspection"],
    ["global object alias", "const escaped = globalThis; void escaped;", "forbidden-runtime-introspection"],
    ["Reflect object alias", "const escaped = Reflect; void escaped;", "forbidden-runtime-introspection"],
    [
      "createRequire cache read",
      "void createRequire(import.meta.url).cache;",
      "forbidden-runtime-introspection",
    ],
    ["process.moduleLoadList read", "void process.moduleLoadList;", "forbidden-runtime-introspection"],
    ["process report write", 'void process.report.writeReport("../ambient.json");', "forbidden-runtime-introspection"],
    [
      "process bracket module-load-list tamper",
      'process["moduleLoadList"].length = 0;',
      "forbidden-runtime-introspection",
    ],
    ["filesystem identifier alias", "const read = readFileSync; void read(target);", "unresolved-computed-acquisition"],
    ["filesystem member alias", "const read = fs.readFileSync; void read(target);", "unresolved-computed-acquisition"],
    ["filesystem bracket alias", 'const read = fs["readFileSync"]; void read(target);', "unresolved-computed-acquisition"],
    ["Unicode-escaped Function", '\\u0046unction("return 1")();', "invalid-source"],
    ["Unicode-escaped eval", '\\u0065val("void 0");', "invalid-source"],
    ["aliased constructor", 'const Hidden = (() => {}).constructor; void Hidden("return 1")();', "dynamic-code-evaluation"],
    ["direct eval", 'eval("void 0");', "dynamic-code-evaluation"],
    ["indirect eval", '(0, eval)("void 0");', "dynamic-code-evaluation"],
    ["global eval", 'globalThis["eval"]("void 0");', "dynamic-code-evaluation"],
    ["unsupported module loader", 'import "./payload.wasm";', "unsupported-source-kind"],
  ])("rejects %s", (_name, source, expected) => {
    const entries: Readonly<Record<string, string>> = {
      ...(source.includes("payload.wasm") ? { "worker/payload.wasm": "wasm" } : {}),
      ...(source.includes("readdirSync") ? { "fixtures/a.txt": "fixture\n" } : {}),
      ...(source.includes('import "./helper"') ? { "worker/helper.ts": "export {};\n" } : {}),
    };
    expect(acquisitionErrorCode(source, entries)).toBe(expected);
  });

  test.each([
    ["Date.now", "void Date.now();"],
    ["Date function", "void Date();"],
    ["empty Date constructor", "void new Date();"],
    ["performance.now", "void performance.now();"],
    ["Math.random", "void Math.random();"],
    ["crypto randomness alias surface", "const { randomBytes } = crypto; void randomBytes(8);"],
    ["Intl", "void new Intl.Collator();"],
    ["localeCompare", "void value.localeCompare(other);"],
    ["toLocale formatter", "void value.toLocaleString();"],
    ["platform branch", 'if (process.platform === "win32") throw 0;'],
    ["architecture branch", 'void process["arch"];'],
    ["process cwd", "void process.cwd();"],
    ["dirname", "void __dirname;"],
    ["import meta URL", "void import.meta.url;"],
  ])("rejects unpinned host-sensitive operation: %s", (_name, source) => {
    expect(acquisitionErrorCode(source)).toBe("host-sensitive-operation");
  });

  test("owns the exact asynchronous registry worker asset and its transitive sources", () => {
    const helper = "implementations/typescript/engine/src/worker-kernel-fixture.ts";
    const close = (body: string) => closeCompiledArtifactAcquisition({
      entrypoints: [repositoryRelativePath(FIELD_WORKER_CLIENT_PATH)],
      bytes: store({
        [FIELD_WORKER_CLIENT_PATH]: FIELD_WORKER_CLIENT_FIXTURE,
        [FIELD_WORKER_ASSET_PATH]: 'import "./worker-kernel-fixture";\n',
        [helper]: body,
      }),
      declaredEnvironmentKeys: [],
    });
    const first = close("export const value = 1;\n");
    expect(first.runtimeEdges).toContainEqual({
      from: repositoryRelativePath(FIELD_WORKER_CLIENT_PATH), kind: "runtime-worker-asset",
      specifier: "./field-identity-worker.ts", raw: false, builtin: null,
      targets: [repositoryRelativePath(FIELD_WORKER_ASSET_PATH)],
    });
    expect(first.sourceRows.map((row) => String(row.path))).toEqual([
      FIELD_WORKER_CLIENT_PATH, FIELD_WORKER_ASSET_PATH, helper,
    ].sort());
    expect(first.sourceRows.every((row) => row.role === "code")).toBe(true);
    expect(first.hostSensitiveOperations.map((row) => [String(row.path), row.kind])).toEqual([
      [FIELD_WORKER_CLIENT_PATH, "absolute-path"],
    ]);
    expect(close("export const value = 2;\n").digest).not.toBe(first.digest);
    expect(acquisitionErrorCodeAtPath(FIELD_WORKER_CLIENT_PATH, FIELD_WORKER_CLIENT_FIXTURE))
      .toBe("missing-input");
  });

  test.each([
    ["different target", FIELD_WORKER_CLIENT_FIXTURE.replace("./field-identity-worker.ts", "./other-worker.ts")],
    ["computed target", FIELD_WORKER_CLIENT_FIXTURE.replace('"./field-identity-worker.ts"', "target")],
    ["different options", FIELD_WORKER_CLIENT_FIXTURE.replace('type: "module"', 'type: "classic"')],
    ["URL returned as data", FIELD_WORKER_CLIENT_FIXTURE.replace(FIELD_WORKER_STATEMENT, "const worker = import.meta.url;")],
    ["extra module URL", `${FIELD_WORKER_CLIENT_FIXTURE}\nvoid import.meta.url;`],
    ["extra cwd read", `${FIELD_WORKER_CLIENT_FIXTURE}\nvoid process.cwd();`],
    ["Worker parameter shadow", FIELD_WORKER_CLIENT_FIXTURE.replace("prepare()", "prepare(Worker: unknown)")],
    ["URL shadow", `const URL = String;\n${FIELD_WORKER_CLIENT_FIXTURE}`],
    ["missing availability probe", FIELD_WORKER_CLIENT_FIXTURE.replace('typeof Worker === "undefined"', "false")],
    ["comment decoy", FIELD_WORKER_CLIENT_FIXTURE.replace(FIELD_WORKER_STATEMENT, `// ${FIELD_WORKER_STATEMENT}\nconst worker = undefined;`)],
    ["duplicate constructor", FIELD_WORKER_CLIENT_FIXTURE.replace(FIELD_WORKER_STATEMENT, `{ ${FIELD_WORKER_STATEMENT} }\n${FIELD_WORKER_STATEMENT}`)],
  ])("rejects runtime-worker asset drift: %s", (_name, source) => {
    expect(acquisitionErrorCodeAtPath(FIELD_WORKER_CLIENT_PATH, source, {
      [FIELD_WORKER_ASSET_PATH]: "export {};\n",
    })).toBe("host-sensitive-operation");
  });

  test("the runtime-worker allowance does not follow its statement to another source", () => {
    expect(acquisitionErrorCode(FIELD_WORKER_CLIENT_FIXTURE, {
      "worker/field-identity-worker.ts": "export {};\n",
    })).toBe("host-sensitive-operation");
    expect(acquisitionErrorCode('new Worker("./other-worker.ts");', {
      "worker/other-worker.ts": "export {};\n",
    })).toBe("host-sensitive-operation");
  });

  test.each([
    ["direct builtin loader", 'void process.getBuiltinModule("node:fs");'],
    ["bracket builtin loader", 'void process["getBuiltinModule"]("node:fs");'],
    ["optional builtin loader", 'void process?.["getBuiltinModule"]?.("node:fs");'],
    ["computed builtin loader", 'void process["get" + "BuiltinModule"]("node:fs");'],
    ["process alias", "const escaped = process; void escaped;"],
    ["global process alias", "const escaped = globalThis.process; void escaped;"],
  ])("rejects process capability escape: %s", (_name, source) => {
    expect(acquisitionErrorCode(source)).toBe("forbidden-runtime-introspection");
  });

  test.each([
    ["direct fetch", 'void Bun.fetch("https://example.invalid");'],
    ["literal bracket fetch", 'void Bun["fetch"]("https://example.invalid");'],
    ["computed member", "void Bun[capability];"],
    ["namespace escape", "const escaped = Bun; void escaped;"],
  ])("rejects Bun capability escape: %s", (_name, source) => {
    expect(acquisitionErrorCode(source)).toBe("forbidden-runtime-introspection");
  });

  test("rejects missing and ambiguous captured resolutions", () => {
    expect(acquisitionErrorCode('import "./missing";')).toBe("missing-input");
    expect(acquisitionErrorCode('import "./ambiguous";', {
      "worker/ambiguous.ts": "export {};",
      "worker/ambiguous/index.ts": "export {};",
    })).toBe("ambiguous-resolution");
  });

  test("does not mistake domain eval properties or bare _cache bindings for denied surfaces", () => {
    expect(acquisitionErrorCode([
      "const methods = { eval: 'domain-method' };",
      "void methods.eval;",
      "const _cache = new Map();",
      "void _cache;",
    ].join("\n"))).toBeUndefined();
  });

  test("reserves lowercase module as a Bun loader capability while preserving domain property names", () => {
    expect(acquisitionErrorCode([
      "const record = { module: { value: 1 } };",
      "void record.module;",
      "void WebAssembly.Module;",
    ].join("\n"))).toBeUndefined();
    for (const source of [
      "const module = { value: 1 }; void module.value;",
      "function inspect(module: { value: number }): number { return module.value; }",
      "const { module } = { module: { value: 1 } }; void module.value;",
      "type module = { value: number };",
      "interface module { value: number }",
      "declare const module: { value: number };",
      'import type module from "./types";',
    ]) {
      expect(lexicalCensusErrorCode(source)).toBe("forbidden-runtime-introspection");
      expect(acquisitionErrorCode(source, {
        "worker/types.ts": "export default interface Binding {};\n",
      })).toBe("forbidden-runtime-introspection");
    }
    for (const source of [
      "const Module = { value: 1 }; void Module.value;",
      "function inspect(Module: { value: number }): number { return Module.value; } void inspect;",
      "type Module = { value: number };",
      "interface Module { value: number }",
      "void WebAssembly.Module;",
    ]) {
      expect(lexicalCensusErrorCode(source)).toBeUndefined();
      expect(acquisitionErrorCode(source)).toBeUndefined();
    }
  });

  test("accepts only the exact path-bound production dynamic-code shapes and counts", () => {
    expect(acquisitionErrorCodeAtPath(
      ENGINE_DISPATCH_PATH,
      [
        ...Array.from({ length: 6 }, () => `{ ${ENGINE_DISPATCH_CRYPTO_GRANT} }`),
        ENGINE_DISPATCH_PROXY_GRANT,
        ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
        ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
        "void Date.now();",
        "void Date.now();",
      ].join("\n"),
    )).toBeUndefined();
    expect(acquisitionErrorCodeAtPath(
      EVALUATOR_FFI_PATH,
      EVALUATOR_DYNAMIC_CODE_PIN,
    )).toBeUndefined();
    expect(acquisitionErrorCodeAtPath(
      PROVER_FFI_PATH,
      PROVER_DYNAMIC_CODE_PIN,
    )).toBeUndefined();
  });

  test.each([
    [
      "missing pinned occurrence",
      ENGINE_DISPATCH_PATH,
      ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
    ],
    [
      "extra pinned occurrence",
      ENGINE_DISPATCH_PATH,
      [
        ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
        ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
        ENGINE_DISPATCH_DYNAMIC_CODE_PIN,
      ].join("\n"),
    ],
    [
      "right shape at wrong path",
      "worker/entry.ts",
      EVALUATOR_DYNAMIC_CODE_PIN,
    ],
    [
      "wrong template expression",
      EVALUATOR_FFI_PATH,
      'const fn = new Function("$fenel", `return ${serialized.value};`,)(JIT_FENEL_RUNTIME) as (...args: unknown[]) => unknown;',
    ],
    [
      "moved namespace-template interpolation",
      ENGINE_DISPATCH_PATH,
      '$ns[code] = new Function("$ns", `${body}with($ns){ return (); }`)($ns);',
    ],
    [
      "moved serialized-template interpolation before literal",
      EVALUATOR_FFI_PATH,
      'const fn = new Function("$fenel", `${serialized._0}return ;`,)(JIT_FENEL_RUNTIME) as (...args: unknown[]) => unknown;',
    ],
    [
      "moved serialized-template interpolation after literal",
      PROVER_FFI_PATH,
      'const fn = new Function("$fenel", `return ;${serialized._0}`,)(COMPILABLE_PROVER_FENEL) as (...callArgs: unknown[]) => unknown;',
    ],
    [
      "wrong fixed runtime",
      PROVER_FFI_PATH,
      'const fn = new Function("$fenel", `return ${serialized._0};`,)(OTHER_RUNTIME) as (...callArgs: unknown[]) => unknown;',
    ],
  ])("rejects %s for a dynamic-code pin", (_name, path, source) => {
    expect(acquisitionErrorCodeAtPath(path, source)).toBe("dynamic-code-evaluation");
  });

  test.each([
    ["Function call", 'Function("return 1");'],
    ["new Function", 'new Function("return 1");'],
    ["parenthesized Function", 'new (Function)("return 1");'],
    ["indirect Function", '(0, Function)("return 1");'],
    ["global Function", 'globalThis.Function("return 1");'],
    ["bracket global Function", 'globalThis["Function"]("return 1");'],
    ["Reflect constructor", 'Reflect.construct(Function, ["return 1"]);'],
    ["async constructor family", '(async () => {}).constructor("return 1");'],
    ["generator constructor family", '(function* () {}).constructor("return 1");'],
    ["bracket constructor family", '(() => {})["constructor"]("return 1");'],
    ["wrapped constructor family", 'new ((() => {}).constructor)("return 1");'],
    ["AsyncFunction identifier", 'AsyncFunction("return 1");'],
    ["GeneratorFunction identifier", 'GeneratorFunction("return 1");'],
    ["AsyncGeneratorFunction identifier", 'AsyncGeneratorFunction("return 1");'],
  ])("rejects alternate dynamic-code form: %s", (_name, source) => {
    expect(acquisitionErrorCode(source)).toBe("dynamic-code-evaluation");
  });

  test("accepts fixed recovery-stub bytes without reading excluded live outputs", () => {
    const captured = store({
      "worker/entry.ts": [
        'import "../implementations/typescript/engine/src/generated/compiled-parser.build-certificate.json";',
        'import "../implementations/typescript/engine/src/generated/compiled-parser.generated";',
        'import "../implementations/typescript/engine/src/generated/compiled-resolver.build-certificate.json";',
        'import "../implementations/typescript/engine/src/generated/compiled-resolver.generated";',
        'import "../implementations/typescript/engine/src/generated/parse-cache.generated";',
        'import "../implementations/typescript/engine/src/generated/signature-honesty-claims.json";',
      ].join("\n"),
      "implementations/typescript/engine/src/parse-cache-abi.ts":
        "export const PARSE_CACHE_AST_ABI_VERSION = 4;\n",
    });
    const materializedFiles: readonly MaterializedAcquisitionFile[] = compiledArtifactRecoveryStubs()
      .map((stub) => ({ path: repositoryRelativePath(stub.path), bytes: stub.bytes }));
    const excluded = new Set<string>(RECOVERABLE_OUTPUT_EXCLUSIONS);
    const payloads: readonly (readonly [string, Uint8Array])[] = [
      ["invalid syntax", Uint8Array.from([0xff, 0xfe, 0x0a])],
      ["top-level throw", UTF8.encode('throw new Error("live output executed");\n')],
      ["hostile valid source", UTF8.encode("process.exit(97);\n")],
      ["ordinary stale data", UTF8.encode('{"stale":true}\n')],
    ];
    const digests: string[] = [];
    for (const [name, livePayload] of payloads) {
      const capturedReads: string[] = [];
      const bytes: CapturedByteStore = Object.freeze({
        paths: captured.paths,
        has: (path: RepositoryRelativePath) => captured.has(path),
        read: (path: RepositoryRelativePath) => {
          if (excluded.has(path)) {
            throw new Error(`${name} excluded live payload was read (${livePayload.byteLength} bytes): ${path}`);
          }
          capturedReads.push(path);
          return captured.read(path);
        },
      });
      const result = closeCompiledArtifactAcquisition({
        entrypoints: [repositoryRelativePath("worker/entry.ts")],
        bytes,
        materializedFiles,
        declaredEnvironmentKeys: [],
      });
      digests.push(result.digest);
      expect(capturedReads, name).toEqual([
        "worker/entry.ts",
        "implementations/typescript/engine/src/parse-cache-abi.ts",
      ]);
      expect(result.sourceRows.map((row) => String(row.path)), name).toEqual(expect.arrayContaining([
        ...RECOVERABLE_OUTPUT_EXCLUSIONS,
        repositoryRelativePath("implementations/typescript/engine/src/parse-cache-abi.ts"),
      ]));
    }
    expect(new Set(digests).size).toBe(1);
  });

  test("the committed parser and resolver worker closures satisfy the closed policy", () => {
    const bytes = collectRepositoryBytes();
    const materializedFiles = compiledArtifactRecoveryStubs().map((stub) => ({
      path: repositoryRelativePath(stub.path),
      bytes: stub.bytes,
    }));
    const results = ["compiled-parser", "compiled-resolver"].map((owner) =>
      closeCompiledArtifactAcquisition({
        entrypoints: [repositoryRelativePath(
          `implementations/typescript/engine/scripts/generate-${owner}-worker.ts`,
        )],
        bytes,
        materializedFiles,
        declaredEnvironmentKeys: DECLARED_ENVIRONMENT,
      })
    );

    expect(results.map((result) => ({
      digest: String(result.digest),
      sourceRows: result.sourceRows.length,
      runtimeEdges: result.runtimeEdges.length,
      typeOnlyEdges: result.typeOnlyEdges.length,
      hostSensitiveOperations: result.hostSensitiveOperations.length,
    }))).toEqual([
      {
        digest: "d00b46e68239fd1419f9cc4559442520aa39d474ccc298c81856b4051829af91",
        sourceRows: 626,
        runtimeEdges: 1419,
        typeOnlyEdges: 518,
        hostSensitiveOperations: 15,
      },
      {
        digest: "455d0b23975be38e8edb541936eec5ded6c46dd7219800ff562d84b7973c570a",
        sourceRows: 626,
        runtimeEdges: 1420,
        typeOnlyEdges: 519,
        hostSensitiveOperations: 15,
      },
    ]);

    for (const result of results) {
      expect(result.builtins).toEqual(["node:crypto", "node:util"]);
      expect(result.allowedBuiltins).toEqual(["node:crypto", "node:util"]);
      expect(result.observedEnvironmentKeys).toEqual(OBSERVED_ENVIRONMENT);
      expect(result.hostSensitiveOperations).toHaveLength(15);
      expect(result.hostSensitiveOperations.map(({ path, kind }) => `${path}\0${kind}`)).toEqual([
        ...result.hostSensitiveOperations.map(({ path, kind }) => `${path}\0${kind}`),
      ].sort());
      expect(new Map(result.hostSensitiveOperations.map(({ kind }) => [
        kind,
        result.hostSensitiveOperations.filter((row) => row.kind === kind).length,
      ]))).toEqual(new Map([
        ["current-time", 6],
        ["locale-format", 2],
        ["randomness", 6],
        ["absolute-path", 1],
      ]));
      expect(result.sourceRows.filter((row) => row.role === "code")).toHaveLength(185);
      expect(result.sourceRows.filter((row) => row.role === "raw")).toHaveLength(439);
      expect(result.sourceRows.filter((row) => row.role === "data")).toHaveLength(2);
      expect(result.sourceRows).toHaveLength(626);
      expect(result.typeOnlyEdges.length).toBeGreaterThanOrEqual(390);
      expect(result.runtimeEdges.some((edge) =>
        edge.kind === "literal-read"
        || edge.kind === "literal-directory"
        || edge.kind === "literal-glob"
      )).toBe(false);
      expect(result.sourceRows.map((row) => String(row.path))).toEqual(expect.arrayContaining([
        ENGINE_DISPATCH_PATH,
        EVALUATOR_FFI_PATH,
        PARSER_FIXITIES_PATH,
        PROVER_FFI_PATH,
        FIELD_WORKER_CLIENT_PATH,
        FIELD_WORKER_ASSET_PATH,
        "implementations/typescript/engine/src/engine-modules.ts",
        "implementations/typescript/engine/src/types.ts",
      ]));
      expect(result.runtimeEdges.filter((edge) => edge.kind === "runtime-worker-asset")).toEqual([{
        from: repositoryRelativePath(FIELD_WORKER_CLIENT_PATH), kind: "runtime-worker-asset",
        specifier: "./field-identity-worker.ts", raw: false, builtin: null,
        targets: [repositoryRelativePath(FIELD_WORKER_ASSET_PATH)],
      }]);
    }
    const withoutWorker = (result: (typeof results)[number]): readonly string[] => result.sourceRows
      .map((row) => row.path)
      .filter((path) => !path.includes("generate-compiled-") || !path.endsWith("-worker.ts"));
    expect(withoutWorker(results[0]!)).toEqual(withoutWorker(results[1]!));
  }, 30_000);
});
