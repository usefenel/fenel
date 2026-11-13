import { beforeAll, describe, expect, test } from "bun:test";
import DOCUMENT from "../../../../fenel/modules/std/document.fenel?raw";
import FORMATS from "../../../../fenel/modules/std/document-formats.fenel?raw";
import IMPORT_HTML from "../../../../fenel/modules/std/document-html-import.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { Just, Nothing } from "./type-foundation";

// Extends ledgered C1: execute the actual Fenel importer and exporter bodies.
// This harness supplies no HTML parser, serializer, URL policy or native shim.
let context: EvaluateContext;
beforeAll(() => {
  const source = loadFenelModuleUnion([
    { src: DOCUMENT, name: "std" }, { src: FORMATS, name: "std" },
    { src: IMPORT_HTML, name: "std" },
  ]).find(module => module.name === "std")!;
  const functions = source.functions ?? [];
  const entities = source.entities ?? [];
  const registry = createRegistry([{ ...stdModule,
    functions: [...(stdModule.functions ?? []).filter(fn => !functions.some(other => other.id === fn.id)), ...functions],
    entities: [...(stdModule.entities ?? []).filter(entity => !entities.some(other => other.id === entity.id)), ...entities],
  }]);
  context = registry.evaluateContext();
}, 180_000);

const call = (name: string, ...args: unknown[]) => invokeCallable({ $ref: `std:${name}` }, args, context);
const text = (value: string) => ({ $tag: "DocText", text: value });
const paragraph = (...content: unknown[]) => ({ $tag: "DocParagraph", content });
const document = (...blocks: unknown[]) => ({ $tag: "RichDocument", blocks });
const Ok = (value: unknown) => ({ $tag: "Ok", _0: value });
const imported = (source: unknown) => call("documentFromHtml", source);
// Bun's nested asymmetric toMatchObject matcher replaced the checked _0
// payload in this fixture; explicit field assertions preserve later messages.
const refused = (source: unknown) => {
  const result = imported(source) as { $tag: string; _0: unknown };
  expect(result.$tag).toBe("Err");
  expect(typeof result._0).toBe("string");
  expect(result._0 as string).toContain("code-point");
  return result as { $tag: "Err"; _0: string };
};
const roundTrip = (input: unknown, normalized: unknown = input) => {
  const html = call("documentToHtml", input) as { $tag: string; _0: string };
  expect(html.$tag).toBe("Ok");
  expect(imported(html._0)).toEqual(Ok(normalized));
  expect(call("documentToHtml", normalized)).toEqual(Ok(html._0));
};

describe("source-owned bounded document HTML import", () => {
  test("ordinary source signature has a body and no native counterpart", () => {
    const fn = stdModule.functions?.find(fn => fn.id === "std:documentFromHtml");
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
    expect(fn!.params).toHaveLength(1);
    expect(fn!.params[0]!.type).toEqual({ $ref: "String" });
    expect(stdModule.nativeImpls?.[fn!.id]).toBeUndefined();
    expect(stdModule.nativeImplsCtx?.[fn!.id]).toBeUndefined();
  });

  test("empty documents, paragraphs, styles, links and code stay distinct", () => {
    expect(imported("")).toEqual(Ok(document()));
    expect(imported('<p></p><p><em></em><strong></strong><a href="/docs"></a><code></code></p><pre><code></code></pre>')).toEqual(Ok(document(
      paragraph(), paragraph(
        { $tag: "DocEmphasis", content: [] }, { $tag: "DocStrong", content: [] },
        { $tag: "DocLink", url: "/docs", content: [] }, { $tag: "DocInlineCode", code: "" },
      ), { $tag: "DocCode", language: Nothing, source: "" },
    )));
  });

  test("adjacent/empty text normalizes while structural boundaries survive", () => {
    const input = document(paragraph(text(""), text("a"), text("b"),
      { $tag: "DocEmphasis", content: [text(""), text("c"), text("d")] },
      text(""), text("e"), text("f")), paragraph(text("")));
    const normalized = document(paragraph(text("ab"),
      { $tag: "DocEmphasis", content: [text("cd")] }, text("ef")), paragraph());
    roundTrip(input, normalized);
  });

  test("all existing representable blocks and inlines round trip together", () => {
    const input = document({ $tag: "DocSection", title: [text("Outer "), { $tag: "DocInlineCode", code: "&#10;" }], blocks: [
      paragraph(text('<literal> &amp; "quoted"\' 😀 𝄞\t\n\r'),
        { $tag: "DocStrong", content: [{ $tag: "DocEmphasis", content: [text(" composed ")] }] },
        { $tag: "DocLink", url: 'https://example.com/path😀?a=1&b="quoted"', content: [text("link"), { $tag: "DocInlineCode", code: "x\ny\r\tz" }] }),
      { $tag: "DocCode", language: Just('λ\t\n\r"&<>'), source: '<!-- -->\n<script>literal</script>\t\r &amp;' },
      { $tag: "DocNote", blocks: [{ $tag: "DocSection", title: [text("Inner")], blocks: [paragraph(text("note"))] }] },
    ] }, paragraph(text("a root sibling after the section")));
    roundTrip(input);
  });

  test("absent and explicitly empty code languages preserve their Maybe", () => {
    expect(imported('<pre><code>x</code></pre><pre><code data-language="">x</code></pre>')).toEqual(Ok(document(
      { $tag: "DocCode", language: Nothing, source: "x" },
      { $tag: "DocCode", language: Just(""), source: "x" },
    )));
    roundTrip(document({ $tag: "DocCode", language: Just(""), source: "x" }));
  });

  test("five XML entities and decimal/hex scalar references decode once", () => {
    const html = '<p>&amp;&lt;&gt;&quot;&apos;&#39;&#32;&#9;&#10;&#13;&#128512;&#x1F600;&amp;lt;&amp;#10;</p>';
    expect(imported(html)).toEqual(Ok(document(paragraph(text('&<>"\'\' \t\n\r😀😀&lt;&#10;')))));
    expect(imported('<p><code>&amp;lt;</code><a href="/docs?q=&amp;lt;">literal</a></p>')).toEqual(Ok(document(paragraph(
      { $tag: "DocInlineCode", code: "&lt;" },
      { $tag: "DocLink", url: "/docs?q=&lt;", content: [text("literal")] },
    ))));
  });

  test("XML-preserved raw whitespace and referenced controls remain exact", () => {
    expect(imported('<p> \t\n&#13;😀 </p><pre><code data-language="a&#9;&#10;&#13;b">\t\n&#13;</code></pre>')).toEqual(Ok(document(
      paragraph(text(" \t\n\r😀 ")),
      { $tag: "DocCode", language: Just("a\t\n\rb"), source: "\t\n\r" },
    )));
    expect(refused('<p><a href="/docs&#9;path">bad</a></p>')._0).toContain("links");
    refused('<p>raw\rreturn</p>');
    for (const control of ["\t", "\n", "\r"]) refused(`<pre><code data-language="a${control}b">x</code></pre>`);
  });

  test.each(["https://example.com/path?q=a&b=c", "HTTP://example.com:8080/", "mailto:reader@example.com", "/docs", "./docs", "../docs", "#part"])(
    "shared export URL fragment admits %s", url => roundTrip(document(paragraph({ $tag: "DocLink", url, content: [text("label")] }))));

  test.each([
    '<script>alert(1)</script>', '<p onclick="run()">x</p>', '<p style="color:red">x</p>', '<P>x</P>',
    '<p><b>x</b></p>', '<p><img src="/img"/></p>', '<p><br/></p>', '<p><span>x</span></p>',
    '<aside>x</aside>', '<aside class="other"></aside>', '<aside class="document-note" id="x"></aside>',
    '<a href="/docs">outside</a>', '<section id="x"><h1>x</h1></section>', '<h1>x</h1>',
    '<pre><code class="language-js">x</code></pre>', '<pre><code data-language="js" data-language="ts">x</code></pre>',
    '<p><a href="/x" href="/y">x</a></p>', "<p><a href='/x'>x</a></p>", '<p><a href ="/x">x</a></p>',
    '<!DOCTYPE html><p>x</p>', '<?xml version="1.0"?><p>x</p>', '<!--comment--><p>x</p>', '<p><![CDATA[x]]></p>',
  ])("unsupported or active HTML refuses whole source: %s", source => { refused(source); });

  test.each([
    '<p>x', '<p>x</strong>', '<p><em>x</p></em>', '<p>x</p>junk', '<p>x</p><p>', '<p>x</p></p>',
    '<p><a href="/docs>x</a></p>', '<p><a href="/docs" extra="x">x</a></p>',
    '<pre><code>x<em>y</em></code></pre>', '<p>raw & unfinished</p>', '<p>raw ]]></p>',
    '<p><a href="/raw<path">x</a></p>', ' <p>x</p>', '<p>x</p>\n<p>y</p>',
  ])("malformed/trailing/unrepresented source refuses: %s", source => { refused(source); });

  test.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,code", "tel:123", "//evil.example",
    "https://", "https://user@example.com", "https://example.com:bad", "mailto:", "mailto:a@b?subject=x",
    " https://example.com", "https://example.com\\@evil.test", "/path\u00a0gap",
  ])("shared export URL fragment refuses %s", url => {
    refused(`<p><a href="${url}">label</a></p>`);
  });

  test("entity decoding cannot hide unsafe URLs or create nested markup", () => {
    refused('<p><a href="jav&#97;script:alert(1)">bad</a></p>');
    refused('<p><a href="&#47;&#47;evil.example">bad</a></p>');
    refused('<p><a href="/outer"><strong><a href="/inner">nested</a></strong></a></p>');
    expect(imported('<p>&lt;script&gt;&amp;lt;script&amp;gt;</p>')).toEqual(Ok(document(paragraph(text('<script>&lt;script&gt;')))));
  });

  test.each(["&copy;", "&AMP;", "&lt", "&#;", "&#x;", "&#X41;", "&#-1;", "&#1.0;", "&#xZZ;", "&#1114112;", "&#999999999999999999999999;", "&#0;", "&#11;", "&#127;", "&#133;", "&#55296;", "&#57343;", "&#64976;", "&#65534;", "&#x10FFFF;"])(
    "unknown/malformed/prohibited entity %s refuses", entity => { refused(`<p>${entity}</p>`); });

  test.each(["\u0000", "\u000b", "\u007f", "\u0085", "\ud800", "\udfff", "\ufdd0", "\ufffe", "\u{1fffe}"])(
    "raw scalar %j outside export policy refuses", scalar => {
      refused(`<p>${scalar}</p>`);
      refused(`<pre><code data-language="${scalar}">x</code></pre>`);
    });

  test("section headings follow nesting and notes retain section depth", () => {
    refused('<section><h2>wrong root depth</h2></section>');
    refused('<section><h1>outer</h1><section><h1>wrong child</h1></section></section>');
    refused('<section><h1>line&#10;break</h1></section>');
    refused('<section><h1><code>line\nbreak</code></h1></section>');
    expect(imported('<aside class="document-note"><section><h1>inside root note</h1></section></aside>')).toEqual(Ok(document(
      { $tag: "DocNote", blocks: [{ $tag: "DocSection", title: [text("inside root note")], blocks: [] }] },
    )));
    let sections = '<p>body</p>';
    for (let depth = 7; depth >= 1; depth--) sections = `<section><h${depth}>h</h${depth}>${sections}</section>`;
    refused(sections);
  });

  test("code-point offsets count non-BMP text as one character", () => {
    expect(refused('<p>😀</p>junk')._0).toContain("code-point 8");
    expect(refused('<p>😀&copy;</p>')._0).toContain("code-point 4");
  });

  test("source size is bounded by code points, including non-BMP text", () => {
    const value = "😀".repeat(8185);
    expect(imported(`<p>${value}</p>`)).toEqual(Ok(document(paragraph(text(value)))));
    expect(refused(`<p>${value}x</p>`)._0).toContain("exceeds 8192");
    refused(42);
  }, 60_000);

  test("bounded sibling blocks and inline nodes terminate without recursion overflow", () => {
    const blocks = imported("<p></p>".repeat(1000)) as { $tag: string; _0: { blocks: unknown[] } };
    expect(blocks.$tag).toBe("Ok");
    expect(blocks._0.blocks).toHaveLength(1000);
    const inlines = imported(`<p>${"<em></em>".repeat(900)}</p>`) as { $tag: string; _0: { blocks: { content: unknown[] }[] } };
    expect(inlines.$tag).toBe("Ok");
    expect(inlines._0.blocks[0]!.content).toHaveLength(900);
  }, 60_000);

  test("nesting uses the same 64 traversal-step export boundary", () => {
    const wrap = (content: string) => `<aside class="document-note">${content}</aside>`;
    let admitted = '<p></p>';
    for (let depth = 0; depth < 63; depth++) admitted = wrap(admitted);
    expect(imported(admitted)).toMatchObject({ $tag: "Ok" });
    expect(refused(wrap(admitted))._0).toContain("nesting exceeds 64");
    let textTooDeep = '<p>x</p>';
    for (let depth = 0; depth < 63; depth++) textTooDeep = wrap(textTooDeep);
    expect(refused(textTooDeep)._0).toContain("nesting exceeds 64");
    let styled = 'x';
    for (let depth = 0; depth < 70; depth++) styled = `<em>${styled}</em>`;
    expect(refused(`<p>${styled}</p>`)._0).toContain("nesting exceeds 64");
  });
});
