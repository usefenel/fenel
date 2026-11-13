import { describe, it, expect } from "vitest";
import type { FieldDef } from "@fenel/engine/types";
import { Maybe } from "@fenel/engine/type-foundation";
import { _internals } from "./telegram-form";
import { getSystemRegistry } from "@fenel/engine/system-registry";

const { fieldLabel, promptForField, parseFieldInput, innerType, typeHint, tryParseBoolean } =
  _internals;
const registry = getSystemRegistry();
function platformField(name: string): FieldDef {
  const type = registry.getIdentifiedEntity("platform")?.type;
  if (!type || !("$record" in type)) throw new Error("missing platform record");
  const field = type.$record.fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`missing platform.${name}`);
  return field;
}

describe("fieldLabel — UUID field presentation", () => {
  it("resolves an authored label through the field UUID facet", () => {
    expect(fieldLabel(platformField("handleMaxLength"), registry)).toBe("Max Length");
  });

  it("falls back to the field name when no label is set", () => {
    expect(fieldLabel({ name: "age", type: { $named: "Number" } })).toBe("age");
  });

  it("does not revive a declaration-level inline label", () => {
    expect(fieldLabel({ name: "n", label: "Legacy label", type: { $named: "String" } } as never))
      .toBe("n");
  });

  it("rejects a keyless product field when an explicit registry is supplied", () => {
    expect(() => fieldLabel({ name: "age", type: { $named: "Number" } }, registry))
      .toThrow("has no NamedField UUID");
  });
});

describe("typeHint — type-driven prompt suffix", () => {
  it("hints yes/no for Boolean", () => {
    expect(typeHint({ $named: "Boolean" })).toBe(" (yes/no)");
  });

  it("hints number for Number/Int/Nat", () => {
    expect(typeHint({ $named: "Number" })).toBe(" (a number)");
    expect(typeHint({ $named: "Int" })).toBe(" (a number)");
    expect(typeHint({ $named: "Nat" })).toBe(" (a number)");
  });

  it("hints date for Date", () => {
    expect(typeHint({ $named: "Date" })).toBe(" (date — YYYY-MM-DD)");
  });

  it("hints email for refined-string format:email", () => {
    expect(
      typeHint({ $refined: { base: { $named: "String" }, set: { $named: "format:email" } } }),
    ).toBe(" (your email)");
  });

  it("hints handle for refined-string format:handle", () => {
    expect(
      typeHint({ $refined: { base: { $named: "String" }, set: { $named: "format:handle" } } }),
    ).toBe(" (your @handle)");
  });

  it("emits empty string for plain String", () => {
    expect(typeHint({ $named: "String" })).toBe("");
  });

  it("peels Maybe before deciding the hint", () => {
    expect(typeHint(Maybe({ $named: "Boolean" }))).toBe(" (yes/no)");
  });
});

describe("innerType — peeling wrappers", () => {
  it("peels Maybe", () => {
    expect(innerType(Maybe({ $named: "Number" }))).toEqual({ $named: "Number" });
  });

  it("peels $refined", () => {
    expect(
      innerType({ $refined: { base: { $named: "String" }, set: { $named: "format:email" } } }),
    ).toEqual({ $named: "String" });
  });

  it("peels nested wrappers recursively", () => {
    expect(
      innerType(Maybe({ $refined: { base: { $named: "Number" }, set: { $named: "test:positive" } } })),
    ).toEqual({ $named: "Number" });
  });
});

describe("tryParseBoolean — yes/no handling", () => {
  it("accepts yes/y/true/1/ok/yep/yeah as true", () => {
    for (const t of ["yes", "Y", "true", "1", "OK", "yep", "yeah"]) {
      expect(tryParseBoolean(t), t).toBe(true);
    }
  });

  it("accepts no/n/false/0/nope/nah as false", () => {
    for (const t of ["no", "N", "false", "0", "nope", "nah"]) {
      expect(tryParseBoolean(t), t).toBe(false);
    }
  });

  it("ignores leading/trailing whitespace", () => {
    expect(tryParseBoolean("  yes  ")).toBe(true);
    expect(tryParseBoolean("\tno\n")).toBe(false);
  });

  it("returns null for ambiguous strings", () => {
    expect(tryParseBoolean("maybe")).toBeNull();
    expect(tryParseBoolean("")).toBeNull();
  });
});

describe("parseFieldInput — type-driven parsing", () => {
  it("parses Boolean from yes/no", () => {
    const f: FieldDef = { name: "agree", type: { $ref: "Boolean" } };
    expect(parseFieldInput("yes", f)).toEqual({ ok: true, value: true });
    expect(parseFieldInput("no", f)).toEqual({ ok: true, value: false });
  });

  it("re-prompts when Boolean input isn't recognised", () => {
    const f: FieldDef = { name: "agree", type: { $ref: "Boolean" } };
    const r = parseFieldInput("maybe", f) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/yes/);
  });

  it("delegates to parseInput for Number — rejects non-numeric", () => {
    const f: FieldDef = { name: "age", type: { $ref: "Number" } };
    const r = parseFieldInput("not a number", f) as any;
    expect(r.ok).toBe(false);
  });

  it("delegates to parseInput for Number — accepts numeric", () => {
    const f: FieldDef = { name: "age", type: { $ref: "Number" } };
    const r = parseFieldInput("42", f) as any;
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });

  it("delegates to parseInput for refined-email — normalises trim+lowercase", () => {
    const f: FieldDef = {
      name: "email",
      type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:email" } } },
    };
    const r = parseFieldInput("  Rom@UseFenel.com  ", f) as any;
    expect(r.ok).toBe(true);
    expect(r.value).toBe("rom@usefenel.com");
  });

  it("delegates to parseInput for refined-email — rejects empty after trim", () => {
    const f: FieldDef = {
      name: "email",
      type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:email" } } },
    };
    const r = parseFieldInput("   ", f) as any;
    expect(r.ok).toBe(false);
  });

  it("rejects /cancel as a defensive fallback", () => {
    const f: FieldDef = { name: "name", type: { $ref: "String" } };
    const r = parseFieldInput("/cancel", f) as any;
    expect(r.ok).toBe(false);
  });

  it("accepts plain strings unchanged for String fields", () => {
    const f: FieldDef = { name: "name", type: { $ref: "String" } };
    expect(parseFieldInput("Romain", f)).toEqual({ ok: true, value: "Romain" });
  });
});

describe("promptForField — composed prompt text", () => {
  it("appends the type hint to the label", () => {
    expect(promptForField(platformField("handleMaxLength"), registry))
      .toBe("Max Length (a number)");
  });

  it("uses field name when no label", () => {
    expect(promptForField({ name: "agree", type: { $named: "Boolean" } })).toBe("agree (yes/no)");
  });

  it("renders cleanly for plain String fields (no hint)", () => {
    expect(promptForField(platformField("urlTemplate"), registry)).toBe("URL Template");
  });
});
