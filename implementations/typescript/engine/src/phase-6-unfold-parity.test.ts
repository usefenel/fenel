// ---------------------------------------------------------------------------
// containment-substrate Phase 6 — unfold / substituteVar parity oracle.
//
// The legacy `set-algebra.ts:unfold` / `substituteVar` stay a ledgered
// PERFORMANCE BRANCH (the live `structural.ts:unfold` consumer is on the
// structural-dispatch / derive hot path — interpreted-Fenel measured ~68×
// slower, so making it live would regress; the `fenel-parser.ts` precedent).
// The `.fenel` `engine:substituteVar` body (type-algebra.fenel) is the SOURCE
// OF TRUTH. This oracle gates the two against each other byte-for-byte over a
// corpus exercising every former substituteVar recurses + metadata preservation
// + shadowing + the bottom `μX.X` — the differential sweep the brief mandates.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import type { FenelType } from "./types";
import { unfold } from "./set-algebra";
import { dispatchedUnfold } from "./engine-bodies-dispatch";

const N = { $tag: "Nothing" } as const;
const J = (v: unknown) => ({ $tag: "Just", _0: v });
// The oracle crosses the admitted traversal boundary. Draft/unkeyed syntax
// has a separate reader-preview test and is not field-admission evidence.
const fieldIds = new Map<string, string>();
const fld = (name: string, type: FenelType, extra: Record<string, unknown> = {}) => {
  let identity = fieldIds.get(name);
  if (!identity) {
    identity = `c1000000-0000-4000-8000-${String(fieldIds.size + 1).padStart(12, "0")}`;
    fieldIds.set(name, identity);
  }
  return { name, key: { $tag: "NamedField" as const, ref: { $ref: identity } }, label: N, type, meta: {}, ui: N, ...extra };
};

type MuType = { $mu: { var: string; body: FenelType } };

// A corpus of μ-types covering every former `substituteVar` walks, plus the
// metadata-preservation, `$mu`-shadowing, and bottom-`μX.X` edge cases.
const CORPUS: { label: string; mu: MuType }[] = [
  {
    label: "List μ (variant Nil | Cons{head,tail:X})",
    mu: {
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Nil", label: N, fields: [] },
              { name: "Cons", label: N, fields: [fld("head", { $ref: "a" }), fld("tail", { $var: "X" })] },
            ],
          },
        } as FenelType,
      },
    },
  },
  {
    label: "record μ (self:X, n:Int)",
    mu: { $mu: { var: "X", body: { $record: { fields: [fld("self", { $var: "X" }), fld("n", { $ref: "Int" })] } } as FenelType } },
  },
  {
    label: "tuple μ (X, Str)",
    mu: { $mu: { var: "X", body: { $tuple: [{ $var: "X" }, { $ref: "Str" }] } as FenelType } },
  },
  {
    label: "map μ (keys ⊤, values X)",
    mu: { $mu: { var: "X", body: { $map: { keys: { $tag: "SeAll" }, values: { $var: "X" } } } as FenelType } },
  },
  {
    label: "refined μ (base X, set carried raw)",
    mu: { $mu: { var: "X", body: { $refined: { base: { $var: "X" }, set: { $tag: "SeInterval", interval: { lo: N, hi: N } } } } as FenelType } },
  },
  {
    label: "tagged μ (value X, phantom Id-ref)",
    mu: { $mu: { var: "X", body: { $tagged: { value: { $var: "X" }, phantom: { $ref: "Id" } } } as FenelType } },
  },
  {
    label: "opaque μ (pure X)",
    mu: { $mu: { var: "X", body: { $opaque: { name: "Wrap", repr: "object", pure: { $var: "X" } } } as FenelType } },
  },
  {
    label: "$el.call μ (Box X Int — type-app args)",
    mu: { $mu: { var: "X", body: { $el: { call: ["Box", { $var: "X" }, { $ref: "Int" }] } } as FenelType } },
  },
  {
    label: "shadowing inner μ (same var X)",
    mu: {
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              {
                name: "Outer",
                label: N,
                fields: [
                  fld("inner", { $mu: { var: "X", body: { $record: { fields: [fld("loop", { $var: "X" })] } } } }),
                  fld("ref", { $var: "X" }),
                ],
              },
            ],
          },
        } as FenelType,
      },
    },
  },
  {
    label: "rich field metadata (label/meta/ui must survive)",
    mu: {
      $mu: {
        var: "X",
        body: {
          $record: {
            fields: [
              fld("a", { $var: "X" }, { label: J("Label!"), meta: { custom: 42 }, ui: J("widget") }),
              fld("b", { $ref: "Str" }, { label: J("B") }),
            ],
          },
        } as FenelType,
      },
    },
  },
  {
    label: "bottom μX.X (body is a bare $var)",
    mu: { $mu: { var: "X", body: { $var: "X" } } },
  },
  {
    label: "custom discriminator survives changed variant substitution",
    mu: { $mu: { var: "X", body: { $variant: { discriminator: "kind", cases: [
      { name: "Changed", label: N, fields: [fld("payload", { $var: "X" })] },
      { name: "Kept", label: N, fields: [fld("plain", { $unit: true })] },
    ] } } } },
  },
  {
    label: "custom discriminator survives an unchanged variant",
    mu: { $mu: { var: "X", body: { $variant: { discriminator: "kind", cases: [
      { name: "Kept", label: N, fields: [fld("plain", { $unit: true })] },
    ] } } } },
  },
];

describe("containment-substrate Phase 6 — unfold parity (TS perf branch ≡ Fenel source of truth)", () => {
  for (const { label, mu } of CORPUS) {
    it(`byte-identical: ${label}`, () => {
      const before = structuredClone(mu);
      const ts = unfold(mu);
      const fenel = dispatchedUnfold(mu);
      expect(fenel).toEqual(ts);
      expect(mu).toEqual(before);
    });
  }
});

describe("unfold performance branch retains unchanged raw type data", () => {
  const noOp: Array<{ label: string; type: FenelType }> = [
    { label: "void", type: { $void: true } }, { label: "unit", type: { $unit: true } },
    { label: "reference", type: { $ref: "String" } }, { label: "other variable", type: { $var: "Y" } },
    { label: "record", type: { $record: { fields: [fld("plain", { $unit: true })] } } },
    { label: "variant", type: { $variant: { discriminator: "kind", cases: [{ name: "Empty", label: N, fields: [] }] } } },
    { label: "tuple", type: { $tuple: [{ $unit: true }] } },
    { label: "map", type: { $map: { keys: { $tag: "SeAll" }, values: { $unit: true } } } },
    { label: "refined", type: { $refined: { base: { $unit: true }, set: { $tag: "SeAll" } } } },
    // These existing source arms deliberately keep the whole carrier, even
    // when its children mention X. This change does not widen substitution.
    { label: "union", type: { $union: [{ $var: "X" }] } },
    { label: "intersection", type: { $intersect: [{ $var: "X" }] } },
    { label: "complement", type: { $complement: { $var: "X" } } },
    { label: "other binder", type: { $mu: { var: "Y", body: { $unit: true } } } },
    { label: "tagged", type: { $tagged: { value: { $unit: true }, phantom: { $ref: "Id" } } } },
    { label: "opaque", type: { $opaque: { name: "Box", pure: { $unit: true } } } },
    { label: "arrow", type: { $arrow: { params: [fld("payload", { $var: "X" })], returns: { $var: "X" } } } },
    { label: "type universe", type: { $type: true } },
    { label: "dependent expression", type: { $el: { var: "X" } } },
  ];
  for (const { label, type } of noOp) {
    it(`preserves ${label} identity and source result`, () => {
      const mu: MuType = { $mu: { var: "X", body: type } };
      const before = structuredClone(mu);
      expect(unfold(mu)).toBe(type);
      expect(dispatchedUnfold(mu)).toEqual(type);
      expect(mu).toEqual(before);
    });
  }
  it("retains unchanged field/case siblings and substitutes only the matching binder", () => {
    const changed = fld("payload", { $var: "X" });
    const kept = fld("plain", { $unit: true });
    const sameBinder: FenelType = { $mu: { var: "X", body: { $var: "X" } } };
    const shadowed = fld("shadowed", sameBinder);
    const variant: FenelType = { $variant: { discriminator: "kind", cases: [
      { name: "Changed", label: N, fields: [changed, kept, shadowed] },
      { name: "Kept", label: N, fields: [kept] },
    ] } };
    const mu: MuType = { $mu: { var: "X", body: variant } };
    const out = unfold(mu) as Extract<FenelType, { $variant: unknown }>;
    expect(out).not.toBe(variant);
    expect(out.$variant.discriminator).toBe("kind");
    expect(out.$variant.cases[0]!.fields![0]!.type).toBe(mu);
    expect(out.$variant.cases[0]!.fields![1]).toBe(kept);
    expect(out.$variant.cases[0]!.fields![2]).toBe(shadowed);
    expect(out.$variant.cases[0]!.fields![2]!.type).toBe(sameBinder);
    expect(out.$variant.cases[1]).toBe(variant.$variant.cases[1]);
  });
  it("retains el.call heads/scalars when no argument changes", () => {
    const body: FenelType = { $el: { call: ["Box", { $var: "Y" }, 0, false, ""] } };
    expect(unfold({ $mu: { var: "X", body } })).toBe(body);
    const nativeConstant: FenelType = { $el: { call: ["Box", Number.NaN] } };
    expect(unfold({ $mu: { var: "X", body: nativeConstant } })).toBe(nativeConstant);
  });
  it("retains closed outer mu when unfolding a differently named inner binder", () => {
    const inner: FenelType = { $mu: { var: "B", body: { $record: { fields: [fld("outer", { $var: "A" })] } } } };
    const outer: MuType = { $mu: { var: "A", body: { $record: { fields: [fld("inner", inner)] } } } };
    const first = unfold(outer) as Extract<FenelType, { $record: unknown }>;
    const entered = unfold(first.$record.fields[0]!.type as MuType) as Extract<FenelType, { $record: unknown }>;
    expect(entered.$record.fields[0]!.type).toBe(outer);
    expect(dispatchedUnfold(first.$record.fields[0]!.type as MuType)).toEqual(entered);
  });
});
