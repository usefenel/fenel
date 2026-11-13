// declaration-annotations Phase 1 — the fail-closed directive surface + the
// explicit entity gate. Brief:
// `workstreams/declaration-annotations/briefs/phase-1-fail-closed-and-entity-gate.md`.
//
// Four groups, one per part of the phase:
//   A.0  the POLICY MIRROR is a law-bound projection of the `.fenel` table
//   A.1  a directive dangling at EOF is REJECTED by both parsers, not dropped
//   A.2/A.3  unknown name / arity / placement / multiplicity are LOAD errors
//   B.3  the DISTINGUISHING probes — these fail against the old covert gate
//
// TS ledger: test/tooling category (an existing sanctioned exception).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./fenel-parser";
import {
  loadFenelModule,
  loadFenelModuleUnion,
  DIRECTIVE_POLICY,
  DirectivePolicyError,
  type DirectivePolicyRow,
} from "./fenel-module";
import {
  dispatchEngineBody,
  marshalParsedFrames,
} from "./engine-bodies-dispatch";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const POLICY_FENEL = join(ROOT, "fenel", "modules", "engine", "directive-policy.fenel");

// The Fenel-seam assertions drive the INTERPRETED parser (2–8s per case on a
// cold compiled artifact), and engine-harness boot is charged to whichever test
// touches it first. Same budget the sibling parser suites use.
const TO = 120000;

type Instance = { typeName: string; args: string[]; methods: Record<string, unknown> };
const instancesOf = (src: string, name = "test"): Instance[] =>
  (loadFenelModule(src, name).instances ?? []) as unknown as Instance[];
const find = (is: Instance[], typeName: string, arg0?: string) =>
  is.find((i) => i.typeName === typeName && (arg0 === undefined || i.args[0] === arg0));

// ===========================================================================
// A.0 — the mirror is a projection of the Fenel table, not freestanding TS.
// ===========================================================================
describe("A.0 — directive policy mirror ≡ directive-policy.fenel", () => {
  // Decode the `.fenel` table INDEPENDENTLY: walk the parsed value-decl body
  // and reject any node shape we do not expect, rather than reusing the
  // mirror's own coercion (which would make the test vacuous).
  const decodeRows = (): DirectivePolicyRow[] => {
    const src = readFileSync(POLICY_FENEL, "utf8");
    const ast = parse(src) as { program?: unknown[] };
    const decls = ast.program ?? [ast];
    const table = decls.find(
      (d): d is { def: { name: string; body: unknown } } =>
        typeof d === "object" && d !== null && "def" in d
        && (d as { def: { name: string } }).def.name === "directivePolicyTable",
    );
    expect(table, "directivePolicyTable definition not found").toBeDefined();
    const body = table!.def.body;
    expect(Array.isArray(body), "table body must be a list literal").toBe(true);

    // `Just 1` ⇒ {construct:["Just",1]}; `Nothing` ⇒ {construct:["Nothing"]}.
    const maybeNumber = (v: unknown): number | null => {
      expect(v).toHaveProperty("construct");
      const c = (v as { construct: unknown[] }).construct;
      if (c[0] === "Nothing") { expect(c).toHaveLength(1); return null; }
      expect(c[0]).toBe("Just");
      expect(c).toHaveLength(2);
      expect(typeof c[1]).toBe("number");
      return c[1] as number;
    };
    // A nullary constructor ⇒ {construct:["DmScalar"]}.
    const nullaryTag = (v: unknown, allowed: readonly string[]): string => {
      expect(v).toHaveProperty("construct");
      const c = (v as { construct: unknown[] }).construct;
      expect(c).toHaveLength(1);
      expect(allowed).toContain(c[0]);
      return c[0] as string;
    };

    return (body as unknown[]).map((row) => {
      expect(row).toHaveProperty("construct");
      const c = (row as { construct: unknown[] }).construct;
      expect(c[0]).toBe("DirectivePolicy");
      expect(c).toHaveLength(2);
      const f = c[1] as Record<string, unknown>;
      // Exactly the seven declared fields — no more, no less.
      expect(Object.keys(f).sort()).toEqual(
        ["context", "keyArity", "maxArgs", "minArgs", "multiplicity", "name", "stage"],
      );
      expect(typeof f.name).toBe("string");
      expect(typeof f.minArgs).toBe("number");
      expect(typeof f.keyArity).toBe("number");
      return {
        name: f.name as string,
        minArgs: f.minArgs as number,
        maxArgs: maybeNumber(f.maxArgs),
        multiplicity: nullaryTag(f.multiplicity, ["DmScalar", "DmAccumulating", "DmSelectorKeyed"]),
        keyArity: f.keyArity as number,
        context: nullaryTag(f.context, ["DcAnyDecl", "DcFunctionDecl", "DcTypeDecl"]),
        stage: nullaryTag(f.stage, ["DsLoad", "DsParse"]),
      } as DirectivePolicyRow;
    });
  };

  it("the TS mirror is deep-equal to the Fenel table, row for row and in order", () => {
    expect(decodeRows()).toEqual(DIRECTIVE_POLICY as DirectivePolicyRow[]);
  }, TO);

  it("names are unique and the table is non-trivial", () => {
    const names = DIRECTIVE_POLICY.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(19);
  });

  it("keyArity is non-zero exactly for the selector-keyed family", () => {
    for (const p of DIRECTIVE_POLICY) {
      expect(p.keyArity > 0).toBe(p.multiplicity === "DmSelectorKeyed");
      if (p.maxArgs !== null) expect(p.maxArgs).toBeGreaterThanOrEqual(p.minArgs);
      // A selector key cannot be wider than the arguments the directive takes.
      if (p.maxArgs !== null) expect(p.keyArity).toBeLessThanOrEqual(p.maxArgs);
    }
  });

  it("@discriminator is the ONLY parse-stage directive", () => {
    expect(DIRECTIVE_POLICY.filter((p) => p.stage === "DsParse").map((p) => p.name))
      .toEqual(["discriminator"]);
  });
});

// ===========================================================================
// A.1 — the EOF drop. Pinned at BOTH Fenel seams and in the TS perf branch.
// ===========================================================================
describe("A.1 — a directive dangling at EOF is rejected, never dropped", () => {
  // LAZY. Booting the engine harness during test COLLECTION races this file's
  // `fenel-module` import graph (the known regex-set-form init cycle the
  // parser-bootstrap artifact exists for). Resolve it on first use instead.
  let _table: unknown;
  const fixityTable = (): unknown =>
    (_table ??= dispatchEngineBody("engine:defaultFixityTable", []));
  const V = (t: string) => ({ t, v: "", ln: 0, col: 0 });
  const groupsOf = (src: string) =>
    dispatchEngineBody("engine:splitTopLevelDecls", [
      dispatchEngineBody("engine:layoutTokens", [dispatchEngineBody("engine:lexAll", [src])]),
    ]) as { headered: boolean; name: string; groups: unknown[][] };
  const elementsOf = (src: string): { frame: { kind: string; name?: string } }[] => {
    const out: { frame: { kind: string; name?: string } }[] = [];
    for (const g of groupsOf(src).groups) {
      const r = dispatchEngineBody("engine:parseProgToks", [
        fixityTable(), null, [V("vopen"), ...g, V("vclose"), V("eof")],
      ]) as { $tag: string; _0?: unknown[] };
      expect(r.$tag, "group failed to parse").toBe("Just");
      for (const e of r._0!) out.push(e as { frame: { kind: string } });
    }
    return out;
  };
  const marshals = (src: string): boolean => {
    try {
      marshalParsedFrames(
        dispatchEngineBody("engine:programToFrames", [elementsOf(src)]) as unknown[],
      );
      return true;
    } catch { return false; }
  };

  const DANGLING: [string, string, string][] = [
    ["one trailing directive", 'foo : Number\nfoo = 1\n\n@label "D"\n', "label"],
    ["several trailing directives", 'foo = 1\n@label "D1"\n@description "D2"\n', "label"],
    ["a directive-only file", '@label "Alone"\n', "label"],
    ["a headered file's trailing directive", 'module engine where\nfoo = 1\n@tags "x"\n', "tags"],
    ["a comment after the dangling run", 'foo = 1\n@icon "i"\n-- trailing prose\n', "icon"],
  ];

  it.each(DANGLING)("Fenel seams emit a named `dangling` frame: %s", (_name, src, first) => {
    // groupDeclsGo (parse-file.fenel) no longer drops the pending run, and
    // buildDeclsGo (decl-grammar.fenel) turns it into a named dangling frame.
    const frames = elementsOf(src);
    const dangling = frames.filter((f) => f.frame.kind === "dangling");
    expect(dangling).toHaveLength(1);
    expect(dangling[0]!.frame.name).toBe(first);
  }, TO);

  it.each(DANGLING)("the loader marshal REJECTS it: %s", (_name, src) => {
    expect(marshals(src)).toBe(false);
  }, TO);

  it.each(DANGLING)("the TS perf-branch parser throws, naming directive + line: %s", (_n, src, first) => {
    expect(() => parse(src)).toThrowError(new RegExp(`@${first} has no declaration to annotate`));
  });

  const VALID: [string, string][] = [
    ["a plain sig + def", "foo : Number\nfoo = 1\n"],
    ["a directive-carrying decl", '@label "L"\nfoo : Number\nfoo = 1\n'],
    ["a headered module", 'module engine where\n@label "L"\nfoo : Number\nfoo = 1\n'],
    ["a type decl with directives", '@entity\n@label "C"\nColor = Red | Green\n'],
  ];

  it.each(VALID)("VALID programs are untouched — no dangling frame: %s", (_name, src) => {
    // The empty-accumulator guards are what keep every valid file byte-identical;
    // without them each parse would gain a spurious trailing frame/group.
    expect(elementsOf(src).some((f) => f.frame.kind === "dangling")).toBe(false);
    expect(marshals(src)).toBe(true);
    expect(() => parse(src)).not.toThrow();
  }, TO);

  it("END-TO-END: loadFenelModule itself rejects a dangling directive", () => {
    // The seam assertions above test the pieces; this pins the CONTRACT the rest
    // of the system depends on. Mode-independent: on the default path the Fenel
    // parser rejects, `parseViaFenelParser` returns PARSE_VIA_FENEL_FAIL, and
    // `parsedViaCache` falls back to the TS parser, which throws the named error.
    // Under FENEL_PARSER_LEGACY=1 the TS parser throws it directly.
    expect(() => loadFenelModule('foo = 1\n@label "D"\n', "test"))
      .toThrowError(/@label has no declaration to annotate/);
  }, TO);

  it("splitTopLevelDecls emits no empty trailing group for a valid file", () => {
    for (const [, src] of VALID) {
      for (const g of groupsOf(src).groups) expect(g.length).toBeGreaterThan(0);
    }
  }, TO);
});

// ===========================================================================
// A.2 / A.3 — the load gate.
// ===========================================================================
describe("A.2/A.3 — the fail-closed load gate", () => {
  const rejects = (src: string, match: RegExp) => {
    expect(() => loadFenelModule(src, "test")).toThrowError(DirectivePolicyError);
    expect(() => loadFenelModule(src, "test")).toThrowError(match);
  };

  it("rejects an unknown directive name and names the known set", () => {
    rejects('@lable "typo"\nfoo : Number\nfoo = 1\n', /@lable is not a known directive/);
    rejects('@lable "typo"\nfoo : Number\nfoo = 1\n', /Known directives: category, codeName/);
  });

  it("rejects @deprecated — the name the old surface silently reserved", () => {
    rejects('@deprecated "x"\nfoo : Number\nfoo = 1\n', /@deprecated is not a known directive/);
  });

  it("rejects an out-of-schema argument count", () => {
    rejects('@label "A" "B"\nfoo : Number\nfoo = 1\n', /@label takes at most 1 argument/);
    rejects('@native "x"\nfoo : Number\n', /@native takes at most 0 argument/);
    rejects('@fieldLabel "a"\n@entity\nC = C { a: Number }\n', /@fieldLabel takes at least 2 argument/);
  });

  it("rejects a directive on the wrong declaration kind", () => {
    rejects('@requires "HasStateIO"\nColor = Red | Green\n', /@requires may not be placed on a type declaration/);
    rejects('@discriminator "k"\nfoo : Number\nfoo = 1\n', /@discriminator may not be placed on a function declaration/);
    rejects("@entity\nfoo : Number\nfoo = 1\n", /@entity may not be placed on a function declaration/);
  });

  it("rejects a duplicate SCALAR — including across a signature and its definition", () => {
    rejects('@label "A"\n@label "B"\nfoo : Number\nfoo = 1\n', /@label is declared 2 times/);
    rejects('@label "A"\nfoo : Number\n@label "B"\nfoo = 1\n', /@label is declared 2 times/);
    // A comment between the two is exactly how both live defects hid.
    rejects('@label "A"\n-- prose\n@label "B"\nfoo = 1\n', /@label is declared 2 times/);
  });

  it("ACCEPTS a selector-keyed repeat, rejects a duplicate selector key", () => {
    const is = instancesOf(
      '@entity\n@fieldLabel "a" "A"\n@fieldLabel "b" "B"\nC = C { a: Number, b: Number }\n',
    );
    expect(find(is, "Codeable", "C")).toBeDefined();
    rejects(
      '@entity\n@fieldLabel "a" "A"\n@fieldLabel "a" "B"\nC = C { a: Number }\n',
      /@fieldLabel "a" is declared more than once/,
    );
  });

  it("ACCUMULATES @tags across occurrences instead of keeping only the first", () => {
    const is = instancesOf('@tags "a" "b"\n@tags "c"\nfoo : Number\nfoo = 1\n');
    expect(find(is, "Taggable")!.methods.tags).toEqual(["a", "b", "c"]);
  });

  it("rejects @discriminator on a refined / alias type decl (the TS parser's own rule)", () => {
    // Rejected either way, but by DIFFERENT layers: the TS perf branch throws a
    // ParseError before the loader ever sees the AST, while the Fenel emitter
    // happily lifts it — so the load gate is what makes the Fenel path agree.
    // Assert the rejection, not which layer produced it.
    expect(() =>
      loadFenelModule('@entity\n@discriminator "type"\nEmail = String | isValidEmail\n', "test"),
    ).toThrowError(/@discriminator applies only to variant-form/);
  });

  it("accepts @discriminator on a variant type decl", () => {
    expect(() =>
      loadFenelModule('@discriminator "type"\nBlock = Form ref: String\n', "test"),
    ).not.toThrow();
  });

  it("rejects @native on a signature that also has a definition", () => {
    rejects("@native\nfoo : Number\nfoo = 1\n", /also has a Fenel definition/);
  });

  it("rejects a directive-carrying orphan signature (the loader would drop it whole)", () => {
    rejects('@label "A"\nfoo : Number\n', /has no definition and no @native/);
  });

  it("accepts the valid baseline unchanged", () => {
    const is = instancesOf('@label "A"\n@description "d"\n@tags "x"\nfoo : Number\nfoo = 1\n');
    expect(find(is, "Labelable")!.methods.label).toBe("A");
    expect(find(is, "Describable")!.methods.description).toBe("d");
    expect(find(is, "Taggable")!.methods.tags).toEqual(["x"]);
  });

  // NOTE: aggregation is the POLICY GATE's contract. The two site-local checks
  // (dispatch-instance directives, below, and the union-boundary codeName
  // collision) throw on first occurrence — they run outside `validateDirectives`
  // because their inputs are not known until later.
  it("reports EVERY policy-gate violation in one error, not just the first", () => {
    try {
      loadFenelModule('@lable "x"\n@label "A"\n@label "B"\nfoo = 1\n', "test");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/@lable is not a known directive/);
      expect((e as Error).message).toMatch(/@label is declared 2 times/);
    }
  });
});

// ===========================================================================
// B.3 — DISTINGUISHING probes. Each of these FAILS against the old covert
// gate (`ds.some(d => ENTITY_IDENTITY_FACETS.has(d.name))`), which is what
// makes them evidence that the flip actually happened. A parity snapshot
// alone cannot prove that: adding `@entity` everywhere while leaving the old
// predicate live produces the same empty diff.
// ===========================================================================
describe("B.3 — the explicit entity gate", () => {
  it("@entity ALONE emits Codeable — the old gate emitted none (no identity facet present)", () => {
    const is = instancesOf("@entity\nColor = Red | Green\n");
    expect(find(is, "Codeable", "Color")).toBeDefined();
    expect(find(is, "Codeable", "Color")!.methods).toEqual({ codeName: "Color" });
  });

  it("an identity facet WITHOUT @entity lifts the facet but emits NO Codeable — the old gate emitted one", () => {
    const is = instancesOf('@label "Colour"\nColor = Red | Green\n');
    expect(find(is, "Labelable", "Color")!.methods.label).toBe("Colour");
    expect(find(is, "Codeable", "Color")).toBeUndefined();
  });

  it("@entity + facets preserves every facet projection", () => {
    const is = instancesOf(
      '@entity\n@codeName "colour"\n@label "Colour"\n@description "d"\n'
      + '@tags "t1" "t2"\n@category "c"\n@icon "i"\n@emoji "e"\nColor = Red | Green\n',
    );
    expect(find(is, "Codeable", "colour")!.methods).toEqual({ codeName: "colour" });
    expect(find(is, "Labelable", "colour")!.methods.label).toBe("Colour");
    expect(find(is, "Describable", "colour")!.methods.description).toBe("d");
    expect(find(is, "Taggable", "colour")!.methods.tags).toEqual(["t1", "t2"]);
    expect(find(is, "Categorizable", "colour")!.methods.category).toBe("c");
    expect(find(is, "Iconable", "colour")!.methods.icon).toBe("i");
    expect(find(is, "Emojiable", "colour")!.methods.emoji).toBe("e");
  });

  it("@discriminator alone stays identity-inert", () => {
    const is = instancesOf('@discriminator "type"\nBlock = Form ref: String\n');
    expect(find(is, "Codeable", "Block")).toBeUndefined();
    expect(find(is, "Labelable", "Block")).toBeUndefined();
  });

  it("a directive-less type decl stays inert, and registration is UNCONDITIONAL either way", () => {
    // The gate never controlled `entities.push` — that is the correction the
    // brief's B.0 makes to the design doc. Every type decl registers; only the
    // identity signal is gated.
    for (const src of ["Color = Red | Green\n", "@entity\nColor = Red | Green\n"]) {
      const mod = loadFenelModule(src, "test");
      expect((mod.entities ?? []).map((e) => e.id)).toEqual(["Color"]);
    }
    expect(find(instancesOf("Color = Red | Green\n"), "Codeable", "Color")).toBeUndefined();
  });

  it("@valueLabel keys off the EFFECTIVE codeName under the explicit marker", () => {
    const is = instancesOf(
      '@entity\n@codeName "kind"\n@valueLabel "group" "Group / Organization"\n'
      + "Kind = String | isKind\n",
    );
    expect(find(is, "Labelable", "kind.group")!.methods.label).toBe("Group / Organization");
  });

  it("an unmarked sibling gets no Codeable of its own", () => {
    const is = instancesOf("@entity\nMarked = A | B\nUnmarked = C | D\n");
    expect(find(is, "Codeable", "Marked")).toBeDefined();
    expect(find(is, "Codeable", "Unmarked")).toBeUndefined();
  });

  it("rejects an effective-codeName COLLISION between two type decls", () => {
    // Promotion (`hasLiftedCodeable`, system-entities.ts) matches a codeName
    // STRING globally rather than carrying declaration ownership. So if a marked
    // declaration's `@codeName` collides with an unmarked declaration's name,
    // the marked one's Codeable can promote the UNMARKED one (it comes first in
    // `foundationEntityRegs`), and the marked one is then skipped as already
    // registered. Rejecting the collision removes the single-source case.
    // NOTE the victim carries NO directives, which is why the check is driven by
    // the type-decl roster and not by the directive sites.
    expect(() =>
      loadFenelModule('Unmarked = U\n\n@entity\n@codeName "Unmarked"\nMarked = M\n', "test"),
    ).toThrowError(/all register under the effective codeName "Unmarked"/);
  });

  it("rejects an effective-codeName collision ACROSS files of one module", () => {
    // Same invariant as above, at the cross-file union boundary. `ent.id` differs
    // (`Unmarked` vs `Marked`) so the pre-existing duplicate-id check does not
    // fire; the effective REGISTRATION id is what collides, and that is the id
    // promotion matches on.
    expect(() =>
      loadFenelModuleUnion([
        { name: "a.fenel", src: "module m where\nUnmarked = U\n" },
        { name: "b.fenel", src: 'module m where\n@entity\n@codeName "Unmarked"\nMarked = M\n' },
      ]),
    ).toThrowError(/registers under the effective codeName "Unmarked"/);
  }, TO);

  it("ACCEPTS a raw-id/effective-id crossover across files — the two namespaces are independent", () => {
    // `Original` registers as "Alias"; a sibling declaration is literally NAMED
    // `Alias` and registers as "Other". Raw ids {Original, Alias} are unique and
    // effective ids {Alias, Other} are unique, so this is legal. Folding both
    // into one map rejected it — and order-DEPENDENTLY: a raw-duplicate error in
    // one file order, an effective-collision error in the other. Both orders.
    const a = { name: "a.fenel", src: 'module m where\n@entity\n@codeName "Alias"\nOriginal = O\n' };
    const b = { name: "b.fenel", src: 'module m where\n@entity\n@codeName "Other"\nAlias = A\n' };
    expect(() => loadFenelModuleUnion([a, b])).not.toThrow();
    expect(() => loadFenelModuleUnion([b, a])).not.toThrow();
  }, TO);

  it("rejects directives on a dispatch instance (they would be silently discarded)", () => {
    // An instance-file value is indexed by TYPE and gets no by-name identity, so
    // the loader's early `continue` skips every directive consumer. The policy
    // gate cannot catch this — dispatch-instance-ness is only known after
    // `deriveTypedValueDecl` — so the check lives at that site.
    const src = '@label "Silently lost"\nsomeInstance : Labelable Foo\n'
      + 'someInstance = Labelable { label = "x" }\n';
    expect(() => loadFenelModule(src, "test", { dispatchInstanceFile: true }))
      .toThrowError(/on a dispatch instance/);
    // …and the SAME source outside an instance file is fine (it is an ordinary
    // typed value-decl with by-name identity).
    expect(() => loadFenelModule(src, "test")).not.toThrow();
  });
});
