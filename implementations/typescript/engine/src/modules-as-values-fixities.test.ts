// modules-as-values Phase 2e — operator fixities name their function by
// reference. brief: `workstreams/modules-as-values/briefs/phase-2e-fixities-as-references.md`.
//
// `fenel/std/parser-fixities.fenel` writes each fixity as an unnamed instance
// whose type parameter is the function itself (`_ : Infixable std.add`), not a
// colon-id string literal. The instance stores the handle as written; readers
// compare by the RESOLVED function id, never by the raw string. A `Upper.lower`
// handle (`Monad.bind`) names a class method and never reaches `getFunction`
// (which would resolve it to `algebra:maybeBind` through the capability-method
// fallback).
//
// (A) projection shape, (B) handle ⇔ parser call name agree on the resolved id,
// (C) drift between the instances and the two hardcoded Fenel tables
// (`defaultFixityTable`, `ppInfixOf`/`ppPrefixOf`), (D) the authoring session
// catalog still offers the std operators.

import { describe, expect, it } from "bun:test";
import parserFixitiesSrc from "../../../../fenel/std/parser-fixities.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { parse } from "./fenel-parser";
import {
  PARSE_VIA_FENEL_FAIL,
  dispatchEngineBody,
  dispatchedGetCodeName,
  parseViaFenelParser,
  print,
} from "./engine-bodies-dispatch";
import { PRINTER_EXCLUDED_NOTATIONS } from "./parser-fixities";
import { WORD_INFIX } from "./parser-keywords";
import { dispatchRegistry } from "./system-entities";
import { getSystemRegistry } from "./system-registry";
import { createAccountFieldRegistry } from "./account-field-registry";
import { modulesFor } from "./module-manifest";
import { GLOBAL_ONLY, instanceVisible } from "./dispatch-registry";
import { getCatalog } from "./type-catalog";
import { canonical } from "./locale";
import { buildAuthoringCatalogSnapshot } from "./authoring/environment";
import type { Instance } from "./types";

const projected: Instance[] = loadFenelModule(parserFixitiesSrc, "std", {
  dispatchInstanceFile: true,
}).instances ?? [];
const infixables = projected.filter((i) => i.typeName === "Infixable");
const prefixables = projected.filter((i) => i.typeName === "Prefixable");
const codeables = projected.filter((i) => i.typeName === "Codeable");

const handleOf = (inst: Instance): string => inst.args[0] as string;
const notationOf = (inst: Instance): string => inst.methods?.notation as string;
/** `Class.method` — the qualified-method shape the parser lowers to `{method}`. */
const isMethodHandle = (h: string): boolean => /^[A-Z][A-Za-z0-9_]*\.[a-z_][A-Za-z0-9_]*$/.test(h);
/** The member name of a lowercase handle — its last `.`- or `:`-separated segment. */
const memberName = (h: string): string => h.split(/[.:]/).pop()!;
const STRUCTURAL_NOTATIONS = new Set(["$", "|>", "&", "in", "."]);
/** A notation the lexer reads as an operator: symbolic, or a curated word operator. */
const lexesAsOperator = (notation: string): boolean =>
  !/^[A-Za-z_]/.test(notation) || WORD_INFIX.has(notation);

describe("(A) the fixity file projects dotted function handles", () => {
  it("18 Infixable, 2 Prefixable and 3 Codeable instances, each argued by a dotted handle", () => {
    expect(infixables.length).toBe(18);
    expect(prefixables.length).toBe(2);
    expect(codeables.length).toBe(3);
    for (const inst of [...infixables, ...prefixables, ...codeables]) {
      expect(inst.args.length).toBe(1);
      expect(handleOf(inst)).toMatch(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });

  it("pins each notation to its handle, in source order", () => {
    expect(infixables.map((i) => [notationOf(i), handleOf(i)])).toEqual([
      ["+", "std.add"], ["-", "std.sub"], ["*", "std.mul"], ["/", "std.div"],
      ["%", "std.mod"], ["cat", "std.concat"], ["==", "std.eq"], ["!=", "std.neq"],
      ["<", "std.lt"], [">", "std.gt"], ["<=", "std.lte"], [">=", "std.gte"],
      ["and", "std.and"], ["or", "std.or"], ["&&", "std.and"], ["||", "std.or"],
      [">>=", "Monad.bind"], ["<>", "Monoid.mappend"],
    ]);
    expect(prefixables.map((i) => [notationOf(i), handleOf(i)])).toEqual([
      ["not", "std.not"], ["-", "std.negate"],
    ]);
    expect(codeables.map(handleOf)).toEqual(["std.and", "std.or", "std.not"]);
  });
});

describe("(B) a handle and the parser's call name resolve to the same function", () => {
  const registry = getSystemRegistry();

  /** The call name the parser emits for an operator — read off the AST. */
  const infixCallName = (notation: string): unknown => {
    const ast = parse(`(${notation})`) as { fn?: unknown[] };
    const body = ast.fn?.[2] as { call?: unknown[]; method?: unknown[] } | undefined;
    if (body?.call) return body.call[0];
    if (body?.method) return `${body.method[0]}.${body.method[1]}`;
    return undefined;
  };
  const prefixCallName = (notation: string): unknown =>
    (parse(notation === "not" ? "not x" : `${notation}x`) as { call?: unknown[] }).call?.[0];

  it("every lowercase handle's member name is the parser's call name, and both resolve to one function id", () => {
    // `cat` is the JSON-Logic op spelling: the lexer reads it as an identifier,
    // so no source text reaches its fixity row; its member name stands in.
    const rows: Array<[string, unknown]> = [
      ...infixables.map((i) => [
        handleOf(i),
        notationOf(i) === "cat" ? memberName(handleOf(i)) : infixCallName(notationOf(i)),
      ] as [string, unknown]),
      ...prefixables.map((i) => [handleOf(i), prefixCallName(notationOf(i))] as [string, unknown]),
    ];
    const lowercase = rows.filter(([h]) => !isMethodHandle(h));
    expect(new Set(lowercase.map(([h]) => h)).size).toBe(16);
    for (const [handle, callName] of lowercase) {
      expect({ handle, callName }).toEqual({ handle, callName: memberName(handle) });
      const viaHandle = registry.getFunction(handle)?.id;
      expect(viaHandle).toBeDefined();
      expect({ handle, id: registry.getFunction(callName as string)?.id }).toEqual({ handle, id: viaHandle });
    }
  });

  it("each localized Codeable's handle resolves to the function its `en` spelling names", () => {
    for (const inst of codeables) {
      const en = (inst.methods?.codeName as { en?: string }).en!;
      const viaHandle = registry.getFunction(handleOf(inst))?.id;
      expect(viaHandle).toBeDefined();
      expect(registry.getFunction(en)?.id).toBe(viaHandle);
    }
  });

  it("every `Upper.lower` handle parses to `{method}` on a class that declares that method", () => {
    const methodOps = infixables.filter((i) => isMethodHandle(handleOf(i)));
    expect(methodOps.map(handleOf)).toEqual(["Monad.bind", "Monoid.mappend"]);
    for (const inst of methodOps) {
      const [cls, method] = handleOf(inst).split(".") as [string, string];
      expect(parse(`a ${notationOf(inst)} b`)).toEqual({
        method: [cls, method, { var: "a" }, { var: "b" }],
      });
      const declared = dispatchRegistry.getClass(cls)?.methods?.map((m) => m.name) ?? [];
      expect(declared).toContain(method);
    }
  });
});

describe("(C) drift — the hardcoded Fenel tables agree with the instances", () => {
  const ASSOC: Record<string, string> = { left: "l", right: "r", none: "n" };
  const callNameOf = (h: string): string => (isMethodHandle(h) ? h : memberName(h));

  it("defaultFixityTable carries exactly the Infixable rows (name, precedence, associativity)", () => {
    const table = dispatchEngineBody("engine:defaultFixityTable", []) as Array<Record<string, unknown>>;
    const operatorRows = table.filter((row) => !STRUCTURAL_NOTATIONS.has(row.notation as string));
    const expected: Array<Record<string, unknown>> = infixables.map((i) => ({
      notation: notationOf(i),
      fnId: callNameOf(handleOf(i)),
      prec: i.methods?.precedence,
      assoc: ASSOC[i.methods?.associativity as string],
    }));
    expect(operatorRows).toEqual(expected);
  }, 300_000);

  it("the printer's ppInfixOf/ppPrefixOf agree, and each canonical operator prints as an operator", () => {
    const canonicalInfix = infixables.filter((i) => !PRINTER_EXCLUDED_NOTATIONS.has(notationOf(i)));
    expect(canonicalInfix.length).toBe(14);
    // Only a notation that LEXES as an operator may print infix: a symbolic
    // notation, or a curated word operator (WORD_INFIX). `cat` (std.concat's
    // JSON-Logic op spelling) lexes as an identifier, so `a cat b` would read
    // back as the application of `a`: the printer has no row for it and prints
    // the application `concat a b`.
    const printable = canonicalInfix.filter((i) => lexesAsOperator(notationOf(i)));
    expect(canonicalInfix.filter((i) => !printable.includes(i)).map(notationOf)).toEqual(["cat"]);
    for (const inst of canonicalInfix) {
      const name = callNameOf(handleOf(inst));
      const isPrintable = printable.includes(inst);
      expect({ name, row: dispatchEngineBody("engine:ppInfixOf", [name]) }).toEqual({
        name,
        row: isPrintable
          ? {
            $tag: "Just",
            _0: {
              notation: notationOf(inst),
              prec: inst.methods?.precedence,
              assoc: inst.methods?.associativity,
            },
          }
          : { $tag: "Nothing" },
      });
      const printed = print({ call: [name, { var: "a" }, { var: "b" }] });
      expect(printed).toBe(isPrintable ? `a ${notationOf(inst)} b` : `${name} a b`);
      // The printed text must read back as the same operator: a call of
      // `name`, or (`and`/`or`, short-circuit) its structural key.
      const reparsed = parse(printed) as Record<string, unknown>;
      const head = Array.isArray(reparsed.call) ? reparsed.call[0] : Object.keys(reparsed)[0];
      expect({ name, readsBack: head === name }).toEqual({ name, readsBack: true });
    }
    for (const inst of prefixables) {
      const name = callNameOf(handleOf(inst));
      expect({ name, row: dispatchEngineBody("engine:ppPrefixOf", [name]) }).toEqual({
        name,
        row: { $tag: "Just", _0: { notation: notationOf(inst), prec: inst.methods?.precedence } },
      });
      const spaced = /^[a-z]/.test(notationOf(inst)) ? " " : "";
      expect(print({ call: [name, { var: "x" }] })).toBe(`${notationOf(inst)}${spaced}x`);
    }
  }, 300_000);
});

describe("(E) every printer table row round-trips through BOTH parsers", () => {
  type Ir = unknown;
  const a = { var: "a" };
  const b = { var: "b" };
  const x = { var: "x" };
  const call = (name: string, ...args: Ir[]): Ir => ({ call: [name, ...args] });
  const canonicalInfix = infixables.filter((i) => !PRINTER_EXCLUDED_NOTATIONS.has(notationOf(i)));
  const infixNames = canonicalInfix.map((i) => memberName(handleOf(i)));
  const prefixNames = prefixables.map((i) => memberName(handleOf(i)));
  // One representative per precedence level (the first canonical row at it),
  // for the mixed-precedence variants.
  const levelReps: string[] = [];
  const seenLevels = new Set<unknown>();
  for (const inst of canonicalInfix) {
    if (seenLevels.has(inst.methods?.precedence)) continue;
    seenLevels.add(inst.methods?.precedence);
    levelReps.push(memberName(handleOf(inst)));
  }

  // `grammar`: also read by the Fenel grammar (every row flat, and nested in
  // both directions under itself).
  const samples: Array<{ label: string; ir: Ir; grammar?: true }> = [];
  for (const n of infixNames) {
    samples.push({ label: `${n} a b`, ir: call(n, a, b), grammar: true });
    samples.push({ label: `${n} (${n} a b) x`, ir: call(n, call(n, a, b), x), grammar: true });
    samples.push({ label: `${n} a (${n} b x)`, ir: call(n, a, call(n, b, x)), grammar: true });
  }
  for (const p of prefixNames) {
    samples.push({ label: `${p} x`, ir: call(p, x), grammar: true });
    samples.push({ label: `${p} (${p} x)`, ir: call(p, call(p, x)) });
    for (const n of levelReps) {
      samples.push({ label: `${p} (${n} a b)`, ir: call(p, call(n, a, b)) });
      samples.push({ label: `${n} (${p} a) b`, ir: call(n, call(p, a), b) });
      samples.push({ label: `${n} a (${p} b)`, ir: call(n, a, call(p, b)) });
    }
  }
  for (const outer of levelReps) {
    for (const inner of levelReps) {
      if (outer === inner) continue;
      samples.push({ label: `${outer} (${inner} a b) x`, ir: call(outer, call(inner, a, b), x) });
      samples.push({ label: `${outer} a (${inner} b x)`, ir: call(outer, a, call(inner, b, x)) });
    }
  }
  // A prefix call as an application argument: both parsers read `f not a` as
  // three arguments and `f -a` as a subtraction.
  for (const p of prefixNames) {
    samples.push({ label: `f (${p} a)`, ir: call("f", call(p, a)), grammar: true });
    samples.push({ label: `f a (${p} b)`, ir: call("f", a, call(p, b)), grammar: true });
  }
  // Negative numeric literals have no literal spelling: the parsers read `-1`
  // as `negate 1`. `f -1` reads back as a subtraction and `--1` lexes as a
  // comment, so argument and prefix positions need parentheses.
  const negatives: Array<{ label: string; ir: Ir }> = [
    { label: "f -1", ir: call("f", -1) },
    { label: "f a -2.5", ir: call("f", a, -2.5) },
    { label: "negate -1", ir: call("negate", -1) },
    { label: "not -1", ir: call("not", -1) },
    { label: "negate (negate -1)", ir: call("negate", call("negate", -1)) },
    { label: "f (negate -1)", ir: call("f", call("negate", -1)) },
    { label: "sub a -1", ir: call("sub", a, -1) },
    { label: "sub -1 a", ir: call("sub", -1, a) },
    { label: "-1 alone", ir: -1 },
    { label: "[-1, a]", ir: [-1, a] },
  ];
  for (const n of levelReps) {
    negatives.push({ label: `${n} -1 b`, ir: call(n, -1, b) });
    negatives.push({ label: `${n} a -1`, ir: call(n, a, -1) });
  }
  for (const sample of negatives) samples.push({ ...sample, grammar: true });

  /** The IR a reader produces for a negative literal: `negate` of its magnitude. */
  const canonicalNegatives = (ir: Ir): Ir => {
    if (typeof ir === "number") return ir < 0 ? call("negate", -ir) : ir;
    if (Array.isArray(ir)) return ir.map(canonicalNegatives);
    if (ir !== null && typeof ir === "object") {
      return Object.fromEntries(Object.entries(ir).map(([k, v]) => [k, canonicalNegatives(v)]));
    }
    return ir;
  };

  // The Fenel grammar reads the `grammar` subset: while the compiled parser is
  // stale the grammar runs interpreted, at seconds per definition.
  const grammarSamples = samples.filter((s) => s.grammar === true);
  const printedSamples = (from: typeof samples) =>
    from.map((s, index) => ({ ...s, name: `r${index}`, printed: print(s.ir) }));
  const moduleOf = (rows: Array<{ name: string; printed: string }>): string =>
    `module PrinterRoundTrip where\n\n${rows.map((r) => `${r.name} a b x = ${r.printed}`).join("\n\n")}\n`;
  const bodiesOf = (tree: unknown): Map<string, unknown> => {
    const frames = (tree as { program?: Array<{ def?: { name: string; body: unknown } }> }).program ?? [];
    const out = new Map<string, unknown>();
    for (const frame of frames) if (frame.def) out.set(frame.def.name, frame.def.body);
    return out;
  };
  const bodyOf = (body: unknown): unknown => {
    // A parameterised definition's body may be wrapped as `{fn:[params, …, body]}`.
    const fn = (body as { fn?: unknown[] } | null)?.fn;
    return Array.isArray(fn) ? fn[fn.length - 1] : body;
  };

  it("the TypeScript parser reads every printed row back to the same IR", () => {
    const rows = printedSamples(samples);
    const bodies = bodiesOf(parse(moduleOf(rows)));
    for (const row of rows) {
      expect({ label: row.label, printed: row.printed, ir: canonicalNegatives(bodyOf(bodies.get(row.name))) })
        .toEqual({ label: row.label, printed: row.printed, ir: canonicalNegatives(row.ir) });
    }
  }, 300_000);

  it("the Fenel grammar reads every printed row back to the same IR", () => {
    const rows = printedSamples(grammarSamples);
    expect(rows.length).toBe(3 * infixNames.length + 3 * prefixNames.length + negatives.length);
    const tree = parseViaFenelParser(moduleOf(rows));
    expect(tree).not.toBe(PARSE_VIA_FENEL_FAIL);
    const bodies = bodiesOf(tree);
    for (const row of rows) {
      expect({ label: row.label, printed: row.printed, ir: canonicalNegatives(bodyOf(bodies.get(row.name))) })
        .toEqual({ label: row.label, printed: row.printed, ir: canonicalNegatives(row.ir) });
    }
  }, 900_000);
});

describe("(D) the authoring session catalog keeps the std operators", () => {
  it("offers op:+ targeting std:add, and no operator targets algebra:maybeBind", () => {
    // An account session registry (the editor's), and the operator wiring of the
    // distro's `buildSessionCatalog`.
    const registry = createAccountFieldRegistry(modulesFor("seed"), "fixities-2e-test", {
      owners: [], fields: [], facets: [],
    });
    const snapshot = buildAuthoringCatalogSnapshot(getCatalog(registry), {
      registry,
      codeNameFor: (id) => {
        const declared = dispatchedGetCodeName(id);
        return declared ? canonical(declared) : undefined;
      },
      operatorInstances: [
        ...dispatchRegistry.listInstances("Infixable")
          .filter((instance) => instanceVisible(instance, GLOBAL_ONLY))
          .map((instance) => ({ ...instance, fixity: "infix" as const })),
        ...dispatchRegistry.listInstances("Prefixable")
          .filter((instance) => instanceVisible(instance, GLOBAL_ONLY))
          .map((instance) => ({ ...instance, fixity: "prefix" as const })),
      ],
      capabilityMethodOwners: "all",
    });
    const operators = snapshot.functions.filter((entry) => entry.notation !== undefined);
    const plus = operators.find((entry) => entry.id === "op:+");
    expect(plus?.targetId).toBe("std:add");
    expect(plus?.codeName).toBe("add");
    expect(snapshot.operatorCodeNameByNotation.get("+")).toBe("add");
    expect(operators.map((entry) => [entry.notation, entry.targetId]).sort()).toEqual([
      ["!=", "std:neq"], ["%", "std:mod"], ["*", "std:mul"], ["+", "std:add"],
      ["-", "std:negate"], ["-", "std:sub"], ["/", "std:div"], ["<", "std:lt"],
      ["<=", "std:lte"], ["==", "std:eq"], [">", "std:gt"], [">=", "std:gte"],
      ["and", "std:and"], ["cat", "std:concat"], ["not", "std:not"], ["or", "std:or"],
    ].sort());
    expect(operators.some((entry) => entry.targetId === "algebra:maybeBind")).toBe(false);
  }, 600_000);
});
