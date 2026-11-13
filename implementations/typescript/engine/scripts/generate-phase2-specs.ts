// One-off generator for Phase 2 of typeclass-substrate-completion: emits
// Fenel source declarations for every TS-declared Interface that
// doesn't already have a hand-authored counterpart in
// fenel/std/typeclass-specs.fenel. Run from repo root via:
//
//   bun implementations/typescript/engine/scripts/generate-phase2-specs.ts
//
// Output to stdout — caller appends to typeclass-specs.fenel.

import { dispatchRegistry } from "../src/system-entities";
import type { Interface, InterfaceMethod } from "../src/class-types";
import type { FenelType } from "../src/types";
import { peelList, peelMaybe, peelResult } from "../src/set-algebra";

// Hand-authored specs already in fenel/std/typeclass-specs.fenel — skip these.
const HAND_AUTHORED = new Set([
  "LabelableSpec", "CodeableSpec", "DescribableSpec", "IconableSpec",
  "EmojiableSpec", "SoundableSpec", "CategorizableSpec", "TaggableSpec",
  "ViewableSpec", "AliasableSpec", "ExemplifiableSpec", "StoryboardableSpec",
  "LayoutSpec", "InputableSpec", "ReferenceableSpec", "GroupableSpec",
  "HasDefaultSpec", "UndefinableSpec",
]);

function lawNameToFieldName(name: string): string {
  const parts = name.split(/[-_\s]+/).filter((p) => p.length > 0);
  if (parts.length === 0) return name;
  const head = parts[0]!;
  const tail = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return [head.charAt(0).toLowerCase() + head.slice(1), ...tail].join("");
}

// Print a FenelType as a single-line Fenel surface type expression.
// Drops refinements to match the convention of the existing 18 hand-authored
// specs (which lifted refined String → String for tractability).
function printFenelType(t: unknown): string {
  if (typeof t === "string") return t;
  if (!t || typeof t !== "object") return String(t);
  const obj = t as Record<string, unknown>;
  if ("$named" in obj) return obj.$named as string;
  if ("$var" in obj) return obj.$var as string;
  if ("$void" in obj) return "Void";
  if ("$unit" in obj) return "Unit";
  if ("$type" in obj) return "Type";
  // Canonical containers recognized via peelers.
  const list = peelList(t as FenelType);
  if (list) return `[${printFenelType(list.elem)}]`;
  const maybe = peelMaybe(t as FenelType);
  if (maybe) return `Maybe<${printFenelType(maybe.value)}>`;
  const result = peelResult(t as FenelType);
  if (result) return `Result<${printFenelType(result.err)}, ${printFenelType(result.ok)}>`;
  if ("$tuple" in obj) {
    const items = obj.$tuple as unknown[];
    return `(${items.map(printFenelType).join(", ")})`;
  }
  if ("$record" in obj) {
    const r = obj.$record as { fields: Array<{ name: string; type: unknown }> };
    if (r.fields.length === 0) return "{ }";
    const fs = r.fields.map(f => `${f.name}: ${printFenelType(f.type)}`);
    return `{ ${fs.join(", ")} }`;
  }
  if ("$arrow" in obj) {
    const ar = obj.$arrow as { params: Array<{ name?: string; type: unknown }>; returns: unknown };
    const ps = ar.params;
    const ret = printFenelType(ar.returns);
    if (ps.length === 0) return `() -> ${ret}`;
    if (ps.length === 1) return `${printFenelType(ps[0]!.type)} -> ${ret}`;
    const paramStrs = ps.map(p => printFenelType(p.type));
    return `(${paramStrs.join(", ")}) -> ${ret}`;
  }
  if ("$refined" in obj) {
    // Drop refinements — existing 18 hand-authored specs convention.
    const r = obj.$refined as { base: unknown };
    return printFenelType(r.base);
  }
  if ("$tagged" in obj) {
    const tg = obj.$tagged as { value: unknown; phantom: unknown };
    return `Tagged<${printFenelType(tg.value)}, ${printFenelType(tg.phantom)}>`;
  }
  if ("$map" in obj) {
    const m = obj.$map as { keys: unknown; values: unknown };
    return `Map<${printFenelType(m.keys)}, ${printFenelType(m.values)}>`;
  }
  if ("$opaque" in obj) {
    const op = obj.$opaque as { name: string };
    return op.name;
  }
  if ("$variant" in obj) {
    // No clean Fenel surface for anonymous inline variants. Method returns
    // shouldn't hit this — flag loudly so we can address.
    throw new Error(`Cannot print $variant inline as Fenel surface: ${JSON.stringify(obj).slice(0, 200)}`);
  }
  if ("$el" in obj) {
    const e = obj.$el as Record<string, unknown>;
    if (e && typeof e === "object" && Array.isArray(e.call)) {
      const args = e.call as unknown[];
      if (args.length >= 1 && typeof args[0] === "string") {
        const head = args[0];
        const rest = args.slice(1).map((a) => {
          const s = printFenelType(a);
          return /[ <>]/.test(s) ? `(${s})` : s;
        });
        return rest.length === 0 ? head : `${head} ${rest.join(" ")}`;
      }
    }
  }
  throw new Error(`Cannot print FenelType: ${JSON.stringify(obj).slice(0, 200)}`);
}

function methodFieldType(m: InterfaceMethod): string {
  if (m.params.length === 0) return printFenelType(m.returns);
  // Multi-param method → arrow type.
  const arrow: FenelType = {
    $arrow: { params: m.params, returns: m.returns },
  };
  return printFenelType(arrow);
}

function emitSpec(tc: Interface): string {
  const specName = `${tc.name}Spec`;
  const params = (tc.params ?? []).map(p => p.name).join(" ");
  const header = params.length > 0 ? `${specName} ${params}` : specName;
  // Field assignments: methods first, then laws (matches synthesizer order).
  const parts: string[] = [];
  for (const m of tc.methods) {
    parts.push(`${m.name}: ${methodFieldType(m)}`);
  }
  for (const law of tc.laws ?? []) {
    parts.push(`${lawNameToFieldName(law.name)}: Verified Boolean`);
  }
  // Body part — Fenel syntax allows `X = X field: T field: T`. Single-line.
  const body = `${specName}${parts.length > 0 ? " " + parts.join(" ") : ""}`;
  return `${header} = ${body}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const classes = dispatchRegistry.listClasses();
const skipped: string[] = [];
const skippedLowercase: string[] = [];
const skippedListNoParam: string[] = [];
const emitted: { name: string; src: string; description?: string }[] = [];
const errors: { name: string; err: string }[] = [];

function hasBareListReference(tc: Interface): boolean {
  // Flag methods whose return type is the literal `{$named: "List"}` (zero-arg
  // List reference — stale TS source bug; parsing back as Fenel `List` would
  // greedily juxtapose with the next field name).
  const isBareList = (t: unknown): boolean => {
    if (!t || typeof t !== "object") return false;
    const obj = t as Record<string, unknown>;
    if ("$named" in obj && obj.$named === "List") return true;
    return false;
  };
  for (const m of tc.methods) {
    if (isBareList(m.returns)) return true;
    for (const p of m.params) if (isBareList(p.type)) return true;
  }
  return false;
}

for (const tc of classes) {
  const specName = `${tc.name}Spec`;
  if (HAND_AUTHORED.has(specName)) {
    skipped.push(specName);
    continue;
  }
  // Skip lowercase-named typeclasses — Fenel parser requires uppercase for
  // type-defs. Renaming `messaging`/`payment`/`ai`/`telegram_lifecycle`/...
  // touches persisted DB data (Instance.className). Deferred to Phase 2.5.
  if (!/^[A-Z]/.test(tc.name)) {
    skippedLowercase.push(specName);
    continue;
  }
  // Skip specs with stale bare-`List` field types — parsing-side ambiguity.
  if (hasBareListReference(tc)) {
    skippedListNoParam.push(specName);
    continue;
  }
  try {
    const src = emitSpec(tc);
    emitted.push({
      name: specName,
      src,
      description: typeof tc.description === "string" ? tc.description : undefined,
    });
  } catch (e) {
    errors.push({ name: specName, err: String(e) });
  }
}

console.log(`-- ============================================================================`);
console.log(`-- Phase 2 of typeclass-substrate-completion — auto-generated spec records`);
console.log(`-- ============================================================================`);
console.log(`-- ${emitted.length} specs generated from TS Interface registry`);
console.log(`-- ${skipped.length} hand-authored specs skipped (already in this file above)`);
console.log(`-- ${skippedLowercase.length} lowercase-named typeclasses skipped (deferred to Phase 2.5)`);
console.log(`-- ${skippedListNoParam.length} skipped (stale bare-List field type)`);
for (const n of skippedLowercase) console.log(`--   lowercase: ${n}`);
for (const n of skippedListNoParam) console.log(`--   bare-List: ${n}`);
if (errors.length > 0) {
  console.log(`-- ${errors.length} ERRORS:`);
  for (const e of errors) console.log(`--   ${e.name}: ${e.err}`);
}
console.log(``);
for (const sp of emitted) {
  if (sp.description) {
    console.log(`-- ${sp.description}`);
  }
  console.log(sp.src);
  console.log(``);
}
console.log(`-- ============================================================================`);
console.log(`-- end Phase 2 auto-generated specs`);
console.log(`-- ============================================================================`);

if (errors.length > 0) {
  console.error(`\nERRORS: ${errors.length} specs could not be printed.`);
  process.exit(1);
}
