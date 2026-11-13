import { beforeAll, describe, expect, test } from "bun:test";
import DOCUMENT from "../../../../fenel/modules/std/document.fenel?raw";
import FORMATS from "../../../../fenel/modules/std/document-formats.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { Just, Nothing } from "./type-foundation";

// Extends ledgered C1: execute actual Fenel export bodies. This fixture owns no
// serializer, URL policy, replacement document model, native or host callback.
let context: EvaluateContext;
beforeAll(() => {
  const source = loadFenelModuleUnion([{ src: DOCUMENT, name: "std" }, { src: FORMATS, name: "std" }])
    .find(module => module.name === "std")!;
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
const Ok = (value: string) => ({ $tag: "Ok", _0: value });
const exported = (format: "Markdown" | "Html", value: unknown) => call(`documentTo${format}`, value);
const error = (format: "Markdown" | "Html", value: unknown) => {
  expect(exported(format, value)).toMatchObject({ $tag: "Err", _0: expect.any(String) });
};

describe("source-owned document exports", () => {
  test("ordinary source signatures have bodies and no native counterpart", () => {
    for (const name of ["documentToMarkdown", "documentToHtml"]) {
      const fn = stdModule.functions?.find(fn => fn.id === `std:${name}`);
      expect(fn).toBeDefined();
      expect(fn!.body).toBeDefined();
      expect(fn!.params).toHaveLength(1);
      expect(fn!.params[0]!.type).toEqual({ $ref: "RichDocument" });
      expect(stdModule.nativeImpls?.[`std:${name}`]).toBeUndefined();
      expect(stdModule.nativeImplsCtx?.[`std:${name}`]).toBeUndefined();
    }
  });
  test("empty documents and empty paragraphs remain distinct", () => {
    for (const format of ["Markdown", "Html"] as const) {
      expect(exported(format, document())).toEqual(Ok(""));
      expect(exported(format, document(paragraph()))).toEqual(Ok("<p></p>"));
    }
  });

  test("HTML escapes markup, entity lookalikes and attribute quotes exactly once", () => {
    const candidate = document(paragraph(text('<script>&amp; "quoted"\' > 😀')),
      paragraph({ $tag: "DocLink", url: 'https://example.com/?a=1&b="quoted"', content: [text("literal <link>")] }));
    expect(exported("Html", candidate)).toEqual(Ok('<p>&lt;script&gt;&amp;amp; &quot;quoted&quot;&#39; &gt; 😀</p><p><a href="https://example.com/?a=1&amp;b=&quot;quoted&quot;">literal &lt;link&gt;</a></p>'));
    expect(candidate.blocks[0]).toEqual(paragraph(text('<script>&amp; "quoted"\' > 😀')));
  });

  test("nested inline styling and links use explicit XHTML boundaries in CommonMark", () => {
    const content = [{ $tag: "DocStrong", content: [{ $tag: "DocEmphasis", content: [text(" styled ")] }] },
      text(" *not emphasis* [not a link] & <script>"),
      { $tag: "DocLink", url: "/docs?q=a&b=c", content: [text("read")] }];
    expect(exported("Markdown", document(paragraph(...content)))).toEqual(Ok("<strong><em>&#32;styled&#32;</em></strong>&#32;\\*not&#32;emphasis\\*&#32;\\[not&#32;a&#32;link\\]&#32;&amp;&#32;&lt;script&gt;<a href=\"/docs?q=a&amp;b=c\">read</a>"));
    expect(exported("Html", document(paragraph(...content)))).toEqual(Ok('<p><strong><em> styled </em></strong> *not emphasis* [not a link] &amp; &lt;script&gt;<a href="/docs?q=a&amp;b=c">read</a></p>'));
  });

  test("literal paragraph whitespace cannot become Markdown block syntax", () => {
    expect(exported("Markdown", document(paragraph(text("    # heading\n\n> quote\tend\r"))))).toEqual(
      Ok("&#32;&#32;&#32;&#32;\\#&#32;heading&#10;&#10;&gt;&#32;quote&#9;end&#13;"));
    expect(exported("Html", document(paragraph(text("a\tb\nc\rd"))))).toEqual(Ok("<p>a&#9;b&#10;c&#13;d</p>"));
  });

  test("inline code uses collision-free delimiters without discarding edge spaces", () => {
    for (const [code, expected] of [["a`b", "``a`b``"], ["`", "`` ` ``"], [" a ", "`  a  `"], ["   ", "`   `"], ["", "<code></code>"]] as const) {
      const input = document(paragraph({ $tag: "DocInlineCode", code }));
      expect(exported("Markdown", input), code).toEqual(Ok(expected));
      expect(exported("Html", input)).toEqual(Ok(`<p><code>${code}</code></p>`));
    }
    error("Markdown", document(paragraph({ $tag: "DocInlineCode", code: "a\nb" })));
    expect(exported("Html", document(paragraph({ $tag: "DocInlineCode", code: "a\nb" })))).toEqual(Ok("<p><code>a&#10;b</code></p>"));
  });

  test("adjacent inline-code fences stay separate even across empty literal nodes", () => {
    const code = (value: string) => ({ $tag: "DocInlineCode", code: value });
    expect(exported("Markdown", document(paragraph(code("a"), text(""), code("b"))))).toEqual(Ok("`a`<!---->`b`"));
    expect(exported("Markdown", document(paragraph({ $tag: "DocEmphasis", content: [code("a"), code("   "), code(""), code("b")] })))).toEqual(
      Ok("<em>`a`<!---->`   `<code></code>`b`</em>"));
  });

  test("block-code fences cannot close on source backticks; exact non-LF source uses XHTML", () => {
    const source = "```\n<script>literal</script>\n````\n";
    expect(exported("Markdown", document({ $tag: "DocCode", language: Just("fenel"), source }))).toEqual(
      Ok("`````fenel\n" + source + "`````"));
    expect(exported("Markdown", document({ $tag: "DocCode", language: Nothing, source: "a\r\nb" }))).toEqual(
      Ok("<pre><code>a&#13;&#10;b</code></pre>"));
    expect(exported("Html", document({ $tag: "DocCode", language: Just('a"&b'), source: "<code>\t" }))).toEqual(
      Ok('<pre><code data-language="a&quot;&amp;b">&lt;code&gt;&#9;</code></pre>'));
    error("Markdown", document({ $tag: "DocCode", language: Just("bad`language"), source: "code\n" }));
  });

  test("section nesting drives headings and notes retain the surrounding depth", () => {
    const input = document({ $tag: "DocSection", title: [text("Outer")], blocks: [
      paragraph(text("body")), { $tag: "DocNote", blocks: [{ $tag: "DocSection", title: [text("Inner")], blocks: [paragraph(text("note"))] }] },
    ] });
    expect(exported("Html", input)).toEqual(Ok('<section><h1>Outer</h1><p>body</p><aside class="document-note"><section><h2>Inner</h2><p>note</p></section></aside></section>'));
    expect(exported("Markdown", input)).toEqual(Ok('# Outer\n\nbody\n\n<aside class="document-note"><section><h2>Inner</h2><p>note</p></section></aside>'));
    for (const format of ["Markdown", "Html"] as const) {
      error(format, document({ $tag: "DocSection", title: [text("line\nbreak")], blocks: [] }));
      let nested: unknown = paragraph(text("depth"));
      for (let i = 0; i < 7; i++) nested = { $tag: "DocSection", title: [text("level")], blocks: [nested] };
      error(format, document(nested));
    }
  });

  test("heading code entity lookalikes are literal rather than authored newlines", () => {
    const input = document({ $tag: "DocSection", title: [{ $tag: "DocInlineCode", code: "&#10; &#13;" }], blocks: [] });
    expect(exported("Markdown", input)).toEqual(Ok("# `&#10; &#13;`"));
    expect(exported("Html", input)).toEqual(Ok("<section><h1><code>&amp;#10; &amp;#13;</code></h1></section>"));
  });

  test("excessive inline nesting refuses before descending past the fragment", () => {
    let inline: unknown = text("deep");
    for (let i = 0; i < 70; i++) inline = { $tag: "DocEmphasis", content: [inline] };
    for (const format of ["Markdown", "Html"] as const) error(format, document(paragraph(inline)));
  });

  test.each(["https://example.com/path?q=a&b=c", "HTTP://example.com:8080/", "mailto:reader@example.com", "/docs", "./docs", "../docs", "#part"])(
    "safe URL %s uses the same Fenel policy in both formats", url => {
      for (const format of ["Markdown", "Html"] as const) {
        const result = exported(format, document(paragraph({ $tag: "DocLink", url, content: [text("label")] })));
        expect(result).toMatchObject({ $tag: "Ok", _0: expect.stringContaining("<a href=") });
      }
    });

  test.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "vbscript:code", "//evil.example", "https://", "https://user@example.com", "https://example.com:bad", "mailto:", "mailto:reader@example.com?subject=x", " https://example.com", "https://exa\nmple.com", "https://example.com\\@evil.test", "#\u0000bad", "https://example.com/\u00a0path"])(
    "unsafe or unsupported URL %s refuses the complete export", url => {
      for (const format of ["Markdown", "Html"] as const) error(format, document(paragraph({ $tag: "DocLink", url, content: [text("label")] })));
    });

  test("embeds, unknown/malformed nodes and nested links refuse instead of dropping data", () => {
    for (const format of ["Markdown", "Html"] as const) {
      for (const input of [
        document({ $tag: "DocEmbed", data: { $tag: "DocNumberData", number: 42 }, caption: [text("caption")] }),
        document({ $tag: "FutureBlock", source: "retained" }), document(paragraph({ $tag: "FutureInline", text: "retained" })),
        document(paragraph({ $tag: "DocText", text: 42 })), document({ $tag: "DocNote", blocks: "bad" }),
        document({ $tag: "DocCode", source: "literal", language: { $tag: "FutureLanguage" } }),
        { $tag: "RichDocument", blocks: "bad" }, { $tag: "OtherDocument", blocks: [] },
        document(paragraph({ $tag: "DocLink", url: "/outer", content: [{ $tag: "DocStrong", content: [{ $tag: "DocLink", url: "/inner", content: [text("nested")] }] }] })),
      ]) error(format, input);
    }
  });

  test.each(["\u0000", "\u000b", "\u007f", "\u0085", "\ud800", "\udfff", "\ufdd0", "\ufffe", "\uffff", "\u{1fffe}", "\u{10ffff}"])(
    "character %j outside the advertised XML-safe fragment refuses text and code", scalar => {
      for (const format of ["Markdown", "Html"] as const) {
        error(format, document(paragraph(text(`before${scalar}after`))));
        error(format, document({ $tag: "DocCode", language: Nothing, source: `before${scalar}after` }));
      }
    });

  test("paragraph/code/comment lookalikes are inert literal data", () => {
    const value = '<!-- --> <img onerror="alert(1)"> &copy; [x](javascript:code)';
    const input = document(paragraph(text(value)));
    const html = exported("Html", input) as { $tag: string; _0: string };
    expect(html.$tag).toBe("Ok");
    expect(html._0).toContain("&lt;!-- --&gt;");
    expect(html._0).not.toContain("<img");
    const markdown = exported("Markdown", input) as { $tag: string; _0: string };
    expect(markdown.$tag).toBe("Ok");
    expect(markdown._0).toContain("\\[x\\]\\(javascript\\:code\\)");
    expect(markdown._0).not.toContain("<img");
  });
});
