import { beforeAll, describe, expect, test } from "bun:test";
import DOCUMENT from "../../../../fenel/modules/std/document.fenel?raw";
import FORMATS from "../../../../fenel/modules/std/document-formats.fenel?raw";
import IMPORT_HTML from "../../../../fenel/modules/std/document-html-import.fenel?raw";
import IMPORT_MARKDOWN from "../../../../fenel/modules/std/document-markdown-import.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { Just, Nothing } from "./type-foundation";

// Extends ledgered C1: execute the real Fenel reader/exporter, with no parser,
// format policy, document tree or native implementation supplied by the host.
let context: EvaluateContext;
beforeAll(() => {
  const source = loadFenelModuleUnion([
    { src: DOCUMENT, name: "std" }, { src: FORMATS, name: "std" },
    { src: IMPORT_HTML, name: "std" }, { src: IMPORT_MARKDOWN, name: "std" },
  ]).find(module => module.name === "std")!;
  const functions = source.functions ?? [];
  const entities = source.entities ?? [];
  context = createRegistry([{ ...stdModule,
    functions: [...(stdModule.functions ?? []).filter(fn => !functions.some(other => other.id === fn.id)), ...functions],
    entities: [...(stdModule.entities ?? []).filter(entity => !entities.some(other => other.id === entity.id)), ...entities],
  }]).evaluateContext();
}, 180_000);

const call = (name: string, ...args: unknown[]) => invokeCallable({ $ref: `std:${name}` }, args, context);
const text = (value: string) => ({ $tag: "DocText", text: value });
const code = (value: string) => ({ $tag: "DocInlineCode", code: value });
const paragraph = (...content: unknown[]) => ({ $tag: "DocParagraph", content });
const section = (title: string, ...blocks: unknown[]) => ({ $tag: "DocSection", title: title ? [text(title)] : [], blocks });
const document = (...blocks: unknown[]) => ({ $tag: "RichDocument", blocks });
const Ok = (value: unknown) => ({ $tag: "Ok", _0: value });
const imported = (source: unknown) => call("documentFromMarkdown", source);
const refused = (source: unknown) => {
  const result = imported(source) as { $tag: string; _0: unknown };
  expect(result.$tag).toBe("Err");
  expect(typeof result._0).toBe("string");
  expect(result._0 as string).toContain("code-point");
  return result as { $tag: "Err"; _0: string };
};
const roundTrip = (input: unknown, normalized: unknown = input) => {
  const markdown = call("documentToMarkdown", input) as { $tag: string; _0: string };
  expect(markdown.$tag).toBe("Ok");
  expect(imported(markdown._0)).toEqual(Ok(normalized));
  expect(call("documentToMarkdown", normalized)).toEqual(Ok(markdown._0));
};

describe("source-owned bounded Document Markdown import", () => {
  test("registered signature has a Fenel body and no native counterpart", () => {
    const fn = stdModule.functions?.find(fn => fn.id === "std:documentFromMarkdown");
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
    expect(fn!.params).toHaveLength(1);
    expect(fn!.params[0]!.type).toEqual({ $ref: "String" });
    expect(stdModule.nativeImpls?.[fn!.id]).toBeUndefined();
    expect(stdModule.nativeImplsCtx?.[fn!.id]).toBeUndefined();
  });

  test("empty source, empty paragraphs and empty structural inlines remain distinct", () => {
    expect(imported("\n\n")).toEqual(Ok(document()));
    roundTrip(document());
    roundTrip(document(paragraph()));
    roundTrip(document(paragraph({ $tag: "DocEmphasis", content: [] }, { $tag: "DocStrong", content: [] },
      { $tag: "DocLink", url: "/docs", content: [] }, code(""))));
    expect(imported("#")).toEqual(Ok(document(section(""))));
    expect(imported("# ")).toEqual(Ok(document(section(""))));
  });

  test("ordinary public sample becomes the shared typed outline", () => {
    const source = "# An article across formats\n\nHello <strong>typed data</strong> &amp; literal &lt;text&gt;.\n\n## Editable data\n\nA bounded outline stays editable.";
    expect(imported(source)).toEqual(Ok(document(section("An article across formats",
      paragraph(text("Hello "), { $tag: "DocStrong", content: [text("typed data")] }, text(" & literal <text>.")),
      section("Editable data", paragraph(text("A bounded outline stays editable.")))))));
  });

  test("headings close same/deeper sections and keep leading root blocks", () => {
    expect(imported("intro\n\n# A\n\na\n\n## B\n\nb\n\n## C\n\nc\n\n# D\n\nd")).toEqual(Ok(document(
      paragraph(text("intro")), section("A", paragraph(text("a")), section("B", paragraph(text("b"))), section("C", paragraph(text("c")))),
      section("D", paragraph(text("d"))),
    )));
    refused("## Missing parent");
    refused("# A\n\n### Missing middle");
    refused("####### Too deep");
  });

  test("arbitrary section-end boundaries intentionally normalize to an outline", () => {
    const input = document(section("A", paragraph(text("inside"))), paragraph(text("root sibling")));
    const serialized = call("documentToMarkdown", input) as { $tag: string; _0: string };
    const normalized = document(section("A", paragraph(text("inside")), paragraph(text("root sibling"))));
    expect(imported(serialized._0)).toEqual(Ok(normalized));
    expect(call("documentToMarkdown", normalized)).toEqual(serialized);
    expect(imported("# A\n\n## B\n\nbody after B")).toEqual(Ok(document(section("A", section("B", paragraph(text("body after B")))))));
  });

  test("outline-shaped documents round trip with adjacent/empty text normalization", () => {
    const input = document(paragraph(text(""), text("before")), section("A",
      paragraph(text("a"), text("b"), { $tag: "DocEmphasis", content: [text(""), text("c"), text("d")] }),
      section("B", paragraph(text("child")))), section("C"));
    const normalized = document(paragraph(text("before")), section("A",
      paragraph(text("ab"), { $tag: "DocEmphasis", content: [text("cd")] }),
      section("B", paragraph(text("child")))), section("C"));
    roundTrip(input, normalized);
  });

  test("mixed XHTML style/link content parses Markdown spans rather than literal backticks", () => {
    roundTrip(document(paragraph({ $tag: "DocStrong", content: [{ $tag: "DocEmphasis", content: [code("a`b"), text(" "), code("   "), code(""), code("`edge`")] }] },
      { $tag: "DocLink", url: "/docs?q=a&b=c", content: [code("a"), code("b"), text("<literal>")] })));
    expect(imported('<em>`x`&amp;lt;</em>')).toEqual(Ok(document(paragraph({ $tag: "DocEmphasis", content: [code("x"), text("&lt;")] }))));
    expect(imported("a\\`<!---->`b`")).toEqual(Ok(document(paragraph(text("a`"), code("b")))));
    roundTrip(document(paragraph(text("a`"), code("b"))));
  });

  test.each(["a`b", "`", " a ", "   ", "", "a``b", "`a`", "\tcode\t", "&#10; &amp; <script>"])(
    "inline code %j preserves literal contents and padding", value => roundTrip(document(paragraph(code(value)))));

  test("paragraph entities decode once; escaped punctuation is never reinterpreted", () => {
    const literal = "    # heading\n\n> quote\tend\r &amp; [x](url) *style* \\ 😀";
    roundTrip(document(paragraph(text(literal))));
    expect(imported("&amp;lt;&#128512;&#x1F600;\\*\\[\\]\\&")).toEqual(Ok(document(paragraph(text("&lt;😀😀*[]&")))));
    expect(imported("&#0000065;&#x000041;")).toEqual(Ok(document(paragraph(text("AA")))));
    roundTrip(document(section("escaped #", paragraph(text("body")))));
    expect(imported("# `&#10; &#13;`")).toEqual(Ok(document({ $tag: "DocSection", title: [code("&#10; &#13;")], blocks: [] })));
    refused("# line&#10;break");
    refused("# title #");
    refused("# #");
  });

  test("fenced code stays literal, including shorter delimiter runs and XML lookalikes", () => {
    const source = "```\n<script>&amp; literal\n````\n";
    roundTrip(document({ $tag: "DocCode", language: Just("fenel"), source }));
    expect(imported("```js\n&amp;\n``\n````")).toEqual(Ok(document({ $tag: "DocCode", language: Just("js"), source: "&amp;\n``\n" })));
    expect(imported("```\ncode\n  ``` \t\n# After")).toEqual(Ok(document({ $tag: "DocCode", language: Nothing, source: "code\n" }, section("After"))));
    expect(imported("```\n```")).toEqual(Ok(document({ $tag: "DocCode", language: Nothing, source: "" })));
    roundTrip(document({ $tag: "DocCode", language: Nothing, source: "line\n" }));
    roundTrip(document({ $tag: "DocCode", language: Just("fenel"), source: "no final newline\r\n" }));
    refused("```js\ncode");
    refused("```bad language\ncode\n```");
    refused('<pre><code data-language="">x</code></pre>');
  });

  test("XHTML blocks reuse exact literal parsing and notes retain explicit trees", () => {
    const note = { $tag: "DocNote", blocks: [section("Inside", paragraph(text("literal `code`")), { $tag: "DocCode", language: Just("λ"), source: "x\r\n" }), paragraph(code("a\nb"))] };
    roundTrip(document(paragraph(), { $tag: "DocCode", language: Nothing, source: "x\r\n" }, note));
    expect(imported("<p>`literal`</p>")).toEqual(Ok(document(paragraph(text("`literal`")))));
    expect(imported('# A\n\n<aside class="document-note"><section><h1>Relocated</h1><p>note</p></section><p>sibling</p></aside>')).toEqual(Ok(document(section("A",
      { $tag: "DocNote", blocks: [section("Relocated", paragraph(text("note"))), paragraph(text("sibling"))] },
    ))));
    const deep = "# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F\n\n<aside class=\"document-note\"><section><h1>Too deep after relocation</h1></section></aside>";
    expect(refused(deep)._0).toContain("heading levels beyond six");
  });

  test.each(["*style*", "_style_", "[link](/docs)", "![image](/img)", "> quote", "- item", "+ item", "-", "+", "1. item", "1) item", "1.", "1)", "---", "- - -", "~~~js\ncode\n~~~", "    indented", "soft\nwrapped", "trailing  ", "raw\ttab", "text\\", "\\a", "`unclosed", "<em>unclosed", "<strong>x</em>", "<!---->", "a<!---->b", "hello <code>*styled*</code>", "hello <code>`code`</code>"])(
    "unsupported/malformed Markdown refuses whole source: %j", source => { refused(source); });

  test.each(['<script>x</script>', '<img src="/x"/>', '<p onclick="x">active</p>', '<em onclick="x">active</em>', '<!--comment-->', '<!DOCTYPE html>', '<section><h1>explicit section</h1></section>', '<a href="/x">outer<a href="/y">inner</a></a>', '<a href="javascript:alert(1)">bad</a>', '<a href="jav&#97;script:code">bad</a>', '<a href="&#47;&#47;evil.example">bad</a>', '<aside class="document-note"><p><a href="javascript:code">bad</a></p></aside>'])(
    "unrecognized/active XHTML refuses whole source: %s", source => { refused(source); });

  test("raw XHTML blocks require blank-line termination before Markdown resumes", () => {
    for (const block of ['<p>x</p>', '<pre><code>x</code></pre>', '<aside class="document-note"><p>x</p></aside>']) {
      refused(`${block}\n# Heading`);
      refused(`${block}\nparagraph`);
      expect(imported(`${block}\n\n# Heading`)).toMatchObject({ $tag: "Ok" });
      expect(imported(`${block}\n`)).toMatchObject({ $tag: "Ok" });
    }
    expect(imported("```\nx\n```\n# Heading")).toEqual(Ok(document({ $tag: "DocCode", language: Nothing, source: "x\n" }, section("Heading"))));
  });

  test.each(["&copy;", "&AMP;", "&lt", "&#;", "&#x;", "&#X41;", "&#0;", "&#11;", "&#127;", "&#55296;", "&#65534;", "&#1114112;", "&#000000000000065;", "&#x000000000041;"])(
    "unsupported/malformed entity %s refuses", entity => { refused(entity); });

  test.each(["\u0000", "\u000b", "\u007f", "\u0085", "\ud800", "\udfff", "\ufdd0", "\ufffe", "\u{1fffe}"])(
    "raw invalid XML scalar %j refuses", scalar => { refused(`before${scalar}after`); });

  test("source bounds and errors use Unicode code points", () => {
    expect(imported("😀".repeat(8192))).toEqual(Ok(document(paragraph(text("😀".repeat(8192))))));
    expect(refused("😀".repeat(8193))._0).toContain("exceeds 8192");
    expect(refused("😀&copy;")._0).toContain("code-point 1");
    expect(refused("😀\r")._0).toContain("code-point 1");
    refused(42);
  }, 60_000);

  test("many siblings terminate and normalized traversal retains the existing bound", () => {
    const siblings = imported(Array(1000).fill("<p></p>").join("\n\n")) as { $tag: string; _0: { blocks: unknown[] } };
    expect(siblings.$tag).toBe("Err"); // 8998 code points exceed the declared bound.
    const bounded = imported(Array(800).fill("<p></p>").join("\n\n")) as { $tag: string; _0: { blocks: unknown[] } };
    expect(bounded.$tag).toBe("Ok");
    expect(bounded._0.blocks).toHaveLength(800);
    let styled = "x";
    for (let depth = 0; depth < 70; depth++) styled = `<em>${styled}</em>`;
    expect(refused(styled)._0).toContain("nesting exceeds 64");
    let notes = "<p></p>";
    for (let depth = 0; depth < 64; depth++) notes = `<aside class="document-note">${notes}</aside>`;
    expect(refused(notes)._0).toContain("nesting exceeds 64");
  }, 60_000);
});
