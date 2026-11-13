// Regenerator for module-migrate-std.oracle.json (FM-retire-9 Step 9c). Dumps a
// NORMALIZED snapshot of the stdModule roster — the regression lock the
// module-migrate-std oracle compares the live module against. The bulk TS specs
// are retired (9a/9b), so this is a generate-then-lock snapshot (like the
// engine/notion/dashboard oracles), not a pre-migration dump. Re-run + commit the
// regenerated .oracle.json when std legitimately changes (the oracle test goes red
// until you do).
//
// The 4 §4 normalizations are applied here AND mirrored in the test read side so
// the lock is robust to the documented cosmetic divergences (type-var $var/$named/
// $ref folding; arrow-param names → _i; key-order) while still catching any real
// roster / sig / facet change.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdModule } from "../src/modules/std";
import type { Instance } from "../src/types";

const fns = stdModule.functions ?? [];
const insts = (stdModule.instances ?? []) as Instance[];
// universal-dispatch-convergence Phase 3 — the dispatch-Type-name field is
// `typeName` (the retired `className` spelling silently matched nothing, which
// is why post-rename regens would have dropped every facet).
function methodOf(typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

// Normalization 1 — fold {$var}/{$ref} of a name to the single {$ref} token
// (BYTE-IDENTICAL to the test-side norm in module-migrate-std.test.ts — the
// post-7g $ref spelling; an earlier drift folded to {$named} here while the
// test folded to {$ref}, which would have made any regen mismatch on every
// type-var).
// Normalization 2 — anonymous arrow-param names → _i.
// Normalization 4 — canonicalize object key order (sort).
function norm(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(norm);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if (typeof o.$var === "string") return { $ref: o.$var };
    if (typeof o.$ref === "string") return { $ref: o.$ref };
    // arrow param names → _i (positional)
    if (o.$arrow && typeof o.$arrow === "object") {
      const arr = o.$arrow as { params?: unknown[]; returns?: unknown };
      const params = (arr.params ?? []).map((p, i) => {
        const pn = norm(p) as Record<string, unknown>;
        return { ...pn, name: `_${i}` };
      });
      return { $arrow: sortKeys({ params, returns: norm(arr.returns) }) };
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = norm(o[k]);
    return sortKeys(out);
  }
  return t;
}
function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

const oracle: Record<string, unknown> = { fns: {} };
const fnsOut = oracle.fns as Record<string, unknown>;
for (const f of fns) {
  const cat = methodOf("Categorizable", f.id)?.category;
  const lbl = methodOf("Labelable", f.id)?.label;
  const desc = methodOf("Describable", f.id)?.description;
  const tags = methodOf("Taggable", f.id)?.tags;
  const io = methodOf("IOInvokable", f.id)?.ioAction;
  fnsOut[f.id] = {
    codeName: methodOf("Codeable", f.id)?.codeName,
    ...(lbl !== undefined ? { label: lbl } : {}),
    ...(desc !== undefined ? { description: desc } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(cat !== undefined ? { category: cat } : {}),
    ...(io !== undefined ? { ioAction: io } : {}),
    params: norm(f.params),
    returns: norm(f.returns),
    hasBody: f.body !== undefined,
  };
}

const path = join(import.meta.dir, "..", "src", "module-migrate-std.oracle.json");
writeFileSync(path, JSON.stringify(oracle, null, 2) + "\n");
console.log("wrote", Object.keys(fnsOut).length, "fns to", path);
