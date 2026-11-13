// ---------------------------------------------------------------------------
// gen-engine-sigs.ts — module-substrate Phase 3v generate-then-lock generator.
//
// THROWAWAY (notion-3u / dashboard-3t mechanic; delete post-verify). Builds the
// `module engine where` sig + @facet headers for the engine body .fenel files
// from the `engineModule` oracle, and emits the per-rung oracle fixture JSON.
//
//   bun implementations/typescript/engine/scripts/gen-engine-sigs.ts <rung>
//
// Rungs map to file-groups (see RUNGS below). The script:
//   1. dumps the oracle (id -> {params, returns, codeName, label, description,
//      category, tags, ioAction, hasBody}),
//   2. maps id -> source .fenel file (probe-load each file, record def names),
//   3. for each target file, weaves the sig + @facet block above each def,
//      prepends `module engine where`,
//   4. writes the migrated .fenel (when --write),
//   5. emits/updates the oracle fixture JSON for the rung's roster.
//
// To replace the fixture with the complete current engine oracle (including
// deleting retired ids) without weaving any Fenel source, use:
//
//   bun implementations/typescript/engine/scripts/gen-engine-sigs.ts --full-fixture
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineModule } from "../src/modules/engine";
import { loadFenelModule, loadFenelModuleUnion } from "../src/fenel-module";
import type { FenelType } from "../src/types";

const REPO_ROOT = join(import.meta.dir, "../../../..");
const FENEL_DIR = join(REPO_ROOT, "fenel/modules/engine");
const FIXTURE_DIR = join(import.meta.dir, "../src");

// File-groups per rung (file basenames under fenel/modules/engine/).
const RUNGS: Record<string, string[]> = {
  "3v.1": [
    "type-algebra",
    "type-traversal",
    "type-normalize",
    "decompose",
    "dependent-types",
  ],
  // 3v.2 — 75-function front-of-pipeline group. ir-ast / ir-types are entity-only (0 fns)
  // and stay header-LESS: they ride the union via the `name: "engine"` arg
  // fallback (loadFenelModuleUnion groups on module.name; a header-less file's
  // name IS the arg). Listed FIRST for tidy entity order. The 4 body files
  // carry the woven `module engine where` header.
  "3v.2": [
    "ir-ast",
    "ir-types",
    "parse-effect-fn-id",
    "make-effects-explicit",
    "make-closures-explicit",
    "normalise-to-core",
  ],
  // 3v.3a — the JS lowering tier (emit-js + serialize-js-module). 62 fns /
  // 2 files / 0 entities (JsAst / JsModule / CallMapping are declared in a
  // separate js-types file loaded by compile-js, not by these two). Both are
  // engine-only (only engine.ts imports their `?raw`) so each takes the woven
  // `module engine where` header normally — NO header-less / name-fallback
  // machinery (that is ir-types-specific). NO Axis B (0 entities → no dup).
  "3v.3a": [
    "emit-js",
    "serialize-js-module",
  ],
  // 3v.3b — the Wasm lowering tier (lower-to-wasm-ast). 172 fns / 1 file /
  // 0 entities (the WasmAst family — WasmModule / WasmValType / WasmInstr /
  // WasmDomain / CallDomain / WasmDirectOp / LowerOutput / DomainEntry / … —
  // is declared in compile-wasm/types.fenel, loaded by compile-wasm, NOT by
  // this file; lower-to-wasm-ast only references them by name). Engine-only
  // (only engine.ts imports its `?raw`) so it takes the woven `module engine
  // where` header normally — NO header-less / name-fallback machinery, NO
  // Axis B (0 entities → no dup). The single largest engine body file.
  "3v.3b": [
    "lower-to-wasm-ast",
  ],
  // 3v.3c — the LLVM lowering tier (lower-to-llvm-ast). 155 fns / 1 file /
  // 0 entities (the LlvmAst family — LlvmModule / LlvmValType / LlvmInstr /
  // LlvmFunctionDef / LlvmDomain / LlvmDirectArith / LlvmDirectCmp /
  // LlvmCallDomain / LlvmLowerOutput / … — is declared in
  // compile-llvm/types.fenel, loaded by compile-llvm, NOT by this file;
  // lower-to-llvm-ast only references them by name). Engine-only (only
  // engine.ts imports its `?raw`) so it takes the woven `module engine where`
  // header normally — NO header-less / name-fallback machinery, NO Axis B
  // (0 entities → no dup). The sigs are anyType uniformly → every sig OMITTED.
  // The second-largest engine body file; COMPLETES the lowering tier.
  "3v.3c": [
    "lower-to-llvm-ast",
  ],
  // 3v.4a — the set-algebra tier (set-algebra-deciders + set-syntax). 672 fns /
  // 2 files / 29 entities (the SetExprAdt / interval / format ADT family —
  // HierarchyEntry / Bound / Interval / SetExprAdt / FmtIntervalAdt /
  // FmtBoundEntry / ParseState / … — DECLARED by these two files, riding the
  // union's `entities`, UNLIKE the 0-entity lowering rungs). Both are
  // engine-only (only engine.ts imports their `?raw`) so each takes the woven
  // `module engine where` header normally. Axis B is PROVEN CLEAN (the 2-file
  // union loads without throwing — 0 internal/cross-file dup entity ids). The
  // sig vocab is the richest since 3v.2 — SetExpr deciders/syntax reference the
  // named ADTs above (serializer handles bare named entities + records/tuples/
  // $el) → #50 watch LIVE.
  "3v.4a": [
    "set-algebra-deciders",
    "set-syntax",
  ],
  // 3v.4b — the engine-internal tier (validate + validation-hints +
  // input-parsers + field-meta + representations-leaves + identifiable). 183 fns
  // / 6 files / 36 entities (FieldError / FieldResult + the per-shape Schema
  // ADTs from validate; LblSetExpr / LblPatternKind / VwhSchema from
  // validation-hints; ParseResult / Parse*Input from input-parsers; the FldField
  // / *Input field-meta ADTs; ShortIdInput from representations-leaves;
  // identifiable declares 0). All 6 are engine-only (only engine.ts imports
  // their `?raw`) so each takes the woven `module engine where` header normally.
  // Axis B is PROVEN CLEAN (the 6-file union loads without a dup-entity throw —
  // 39 unique ids, 0 internal/cross-file collisions). The serializer is
  // demonstrably complete across 7 locked slices / 1,503 fns (Surprise #55) — expect NO
  // serializeType extension.
  "3v.4b": [
    "validate",
    "validation-hints",
    "input-parsers",
    "field-meta",
    "representations-leaves",
    "identifiable",
  ],
  // floor-kernel Phase 3c — containment now owns the unified TraversalType
  // disjoint/subset/empty presentation. Keep a narrow oracle-refresh target so
  // signature/facet changes in this post-3v file can be merged mechanically.
  "floor-kernel-3c": [
    "containment",
  ],
  // floor-kernel Phase 4 — canonical SetExpr convergence touched the
  // registered ADT, its core decider/comprehension owners, and the structural
  // reader bodies. Keep their facets/oracle refresh reproducible as one rung.
  "floor-kernel-4": [
    "set-expr-types",
    "assignable",
    "refine",
    "fenel-check",
    "flow-infer",
    "invert",
    "type-to-set",
    "type-normalize",
    "set-algebra-deciders",
    "comprehend",
    "json-schema",
    "set-expr-sql",
    "fenel-printer",
  ],
};

// ---------------------------------------------------------------------------
// Oracle dump
// ---------------------------------------------------------------------------
type FacetMethods = Record<string, unknown>;
const insts = engineModule.instances ?? [];
function instanceClassName(i: { typeName?: string; className?: string }): string | undefined {
  return i.typeName ?? i.className;
}
function methodOf(className: string, id: string): FacetMethods | undefined {
  return insts.find((i) => instanceClassName(i) === className && i.args[0] === id)?.methods;
}

interface OracleFn {
  codeName: string;
  label?: string;
  description?: string;
  tags?: string[];
  category?: string;
  ioAction?: string;
  params: unknown[];
  returns: unknown;
  hasBody: boolean;
}

const oracle = new Map<string, OracleFn>();
const engineFunctions = engineModule.functions ?? [];
for (const f of engineFunctions) {
  if (oracle.has(f.id)) {
    throw new Error(`engineModule publishes duplicate function id ${f.id}`);
  }
  const codeName = (methodOf("Codeable", f.id) as { codeName?: string })?.codeName
    ?? f.id.slice("engine:".length);
  const label = (methodOf("Labelable", f.id) as { label?: string })?.label;
  const description = (methodOf("Describable", f.id) as { description?: string })?.description;
  const tags = (methodOf("Taggable", f.id) as { tags?: string[] })?.tags;
  const category = (methodOf("Categorizable", f.id) as { category?: string })?.category;
  const ioAction = (methodOf("IOInvokable", f.id) as { ioAction?: string })?.ioAction;
  oracle.set(f.id, {
    codeName, label, description, tags, category, ioAction,
    params: (f.params ?? []) as unknown[],
    returns: f.returns as unknown,
    hasBody: !!f.body,
  });
}

// ---------------------------------------------------------------------------
// id -> source file (probe-load each file)
// ---------------------------------------------------------------------------
function fileDefNames(basename: string): string[] {
  const src = readFileSync(join(FENEL_DIR, `${basename}.fenel`), "utf8");
  const mod = loadFenelModule(src, "probe");
  return (mod.functions ?? []).map((f) => f.id.slice(f.id.indexOf(":") + 1));
}

// ---------------------------------------------------------------------------
// serializeType — FenelType -> .fenel sig surface
// ---------------------------------------------------------------------------
function isVar(t: unknown): t is { $var: string } {
  return !!t && typeof t === "object" && "$var" in (t as object);
}
function isNamed(t: unknown): t is { $named: string } | { $ref: string } {
  // 7g-retire-4c: a type name-ref is `{$ref}` now (legacy `{$named}` tolerated).
  return !!t && typeof t === "object" && ("$named" in (t as object) || "$ref" in (t as object));
}

// peelers (structural)
function peelListElem(t: any): FenelType | null {
  // representation-substrate Phase 5a — was `repr === "array"`; the `repr` string
  // retired, so key on the opaque `name` (the List type's identity). The pure
  // cons-spine extraction below is unchanged.
  if (t && t.$opaque && t.$opaque.name === "List") {
    const pure = t.$opaque.pure;
    // μX. Nil | Cons { head: a, tail: X }
    const cases = pure?.$mu?.body?.$variant?.cases ?? pure?.$variant?.cases;
    const cons = cases?.find((c: any) => c.name === "Cons");
    const head = cons?.fields?.find((f: any) => f.name === "head");
    return (head?.type ?? null) as FenelType | null;
  }
  return null;
}
// single payload field — std encoding uses `value`, positional sugar uses `_0`
function payloadType(c: any): FenelType | null {
  const f = c?.fields?.find((f: any) => f.name === "value")
    ?? c?.fields?.find((f: any) => f.name === "_0")
    ?? c?.fields?.[0];
  return (f?.type ?? null) as FenelType | null;
}
function peelMaybeInner(t: any): FenelType | null {
  if (t && t.$variant && Array.isArray(t.$variant.cases)) {
    const names = t.$variant.cases.map((c: any) => c.name).sort();
    if (names.length === 2 && names[0] === "Just" && names[1] === "Nothing") {
      return payloadType(t.$variant.cases.find((c: any) => c.name === "Just"));
    }
  }
  return null;
}
function peelResultEA(t: any): [FenelType, FenelType] | null {
  if (t && t.$variant && Array.isArray(t.$variant.cases)) {
    const names = t.$variant.cases.map((c: any) => c.name).sort();
    if (names.length === 2 && names[0] === "Err" && names[1] === "Ok") {
      const e = payloadType(t.$variant.cases.find((c: any) => c.name === "Err"));
      const a = payloadType(t.$variant.cases.find((c: any) => c.name === "Ok"));
      if (e && a) return [e as FenelType, a as FenelType];
    }
  }
  return null;
}

function serializeType(t: unknown, paren = false): string {
  if (isVar(t)) return (t as { $var: string }).$var;       // {$var:X} -> X (reloads as {$named:X})
  if (isNamed(t)) return ((t as { $named?: string }).$named ?? (t as { $ref?: string }).$ref)!;  // {$ref:X}/{$named:X} -> X
  const list = peelListElem(t as any);
  if (list) {
    const inner = serializeType(list, true);
    const s = `List ${inner}`;
    return paren ? `(${s})` : s;
  }
  const mb = peelMaybeInner(t as any);
  if (mb) {
    const s = `Maybe ${serializeType(mb, true)}`;
    return paren ? `(${s})` : s;
  }
  const res = peelResultEA(t as any);
  if (res) {
    const s = `Result ${serializeType(res[0], true)} ${serializeType(res[1], true)}`;
    return paren ? `(${s})` : s;
  }
  const tt = t as any;
  if (tt && tt.$record && Array.isArray(tt.$record.fields)) {
    const fs = tt.$record.fields.map((f: any) => `${f.name}: ${serializeType(f.type)}`).join(", ");
    const s = `{ ${fs} }`;
    // 3v.2 serializeType extension (#50 surface-it): in type-application
    // ARGUMENT position (`Maybe { … }` / `List { … }` / `Result e { … }`) the
    // parser's `canStartTypeAppArg` doesn't admit a bare `{`, so wrap the
    // record in parens → `Maybe ({ … })`. The `(` type-app-arg path re-enters
    // the full type parser (parseTypeExpr → parseTypeAtom handles the record);
    // `liftJuxApp("Maybe", [record])` then resolves to the canonical
    // `$variant` Maybe-of-record, byte-equal to the oracle. At top level / as a
    // nested record field type (paren=false) a bare record parses fine.
    return paren ? `(${s})` : s;
  }
  if (tt && tt.$tuple && Array.isArray(tt.$tuple)) {
    return `(${tt.$tuple.map((x: any) => serializeType(x)).join(", ")})`;
  }
  if (tt && tt.$el) {
    // dependent: {$el:{call:[Name, arg...]}} -> reproduce as a call-form via name
    const call = tt.$el.call;
    if (Array.isArray(call)) {
      const head = call[0];
      const args = call.slice(1).map((a: any) => serializeType(a, true)).join(" ");
      return args ? `${head} ${args}` : `${head}`;
    }
  }
  throw new Error(`serializeType: unknown shape ${JSON.stringify(t)}`);
}

// A sig is OMITTED when every param-type AND the return is a top-level {$var}.
function sigAllVar(o: OracleFn): boolean {
  const ret = o.returns;
  const params = o.params as Array<{ type?: unknown }>;
  if (!isVar(ret)) return false;
  for (const p of params) if (!isVar(p.type)) return false;
  return true;
}

function serializeSig(name: string, o: OracleFn): string | null {
  if (sigAllVar(o)) return null; // OMIT — loader default reproduces var-everywhere
  const params = o.params as Array<{ name?: string; type?: unknown }>;
  const parts: string[] = [];
  for (const p of params) {
    parts.push(`(${p.name}: ${serializeType(p.type)})`);
  }
  const ret = serializeType(o.returns);
  const arrow = [...parts, ret].join(" -> ");
  return `${name} : ${arrow}`;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function facetBlock(o: OracleFn): string[] {
  const lines: string[] = [];
  if (o.label !== undefined) lines.push(`@label "${esc(o.label)}"`);
  if (o.description !== undefined) lines.push(`@description "${esc(o.description)}"`);
  if (o.tags !== undefined && o.tags.length > 0) {
    lines.push(`@tags ${o.tags.map((t) => `"${esc(t)}"`).join(" ")}`);
  }
  // category: DROP when === "engine" (3j); KEEP otherwise (engine-internal, locale, string)
  if (o.category !== undefined && o.category !== "engine") {
    lines.push(`@category "${esc(o.category)}"`);
  }
  if (o.ioAction !== undefined) lines.push(`@ioAction "${esc(o.ioAction)}"`);
  return lines;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const fullFixture = process.argv.includes("--full-fixture");
const rungArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const rung = rungArg ?? "3v.1";
const doWrite = process.argv.includes("--write");
const doVerify = process.argv.includes("--verify");
if (fullFixture && (doWrite || doVerify)) {
  throw new Error("--full-fixture cannot be combined with --write or --verify");
}
const files = fullFixture ? [] : RUNGS[rung];
if (!files) throw new Error(`unknown rung ${rung}`);

// normalizeVars: {$var:x} ≡ {$named:x} in type-var position (the documented
// {$var}→{$named} shift — see Surprise #52).
function normVars(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(normVars);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if ("$var" in o && typeof o.$var === "string") return { $named: o.$var };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = normVars(o[k]);
    return out;
  }
  return t;
}

if (doVerify) {
  // Pass `name: "engine"` for ALL files so the header-LESS entity-only files
  // (ir-ast / ir-types — 3v.2) group with the `module engine where` body files
  // under one "engine" group (loadFenelModuleUnion groups on module.name; a
  // header-less file's name IS this arg). Find the engine group explicitly
  // rather than [0] (robust to first-seen order).
  const union = loadFenelModuleUnion(
    files.map((b) => ({
      src: readFileSync(join(FENEL_DIR, `${b}.fenel`), "utf8"),
      name: "engine",
    })),
  ).find((m) => m.name === "engine")!;
  const ufns = new Map((union.functions ?? []).map((f) => [f.id, f]));
  const uinsts = union.instances ?? [];
  const umethod = (cls: string, id: string): FacetMethods | undefined =>
    uinsts.find((i) => instanceClassName(i) === cls && i.args[0] === id)?.methods;
  let mismatches = 0;
  for (const base of files) {
    for (const nm of fileDefNames(base)) {
      const id = `engine:${nm}`;
      const o = oracle.get(id);
      const u = ufns.get(id);
      if (!o) continue;
      if (!u) { console.log(`MISSING in union: ${id}`); mismatches++; continue; }
      const op = JSON.stringify(normVars(o.params));
      const up = JSON.stringify(normVars(u.params));
      if (op !== up) { console.log(`PARAMS ${id}\n  oracle: ${op}\n  union:  ${up}`); mismatches++; }
      const or = JSON.stringify(normVars(o.returns));
      const ur = JSON.stringify(normVars(u.returns));
      if (or !== ur) { console.log(`RETURN ${id}\n  oracle: ${or}\n  union:  ${ur}`); mismatches++; }
      // facets
      const ucode = (umethod("Codeable", id) as { codeName?: string })?.codeName;
      if (ucode !== o.codeName) { console.log(`CODENAME ${id}: ${ucode} != ${o.codeName}`); mismatches++; }
      const ulabel = (umethod("Labelable", id) as { label?: string })?.label;
      if ((o.label ?? undefined) !== (ulabel ?? undefined)) { console.log(`LABEL ${id}`); mismatches++; }
      const udesc = (umethod("Describable", id) as { description?: string })?.description;
      if ((o.description ?? undefined) !== (udesc ?? undefined)) { console.log(`DESC ${id}`); mismatches++; }
      const utags = (umethod("Taggable", id) as { tags?: string[] })?.tags;
      if (JSON.stringify(o.tags ?? null) !== JSON.stringify(utags ?? null)) { console.log(`TAGS ${id}: ${JSON.stringify(utags)} != ${JSON.stringify(o.tags)}`); mismatches++; }
      const ucat = (umethod("Categorizable", id) as { category?: string })?.category;
      const expectedCat = o.category !== undefined && o.category !== "engine" ? o.category : undefined;
      if (expectedCat !== ucat) { console.log(`CATEGORY ${id}: ${ucat} != ${expectedCat}`); mismatches++; }
      const ubody = !!u.body;
      if (ubody !== o.hasBody) { console.log(`HASBODY ${id}: ${ubody} != ${o.hasBody}`); mismatches++; }
    }
  }
  console.log(`\nVerify rung ${rung}: ${mismatches} mismatches`);
  process.exit(mismatches === 0 ? 0 : 1);
}

const rosterIds: string[] = [];
const fixtureFns: Record<string, OracleFn> = {};

for (const base of files) {
  const defNames = fileDefNames(base);
  const ids = defNames.map((n) => `engine:${n}`);
  for (const id of ids) {
    if (!oracle.has(id)) {
      console.warn(`!! ${id} (from ${base}.fenel) not in oracle`);
      continue;
    }
    rosterIds.push(id);
    fixtureFns[id] = oracle.get(id)!;
  }
  console.log(`${base}.fenel: ${defNames.length} defs`);

  // Entity-only files (ir-ast / ir-types — 3v.2) stay header-LESS: they ride
  // the union via the `name: "engine"` arg fallback, NOT a woven header
  // (adding `module engine where` would force their name to "engine" and break
  // the self-host-tier siblings' separate loads). Nothing to weave (0 fns).
  if (defNames.length === 0) continue;

  // Build the woven file
  const src = readFileSync(join(FENEL_DIR, `${base}.fenel`), "utf8");
  const lines = src.split("\n");
  const out: string[] = ["module engine where", ""];
  // For each def line `^<name> ` or `^<name> :` (first occurrence), inject facet+sig before it.
  const injected = new Set<string>();
  const nameRe = /^([a-z][A-Za-z0-9_]*)\b/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(nameRe);
    if (m && defNames.includes(m[1]!) && !injected.has(m[1]!)) {
      const nm = m[1]!;
      const o = oracle.get(`engine:${nm}`);
      if (o) {
        injected.add(nm);
        for (const fl of facetBlock(o)) out.push(fl);
        const sig = serializeSig(nm, o);
        if (sig) out.push(sig);
      }
    }
    out.push(line);
  }
  const woven = out.join("\n");
  const missing = defNames.filter((n) => !injected.has(n));
  if (missing.length) console.warn(`  !! not injected (no clause line matched): ${missing.join(", ")}`);
  if (doWrite) {
    writeFileSync(join(FENEL_DIR, `${base}.fenel`), woven, "utf8");
    console.log(`  WROTE ${base}.fenel (+${injected.size} headers)`);
  }
}

if (!fullFixture) console.log(`\nRung ${rung}: ${rosterIds.length} fns total`);

if (doWrite || process.argv.includes("--fixture") || fullFixture) {
  const fixturePath = join(FIXTURE_DIR, "module-migrate-engine.oracle.json");
  let existing: { fns: Record<string, OracleFn>; entities: string[] } = { fns: {}, entities: [] };
  try { existing = JSON.parse(readFileSync(fixturePath, "utf8")); } catch {}
  if (fullFixture) {
    const entityIds = (engineModule.entities ?? []).map((entity) => entity.id);
    if (new Set(entityIds).size !== entityIds.length) {
      throw new Error("engineModule publishes duplicate entity ids; refusing to replace the full fixture");
    }
    existing.fns = Object.fromEntries(
      [...oracle.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    );
    existing.entities = [...entityIds].sort();
  } else {
    for (const [id, o] of Object.entries(fixtureFns)) existing.fns[id] = o;
    // Per-rung refreshes retain the historical behavior of re-dumping the
    // complete live entity set while merging only that rung's functions.
    existing.entities = [...new Set((engineModule.entities ?? []).map((e) => e.id))].sort();
  }
  writeFileSync(fixturePath, JSON.stringify(existing, null, 2), "utf8");
  console.log(`Fixture updated: ${Object.keys(existing.fns).length} fns, ${existing.entities.length} entities`);
}
