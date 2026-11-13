// Type annotations in the expression editor (modules-as-values Phase 2d): the
// annotation is authored, shown and round-tripped through the code lens as
// `(e : T)`, one colon in parentheses; `::` is gone from the surface.
import { describe, expect, test } from "bun:test";
import { parseFenel, printFenel } from "@fenel/engine";
import { annotationTypeForEditor, codeLensTextIsReadable } from "./annotation-lens";
import { exprNodeToLogic, logicToExprNode } from "./expr-node-codec";

describe("annotation display helpers", () => {
  test("a real type is edited as is; a legacy bare name as the reference it names", () => {
    const listString = { $ref: "List String" };
    expect(annotationTypeForEditor(listString)).toBe(listString);
    expect(annotationTypeForEditor("String")).toEqual({ $ref: "String" });
    expect(annotationTypeForEditor(" Bytes ")).toEqual({ $ref: "Bytes" });
  });

  test("nothing readable leaves the type builder empty", () => {
    expect(annotationTypeForEditor(undefined)).toBeNull();
    expect(annotationTypeForEditor(null)).toBeNull();
    expect(annotationTypeForEditor("")).toBeNull();
    expect(annotationTypeForEditor([{ $ref: "String" }])).toBeNull();
    expect(annotationTypeForEditor(3)).toBeNull();
  });

  test("printed code with a JSON-dumped type is not offered as editable source", () => {
    expect(codeLensTextIsReadable("(x : List String)")).toBe(true);
    expect(codeLensTextIsReadable('(Iso.decode "aGVsbG8=" : Result String Bytes)')).toBe(true);
    // A string literal holding JSON is escaped when printed, so it stays readable.
    expect(codeLensTextIsReadable(String.raw`"{\"$ref\": 1}"`)).toBe(true);
    expect(codeLensTextIsReadable('x :: {"$ref":"String"}')).toBe(false);
    expect(codeLensTextIsReadable('String -> { "$variant": {} }')).toBe(false);
  });

  test("quoted identity handles beginning with a dollar stay readable beside genuine raw dumps", () => {
    for (const handle of ["$exact", "$ref", '$quoted"part', "$back\\part"]) {
      const source = printFenel({ $ref: handle } as never);
      expect(source).toBe(`@{${JSON.stringify(handle)}}`);
      expect(codeLensTextIsReadable(source)).toBe(true);
      expect(parseFenel(source)).toEqual({ $ref: handle });
    }
    expect(codeLensTextIsReadable('@{"$ref"} { "$type": true }')).toBe(false);
    expect(codeLensTextIsReadable('`text ${@{"$exact"}} more`')).toBe(true);
    expect(codeLensTextIsReadable('`text ${f { "$type": true }} more`')).toBe(false);
  });

  test("the source guard retains diagnostic, whitespace and incomplete-text behavior", () => {
    expect(codeLensTextIsReadable('-- <no surface syntax: unavailable>')).toBe(false);
    expect(codeLensTextIsReadable('-- {"$ref": "handle"}')).toBe(false);
    expect(codeLensTextIsReadable('"<no surface syntax: unfinished')).toBe(true);
    expect(codeLensTextIsReadable('`<no surface syntax: unfinished')).toBe(true);
    expect(codeLensTextIsReadable('"escaped trailing ' + String.fromCharCode(92))).toBe(true);
    for (const space of [" ", "\t", "\n", "\v", "\f", "\r", "\u00a0", "\u1680", "\u2003", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff"]) {
      expect(codeLensTextIsReadable(`{${space}"$ref": "handle"}`)).toBe(false);
    }
  });

  test("large data and document source keeps constant-stack guard behavior", () => {
    const list = `[${Array.from({ length: 8192 }, () => "1").join(", ")}]`;
    const records = `[${Array.from({ length: 1200 }, (_, index) => `{ value = ${index} }`).join(", ")}]`;
    const document = JSON.stringify("ordinary document text ".repeat(900));
    for (const source of [list, records, document]) {
      expect(source.length).toBeGreaterThan(16000);
      expect(codeLensTextIsReadable(source)).toBe(true);
      expect(codeLensTextIsReadable(`${source} (x : <no surface syntax: an inline variant type>)`)).toBe(false);
    }
  });

  test("the printer's no-surface-syntax diagnostic is not offered as editable source", () => {
    // The printer's actual output for an annotation whose type has no surface
    // syntax (an inline variant): the diagnostic, not a JSON dump.
    const variant = {
      $variant: { cases: [{ name: "A", label: { $tag: "Nothing" } }, { name: "B", label: { $tag: "Nothing" } }] },
    };
    const printed = printFenel({ ann: [{ var: "x" }, variant] } as never);
    expect(printed).toContain("<no surface syntax:");
    expect(printed).not.toContain("$variant");
    expect(codeLensTextIsReadable(printed)).toBe(false);
    // Nested inside other code, too.
    const nested = printFenel({ call: ["f", { ann: [{ var: "x" }, variant] }, 1] } as never);
    expect(nested).toContain("<no surface syntax:");
    expect(codeLensTextIsReadable(nested)).toBe(false);
    // The text really does not read back.
    expect(() => parseFenel(printed)).toThrow();
    // A string literal holding the same words is data, and reads back.
    const literal = printFenel({ call: ["f", "<no surface syntax: a note>"] } as never);
    expect(codeLensTextIsReadable(literal)).toBe(true);
    expect(codeLensTextIsReadable(String.raw`f "say \"<no surface syntax: x>\" twice"`)).toBe(true);
  });

  test("template text holding the diagnostic's words is data; an interpolated expression is code", () => {
    const variant = {
      $variant: { cases: [{ name: "A", label: { $tag: "Nothing" } }, { name: "B", label: { $tag: "Nothing" } }] },
    };
    // The words in a template's text (with a quote, an escaped backtick and an
    // escaped `${` beside them) read back unchanged.
    const text = printFenel({ cat: ['<no surface syntax: x> `q` "z" ${', { var: "y" }] } as never);
    expect(text).toContain("<no surface syntax: x>");
    expect(codeLensTextIsReadable(text)).toBe(true);
    expect(printFenel(parseFenel(text) as never)).toBe(text);
    // The printer's real diagnostic inside an interpolation is code, and does not.
    for (const logic of [
      { cat: ["hi ", { ann: [{ var: "x" }, variant] }, " there"] },
      { cat: ["a `b` ", { cat: ["in ", { ann: [{ var: "x" }, variant] }] }, " c"] },
      { cat: ["r ", { call: ["f", { record: { a: 1 } }, { ann: [{ var: "x" }, variant] }] }] },
    ]) {
      const printed = printFenel(logic as never);
      expect(printed).toContain("<no surface syntax: an inline variant type>");
      expect(codeLensTextIsReadable(printed)).toBe(false);
      expect(() => parseFenel(printed)).toThrow();
    }
    // A template in code after a template: the scan returns to code.
    expect(codeLensTextIsReadable("f `<no surface syntax: x>` (y : <no surface syntax: a literal type>)")).toBe(false);
    expect(codeLensTextIsReadable("f `a ${g `<no surface syntax: x>`} b` 1")).toBe(true);
  });
});

describe("the editor source spells annotations with one colon", () => {
  const source = Bun.file(new URL("./index.tsx", import.meta.url)).text();

  test("the declare action is the type contract's plain-words action, writing an annotation", async () => {
    const text = (await source).replace(/\r\n/g, "\n");
    const contract = (await Bun.file(new URL("./type-contract.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
    expect(contract).toContain('"Declare this type"');
    expect(contract).toContain('"Remove declared type"');
    expect(contract).not.toContain("::");
    const start = text.indexOf("function setDeclaredType(");
    const body = text.slice(start, text.indexOf("\n  }\n", start));
    expect(body).toContain("__ann: { expr: props.node, type }");
    expect(body).toContain("ann.expr");
  });

  test("the annotation form's head is a single colon and uses the repo tooltip", async () => {
    const text = (await source).replace(/\r\n/g, "\n");
    const start = text.indexOf("function AnnotationFormEditor(");
    const body = text.slice(start, text.indexOf("\n}\n", start));
    expect(body).toContain("annotationTypeForEditor(props.type)");
    expect(body).not.toContain(">::<");
    expect(body).toMatch(/class="expr-form__head mono"\s+data-tooltip="[^"]*\(expression : Type\)[^"]*"\s*>\s*:\s*<\/div>/);
  });

  test("the code lens refuses to apply text that would not read back", async () => {
    const text = (await source).replace(/\r\n/g, "\n");
    const start = text.indexOf("function NodeCodeView(");
    const body = text.slice(start, text.indexOf("\n}\n", start));
    // B4 unit C: Account readers judge the printed text here; a Local reader's
    // worker answers the same judgment with its printed text.
    expect(body).toContain("return { text, readable: codeLensTextIsReadable(text) };");
    expect(body).toContain("readable: reply._0.readable");
    expect(body).toContain("if (!readable()) return;");
    expect(body).toContain("readonly={!readable()}");
  });
});

// The round trip the code lens performs: text → engine parser → editor node →
// JSON Logic → engine printer → text. It runs against the colon form the
// engine parser and printer adopt in Phase 2d.
describe("code-lens round trip of `(e : T)`", () => {
  const roundTrip = (src: string) => {
    const logic = parseFenel(src) as { ann?: [unknown, unknown] };
    const node = logicToExprNode(logic);
    const back = exprNodeToLogic(node);
    return { logic, node, back, printed: printFenel(back as never) };
  };

  test("an annotation reads to a real type, never a bare-name string", () => {
    const { logic, node } = roundTrip("(x : List String)");
    expect(Array.isArray(logic.ann)).toBe(true);
    expect(logic.ann![0]).toEqual({ var: "x" });
    const type = logic.ann![1];
    expect(typeof type).toBe("object");
    expect(type).not.toBeNull();
    expect(node.kind).toBe("literal");
    const marker = (node as { kind: "literal"; value: { __ann?: { type?: unknown } } }).value.__ann;
    expect(marker?.type).toEqual(type);
    expect(annotationTypeForEditor(marker?.type)).toEqual(type as never);
  });

  test("the editor node lowers back to the same annotation and prints the colon form", () => {
    // The printer writes a type in its canonical spelling: `List String` comes
    // back as the list shorthand `[String]`, the same type.
    const cases: Array<[source: string, canonical: string]> = [
      ["(x : List String)", "(x : [String])"],
      ["(x : String)", "(x : String)"],
      ['(Iso.decode "aGVsbG8=" : Result String Bytes)', '(Iso.decode "aGVsbG8=" : Result String Bytes)'],
    ];
    for (const [src, canonical] of cases) {
      const { logic, back, printed } = roundTrip(src);
      expect(back).toEqual(logic);
      expect(printed).toBe(canonical);
      expect(printed).not.toContain("::");
      expect(codeLensTextIsReadable(printed)).toBe(true);
      expect(parseFenel(printed)).toEqual(logic);
    }
  });

  test("`::` no longer reads as an annotation", () => {
    expect(() => parseFenel("x :: String")).toThrow();
  });
});
