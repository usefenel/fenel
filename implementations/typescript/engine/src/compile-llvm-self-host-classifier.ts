// SUBSTRATE
// ---------------------------------------------------------------------------
// Phase 5b30 — LLVM self-host classifier
//
// Extracted from `compile-llvm-self-host.test.ts` in Phase 5b30 (matrix
// generator hardening — tier-(12-tooling) substrate sub-phase). Owns the
// LLVM-target self-host harness's module-init, CLOSURE_RUNTIME_C inline
// runtime, dependency-driven shared-helper compilation, `runOne` classification,
// `compileSharedObject` helper, clang detection, and
// `classifyFnId(fnId) → Promise<ClassifierResult>` API consumed by both
// `compile-llvm-self-host.test.ts` (bun:test integration) AND
// `scripts/generate-self-host-matrix.ts` (observation-truthful matrix
// cell rendering).
//
// **NO bun:test imports** — pure classification logic + setup.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileFenelToLlvmNative,
  serializeLlvmModuleNative,
} from "./modules/compile-llvm";
import type { CompileSource } from "./compilable";
import {
  compileCallBindingsByFnId,
  type CompileCallBindings,
} from "./compile-call-bindings";
import {
  compileConstructorSlotTable,
  compileConstructorWireNames,
  compileFunctionParamSlots,
  compileFunctionTypeOwnerIds,
} from "./compile-field-slots";
import type { FenelFunction, FenelType } from "./types";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { withEngineDispatchEvaluationSnapshot } from "./engine-bodies-dispatch";
import type { LlvmModule } from "./ir/llvm-ast";
import {
  getRepositoryCompilerConstructorMetadataView,
  getRepositoryCompilerMetadataView,
  type RepositoryCompilerMetadataView,
} from "./compiler-metadata-view";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  buildEffectStubsForFn,
  constraintsToRequiresStrings,
  generateEffectShimC,
} from "./effect-bootstrap-helpers";
import { peelMaybe, peelToVariant, peelList } from "./set-algebra";
import {
  buildSamples,
  effectfulCanary,
  LLVM_EXPECTED_GAPS,
  PROBE_ARGS,
  SCRATCH_SCOPE,
  scopeForConstraint,
  type Sample,
} from "./self-host-samples";
import { refHandle } from "./type-foundation";
import {
  buildSelfHostCandidateIndex,
  memoizeAsyncFnIdClassification,
  projectSelfHostCandidateModule,
} from "./self-host-classification-cache";
import {
  exactImmutableDataEqual,
  exactImmutableDataSnapshot,
  immutableCandidateRoster,
} from "./self-host-immutable-data";
import {
  getWasmLlvmSelfHostEntity,
  wasmLlvmBaseEngineContext as baseEngineCtx,
  wasmLlvmSelfHostModules as harnessModules,
} from "./self-host-wasm-llvm-bootstrap";

export type ClassifierResult =
  | { status: "OK"; samplesCompared: number }
  | { status: "SKIP"; reason: string }
  | { status: "FAIL"; reason: string }
  | { status: "NO_SAMPLES" };

let compilerMetadataRegistry: RepositoryCompilerMetadataView | undefined;
const compilerCtorDefsByOwnerKey = new Map<string, ReturnType<typeof compileConstructorSlotTable>>();
function getCompilerMetadataRegistry(): RepositoryCompilerMetadataView {
  compilerMetadataRegistry ??= getRepositoryCompilerMetadataView();
  return compilerMetadataRegistry;
}
function getHarnessCtorDefs(fn?: FenelFunction): ReturnType<typeof compileConstructorSlotTable> {
  const preferredOwnerIds = fn === undefined ? [] : compileFunctionTypeOwnerIds(fn);
  const key = preferredOwnerIds.join("\0");
  const cached = compilerCtorDefsByOwnerKey.get(key);
  if (cached !== undefined) return cached;
  const table = compileConstructorSlotTable(
    getRepositoryCompilerConstructorMetadataView(),
    { preferredOwnerIds },
  );
  compilerCtorDefsByOwnerKey.set(key, table);
  return table;
}
function getCompilerFunction(fn: FenelFunction): FenelFunction {
  if (fn.id === effectfulCanary.id) return fn;
  const identified = getCompilerMetadataRegistry().getIdentifiedFunction(fn.id);
  if (identified === undefined) {
    throw new Error(`LLVM self-host compiler metadata: unresolved function owner ${fn.id}`);
  }
  return identified;
}

// ---------------------------------------------------------------------------
// Toolchain detection
// ---------------------------------------------------------------------------

function whichSafe(name: string): string | null {
  try {
    const bun = (globalThis as { Bun?: { which: (n: string) => string | null } }).Bun;
    return bun?.which(name) ?? null;
  } catch {
    return null;
  }
}

export const CLANG_PATH = whichSafe("clang");
export const HAS_CLANG = CLANG_PATH !== null;

// ---------------------------------------------------------------------------
// Effect-handler stubs.
// ---------------------------------------------------------------------------

const scratchStateStorage = new Map<string, unknown>();
const stubRegistry = createDispatchRegistry({ methodValues: "compiler-host-stubs" });
stubRegistry.defineClass({
  name: "HasStateIO",
  params: [{ name: "scope" }],
  methods: [
    { name: "set", params: [], returns: { $ref: "Unit" } },
    { name: "get", params: [], returns: { $ref: "String" } },
  ],
});
stubRegistry.addInstance({
  typeName: "HasStateIO",
  args: [SCRATCH_SCOPE],
  methods: {
    set: (key: unknown, value: unknown): unknown => {
      scratchStateStorage.set(String(key), value);
      return null;
    },
    get: (key: unknown): unknown => {
      const v = scratchStateStorage.get(String(key));
      return v === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: v };
    },
  },
});
stubRegistry.defineClass({
  name: "HasTelegramBot",
  params: [{ name: "scope" }],
  methods: [
    { name: "runCollector", params: [], returns: { $ref: "Id" } },
    { name: "stopCollector", params: [], returns: { $ref: "Unit" } },
    { name: "handleUpdate", params: [], returns: { $ref: "Unit" } },
    { name: "findBotById", params: [], returns: { $ref: "Maybe" } },
    { name: "sendMessageText", params: [], returns: { $ref: "Unit" } },
    { name: "sendFieldPrompt", params: [], returns: { $ref: "Unit" } },
  ],
});
stubRegistry.addInstance({
  typeName: "HasTelegramBot",
  args: [SCRATCH_SCOPE],
  methods: {
    runCollector: (): unknown => ({ $tag: "Ok", _0: "stub-bot-id" }),
    stopCollector: (): unknown => ({ $tag: "Nothing" }),
    handleUpdate: (): unknown => null,
    findBotById: (): unknown => ({ $tag: "Nothing" }),
    sendMessageText: (): unknown => null,
    sendFieldPrompt: (): unknown => null,
  },
});

let fnSamples: ReturnType<typeof buildSamples> | undefined;
function getFnSamples(): ReturnType<typeof buildSamples> {
  fnSamples ??= buildSamples("llvm", getHarnessCtorDefs());
  return fnSamples;
}
export const FN_SAMPLES = new Proxy({} as ReturnType<typeof buildSamples>, {
  get: (_target, key) => getFnSamples()[key as string],
  ownKeys: () => Reflect.ownKeys(getFnSamples()),
  getOwnPropertyDescriptor: (_target, key) =>
    Object.getOwnPropertyDescriptor(getFnSamples(), key),
});
export const EXPECTED_GAPS = LLVM_EXPECTED_GAPS;

export type Row =
  | { status: "ok"; fnId: string; samples: number }
  | { status: "skip"; fnId: string; reason: string }
  | { status: "fail"; fnId: string; reason: string };

type LlvmCompileArtifact =
  | {
      readonly status: "ok";
      readonly mod: LlvmModule;
      readonly ir: string;
      readonly entrySymbol: string;
    }
  | { readonly status: "skip"; readonly reason: string };

type LlvmCompileCacheEntry = {
  /** Deeply isolated complete compiler input that produced `artifact`. */
  readonly inputFingerprint: CompileSource;
  readonly artifact: LlvmCompileArtifact;
};

const sharedLlvmCompileArtifacts = new Map<string, LlvmCompileCacheEntry>();
let llvmArtifactCompileAttempts = 0;

export type LlvmClassifierStats = {
  readonly artifactCompileAttempts: number;
};

export function getClassifierStats(): LlvmClassifierStats {
  return Object.freeze({ artifactCompileAttempts: llvmArtifactCompileAttempts });
}

function sourceForFunction(fn: FenelFunction, identifiedFn: FenelFunction): CompileSource {
  const requires = fn.requires ?? [];
  const callBindings = moduleCallBindingsFor(fn);
  const ctorDefs = getHarnessCtorDefs(identifiedFn);
  return {
    name: fn.id,
    params: compileFunctionParamSlots(identifiedFn),
    body: fn.body,
    ...(callBindings === undefined ? {} : { callBindings }),
    ...(requires.length > 0
      ? { requires: constraintsToRequiresStrings(requires) }
      : {}),
    ctorDefs,
    ctorWireNames: compileConstructorWireNames(ctorDefs),
  };
}

function compileLlvmArtifact(source: CompileSource): LlvmCompileArtifact {
  llvmArtifactCompileAttempts += 1;
  const compiled = compileFenelToLlvmNative(source);
  if (compiled.$tag === "Err") {
    return { status: "skip", reason: `compile failed: ${JSON.stringify(compiled._0)}` };
  }
  const mod = compiled._0 as LlvmModule;
  const entry = mod.definitions.at(-1);
  if (entry === undefined) {
    return { status: "skip", reason: "LLVM module has no entry definition" };
  }
  const ir = serializeLlvmModuleNative(mod);
  if (ir.$tag === "Err") {
    return { status: "skip", reason: `serialise failed: ${ir._0}` };
  }
  return { status: "ok", mod, ir: ir._0, entrySymbol: entry.name };
}

function compileSharedLlvmFunction(
  fnId: string,
  source: CompileSource,
): LlvmCompileArtifact {
  // As in the Wasm harness, the string id merely locates a possible entry.
  // Only equality with the complete isolated compiler input authorizes reuse.
  const inputSnapshot = exactImmutableDataSnapshot(source);
  const cached = sharedLlvmCompileArtifacts.get(fnId);
  if (
    inputSnapshot.status === "ok"
    && cached !== undefined
    && exactImmutableDataEqual(cached.inputFingerprint, inputSnapshot.value)
  ) {
    return cached.artifact;
  }
  if (inputSnapshot.status === "uncacheable") {
    sharedLlvmCompileArtifacts.delete(fnId);
  }
  const compilerInput = inputSnapshot.status === "ok"
    ? inputSnapshot.value
    : source;
  const artifact = compileLlvmArtifact(compilerInput);
  if (inputSnapshot.status === "ok") {
    sharedLlvmCompileArtifacts.set(fnId, {
      inputFingerprint: inputSnapshot.value,
      artifact,
    });
  }
  return artifact;
}

// ---------------------------------------------------------------------------
// `runtime/llvm-rt-closure.c` — minimal C runtime providing closure ABI +
// ADT ABI + effect-handler registry + string primitives. Bundled inline
// so the harness is self-contained.
// ---------------------------------------------------------------------------

export const CLOSURE_RUNTIME_C = `
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void *fenel_env_alloc(int64_t n) {
  return calloc((size_t)n, sizeof(void *));
}
void fenel_env_set(void *env, int64_t i, void *v) {
  ((void **)env)[i] = v;
}
void *fenel_env_get(void *env, int64_t i) {
  return ((void **)env)[i];
}
typedef struct { void *fn; void *env; } FenelClosure;
void *fenel_make_closure(void *fn, void *env) {
  FenelClosure *c = (FenelClosure *)malloc(sizeof(FenelClosure));
  c->fn = fn;
  c->env = env;
  return c;
}
void *fenel_closure_fn(void *closure) {
  return ((FenelClosure *)closure)->fn;
}
void *fenel_closure_env(void *closure) {
  return ((FenelClosure *)closure)->env;
}
// Phase 5b36 — magic-prefixed boxed Number so the FFI return-marshal
// layer's structural-read can safely distinguish boxed doubles from
// FenelList / FenelAdt / raw NUL-term char* without dereferencing garbage.
// Layout: bytes [0..7] = magic sentinel, bytes [8..15] = double. Bool stays
// on the legacy 4-byte malloc path — boxed booleans are rarer in sample
// returns and the existing ABI (matching the runtime/llvm-rt.c integer
// reinterpret pattern) downstream is load-bearing for some effect-shim
// integrations; magic-on-bool is left to (c-7) follow-up.
#define FENEL_BOX_NUM_MAGIC ((int64_t)0xBABABABABABABABALL)

typedef struct {
  int64_t magic;
  double value;
} FenelBoxNum;

int fenel_is_box_num(void *v) {
  if (v == NULL) return 0;
  return ((int64_t *)v)[0] == FENEL_BOX_NUM_MAGIC ? 1 : 0;
}

void *fenel_box_num(double v) {
  FenelBoxNum *p = (FenelBoxNum *)malloc(sizeof(FenelBoxNum));
  p->magic = FENEL_BOX_NUM_MAGIC;
  p->value = v;
  return p;
}
double fenel_unbox_num(void *v) {
  return ((FenelBoxNum *)v)->value;
}
// Phase 5b37 — magic-prefixed boxed Bool, mirror of FenelBoxNum. The
// structural-read return-marshal layer needs to distinguish boxed booleans
// from raw NUL-term char* (otherwise a 1-byte value reads as "\\u0001"
// string). Layout: bytes [0..7] = magic sentinel, bytes [8..11] = int.
// Sentinel distinct from FENEL_LIST_MAGIC / FENEL_BOX_NUM_MAGIC / FENEL_ADT_MAGIC.
#define FENEL_BOX_BOOL_MAGIC ((int64_t)0xCBCBCBCBCBCBCBCBLL)

typedef struct {
  int64_t magic;
  int value;
} FenelBoxBool;

int fenel_is_box_bool(void *v) {
  if (v == NULL) return 0;
  return ((int64_t *)v)[0] == FENEL_BOX_BOOL_MAGIC ? 1 : 0;
}

void *fenel_box_bool(int v) {
  FenelBoxBool *p = (FenelBoxBool *)malloc(sizeof(FenelBoxBool));
  p->magic = FENEL_BOX_BOOL_MAGIC;
  p->value = v;
  return p;
}
int fenel_unbox_bool(void *v) {
  if (v == NULL) return 0;
  return ((FenelBoxBool *)v)->value;
}
void *fenel_lit_string(void *ptr, int64_t len) {
  (void)len;
  return ptr;
}
double fenel_mod(void *a, void *b) {
  double av = ((FenelBoxNum *)a)->value;
  double bv = ((FenelBoxNum *)b)->value;
  long long ai = (long long)av;
  long long bi = (long long)bv;
  return (double)(ai % bi);
}

// Phase 5b36 — FenelAdt magic marker at offset 0 lets the FFI return-marshal
// layer's structural-read fallback safely distinguish FenelAdt from primitive
// boxed values (boxed double / boxed int) without dereferencing garbage. Same
// recipe as FenelList's magic — invalid UTF-8 byte pattern, well outside any
// real char* / string / IEEE 754 double bit pattern. Distinct from
// FENEL_LIST_MAGIC so the two sentinels never collide.
#define FENEL_ADT_MAGIC ((int64_t)0xADADADADADADADADLL)

typedef struct {
  int64_t magic;
  const char *tag;
  int64_t n_fields;
  void **fields;
  const char **field_names;
} FenelAdt;

int fenel_is_adt(void *v) {
  if (v == NULL) return 0;
  return ((int64_t *)v)[0] == FENEL_ADT_MAGIC ? 1 : 0;
}

void *fenel_construct(const char *tag, int64_t tag_len, int64_t n_fields) {
  (void)tag_len;
  FenelAdt *v = (FenelAdt *)malloc(sizeof(FenelAdt));
  v->magic = FENEL_ADT_MAGIC;
  v->tag = tag;
  v->n_fields = n_fields;
  v->fields = n_fields > 0 ? (void **)calloc((size_t)n_fields, sizeof(void *)) : NULL;
  v->field_names =
      n_fields > 0 ? (const char **)calloc((size_t)n_fields, sizeof(const char *)) : NULL;
  return v;
}
void fenel_set_field(void *v, int64_t i, void *value) {
  ((FenelAdt *)v)->fields[i] = value;
}
void fenel_set_field_named(void *v, int64_t i, const char *name, int64_t name_len,
                           void *value) {
  (void)name_len;
  FenelAdt *adt = (FenelAdt *)v;
  adt->fields[i] = value;
  adt->field_names[i] = name;
}
void *fenel_get_field(void *v, int64_t i) {
  return ((FenelAdt *)v)->fields[i];
}
void *fenel_get_field_named(void *v, const char *name, int64_t name_len) {
  (void)name_len;
  if (v == NULL) return NULL;
  FenelAdt *adt = (FenelAdt *)v;
  for (int64_t i = 0; i < adt->n_fields; i++) {
    const char *fn = adt->field_names[i];
    if (fn == NULL) continue;
    if (fn == name || strcmp(fn, name) == 0) return adt->fields[i];
  }
  return NULL;
}

int fenel_has_field(void *v, int64_t i) {
  if (v == NULL) return 0;
  FenelAdt *adt = (FenelAdt *)v;
  return (i >= 0 && i < adt->n_fields) ? 1 : 0;
}
int fenel_has_field_named(void *v, const char *name, int64_t name_len) {
  (void)name_len;
  if (v == NULL) return 0;
  FenelAdt *adt = (FenelAdt *)v;
  for (int64_t i = 0; i < adt->n_fields; i++) {
    const char *fn = adt->field_names[i];
    if (fn == NULL) continue;
    if (fn == name || strcmp(fn, name) == 0) return 1;
  }
  return 0;
}

const char *fenel_get_tag(void *v) {
  if (v == NULL) return NULL;
  // Phase 5b36 — magic-check so structural-read fallback can probe ptrs of
  // unknown shape (boxed primitives, raw const char* strings, FenelList) and
  // get NULL back rather than dereferencing garbage as a tag pointer.
  if (((int64_t *)v)[0] != FENEL_ADT_MAGIC) return NULL;
  return ((FenelAdt *)v)->tag;
}
int64_t fenel_get_field_count(void *v) {
  if (v == NULL) return 0;
  return ((FenelAdt *)v)->n_fields;
}
const char *fenel_get_field_name_at(void *v, int64_t i) {
  if (v == NULL) return NULL;
  FenelAdt *adt = (FenelAdt *)v;
  if (i < 0 || i >= adt->n_fields) return NULL;
  return adt->field_names[i];
}
int fenel_tag_eq(void *v, const char *expected_tag) {
  if (v == NULL) return 0;
  const char *t = ((FenelAdt *)v)->tag;
  if (t == expected_tag) return 1;
  return strcmp(t, expected_tag) == 0 ? 1 : 0;
}
int fenel_lit_eq(void *a, void *b) {
  if (a == b) return 1;
  if (a == NULL || b == NULL) return 0;
  double av = ((FenelBoxNum *)a)->value;
  double bv = ((FenelBoxNum *)b)->value;
  return av == bv ? 1 : 0;
}

int fenel_str_eq(void *a, void *b) {
  if (a == b) return 1;
  if (a == NULL || b == NULL) return 0;
  return strcmp((const char *)a, (const char *)b) == 0 ? 1 : 0;
}
void *fenel_match_fail(void *v) {
  (void)v;
  return NULL;
}

void *fenel_slice(void *s, double start_d, double end_d) {
  if (s == NULL) return NULL;
  size_t len = strlen((const char *)s);
  size_t start = (size_t)((start_d < 0.0) ? 0.0 : start_d);
  size_t end = (size_t)((end_d < 0.0) ? 0.0 : end_d);
  if (start > len) start = len;
  if (end > len) end = len;
  if (end < start) end = start;
  size_t n = end - start;
  char *out = (char *)malloc(n + 1);
  memcpy(out, (const char *)s + start, n);
  out[n] = '\\0';
  return out;
}
int fenel_starts_with(void *s, void *pre) {
  if (s == NULL || pre == NULL) return 0;
  const char *cs = (const char *)s;
  const char *cp = (const char *)pre;
  size_t pl = strlen(cp);
  if (strlen(cs) < pl) return 0;
  return strncmp(cs, cp, pl) == 0 ? 1 : 0;
}

// Phase 5b33 — FenelList magic marker at offset 0 distinguishes lists from
// raw \`const char *\` strings at runtime in the polymorphic \`fenel_concat\` /
// \`fenel_elem\` natives. The value 0xFE...0xFE has every byte 0xFE — an
// invalid UTF-8 start byte (>= 0xF8 is malformed) and well outside printable
// ASCII, so no real string literal can collide.
#define FENEL_LIST_MAGIC ((int64_t)0xFEFEFEFEFEFEFEFELL)

typedef struct {
  int64_t magic;
  int64_t length;
  void *items[];
} FenelList;

int fenel_is_list(void *v) {
  if (v == NULL) return 0;
  return ((int64_t *)v)[0] == FENEL_LIST_MAGIC ? 1 : 0;
}

// Phase 5b37 — polymorphic dispatch via FenelList magic-marker check. The
// engine evaluator length op handles both strings (char-count) and lists
// (element-count); aligning the C-runtime closes the body-semantic
// divergence in lowerObjectExpr / lowerJlArrayItems / etc. where the
// strlen-only path read FENEL_LIST_MAGIC bytes as ASCII garbage and
// mis-routed eq-n-1 / eq-n-0 branches. Mirror of fenel_concat 5b33
// polymorphic recipe.
double fenel_length(void *s) {
  if (s == NULL) return 0.0;
  if (fenel_is_list(s)) {
    return (double)((FenelList *)s)->length;
  }
  return (double)strlen((const char *)s);
}

int64_t fenel_list_length(void *v) {
  if (v == NULL || !fenel_is_list(v)) return 0;
  return ((FenelList *)v)->length;
}

void *fenel_list_get(void *v, int64_t i) {
  if (v == NULL || !fenel_is_list(v)) return NULL;
  FenelList *list = (FenelList *)v;
  if (i < 0 || i >= list->length) return NULL;
  return list->items[i];
}

// Phase 5b36 — empty FenelList constructor. Arg-lift uses this for the
// empty-array case so the body passes a real length-0 FenelList (with magic)
// downstream rather than null. The return-marshal structural-read path then
// recognises it via fenel_is_list + walks it as a length-0 array, round-
// tripping the engine empty-list correctly when the field type is a type
// variable that does not peel to opaque-List (e.g. params: var-a in
// EffectsExplicitProgram).
void *fenel_empty_list(void) {
  FenelList *out = (FenelList *)malloc(sizeof(FenelList));
  out->magic = FENEL_LIST_MAGIC;
  out->length = 0;
  return out;
}

void *fenel_split(void *s, void *delim) {
  if (s == NULL || delim == NULL) {
    FenelList *empty = (FenelList *)malloc(sizeof(FenelList));
    empty->magic = FENEL_LIST_MAGIC;
    empty->length = 0;
    return empty;
  }
  const char *cs = (const char *)s;
  const char *cd = (const char *)delim;
  size_t dl = strlen(cd);
  int64_t parts = 1;
  if (dl > 0) {
    const char *p = cs;
    while ((p = strstr(p, cd)) != NULL) {
      parts++;
      p += dl;
    }
  }
  FenelList *list = (FenelList *)malloc(sizeof(FenelList) + parts * sizeof(void *));
  list->magic = FENEL_LIST_MAGIC;
  list->length = parts;
  if (dl == 0) {
    size_t sl = strlen(cs);
    list->length = (int64_t)sl;
    for (size_t i = 0; i < sl; i++) {
      char *piece = (char *)malloc(2);
      piece[0] = cs[i];
      piece[1] = '\\0';
      list->items[i] = piece;
    }
    return list;
  }
  const char *segStart = cs;
  int64_t idx = 0;
  while (idx < parts) {
    const char *segEnd = strstr(segStart, cd);
    size_t n = segEnd != NULL ? (size_t)(segEnd - segStart) : strlen(segStart);
    char *piece = (char *)malloc(n + 1);
    memcpy(piece, segStart, n);
    piece[n] = '\\0';
    list->items[idx++] = piece;
    if (segEnd == NULL) break;
    segStart = segEnd + dl;
  }
  return list;
}

void *fenel_join(void *list_v, void *sep) {
  if (list_v == NULL) {
    char *out = (char *)malloc(1);
    out[0] = '\\0';
    return out;
  }
  FenelList *list = (FenelList *)list_v;
  const char *cs = sep != NULL ? (const char *)sep : "";
  size_t sepLen = strlen(cs);
  size_t total = 0;
  for (int64_t i = 0; i < list->length; i++) {
    if (i > 0) total += sepLen;
    if (list->items[i] != NULL) total += strlen((const char *)list->items[i]);
  }
  char *out = (char *)malloc(total + 1);
  size_t off = 0;
  for (int64_t i = 0; i < list->length; i++) {
    if (i > 0) {
      memcpy(out + off, cs, sepLen);
      off += sepLen;
    }
    if (list->items[i] != NULL) {
      size_t n = strlen((const char *)list->items[i]);
      memcpy(out + off, list->items[i], n);
      off += n;
    }
  }
  out[off] = '\\0';
  return out;
}

void *fenel_head(void *list_v) {
  static const char *justTag = "Just";
  static const char *nothingTag = "Nothing";
  static const char *valueName = "value";
  if (list_v == NULL) {
    return fenel_construct(nothingTag, (int64_t)strlen(nothingTag), 0);
  }
  FenelList *list = (FenelList *)list_v;
  if (list->length <= 0) {
    return fenel_construct(nothingTag, (int64_t)strlen(nothingTag), 0);
  }
  void *just = fenel_construct(justTag, (int64_t)strlen(justTag), 1);
  fenel_set_field_named(just, 0, valueName, (int64_t)strlen(valueName), list->items[0]);
  return just;
}

void *fenel_tail(void *list_v) {
  static const char *justTag = "Just";
  static const char *nothingTag = "Nothing";
  static const char *valueName = "value";
  if (list_v == NULL) {
    return fenel_construct(nothingTag, (int64_t)strlen(nothingTag), 0);
  }
  FenelList *list = (FenelList *)list_v;
  if (list->length <= 0) {
    return fenel_construct(nothingTag, (int64_t)strlen(nothingTag), 0);
  }
  int64_t tailLen = list->length - 1;
  FenelList *tailList = (FenelList *)malloc(sizeof(FenelList) + tailLen * sizeof(void *));
  tailList->magic = FENEL_LIST_MAGIC;
  tailList->length = tailLen;
  for (int64_t i = 0; i < tailLen; i++) tailList->items[i] = list->items[i + 1];
  void *just = fenel_construct(justTag, (int64_t)strlen(justTag), 1);
  fenel_set_field_named(just, 0, valueName, (int64_t)strlen(valueName), tailList);
  return just;
}

// Phase 5b33 — TS-leaf C natives (concat / contains / elem / sortLex /
// toString / appendItem) + camelCase wrapper for fenel_starts_with. These
// resolve the link-cascade left open by 5b32 for the 4 engine:*
// LLVM_EXPECTED_GAPS entries (parseEffectFnId / normaliseToCore /
// makeEffectsExplicit / makeClosuresExplicit), whose bodies reference
// these std TS-leaves that previously had no fenel_<codeName> definition
// in CLOSURE_RUNTIME_C. Semantics mirror the std.ts native impls.
//
// Boolean-returning natives box the result via fenel_box_bool because the
// LLVM emitter's llvmCallDomainOf-unknown-default declares them as
// \`ptr (...) -> ptr\` and the calling Fenel code unboxes via
// fenel_unbox_bool. Returning a raw int would type-mismatch at link.

void *fenel_startsWith(void *s, void *pre) {
  return fenel_box_bool(fenel_starts_with(s, pre));
}

void *fenel_contains(void *s, void *sub) {
  if (s == NULL || sub == NULL) return fenel_box_bool(0);
  return fenel_box_bool(strstr((const char *)s, (const char *)sub) != NULL ? 1 : 0);
}

void *fenel_concat(void *a, void *b) {
  if (a == NULL && b == NULL) return NULL;
  int aIsList = fenel_is_list(a);
  int bIsList = fenel_is_list(b);
  if (aIsList || bIsList || a == NULL || b == NULL) {
    // List concat — either arg may be NULL (treated as empty list) or a
    // FenelList. Returns a fresh FenelList with magic + concatenated items.
    int64_t la = aIsList ? ((FenelList *)a)->length : 0;
    int64_t lb = bIsList ? ((FenelList *)b)->length : 0;
    FenelList *out = (FenelList *)malloc(sizeof(FenelList) + (la + lb) * sizeof(void *));
    out->magic = FENEL_LIST_MAGIC;
    out->length = la + lb;
    if (aIsList) for (int64_t i = 0; i < la; i++) out->items[i] = ((FenelList *)a)->items[i];
    if (bIsList) for (int64_t i = 0; i < lb; i++) out->items[la + i] = ((FenelList *)b)->items[i];
    return out;
  }
  // String concat — both args are raw NUL-terminated char *.
  const char *ca = (const char *)a;
  const char *cb = (const char *)b;
  size_t lla = strlen(ca);
  size_t llb = strlen(cb);
  char *out = (char *)malloc(lla + llb + 1);
  memcpy(out, ca, lla);
  memcpy(out + lla, cb, llb);
  out[lla + llb] = '\\0';
  return out;
}

// Phase 5b33 — fenel_appendItem C native bypasses the std:appendItem Fenel
// body whose LLVM lowering (\`concat arr [item]\` → \`concat(arr, appendItem
// item null)\`) is self-recursive without a base case. The Fenel body works
// in JS via JsonLogic's array-literal evaluation but the LLVM emitter
// transforms \`[item]\` JS-array sugar into a snoc-form CoreCall, which
// recurses infinitely on the LLVM target. The C native here returns a
// fresh FenelList = (arr ++ [item]) — caller-owns semantics — and
// \`appendItem\` is added to C_RUNTIME_NATIVES below so the recursive
// helper IR is never bundled.
void *fenel_appendItem(void *item, void *arr) {
  int64_t arrLen = fenel_is_list(arr) ? ((FenelList *)arr)->length : 0;
  FenelList *out = (FenelList *)malloc(sizeof(FenelList) + (arrLen + 1) * sizeof(void *));
  out->magic = FENEL_LIST_MAGIC;
  out->length = arrLen + 1;
  if (fenel_is_list(arr)) {
    for (int64_t i = 0; i < arrLen; i++) out->items[i] = ((FenelList *)arr)->items[i];
  }
  out->items[arrLen] = item;
  return out;
}

void *fenel_elem(void *needle, void *haystack) {
  if (haystack == NULL) return fenel_box_bool(0);
  if (fenel_is_list(haystack)) {
    FenelList *list = (FenelList *)haystack;
    for (int64_t i = 0; i < list->length; i++) {
      void *item = list->items[i];
      if (needle == item) return fenel_box_bool(1);
      if (needle != NULL && item != NULL &&
          strcmp((const char *)needle, (const char *)item) == 0) {
        return fenel_box_bool(1);
      }
    }
    return fenel_box_bool(0);
  }
  // String haystack — substring-of-string semantics, matching std:elem.
  if (needle == NULL) return fenel_box_bool(0);
  return fenel_box_bool(strstr((const char *)haystack, (const char *)needle) != NULL ? 1 : 0);
}

static int fenel_sortLex_cmp(const void *a, const void *b) {
  const char *sa = *(const char **)a;
  const char *sb = *(const char **)b;
  if (sa == NULL && sb == NULL) return 0;
  if (sa == NULL) return -1;
  if (sb == NULL) return 1;
  return strcmp(sa, sb);
}

void *fenel_sortLex(void *list_v) {
  if (list_v == NULL || !fenel_is_list(list_v)) return list_v;
  FenelList *list = (FenelList *)list_v;
  int64_t n = list->length;
  FenelList *out = (FenelList *)malloc(sizeof(FenelList) + n * sizeof(void *));
  out->magic = FENEL_LIST_MAGIC;
  out->length = n;
  for (int64_t i = 0; i < n; i++) out->items[i] = list->items[i];
  qsort(out->items, (size_t)n, sizeof(void *), fenel_sortLex_cmp);
  return out;
}

// Phase 5b33 — fenel_toString numeric-only impl. The 4 engine:* call sites
// audited in the brief pass a boxed-double (matchId / armIdx / idx / n as
// per-fnId arg names); String-passthrough or Bool / ADT formatting is OUT
// OF SCOPE for 5b33. Hitting a non-Number caller will produce garbage —
// document as new sub-class if it surfaces.
void *fenel_toString(void *x) {
  if (x == NULL) {
    char *out = (char *)malloc(1);
    out[0] = '\\0';
    return out;
  }
  double v = ((FenelBoxNum *)x)->value;
  char *out = (char *)malloc(32);
  if (v == (double)(int64_t)v && v >= -1e15 && v <= 1e15) {
    snprintf(out, 32, "%lld", (long long)v);
  } else {
    snprintf(out, 32, "%g", v);
  }
  return out;
}

typedef void *(*FenelHandlerFn)(void *env, void **args, int n);
typedef struct {
  char *key;
  FenelHandlerFn invoke;
  void *env;
} FenelHandlerEntry;

#define FENEL_MAX_HANDLERS 128
static FenelHandlerEntry g_handlers[FENEL_MAX_HANDLERS];
static int g_n_handlers = 0;

void fenel_register_handler(const char *key, FenelHandlerFn invoke, void *env) {
  if (key == NULL || invoke == NULL) return;
  for (int i = 0; i < g_n_handlers; i++) {
    if (strcmp(g_handlers[i].key, key) == 0) {
      g_handlers[i].invoke = invoke;
      g_handlers[i].env = env;
      return;
    }
  }
  if (g_n_handlers >= FENEL_MAX_HANDLERS) return;
  size_t klen = strlen(key);
  char *kcopy = (char *)malloc(klen + 1);
  if (kcopy == NULL) return;
  memcpy(kcopy, key, klen + 1);
  g_handlers[g_n_handlers].key = kcopy;
  g_handlers[g_n_handlers].invoke = invoke;
  g_handlers[g_n_handlers].env = env;
  g_n_handlers++;
}

FenelHandlerEntry *fenel_lookup_handler(const char *key) {
  for (int i = 0; i < g_n_handlers; i++) {
    if (strcmp(g_handlers[i].key, key) == 0) return &g_handlers[i];
  }
  return NULL;
}

void fenel_reset_handlers(void) {
  for (int i = 0; i < g_n_handlers; i++) {
    free(g_handlers[i].key);
    g_handlers[i].key = NULL;
    g_handlers[i].invoke = NULL;
    g_handlers[i].env = NULL;
  }
  g_n_handlers = 0;
}
`;

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

interface BunSpawnResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}
type BunNamespace = {
  spawnSync: (
    cmd: string[],
    opts?: {
      stderr?: "pipe" | "inherit" | "ignore";
      stdout?: "pipe" | "inherit" | "ignore";
      env?: Record<string, string>;
    },
  ) => BunSpawnResult;
};

export function compileSharedObject(
  name: string,
  irText: string,
  extraC?: string,
  extraIrTexts?: ReadonlyArray<{ name: string; ir: string }>,
): string {
  if (CLANG_PATH === null) throw new Error("clang not available");
  const bun = (globalThis as { Bun?: BunNamespace }).Bun;
  if (bun === undefined) throw new Error("Bun namespace not available");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `fenel-llvm-self-${name}-`));
  const irPath = path.join(tmpDir, `${name}.ll`);
  const rtPath = path.join(tmpDir, "rt.c");
  const ext = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so";
  const soPath = path.join(tmpDir, `lib${name}.${ext}`);
  fs.writeFileSync(irPath, irText);
  fs.writeFileSync(rtPath, CLOSURE_RUNTIME_C + (extraC ?? ""));
  const extraIrPaths: string[] = [];
  for (const extra of extraIrTexts ?? []) {
    const p = path.join(tmpDir, `${extra.name}.ll`);
    fs.writeFileSync(p, extra.ir);
    extraIrPaths.push(p);
  }
  const cmd = [
    CLANG_PATH,
    "-shared",
    "-fPIC",
    "-O0",
    "-o",
    soPath,
    rtPath,
    irPath,
    ...extraIrPaths,
  ];
  if (process.platform === "win32") cmd.push("-Wl,--export-all-symbols");
  const result = bun.spawnSync(cmd, { stderr: "pipe", stdout: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(
      `clang failed (exit ${result.exitCode}):\n${stderr}\n--- IR ---\n${irText}`,
    );
  }
  return soPath;
}

void REPO_ROOT;

// ---------------------------------------------------------------------------
// runOne
// ---------------------------------------------------------------------------

interface FfiTypes {
  void: "void";
  f64: "f64";
  bool: "bool";
}

// Phase 5b32 — fnIds whose FFI invocation segfaults Bun 1.3.11's FFI layer
// (`panic(main thread): Segmentation fault at address 0x3`) post-link-lazy
// bundling. Listed here to short-circuit `runOne` before `dlopen`, since a
// C-level segfault kills the harness process (no JS-recoverable exception)
// and would crash the matrix generator + bun:test harness mid-run. Each
// entry has a matching LLVM_EXPECTED_GAPS entry documenting its sub-class
// (currently sub-class (c-1) — pure FFI-layer issue, link succeeds).
const FFI_SEGFAULT_FNIDS = new Set<string>([
  "std:mod",
]);

// Phase 5b39 — fnIds whose in-process FFI invocation destabilises Bun
// 1.3.11's parent-process dlopen accumulator and crashes with
// `panic(main thread): Segmentation fault at address 0x0` after enough
// accumulated dlopen calls. The crash reproduces deterministically when
// the same .so is loaded + invoked ~30-40 times within one Bun process
// (e.g. `engine:normaliseToCore`'s 19-sample sequence repeated across a
// few attempts, OR the matrix-gen flow's classifyLlvm pass through ~107
// fnIds-with-samples). Diagnosis: not heap fragmentation, not magic-
// marker collision, not close+reopen — bare `dlopen` accumulation alone
// suffices once each .so carries enough symbol churn (heavy C-runtime
// helpers + many extra IRs). Confirmed via probe (5b39): skipping
// `lib.close()` does not stabilise the crash, so it's dlopen-side
// accumulation in Bun's symbol/mmap table, not close-cycle thrash.
//
// Workaround: dispatch each listed fnId to a fresh child Bun process via
// `scripts/run-llvm-classify-one.ts`. The child loads the .so in a clean
// dlopen table, runs the samples, prints the Row as JSON, exits. The
// parent never accumulates the unstable state. Cost: per-fnId fork +
// re-compile (no .so cache across processes); ~1-2s per dispatched fnId.
// Only entries that exhibit the crash are listed — keep this set as
// small as possible.
//
// Sub-class (c-9) tooling-layer workaround for the unresolved Bun 1.3.x
// FFI runtime stability gap. See workstreams/ts-elimination/briefs/
// phase-5b39-matrix-gen-bun-ffi-heap.md for the full diagnosis.
export const SUBPROCESS_FNIDS = new Set<string>([
  "engine:normaliseToCore",
]);

const IN_SUBPROCESS = process.env.FENEL_LLVM_IN_SUBPROCESS === "1";

async function runOneInSubprocess(fnId: string): Promise<Row> {
  const bun = (globalThis as { Bun?: BunNamespace }).Bun;
  if (bun === undefined) {
    return {
      status: "skip",
      fnId,
      reason: "Bun namespace unavailable; cannot dispatch subprocess",
    };
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.resolve(here, "..", "scripts", "run-llvm-classify-one.ts");
  const result = bun.spawnSync(
    [process.execPath, cliPath, fnId],
    {
      stderr: "pipe",
      stdout: "pipe",
      env: { ...process.env, FENEL_LLVM_IN_SUBPROCESS: "1" },
    },
  );
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    return {
      status: "skip",
      fnId,
      reason: `subprocess crashed (exit ${result.exitCode}): ${stderr.slice(-400).trim()}`,
    };
  }
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const lines = stdout.split("\n");
  const lastJsonLine = lines.reverse().find((l) => l.trim().startsWith("{"));
  if (lastJsonLine === undefined) {
    return {
      status: "skip",
      fnId,
      reason: `subprocess emitted no JSON Row (stdout: ${stdout.slice(-200)})`,
    };
  }
  try {
    return JSON.parse(lastJsonLine) as Row;
  } catch (e) {
    return {
      status: "skip",
      fnId,
      reason: `subprocess JSON parse failed: ${(e as Error).message}`,
    };
  }
}

export async function runOne(
  fn: FenelFunction,
  samples: ReadonlyArray<Sample>,
): Promise<Row> {
  const fnId = fn.id;
  if (samples.length === 0) {
    return { status: "skip", fnId, reason: "no samples declared" };
  }
  if (FFI_SEGFAULT_FNIDS.has(fnId)) {
    return {
      status: "skip",
      fnId,
      reason: "Bun FFI segfault on dlopen+invoke (sub-class c-1 post-5b32; link succeeds, runtime crashes)",
    };
  }
  // A child process exists only to isolate Bun's clang/dlopen/FFI path. With no
  // clang there is no behavioral execution to isolate, so keep the IR-shape
  // observation local and avoid a second engine bootstrap.
  if (HAS_CLANG && !IN_SUBPROCESS && SUBPROCESS_FNIDS.has(fnId)) {
    return runOneInSubprocess(fnId);
  }
  const ffi = HAS_CLANG ? await import("bun:ffi") : undefined;
  return withEngineDispatchEvaluationSnapshot((): Row => {
  const identifiedFn = getCompilerFunction(fn);
  const requires = fn.requires ?? [];
  const source = sourceForFunction(fn, identifiedFn);
  const artifact = requires.length === 0
    ? compileSharedLlvmFunction(fnId, source)
    : compileLlvmArtifact(source);
  if (artifact.status === "skip") {
    return { status: "skip", fnId, reason: artifact.reason };
  }
  const { mod, ir, entrySymbol } = artifact;
  if (!HAS_CLANG) {
    // Compile + serialise above is the whole clang-absent contract. Shared helper
    // compilation, effect stubs, subprocesses, dlopen, and sample comparison are
    // behavioral-path work and must not run or inflate this OK (0) observation.
    return { status: "ok", fnId, samples: 0 };
  }
  const ctx: EvaluateContext = {
    ...baseEngineCtx,
    natives: { ...(baseEngineCtx.natives ?? {}) },
  };
  if (requires.length > 0) {
    let stubs;
    try {
      stubs = buildEffectStubsForFn(fn, ctx, stubRegistry, scopeForConstraint);
    } catch (e) {
      return { status: "skip", fnId, reason: `effect stubs failed: ${(e as Error).message}` };
    }
    ctx.natives = { ...(ctx.natives ?? {}), ...stubs.effectNatives };
  }
  if (ffi === undefined) {
    return { status: "skip", fnId, reason: "clang runtime unavailable" };
  }
  const { dlopen, FFIType, JSCallback, CString } = ffi as unknown as {
    dlopen: (path: string, spec: Record<string, { args: unknown[]; returns: unknown }>) => {
      symbols: Record<string, (...a: unknown[]) => unknown>;
      close: () => void;
    };
    FFIType: Record<string, unknown>;
    JSCallback: new (
      cb: (...args: unknown[]) => unknown,
      spec: { args: unknown[]; returns: unknown },
    ) => { ptr: unknown; close: () => void };
    CString: new (ptr: unknown) => { toString(): string };
  };
  const types = FFIType as unknown as Record<string, unknown> & FfiTypes;
  const def = mod.definitions.at(-1);
  if (def === undefined) {
    return { status: "skip", fnId, reason: "LLVM module has no entry definition" };
  }
  function llvmToFfi(t: { $tag: string }): unknown {
    switch (t.$tag) {
      case "Double":
        return types.f64;
      case "I1":
        return types.bool;
      case "Ptr":
        return types.ptr;
      default:
        return null;
    }
  }
  const argFfi = def.params.map((p) => llvmToFfi(p.paramType));
  const retFfi = llvmToFfi(def.returnType);
  if (argFfi.some((a) => a === null) || retFfi === null) {
    return {
      status: "skip",
      fnId,
      reason: `unsupported ABI types: params=${def.params.map((p) => p.paramType.$tag).join(",")} return=${def.returnType.$tag}`,
    };
  }
  const shimC =
    mod.effectImports !== undefined && mod.effectImports.length > 0
      ? generateEffectShimC(mod.effectImports)
      : "";
  let soPath: string;
  try {
    const extraIrs = computeTransitiveHelperClosure(ir)
      .filter((h) => h.symbol !== entrySymbol)
      .map((h, index) => ({ name: `helper-${index}`, ir: h.ir }));
    soPath = compileSharedObject(codeNameOf(fn), ir, shimC, extraIrs);
  } catch (e) {
    return { status: "skip", fnId, reason: `clang failed: ${(e as Error).message}` };
  }
  const symbolSpec: Record<string, { args: unknown[]; returns: unknown }> = {};
  symbolSpec[entrySymbol] = { args: argFfi, returns: retFfi };
  if (mod.effectImports !== undefined && mod.effectImports.length > 0) {
    symbolSpec.fenel_register_handler = {
      args: [types.cstring, types.ptr, types.ptr],
      returns: types.void,
    };
    symbolSpec.fenel_reset_handlers = { args: [], returns: types.void };
  }
  // Phase 5b35 — arg-lift materialisation symbols. Opened unconditionally so
  // `liftSampleForCompiledLlvm` can construct C-side FenelAdt / FenelList
  // values from JS-object / array sample args. Mirrors the C-runtime natives
  // the LLVM emitter already uses for record / variant construction. Without
  // these, Bun FFI rejects complex object args with `Unable to convert
  // [object Object] to a pointer`. Sub-class (c-5) substrate fix.
  symbolSpec.fenel_construct = {
    args: [types.cstring, types.i64, types.i64],
    returns: types.ptr,
  };
  symbolSpec.fenel_set_field_named = {
    args: [types.ptr, types.i64, types.cstring, types.i64, types.ptr],
    returns: types.void,
  };
  symbolSpec.fenel_box_num = { args: [types.f64], returns: types.ptr };
  symbolSpec.fenel_box_bool = { args: ["i32"], returns: types.ptr };
  symbolSpec.fenel_appendItem = { args: [types.ptr, types.ptr], returns: types.ptr };
  // Phase 5b36 — return-marshal FenelList accessors. Opened unconditionally so
  // `marshalAdtPtr`'s structural-read fallback + `$opaque List` arm can walk
  // C-side FenelList structs back to JS arrays. Sub-class (c-6) substrate fix.
  symbolSpec.fenel_is_list = { args: [types.ptr], returns: "i32" };
  symbolSpec.fenel_list_length = { args: [types.ptr], returns: types.i64 };
  symbolSpec.fenel_list_get = { args: [types.ptr, types.i64], returns: types.ptr };
  symbolSpec.fenel_empty_list = { args: [], returns: types.ptr };
  symbolSpec.fenel_unbox_num = { args: [types.ptr], returns: types.f64 };
  symbolSpec.fenel_is_box_num = { args: [types.ptr], returns: "i32" };
  // Phase 5b37 — bool magic-marker + unbox so structural-read can recover
  // unboxed JS booleans without expectedType context. Sub-class (c-7).
  symbolSpec.fenel_is_box_bool = { args: [types.ptr], returns: "i32" };
  symbolSpec.fenel_unbox_bool = { args: [types.ptr], returns: "i32" };
  const isPtrReturn = def.returnType.$tag === "Ptr";
  if (isPtrReturn) {
    symbolSpec.fenel_get_tag = { args: [types.ptr], returns: types.ptr };
    symbolSpec.fenel_get_field_count = { args: [types.ptr], returns: types.i64 };
    symbolSpec.fenel_get_field_name_at = {
      args: [types.ptr, types.i64],
      returns: types.ptr,
    };
    symbolSpec.fenel_get_field = {
      args: [types.ptr, types.i64],
      returns: types.ptr,
    };
    symbolSpec.fenel_get_field_named = {
      args: [types.ptr, types.cstring, types.i64],
      returns: types.ptr,
    };
  }
  let lib: { symbols: Record<string, (...a: unknown[]) => unknown>; close: () => void };
  try {
    lib = dlopen(soPath, symbolSpec) as typeof lib;
  } catch (e) {
    return { status: "skip", fnId, reason: `dlopen failed: ${(e as Error).message}` };
  }
  const callbacks: { close: () => void }[] = [];
  if (mod.effectImports !== undefined && mod.effectImports.length > 0) {
    for (const imp of mod.effectImports) {
      const key = `${imp.typeName}:${imp.methodName}`;
      const cb = new JSCallback(
        (..._args: unknown[]) => null,
        { args: [types.ptr, types.ptr, "i32"], returns: types.ptr },
      );
      const keyBuf = Buffer.from(`${key}\0`);
      (lib.symbols.fenel_register_handler as (
        k: unknown,
        p: unknown,
        e: unknown,
      ) => unknown)(keyBuf, cb.ptr, null);
      callbacks.push(cb);
    }
  }
  try {
    const compiledFn = lib.symbols[entrySymbol] as (...args: unknown[]) => unknown;
    const probeArgs = PROBE_ARGS[fnId] ?? [2];
    // Phase 5b40 — `stringCache` shares one Buffer per unique string across
    // all samples in this runOne. Without dedup, the per-sample keepalive
    // would accumulate to thousands of transient Buffers — confirmed to
    // trip a Bun 1.3.11 GC-vs-FFI panic at sample ~13. With dedup the
    // unique-string count stays bounded at ~hundreds.
    const stringCache = new Map<string, Buffer>();
    for (const args of samples) {
      const engineArgs = liftSampleForEngine(args, ctx);
      const argIsPtr = def.params.map((p) => p.paramType.$tag === "Ptr");
      const lifted = liftSampleForCompiledLlvm(
        args,
        ctx,
        lib.symbols,
        argIsPtr,
        stringCache,
      );
      const data = buildLlvmCompilerEvaluationData(fn.params, engineArgs);
      const engineResult = evaluate(fn.body, data, ctx);
      let compiledResult: unknown;
      try {
        compiledResult = compiledFn(...lifted.compiledArgs);
      } catch (e) {
        return {
          status: "fail",
          fnId,
          reason: `runtime error on args ${JSON.stringify(args)}: ${(e as Error).message}`,
        };
      }
      if (isPtrReturn) {
        compiledResult = marshalAdtPtr(compiledResult, lib.symbols, CString, fn.returns);
      }
      // Phase 5b40 — read `lifted.keepalive.length` after marshalAdtPtr so
      // every transient tag / name / value Buffer stays alive through body
      // execution AND structural-read return-marshal. Without this, JS GC
      // can reclaim a Buffer between materialise + the body's
      // fenel_get_tag / fenel_get_field_named / strcmp on adt->tag /
      // adt->field_names[i] / adt->fields[i] (the C-side stores the
      // caller's pointer raw without copying — see fenel_construct /
      // fenel_set_field_named in CLOSURE_RUNTIME_C). Sub-class (c-9b) fix.
      if (lifted.keepalive.length < 0) {
        throw new Error("unreachable: keepalive length cannot be negative");
      }
      if (!sameValue(engineResult, compiledResult, ctx, lib.symbols, probeArgs)) {
        return {
          status: "fail",
          fnId,
          reason: `mismatch on args ${JSON.stringify(args)} — engine=${JSON.stringify(engineResult)}, compiled=${JSON.stringify(compiledResult)}`,
        };
      }
    }
    return { status: "ok", fnId, samples: samples.length };
  } finally {
    if (mod.effectImports !== undefined && mod.effectImports.length > 0) {
      try {
        (lib.symbols.fenel_reset_handlers as () => unknown)();
      } catch {
        // Best-effort reset.
      }
    }
    for (const cb of callbacks) cb.close();
    lib.close();
    try {
      fs.rmSync(path.dirname(soPath), { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
  });
}

function isFnSyntax(a: unknown): boolean {
  if (a === null || typeof a !== "object" || Array.isArray(a)) return false;
  const keys = Object.keys(a as object);
  return keys.length === 1 && keys[0] === "fn";
}

function liftSampleForEngine(args: ReadonlyArray<unknown>, ctx: EvaluateContext): unknown[] {
  return args.map((a) => (isFnSyntax(a) ? evaluate(a, {}, ctx) : a));
}

function liftSampleForCompiledLlvm(
  args: ReadonlyArray<unknown>,
  ctx: EvaluateContext,
  llvmSymbols: Record<string, (...a: unknown[]) => unknown>,
  argIsPtr: ReadonlyArray<boolean> | undefined,
  stringCache: Map<string, Buffer>,
): { compiledArgs: unknown[]; keepalive: unknown[] } {
  // Phase 5b40 — `keepalive` pins every JS Buffer that the C-side
  // fenel_construct / fenel_set_field_named stores raw (tag, name, string
  // VALUE) through the lifetime of one runOne loop iteration. `stringCache`
  // shares Buffer instances across all samples in the enclosing runOne so
  // unique-string count stays bounded (~hundreds) — without dedup, bare
  // per-sample keepalive trips a Bun 1.3.11 GC-vs-FFI panic mid-compiledFn
  // at ~28k transient Buffers. Sub-class (c-9b) JS-side fix.
  const keepalive: unknown[] = [];
  const compiledArgs = args.map((a, i) => {
    if (isFnSyntax(a)) {
      const closure = evaluate(a, {}, ctx);
      return { __fenelClosureForLlvm: closure } as unknown;
    }
    // Phase 5b33 — string args lift to a NUL-terminated Buffer so Bun FFI
    // can pass them as a `ptr` (cstring). Sample args for engine:* fnIds
    // include raw strings (fnId, codeName) — the C-runtime natives treat
    // these as `const char *` (e.g., fenel_startsWith / fenel_concat
    // string branch). Without this lift, Bun FFI rejects `typeof "..." ===
    // "string"` ptr args.
    if (typeof a === "string") {
      return internString(a, stringCache, keepalive);
    }
    if (a === null || a === undefined) return null;
    // Phase 5b35 — typed-record / anonymous-record / array args materialise
    // via fenel_construct + fenel_set_field_named + fenel_appendItem so the
    // C-side body's `fenel_get_field_named` / `fenel_get_tag` calls see a
    // properly-formed FenelAdt / FenelList. Without this lift, Bun FFI
    // rejects `typeof a === "object"` ptr args with `Unable to convert
    // [object Object] to a pointer`. Sub-class (c-5) substrate fix.
    if (Array.isArray(a)) return materialiseList(a, llvmSymbols, keepalive, stringCache);
    if (isTypedRecord(a)) return materialiseTypedRecord(a, llvmSymbols, keepalive, stringCache);
    if (typeof a === "object") {
      return materialiseAnonRecord(a as Record<string, unknown>, llvmSymbols, keepalive, stringCache);
    }
    // Phase 5b36 — box raw scalars when the IR-declared arg ABI is `ptr`.
    // The LLVM emitter domain-analyses some Number-typed params as `Ptr`
    // (e.g., events:eventEntry's `timestamp: Number` passes through to
    // fenel_set_field_named's `void *` slot without ever crossing through
    // an arithmetic gate). When that happens, Bun FFI must receive a
    // pointer; otherwise it reinterprets the raw JS number as a pointer
    // value (1 → 0x1) and the C body segfaults on the first deref.
    if (argIsPtr !== undefined && argIsPtr[i] === true) {
      if (typeof a === "number") {
        const boxNum = llvmSymbols.fenel_box_num;
        if (boxNum === undefined) throw new Error("fenel_box_num not loaded");
        return boxNum(a);
      }
      if (typeof a === "boolean") {
        const boxBool = llvmSymbols.fenel_box_bool;
        if (boxBool === undefined) throw new Error("fenel_box_bool not loaded");
        return boxBool(a ? 1 : 0);
      }
    }
    return a;
  });
  return { compiledArgs, keepalive };
}

// Phase 5b40 — `internString` shares one Buffer per unique string across
// all samples in a runOne. Returns cached Buffer if present; otherwise
// allocates + caches + pushes to keepalive. Pins value-string memory
// through body execution at bounded GC pressure (Bun 1.3.11's mid-FFI
// GC interaction trips at unbounded Buffer count).
function internString(s: string, cache: Map<string, Buffer>, keepalive: unknown[]): Buffer {
  const existing = cache.get(s);
  if (existing !== undefined) return existing;
  const buf = Buffer.from(s + "\0");
  cache.set(s, buf);
  keepalive.push(buf);
  return buf;
}

// Phase 5b35 — recursive materialisation helpers for FFI arg-lift.
// ---------------------------------------------------------------------------
// `materialiseTypedRecord` walks a `{$tag: "Tag", ...}` JS object + emits
// fenel_construct(tag, nFields) followed by fenel_set_field_named per
// non-`$tag` field; `materialiseAnonRecord` uses tag `"$record"` mirroring
// the LLVM emitter's `lowerLlvmRecord` convention. `materialiseValue`
// dispatches per JS-value-shape — primitives box via fenel_box_num /
// fenel_box_bool, strings lift to NUL-terminated Buffer, arrays go to
// materialiseList, nested records recurse. `materialiseList` builds a
// FenelList via fenel_appendItem snoc-style starting from null. The output
// pointer is the `void *` that Bun FFI passes as a `ptr` arg.

function isTypedRecord(v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return typeof (v as Record<string, unknown>).$tag === "string";
}

function materialiseTypedRecord(
  v: unknown,
  symbols: Record<string, (...a: unknown[]) => unknown>,
  keepalive: unknown[],
  stringCache: Map<string, Buffer>,
): unknown {
  const obj = v as Record<string, unknown>;
  const tag = obj.$tag as string;
  const fieldNames = Object.keys(obj).filter((k) => k !== "$tag");
  const values = fieldNames.map((n) => obj[n]);
  return constructAdtFromFields(tag, fieldNames, values, symbols, keepalive, stringCache);
}

function materialiseAnonRecord(
  v: Record<string, unknown>,
  symbols: Record<string, (...a: unknown[]) => unknown>,
  keepalive: unknown[],
  stringCache: Map<string, Buffer>,
): unknown {
  const fieldNames = Object.keys(v);
  const values = fieldNames.map((n) => v[n]);
  return constructAdtFromFields("$record", fieldNames, values, symbols, keepalive, stringCache);
}

function constructAdtFromFields(
  tag: string,
  fieldNames: ReadonlyArray<string>,
  values: ReadonlyArray<unknown>,
  symbols: Record<string, (...a: unknown[]) => unknown>,
  keepalive: unknown[],
  stringCache: Map<string, Buffer>,
): unknown {
  // Phase 5b40 — tag + name + value Buffers all pin through internString
  // / keepalive because the C-side fenel_construct / fenel_set_field_named
  // store the caller's pointer raw (the available tag_len / name_len ABI
  // params are explicitly ignored — see CLOSURE_RUNTIME_C). Sub-class
  // (c-9b) JS-side fix.
  const tagBuf = internString(tag, stringCache, keepalive);
  const construct = symbols.fenel_construct;
  const setFieldNamed = symbols.fenel_set_field_named;
  if (construct === undefined || setFieldNamed === undefined) {
    throw new Error("fenel_construct / fenel_set_field_named not loaded");
  }
  const adt = construct(tagBuf, BigInt(tag.length), BigInt(fieldNames.length));
  for (let i = 0; i < fieldNames.length; i++) {
    const name = fieldNames[i]!;
    const nameBuf = internString(name, stringCache, keepalive);
    const lifted = materialiseValue(values[i], symbols, keepalive, stringCache);
    setFieldNamed(adt, BigInt(i), nameBuf, BigInt(name.length), lifted);
  }
  return adt;
}

function materialiseValue(
  v: unknown,
  symbols: Record<string, (...a: unknown[]) => unknown>,
  keepalive: unknown[],
  stringCache: Map<string, Buffer>,
): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    // Phase 5b40 — string field VALUES are JS Buffers passed by pointer
    // to fenel_set_field_named. After set_field_named returns, the Buffer
    // is JS-orphaned + GC-eligible — and adt->fields[i] dangles before
    // the body's later strcmp on the field value. internString interns
    // the Buffer in the runOne-wide stringCache + pushes to keepalive,
    // pinning it through body execution at bounded GC pressure. Sub-class
    // (c-9b) fix.
    return internString(v, stringCache, keepalive);
  }
  if (typeof v === "number") {
    const boxNum = symbols.fenel_box_num;
    if (boxNum === undefined) throw new Error("fenel_box_num not loaded");
    return boxNum(v);
  }
  if (typeof v === "boolean") {
    const boxBool = symbols.fenel_box_bool;
    if (boxBool === undefined) throw new Error("fenel_box_bool not loaded");
    return boxBool(v ? 1 : 0);
  }
  if (Array.isArray(v)) return materialiseList(v, symbols, keepalive, stringCache);
  if (isTypedRecord(v)) return materialiseTypedRecord(v, symbols, keepalive, stringCache);
  if (typeof v === "object") {
    return materialiseAnonRecord(v as Record<string, unknown>, symbols, keepalive, stringCache);
  }
  return v;
}

function materialiseList(
  items: ReadonlyArray<unknown>,
  symbols: Record<string, (...a: unknown[]) => unknown>,
  keepalive: unknown[],
  stringCache: Map<string, Buffer>,
): unknown {
  const appendItem = symbols.fenel_appendItem;
  if (appendItem === undefined) throw new Error("fenel_appendItem not loaded");
  // Phase 5b36 — base case uses fenel_empty_list (real length-0 FenelList
  // with magic) rather than null, so the return-marshal's structural-read
  // can recognise it as a list via fenel_is_list when field type is a
  // type-variable that doesn't peel to $opaque List.
  const emptyList = symbols.fenel_empty_list;
  if (emptyList === undefined) throw new Error("fenel_empty_list not loaded");
  let arr: unknown = emptyList();
  for (const item of items) {
    const lifted = materialiseValue(item, symbols, keepalive, stringCache);
    arr = appendItem(lifted, arr);
  }
  return arr;
}

function sameValue(
  a: unknown,
  b: unknown,
  ctx?: EvaluateContext,
  llvmSymbols?: Record<string, unknown>,
  probeArgs: ReadonlyArray<unknown> = [2],
): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (
    isFenelClosureSentinel(a) &&
    isLlvmClosurePtr(b) &&
    ctx !== undefined &&
    llvmSymbols !== undefined
  ) {
    void invokeCallable(a, probeArgs as unknown[], ctx);
    return false;
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i], ctx, llvmSymbols, probeArgs)) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    // Phase 5b36 — treat null-valued keys as absent. The engine evaluator's
    // `construct` op drops fields bound to `undefined` (so a Fenel `case
    // CoreConstruct { fields }` whose source value omits `fields` outputs
    // CeConstruct without the key); the LLVM emitter's lowering writes every
    // schema-named slot via fenel_set_field_named (so the compiled FenelAdt
    // has the key with NULL). Aligning at the comparison surface restores
    // engine-vs-compiled parity without touching either emitter.
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).filter((k) => ao[k] !== null);
    const bk = Object.keys(bo).filter((k) => bo[k] !== null);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!sameValue(ao[k], bo[k], ctx, llvmSymbols, probeArgs)) return false;
    }
    return true;
  }
  return false;
}

function isFenelClosureSentinel(v: unknown): boolean {
  return typeof v === "object" && v !== null && (v as { __fenelFn?: unknown }).__fenelFn === true;
}

function isLlvmClosurePtr(v: unknown): boolean {
  return typeof v === "bigint" || (typeof v === "number" && v !== 0);
}

// ---------------------------------------------------------------------------
// FFI marshalling layer for ptr-returning compiled bodies.
// ---------------------------------------------------------------------------

type FfiFn = (...a: unknown[]) => unknown;
type FfiSymbols = Record<string, FfiFn | undefined>;
type CStringCtor = new (ptr: unknown) => { toString(): string };

function sym(symbols: FfiSymbols, name: string): FfiFn {
  const f = symbols[name];
  if (f === undefined) throw new Error(`FFI symbol ${name} not loaded`);
  return f;
}

function isStringType(t: FenelType): boolean {
  if (typeof t !== "object" || t === null) return false;
  // 7g-retire-2c fold: name-handle of `{$named}` OR its `{$ref}` twin.
  if (refHandle(t) === "String") return true;
  // representation-substrate Phase 5a — was `repr === "string"`; the `repr`
  // string retired, so key on the opaque `name` (the marshalling-boundary
  // identity question "is this THE String type for IR string-constant emit", R3).
  if ("$opaque" in t && t.$opaque.name === "String") return true;
  if ("$refined" in t) return isStringType(t.$refined.base);
  return false;
}

function isPtrZero(p: unknown): boolean {
  return p === null || p === undefined || p === 0 || p === 0n;
}

function readAdtTag(
  ptr: unknown,
  symbols: FfiSymbols,
  CStringCtor: CStringCtor,
): string | null {
  const tagPtr = sym(symbols, "fenel_get_tag")(ptr);
  if (isPtrZero(tagPtr)) return null;
  return new CStringCtor(tagPtr).toString();
}

function getNamedFieldPtr(
  ptr: unknown,
  name: string,
  symbols: FfiSymbols,
): unknown {
  const nameBuf = Buffer.from(`${name}\0`);
  return sym(symbols, "fenel_get_field_named")(ptr, nameBuf, BigInt(name.length));
}

/** Host-side egress for dynamically named fields read from the LLVM ADT ABI.
 * A semantic wire name is data, never an object-prototype instruction. */
export function defineLlvmMarshalledOwnField(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  Object.defineProperty(target, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Build the interpreter oracle's parameter environment with the same
 * own-data-property discipline as LLVM return marshalling. */
export function buildLlvmCompilerEvaluationData(
  params: readonly { readonly name: string }[],
  args: readonly unknown[],
): Record<string, unknown> {
  const data = Object.create(null) as Record<string, unknown>;
  for (let i = 0; i < params.length; i++) {
    defineLlvmMarshalledOwnField(data, params[i]!.name, args[i]);
  }
  return data;
}

// Phase 5b36 — resolve `$named: "X"` to the shared backend harness entity.
// Falls through to null for type-variable leaks
// (e.g. `$named: "a"` where `a` is a type parameter that never registered as
// an entity); callers route to `structuralRead` in that case.
function resolveNamed(name: string): FenelType | null {
  const e = getWasmLlvmSelfHostEntity(name);
  return e?.type ?? null;
}

// Phase 5b36 — type-free structural walker over the C-side FenelAdt / FenelList
// representation. Used as fallback when `expectedType` is `$var` / `$named "a"`
// (type-variable leak) or otherwise unresolved. Recognises FenelList via
// `fenel_is_list` magic-marker, FenelAdt via non-null `fenel_get_tag`, and
// strips the synthetic `$tag: "$record"` for anonymous records so the engine's
// untagged shape round-trips identically.
function structuralRead(
  ptr: unknown,
  symbols: FfiSymbols,
  CStringCtor: CStringCtor,
): unknown {
  if (isPtrZero(ptr)) return null;
  const isListN = sym(symbols, "fenel_is_list")(ptr) as number;
  if (isListN === 1) {
    const len = Number(sym(symbols, "fenel_list_length")(ptr) as bigint);
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const itemPtr = sym(symbols, "fenel_list_get")(ptr, BigInt(i));
      out.push(structuralRead(itemPtr, symbols, CStringCtor));
    }
    return out;
  }
  const tag = readAdtTag(ptr, symbols, CStringCtor);
  if (tag !== null) {
    const nFields = Number(sym(symbols, "fenel_get_field_count")(ptr) as bigint);
    const out: Record<string, unknown> = tag === "$record" ? {} : { $tag: tag };
    for (let i = 0; i < nFields; i++) {
      const namePtr = sym(symbols, "fenel_get_field_name_at")(ptr, BigInt(i));
      if (isPtrZero(namePtr)) continue;
      const name = new CStringCtor(namePtr).toString();
      const fieldPtr = sym(symbols, "fenel_get_field")(ptr, BigInt(i));
      // Phase 5b36 — skip null-valued fields. The compiled body sets every
      // schema-named field via fenel_set_field_named (including ones the
      // source pattern bound to undefined / absent), while the JS engine
      // evaluator drops undefined keys. Treating null as absent on the
      // structural-walk side restores engine parity without changing the
      // emitter's set-every-named-slot convention.
      if (isPtrZero(fieldPtr)) continue;
      defineLlvmMarshalledOwnField(
        out,
        name,
        structuralRead(fieldPtr, symbols, CStringCtor),
      );
    }
    return out;
  }
  // Phase 5b36 — primitive-boxed disambiguation via magic marker on
  // fenel_box_num. With a magic-prefixed FenelBoxNum struct, structural-read
  // can recover unboxed JS Number without expectedType context.
  const isBoxNum = sym(symbols, "fenel_is_box_num")(ptr) as number;
  if (isBoxNum === 1) {
    return sym(symbols, "fenel_unbox_num")(ptr) as number;
  }
  // Phase 5b37 — same recipe for boxed Bool. Without the magic check, a
  // raw 1-byte alloc would round-trip back as the 1-char string "\\u0001".
  const isBoxBool = sym(symbols, "fenel_is_box_bool")(ptr) as number;
  if (isBoxBool === 1) {
    return (sym(symbols, "fenel_unbox_bool")(ptr) as number) === 1;
  }
  // No magic matched — assume raw NUL-terminated string. Strings have no
  // header (zero-overhead `const char *` ABI throughout the C runtime); the
  // CString reader walks bytes until NUL. Last-resort path; acceptable on the
  // sample types where the only non-magic ptr shape is a string.
  return new CStringCtor(ptr).toString();
}

function marshalAdtPtr(
  ptr: unknown,
  symbols: FfiSymbols,
  CStringCtor: CStringCtor,
  expectedType?: FenelType,
): unknown {
  if (isPtrZero(ptr)) {
    // Phase 5b36 — round-trip arg-lift's null-for-empty-list convention back
    // to JS `[]` when expectedType is `$opaque List`. `fenel_head/tail` treat
    // null identically to length-0 FenelList C-side; mirror that on return.
    if (expectedType !== undefined && peelList(expectedType) !== null) return [];
    return null;
  }
  if (expectedType === undefined) {
    return structuralRead(ptr, symbols, CStringCtor);
  }
  if (isStringType(expectedType)) {
    return new CStringCtor(ptr).toString();
  }
  const maybe = peelMaybe(expectedType);
  if (maybe !== null) {
    const tag = readAdtTag(ptr, symbols, CStringCtor);
    if (tag === "Nothing") return { $tag: "Nothing" };
    if (tag === "Just") {
      // Phase 10a-6: Just's payload is positional (field _0). Try named
      // lookup first ("_0" — what the named-record code path stores); fall
      // back to positional read by index when the LLVM lowerer used the
      // unnamed `fenel_set_field` path.
      let valuePtr = getNamedFieldPtr(ptr, "_0", symbols);
      if (isPtrZero(valuePtr)) {
        valuePtr = sym(symbols, "fenel_get_field")(ptr, BigInt(0));
      }
      return {
        $tag: "Just",
        _0: marshalAdtPtr(valuePtr, symbols, CStringCtor, maybe.value),
      };
    }
    return ptr;
  }
  // Phase 5b36 — `$opaque List` arm. Walks FenelList items via the new
  // `fenel_list_length` / `fenel_list_get` C natives and recursively marshals
  // each element at the list's element-type.
  const list = peelList(expectedType);
  if (list !== null) {
    const isListN = sym(symbols, "fenel_is_list")(ptr) as number;
    if (isListN !== 1) return ptr;
    const len = Number(sym(symbols, "fenel_list_length")(ptr) as bigint);
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const itemPtr = sym(symbols, "fenel_list_get")(ptr, BigInt(i));
      out.push(marshalAdtPtr(itemPtr, symbols, CStringCtor, list.elem));
    }
    return out;
  }
  const variant = peelToVariant(expectedType);
  if (variant !== null) {
    const tag = readAdtTag(ptr, symbols, CStringCtor);
    if (tag === null) return ptr;
    const matched = variant.cases.find((c) => c.name === tag);
    if (matched === undefined) return ptr;
    const out: Record<string, unknown> = { $tag: tag };
    const fields = matched.fields ?? [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!;
      // Phase 10a-6: positional ctors (auto-named `_<idx>`) store via
      // `fenel_set_field` without a name on the LLVM side. Try named read
      // first; fall back to positional `fenel_get_field` when name lookup
      // misses.
      let fieldPtr = getNamedFieldPtr(ptr, field.name, symbols);
      if (isPtrZero(fieldPtr)) {
        fieldPtr = sym(symbols, "fenel_get_field")(ptr, BigInt(i));
      }
      // Phase 5b36 — null = absent (engine convention; see structuralRead).
      if (isPtrZero(fieldPtr)) continue;
      defineLlvmMarshalledOwnField(
        out,
        field.name,
        marshalAdtPtr(fieldPtr, symbols, CStringCtor, field.type),
      );
    }
    return out;
  }
  if (typeof expectedType === "object" && expectedType !== null && "$record" in expectedType) {
    // Phase 5b36 — read `fenel_get_tag` and preserve as `$tag` on output. The
    // C-side FenelAdt was constructed with a tag (e.g. "EffectsExplicitProgram")
    // via `fenel_construct`; the prior branch walked fields by name but
    // discarded the tag. The synthetic "$record" tag from anonymous-record
    // construction is excluded — engine emits anonymous records untagged.
    const tag = readAdtTag(ptr, symbols, CStringCtor);
    const out: Record<string, unknown> = tag !== null && tag !== "$record" ? { $tag: tag } : {};
    for (const field of expectedType.$record.fields) {
      const fieldPtr = getNamedFieldPtr(ptr, field.name, symbols);
      // Phase 5b36 — null = absent (engine convention; see structuralRead).
      if (isPtrZero(fieldPtr)) continue;
      defineLlvmMarshalledOwnField(
        out,
        field.name,
        marshalAdtPtr(fieldPtr, symbols, CStringCtor, field.type),
      );
    }
    return out;
  }
  // Phase 5b36 — `$named: "X"` resolution via the shared registry. Recurses
  // into the resolved entity type; falls back to structural-read for
  // type-variable leaks (`$named: "a"` etc. where `getEntity` returns null).
  {
    // 7g-retire-2c fold: name-handle of `{$named}` OR its `{$ref}` twin.
    const named = refHandle(expectedType);
    if (named !== undefined) {
      const resolved = resolveNamed(named);
      if (resolved !== null) return marshalAdtPtr(ptr, symbols, CStringCtor, resolved);
      return structuralRead(ptr, symbols, CStringCtor);
    }
  }
  // Phase 5b36 — `$var` / unknown type → structural-read fallback.
  if (typeof expectedType === "object" && expectedType !== null && "$var" in expectedType) {
    return structuralRead(ptr, symbols, CStringCtor);
  }
  return ptr;
}

// ---------------------------------------------------------------------------
// Candidate enumeration.
// ---------------------------------------------------------------------------

const candidateModules = harnessModules;
const candidateIndex = buildSelfHostCandidateIndex<FenelFunction>([
  ...candidateModules.map(projectSelfHostCandidateModule),
  { name: "phase20", functions: [effectfulCanary] },
]);
// These two Fenel-bodied std declarations intentionally use the established C
// native ABI in this target (see C_RUNTIME_NATIVES below). Omitting them from
// the LLVM lexical projection is explicit ABI selection, not short-name
// collision resolution; every other body-owned definition receives a full id.
const LLVM_SHORT_NATIVE_FNIDS = new Set(["std:mod", "std:appendItem"]);
const callBindingsByFnId = compileCallBindingsByFnId(
  candidateModules.map((candidateModule) => ({
    functions: (candidateModule.functions ?? []).filter((fn) => !LLVM_SHORT_NATIVE_FNIDS.has(fn.id)),
  })),
);
function moduleCallBindingsFor(fn: FenelFunction): CompileCallBindings | undefined {
  return callBindingsByFnId.get(fn.id);
}
export const candidateFns = immutableCandidateRoster(candidateIndex.definitions);
const candidateFnById = candidateIndex.byFnId;

// ---------------------------------------------------------------------------
// Phase 21.2.1 — shared LLVM cross-Fenel-call substrate.
// ---------------------------------------------------------------------------

// Full function ids cross the LLVM ABI through the Fenel-owned reversible
// `llvmExternName` encoding (`fenel_fn_<UTF-8 hex>`). TypeScript only carries
// the current module's immutable binding projection and discovers the emitted
// symbol from the returned LlvmModule; it does not select a short-name target.

interface SharedLlvmHelper {
  fnId: string;
  symbol: string;
  ir: string;
}

function codeNameOf(fn: FenelFunction): string {
  return fn.id.includes(":") ? fn.id.slice(fn.id.indexOf(":") + 1) : fn.id;
}

// Phase 5b31 — `fenel_<codeName>` symbols defined natively in
// CLOSURE_RUNTIME_C above. `preCompileSharedLlvmHelpers` skips Fenel-bodied
// candidates whose codeName collides with one of these, since otherwise the
// pre-compiled helper IR's `define double @fenel_<name>(...)` would clash
// with the C-runtime native's definition at clang link time (`invalid
// redefinition of function 'fenel_<name>'`). The C-runtime impl is the
// source of truth; the helper IR would be dead code regardless because
// every consumer's `call ... @fenel_<name>` resolves to the C declaration.
// Today only `mod` collides — std:mod is the sole Fenel-bodied candidate
// whose codeName matches a CLOSURE_RUNTIME_C native. Future additions to
// the C runtime auto-extend via the same skip mechanism once the
// `matrix-vs-runtime asymmetry probe` surfaces them.
//
// Phase 5b33 — `appendItem` added because its Fenel body lowers to
// self-recursive LLVM IR (`concat arr [item]` → `concat(arr, appendItem
// item null)` without a base case). The JsonLogic JS evaluator handles
// the body correctly via literal-array evaluation, but the LLVM emitter
// transforms `[item]` JS-array sugar into a snoc-form `appendItem(item,
// null)` CoreCall whose body re-enters itself. Promoting `appendItem` to
// a C-runtime native (mirrors the std:mod precedent from 5b31) bypasses
// the broken helper IR and resolves the runtime cascade for the 4
// engine:* LLVM_EXPECTED_GAPS entries.
const C_RUNTIME_NATIVES = new Set<string>([
  "mod",
  "appendItem",
]);

// Phase 5b31 — strip the redundant self-`declare` line from each helper IR
// before bundling. `compileFenelToLlvmNative` emits a `declare ... @<name>(...)`
// for every callee referenced in the body, INCLUDING the entry function's own
// name (because the body's recursive `call @fenel_<name>` is treated like any
// other callee at lowering time). When the entry is also a `define ... @<name>`
// in the same module, clang's `.ll` parser rejects the file with `invalid
// redefinition of function '<name>'` — see manual repro:
//
//   declare ptr @foo(ptr, ptr)
//   define ptr @foo(ptr %a, ptr %b) { ... }   ; clang: invalid redefinition
//
// LLVM allows a function to reference itself directly via `call @foo` without a
// preceding `declare`, so stripping the self-declare is safe and produces a
// link-able helper. The other `declare`s (for OTHER helpers / C-runtime
// natives) stay — they resolve at link time against the corresponding `define`s
// in sibling helper IRs / CLOSURE_RUNTIME_C.
function stripSelfDeclare(ir: string, symbol: string): string {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^declare [^\\n]*@${escaped}\\([^)]*\\)\\s*$\\n?`, "gm");
  return ir.replace(re, "");
}

// Phase 5b32 — extract native `fenel_<name>` and canonical
// `fenel_fn_<UTF-8-hex>` symbols referenced via `call` instructions
// in LLVM IR text. Matches plain `call`, `tail call`, `musttail call`, `notail
// call` variants. Does NOT match `declare` lines — those are forward declarations
// that only become link-time symbol requirements when paired with a `call`.
// Indirect calls via function-pointer values (e.g. `call double %fp(...)`) don't
// reference `@symbol` directly and are not extracted; they resolve at runtime via
// the C-runtime closure ABI, not at link.
function extractFenelCallees(ir: string): Set<string> {
  const callees = new Set<string>();
  const callRe = /(?:tail\s+|musttail\s+|notail\s+)?call\s+[^\n@]*@(fenel_(?:fn_[0-9A-F]+|\w+))\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(ir)) !== null) {
    callees.add(m[1]!);
  }
  return callees;
}

function llvmExternSymbolForFnId(fnId: string): string {
  const hex = [...new TextEncoder().encode(fnId)]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("");
  return `fenel_fn_${hex}`;
}

const sharedLlvmCandidateBySymbol = new Map<string, FenelFunction>();
const sharedLlvmCandidateRank = new Map<string, number>();
for (const [rank, fn] of candidateIndex.definitions.entries()) {
  if (fn.body === undefined || (fn.requires ?? []).length > 0) continue;
  if (C_RUNTIME_NATIVES.has(codeNameOf(fn))) continue;
  const symbol = llvmExternSymbolForFnId(fn.id);
  sharedLlvmCandidateBySymbol.set(symbol, fn);
  sharedLlvmCandidateRank.set(symbol, rank);
}

type SharedLlvmHelperState =
  | { readonly status: "compiling" }
  | { readonly status: "ready"; readonly helper: SharedLlvmHelper }
  | { readonly status: "failed" };

const sharedLlvmHelperStates = new Map<string, SharedLlvmHelperState>();

/** Compile exactly one canonical helper on first reachable demand. A compiling
 * marker closes recursive SCCs; the finished IR is installed before its
 * callees are traversed. Failures remain process-local and are surfaced by the
 * owning fnId's ordinary classifier row when that function is observed. */
function ensureSharedLlvmHelper(symbol: string): SharedLlvmHelper | undefined {
  const state = sharedLlvmHelperStates.get(symbol);
  if (state?.status === "ready") return state.helper;
  if (state !== undefined) return undefined;

  const fn = sharedLlvmCandidateBySymbol.get(symbol);
  if (fn === undefined) return undefined;
  sharedLlvmHelperStates.set(symbol, { status: "compiling" });
  try {
    const identifiedFn = getCompilerFunction(fn);
    const artifact = compileSharedLlvmFunction(
      fn.id,
      sourceForFunction(fn, identifiedFn),
    );
    if (artifact.status !== "ok" || artifact.entrySymbol !== symbol) {
      sharedLlvmHelperStates.set(symbol, { status: "failed" });
      return undefined;
    }
    const helper = Object.freeze({
      fnId: fn.id,
      symbol,
      ir: stripSelfDeclare(artifact.ir, symbol),
    });
    sharedLlvmHelperStates.set(symbol, { status: "ready", helper });
    return helper;
  } catch {
    sharedLlvmHelperStates.set(symbol, { status: "failed" });
    return undefined;
  }
}

// Phase 5b32 — compile and return only the canonical helpers transitively
// referenced from one body IR. Native/effect/indirect symbols have no candidate
// and remain link-time responsibilities. Final candidate order matches the old
// eager roster order, so link inputs are deterministic and history-independent.
function computeTransitiveHelperClosure(bodyIr: string): SharedLlvmHelper[] {
  const needed = new Map<string, SharedLlvmHelper>();
  const visited = new Set<string>();
  const worklist: string[] = [...extractFenelCallees(bodyIr)];
  while (worklist.length > 0) {
    const symbol = worklist.pop()!;
    if (visited.has(symbol)) continue;
    visited.add(symbol);
    const helper = ensureSharedLlvmHelper(symbol);
    if (helper === undefined) continue;
    needed.set(symbol, helper);
    for (const ref of extractFenelCallees(helper.ir)) {
      if (!visited.has(ref)) worklist.push(ref);
    }
  }
  return [...needed.values()].sort((left, right) =>
    (sharedLlvmCandidateRank.get(left.symbol) ?? Number.MAX_SAFE_INTEGER)
      - (sharedLlvmCandidateRank.get(right.symbol) ?? Number.MAX_SAFE_INTEGER)
  );
}

/** Warm shared constructor metadata outside an individual test's timeout budget.
 * Helper IR is intentionally compiled only when a sampled entry reaches it. */
export function prepareClassifier(): void {
  getHarnessCtorDefs();
}

// ---------------------------------------------------------------------------
// Phase 5b30 — public classifier API.
// ---------------------------------------------------------------------------

function rowToResult(row: Row): ClassifierResult {
  switch (row.status) {
    case "ok": return { status: "OK", samplesCompared: row.samples };
    case "skip":
      if (row.reason === "no samples declared") return { status: "NO_SAMPLES" };
      return { status: "SKIP", reason: row.reason };
    case "fail": return { status: "FAIL", reason: row.reason };
  }
}

const classifyFnIdCached = memoizeAsyncFnIdClassification(
  async (fnId: string): Promise<ClassifierResult> => {
  const fn = candidateFnById.get(fnId)?.definition;
  if (fn === undefined) return { status: "NO_SAMPLES" };
  const samples = FN_SAMPLES[fnId] ?? [];
  if (samples.length === 0) return { status: "NO_SAMPLES" };
  return rowToResult(await runOne(fn, samples));
  },
);

export function classifyFnId(fnId: string): Promise<ClassifierResult> {
  return classifyFnIdCached(fnId);
}
