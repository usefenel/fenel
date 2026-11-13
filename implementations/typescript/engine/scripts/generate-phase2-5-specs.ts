// One-off generator for Phase 2.5 of typeclass-substrate-completion: emits
// Fenel source declarations for the 20 module capability typeclasses that
// were renamed from lowercase to uppercase. Output to stdout — caller
// appends to fenel/std/typeclass-specs.fenel.
//
// Mirrors generate-phase2-specs.ts but targets the explicit Phase 2.5 set
// (smaller blast radius than re-running the full Phase 2 generator with an
// expanded skip-list).

import { dispatchRegistry } from "../src/system-entities";
import type { Interface, InterfaceMethod } from "../src/class-types";
import type { FenelType } from "../src/types";
import { peelList, peelMaybe, peelResult } from "../src/set-algebra";

// The 20 Phase 2.5 targets — post-rename uppercase names.
const PHASE_2_5_TARGETS = new Set([
  "Messaging", "Payment", "AI", "Email",
  "TelegramLifecycle", "TelegramWebhooks", "TelegramMessages",
  "TelegramCallbacks", "TelegramMedia", "TelegramFiles",
  "TelegramChatAdmin", "TelegramBotConfig", "TelegramPayments",
  "TelegramInlineMode", "TelegramStickers", "TelegramPassport",
  "TelegramGames", "TelegramPolls", "TelegramForumTopics",
  "TelegramBusiness",
]);

function printFenelType(t: unknown): string {
  if (typeof t === "string") return t;
  if (!t || typeof t !== "object") return String(t);
  const obj = t as Record<string, unknown>;
  if ("$named" in obj) return obj.$named as string;
  if ("$var" in obj) return obj.$var as string;
  if ("$void" in obj) return "Void";
  if ("$unit" in obj) return "Unit";
  if ("$type" in obj) return "Type";
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
  const arrow: FenelType = {
    $arrow: { params: m.params, returns: m.returns },
  };
  return printFenelType(arrow);
}

function emitSpec(tc: Interface): string {
  const specName = `${tc.name}Spec`;
  const params = (tc.params ?? []).map(p => p.name).join(" ");
  const header = params.length > 0 ? `${specName} ${params}` : specName;
  const parts: string[] = [];
  for (const m of tc.methods) {
    // Convert dotted method names (e.g. "domain.add") to underscored field
    // names ("domain_add") — `.` is the field-access operator in Fenel, so
    // dotted record field names won't parse.
    const fieldName = m.name.replace(/\./g, "_");
    parts.push(`${fieldName}: ${methodFieldType(m)}`);
  }
  const body = `${specName}${parts.length > 0 ? " " + parts.join(" ") : ""}`;
  return `${header} = ${body}`;
}

const classes = dispatchRegistry.listClasses();
const emitted: { name: string; src: string; description?: string }[] = [];
const errors: { name: string; err: string }[] = [];

for (const tc of classes) {
  if (!PHASE_2_5_TARGETS.has(tc.name)) continue;
  try {
    const src = emitSpec(tc);
    emitted.push({
      name: `${tc.name}Spec`,
      src,
      description: typeof tc.description === "string" ? tc.description : undefined,
    });
  } catch (e) {
    errors.push({ name: `${tc.name}Spec`, err: String(e) });
  }
}

console.log(`-- ============================================================================`);
console.log(`-- Phase 2.5 of typeclass-substrate-completion — lowercase-renamed capability specs`);
console.log(`-- ============================================================================`);
console.log(`-- ${emitted.length} specs generated from TS Interface registry (post-rename)`);
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
console.log(`-- end Phase 2.5 auto-generated specs`);
console.log(`-- ============================================================================`);

if (errors.length > 0) {
  console.error(`\nERRORS: ${errors.length} specs could not be printed.`);
  process.exit(1);
}
