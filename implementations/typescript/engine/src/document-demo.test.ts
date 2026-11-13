import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/std/document.fenel?raw";
import DEMO from "../../../../fenel/modules/publicdemo/document-demo.fenel?raw";
import INSTANCES from "../../../../fenel/modules/std/document-instances.fenel?raw";
import EMAIL from "../../../../fenel/modules/email/email.fenel?raw";
import IMPORT_TYPES from "../../../../fenel/modules/publicdemo/import-types.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { evaluate, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import type { FenelModule, FenelType } from "./types";
import type { MarkupValue } from "./markup";
import { contains } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";

// C1: execute the real authored document through the shipped evaluator.
// No native policy, helper implementation or replacement document model.
type ReadPart = { $tag: "DocReadMarkup"; markup: MarkupValue }
  | { $tag: "DocReadSection"; heading: MarkupValue; children: ReadPart[] }
  | { $tag: "DocReadNote"; children: ReadPart[] }
  | { $tag: "DocReadEmbed"; value: unknown; type: unknown; caption: MarkupValue };
let context: EvaluateContext;
let registry: ModuleRegistry;
beforeAll(() => {
  const document = loadFenelModule(SOURCE, "std");
  const extended: FenelModule = { ...stdModule,
    functions: [...(stdModule.functions ?? []).filter(fn => !(document.functions ?? []).some(other => other.id === fn.id)), ...(document.functions ?? [])],
    entities: [...(stdModule.entities ?? []).filter(entity => !document.entities?.some(other => other.id === entity.id)), ...(document.entities ?? [])],
  };
  const email = loadFenelModule(EMAIL, "email");
  const emailData = { ...email, functions: email.functions?.filter(fn =>
    ["email:address", "email:formatAddress", "email:bodyText"].includes(fn.id)) };
  const imports = loadFenelModule(IMPORT_TYPES, "ImportDemo");
  const textInputData = { ...imports, functions: [], entities: imports.entities?.filter(entity => entity.id === "ImportTextInput") };
  registry = createRegistry([extended, emailData, textInputData, loadFenelModule(DEMO, "DocumentDemo")]);
  context = registry.evaluateContext();
}, 180_000);
const call = (name: string, ...args: unknown[]) => evaluate({ call: [name, ...args] }, {}, context);

describe("one source-owned typed document", () => {
  test("the public edit example consumes and returns the same canonical document", () => {
    const sample = call("DocumentDemo:documentSample") as { $tag: string; blocks: unknown[] };
    expect(sample.$tag).toBe("RichDocument");
    expect(call("DocumentDemo:editDocument", sample)).toEqual(sample);
    const starting = call("DocumentDemo:documentDemoStartingInputs") as Array<{ function: unknown; arguments: unknown[] }>;
    expect(starting.map(row => row.function)).toEqual([
      { $ref: "DocumentDemo:editDocument" }, { $ref: "DocumentDemo:outlineDocument" },
      { $ref: "DocumentDemo:plainTextDocument" }, { $ref: "DocumentDemo:composeDocumentEmail" },
      { $ref: "DocumentDemo:previewDocumentEmail" },
      { $ref: "DocumentDemo:exportDocumentHtml" }, { $ref: "DocumentDemo:exportDocumentMarkdown" },
      { $ref: "DocumentDemo:importDocumentHtml" },
      { $ref: "DocumentDemo:importDocumentMarkdown" },
    ]);
    expect(starting[0]?.arguments).toEqual([sample]);
  });

  test("format examples run existing source conversions with exportable starting data", () => {
    const starting = call("DocumentDemo:documentDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    const sample = call("DocumentDemo:documentFormatSample");
    for (const name of ["exportDocumentHtml", "exportDocumentMarkdown"]) {
      const row = starting.find(row => row.function.$ref === `DocumentDemo:${name}`)!;
      expect(row.arguments).toEqual([sample]);
      expect(call(row.function.$ref, ...row.arguments)).toMatchObject({ $tag: "Ok", _0: expect.any(String) });
      expect(call(row.function.$ref, call("DocumentDemo:documentSample"))).toMatchObject({ $tag: "Err", _0: expect.any(String) });
      const unsafe = { $tag: "RichDocument", blocks: [{ $tag: "DocParagraph", content: [
        { $tag: "DocLink", url: "javascript:alert(1)", content: [{ $tag: "DocText", text: "refuse" }] },
      ] }] };
      expect(call(row.function.$ref, unsafe)).toMatchObject({ $tag: "Err", _0: expect.any(String) });
    }
    const imported = starting.find(row => row.function.$ref === "DocumentDemo:importDocumentHtml")!;
    expect(imported.arguments).toEqual([call("DocumentDemo:documentHtmlSample")]);
    const result = call(imported.function.$ref, ...imported.arguments) as { $tag: string; _0: unknown };
    expect(result).toMatchObject({ $tag: "Ok", _0: { $tag: "RichDocument" } });
    expect(call("std:documentPlainText", result._0)).toContain("Hello typed data & literal <text>");
    expect(call(imported.function.$ref, '<p><a href="javascript:alert(1)">unsafe</a></p>')).toMatchObject({ $tag: "Err", _0: expect.any(String) });
    expect(call(imported.function.$ref, '<p>broken')).toMatchObject({ $tag: "Err", _0: expect.any(String) });
    expect(call(imported.function.$ref, ...imported.arguments)).toEqual(result);
  });

  test("the Markdown example owns its source input and returns the existing Document", () => {
    const starting = call("DocumentDemo:documentDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    const imported = starting.find(row => row.function.$ref === "DocumentDemo:importDocumentMarkdown")!;
    expect(imported.arguments).toEqual([{ $tag: "ImportTextInput", text: call("DocumentDemo:documentMarkdownSample") }]);
    const result = call(imported.function.$ref, ...imported.arguments) as { $tag: string; _0: unknown };
    expect(result).toMatchObject({ $tag: "Ok", _0: { $tag: "RichDocument" } });
    expect(call("std:documentOutline", result._0)).toEqual([
      { depth: 1, title: "An article across formats" }, { depth: 2, title: "Editable data" },
    ]);
    expect(call("std:documentPlainText", result._0)).toContain("Hello typed data & literal <text>.");
    expect(call(imported.function.$ref, { $tag: "ImportTextInput", text: '<p><a href="javascript:alert(1)">unsafe</a></p>' })).toMatchObject({ $tag: "Err", _0: expect.any(String) });
    expect(call(imported.function.$ref, { $tag: "ImportTextInput", text: "# Heading\n\n<strong>unclosed" })).toMatchObject({ $tag: "Err", _0: expect.any(String) });
    expect(call(imported.function.$ref, ...imported.arguments)).toEqual(result);
  });

  test("nested headings derive their HTML level and preserve recursive styled inline content", () => {
    const plan = call("std:documentReadPlan", call("DocumentDemo:documentSample")) as ReadPart[];
    const outer = plan[0] as Extract<ReadPart, { $tag: "DocReadSection" }>;
    expect(outer.$tag).toBe("DocReadSection");
    expect(outer.heading).toMatchObject({ $tag: "Element", tag: "h1" });
    const inner = outer.children[3] as Extract<ReadPart, { $tag: "DocReadSection" }>;
    expect(inner.heading).toMatchObject({ $tag: "Element", tag: "h2" });
    const nested = { $tag: "DocStrong", content: [{ $tag: "DocLink", url: "https://example.com", content: [{ $tag: "DocEmphasis", content: [{ $tag: "DocText", text: "composed" }] }] }] };
    expect(call("std:documentInlineMarkup", nested)).toEqual({ $tag: "Element", tag: "strong", attrs: [], children: [
      { $tag: "Element", tag: "a", attrs: [{ key: "href", value: "https://example.com" }], children: [
        { $tag: "Element", tag: "em", attrs: [], children: [{ $tag: "Text", value: "composed" }] },
      ] },
    ] });
    expect(call("std:documentBlockReadPlan", 9, { $tag: "DocSection", title: [], blocks: [] })).toMatchObject({ heading: { tag: "h6" } });
  });

  test("embedded scalar and list edits remain their ordinary data with a reflected type", () => {
    for (const [data, value] of [
      [{ $tag: "DocTextData", text: "<img onerror=alert(1)>" }, "<img onerror=alert(1)>"],
      [{ $tag: "DocNumberData", number: 42 }, 42],
      [{ $tag: "DocBooleanData", enabled: false }, false],
      [{ $tag: "DocNumbersData", numbers: [1, -3, 5] }, [1, -3, 5]],
      [{ $tag: "DocNumbersData", numbers: [] }, []],
      [{ $tag: "DocTextsData", texts: ["one", "two"] }, ["one", "two"]],
    ] as const) {
      const plan = call("std:documentReadPlan", { $tag: "RichDocument", blocks: [{ $tag: "DocEmbed", data, caption: [] }] }) as ReadPart[];
      expect(plan[0]).toMatchObject({ $tag: "DocReadEmbed", value, caption: { tag: "figcaption" } });
      expect((plan[0] as Extract<ReadPart, { $tag: "DocReadEmbed" }>).type).toBeDefined();
      const type = (plan[0] as Extract<ReadPart, { $tag: "DocReadEmbed" }>).type as Parameters<typeof typeToSetExpr>[0];
      // GLOBAL_ONLY: this source fixture checks primitive type membership;
      // it has no reader account and loads no account-owned declarations.
      expect(contains(typeToSetExpr(type), value, null, {}, context),
        `The declared embed type must contain ${JSON.stringify(value)}`).toEqual({ $tag: "Just", _0: true });
      if (data.$tag === "DocNumbersData" || data.$tag === "DocTextsData") {
        expect(type).toMatchObject({ $map: { values: { $ref: data.$tag === "DocNumbersData" ? "Number" : "String" } } });
      }
    }
  });

  test("code and text stay literal markup data, with no HTML or JavaScript interpretation", () => {
    const source = "<script>alert('no')</script>";
    expect(call("std:documentBlockReadPlan", 1, { $tag: "DocCode", language: { $tag: "Just", _0: "fenel" }, source })).toEqual({
      $tag: "DocReadMarkup", markup: { $tag: "Element", tag: "pre", attrs: [], children: [
        { $tag: "Element", tag: "code", attrs: [{ key: "data-language", value: "fenel" }], children: [{ $tag: "Text", value: source }] },
      ] },
    });
    expect(call("std:documentCodeAttributes", { $tag: "Nothing" })).toEqual([]);
  });

  test("Viewable selects the shared registered preview for the durable type", () => {
    const instances = loadFenelModule(INSTANCES, "DocumentDemo", { dispatchInstanceFile: true }).instances!;
    expect(instances).toContainEqual(expect.objectContaining({ typeName: "Viewable", args: ["RichDocument"], methods: {
      defaultView: "rich-document", defaultInlineView: "rich-document",
    } }));
  });

  test("the outline traverses sections inside notes in order without adding a heading level", () => {
    const document = { $tag: "RichDocument", blocks: [
      { $tag: "DocParagraph", content: [{ $tag: "DocText", text: "intro" }] },
      { $tag: "DocSection", title: [{ $tag: "DocStrong", content: [{ $tag: "DocText", text: "Outer" }] }], blocks: [
        { $tag: "DocNote", blocks: [{ $tag: "DocSection", title: [{ $tag: "DocInlineCode", code: "Inner" }], blocks: [] }] },
      ] },
      { $tag: "DocSection", title: [], blocks: [] },
    ] };
    const expected = [{ depth: 1, title: "Outer" }, { depth: 2, title: "Inner" }, { depth: 1, title: "" }];
    expect(call("std:documentOutline", document)).toEqual(expected);
    expect(call("DocumentDemo:outlineDocument", document)).toEqual(expected);
    expect(call("std:documentBlockOutline", 9, { $tag: "DocSection", title: [], blocks: [] })).toEqual([{ depth: 9, title: "" }]);
    expect(call("std:documentOutline", { $tag: "RichDocument", blocks: [] })).toEqual([]);
  });

  test("plain text preserves literal content from all authored constructors and removes only styling", () => {
    const document = { $tag: "RichDocument", blocks: [
      { $tag: "DocSection", title: [{ $tag: "DocText", text: "Title" }], blocks: [
        { $tag: "DocParagraph", content: [
          { $tag: "DocText", text: "Some " },
          { $tag: "DocStrong", content: [{ $tag: "DocEmphasis", content: [{ $tag: "DocLink", url: "https://example.com", content: [{ $tag: "DocInlineCode", code: "styled text" }] }] }] },
        ] },
        { $tag: "DocCode", language: { $tag: "Nothing" }, source: "<script>literal</script>\n  code" },
        { $tag: "DocNote", blocks: [{ $tag: "DocParagraph", content: [{ $tag: "DocText", text: "A note" }] }] },
        { $tag: "DocEmbed", data: { $tag: "DocTextData", text: "embedded text" }, caption: [{ $tag: "DocText", text: "Caption" }] },
        { $tag: "DocEmbed", data: { $tag: "DocNumberData", number: -12.5 }, caption: [] },
        { $tag: "DocEmbed", data: { $tag: "DocBooleanData", enabled: false }, caption: [] },
        { $tag: "DocEmbed", data: { $tag: "DocNumbersData", numbers: [0, 42] }, caption: [] },
        { $tag: "DocEmbed", data: { $tag: "DocTextsData", texts: ["one", "two"] }, caption: [] },
        { $tag: "DocParagraph", content: [] },
        { $tag: "DocEmbed", data: { $tag: "DocNumbersData", numbers: [] }, caption: [] },
      ] },
    ] };
    const expected = "Title\n\nSome styled text\n\n<script>literal</script>\n  code\n\nA note\n\nembedded text\n\nCaption\n\n-12.5\n\nfalse\n\n0, 42\n\none\ntwo";
    expect(call("std:documentPlainText", document)).toBe(expected);
    expect(call("DocumentDemo:plainTextDocument", document)).toBe(expected);
    expect(call("std:documentPlainText", { $tag: "RichDocument", blocks: [] })).toBe("");
  });

  test("the mail composition returns the existing complete Email and its literal Text body", () => {
    const from = { $tag: "Address", local: "writer", domain: "example.com", displayName: { $tag: "Nothing" } };
    const to = [{ $tag: "Address", local: "reader", domain: "example.net", displayName: { $tag: "Just", _0: "Reader" } }];
    const document = { $tag: "RichDocument", blocks: [{ $tag: "DocParagraph", content: [{ $tag: "DocText", text: "An edited body" }] }] };
    const mail = call("DocumentDemo:composeDocumentEmail", from, to, "Edited subject", document);
    expect(mail).toEqual({ $tag: "Email", from, to, cc: [], bcc: [], replyTo: { $tag: "Nothing" },
      subject: "Edited subject", body: { $tag: "Text", _0: "An edited body" },
      attachments: [], headers: [], inReplyTo: { $tag: "Nothing" }, references: [] });
    const emailType = registry.getIdentifiedEntity("Email")!.type!;
    // GLOBAL_ONLY: actual source-owned email data has no account authority or
    // host handler in this fixture. The existing entry boundary substitutes
    // only this captured registry's definitions; opaque carriers stay named.
    // The existing full Email schema currently produces a degraded projection
    // (tracked in TODO), so admission must remain undecided rather than guessed.
    expect(contains(typeToSetExpr(emailType), mail, null, {}, context, ref => {
      if (!("$ref" in ref)) return { $void: true };
      const definition = registry.getIdentifiedEntity(ref.$ref)?.type;
      if (!definition || "$opaque" in definition) return { $void: true };
      return typeToSetExpr(definition) as unknown as FenelType;
    })).toEqual({ $tag: "Nothing" });
    const fn = registry.getFunction("DocumentDemo:composeDocumentEmail")!;
    expect(fn.params.map(param => param.name)).toEqual(["from", "to", "subject", "document"]);
    expect(fn.returns).toEqual({ $ref: "Email" });
  });

  test("the email preview uses the registered document type and its existing literal read plan", () => {
    const from = { $tag: "Address", local: "writer", domain: "example.com", displayName: { $tag: "Nothing" } };
    const to = [{ $tag: "Address", local: "reader", domain: "example.net", displayName: { $tag: "Nothing" } }];
    const body = "<script>literal mail body</script>\nSecond line";
    const document = { $tag: "RichDocument", blocks: [{ $tag: "DocParagraph", content: [{ $tag: "DocText", text: body }] }] };
    const preview = call("DocumentDemo:previewDocumentEmail", from, to, "<img> subject", document);
    expect(preview).toEqual({ $tag: "RichDocument", blocks: [
      { $tag: "DocParagraph", content: [{ $tag: "DocText", text: "From: writer@example.com" }] },
      { $tag: "DocParagraph", content: [{ $tag: "DocText", text: "To: reader@example.net" }] },
      { $tag: "DocSection", title: [{ $tag: "DocText", text: "<img> subject" }], blocks: [
        { $tag: "DocCode", language: { $tag: "Nothing" }, source: body },
      ] },
    ] });
    expect(registry.getFunction("DocumentDemo:previewDocumentEmail")!.returns).toEqual({ $ref: "RichDocument" });
    expect(call("std:documentReadPlan", preview)).toEqual([
      { $tag: "DocReadMarkup", markup: { $tag: "Element", tag: "p", attrs: [], children: [{ $tag: "Text", value: "From: writer@example.com" }] } },
      { $tag: "DocReadMarkup", markup: { $tag: "Element", tag: "p", attrs: [], children: [{ $tag: "Text", value: "To: reader@example.net" }] } },
      { $tag: "DocReadSection", heading: { $tag: "Element", tag: "h1", attrs: [], children: [{ $tag: "Text", value: "<img> subject" }] }, children: [
        { $tag: "DocReadMarkup", markup: { $tag: "Element", tag: "pre", attrs: [], children: [
          { $tag: "Element", tag: "code", attrs: [], children: [{ $tag: "Text", value: body }] },
        ] } },
      ] },
    ]);
  });
});
