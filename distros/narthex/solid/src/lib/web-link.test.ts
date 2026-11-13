// Nov 12 (Rom: "A URL type should automatically give us in the UX a link"). A read value of a URL type opens in a
// new tab; one of an e-mail type opens with mailto:. Decided by the type; the chips' address test decides only where
// no type is known. Only http:, https: and mailto: ever become anchors. No registry.
//   bun test ./distros/narthex/solid/src/lib/web-link.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { FenelType } from "@fenel/engine/types";
import { stringFormats, webLink } from "./web-link";

const refined = (handle: string): FenelType => ({ $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle } } } as unknown as FenelType);
const types: Record<string, FenelType> = {
  UrlStr: refined("format:url"),
  EmailStr: refined("format:email"),
  SecureUrl: refined("format:url:web+secure"),
  Homepage: { $ref: "UrlStr" } as FenelType,
  InstagramUrl: { $refined: { base: { $ref: "String" }, set: { $tag: "SeIntersect", branches: [
    { $tag: "SeRef", handle: "format:url:web" }, { $tag: "SePattern", pattern: "instagram" }] } } } as unknown as FenelType,
  UrlOrName: { $refined: { base: { $ref: "String" }, set: { $tag: "SeUnion", branches: [
    { $tag: "SeRef", handle: "format:url" }, { $tag: "SePattern", pattern: "x" }] } } } as unknown as FenelType,
};
const resolve = (name: string) => types[name];
const ref = (name: string) => ({ $ref: name }) as FenelType;

describe("which read value is a link", () => {
  test("a URL type's value opens over https or http", () => {
    expect(webLink("https://usefenel.com", ref("UrlStr"), resolve)).toEqual({ href: "https://usefenel.com", kind: "web" });
    expect(webLink("http://example.org/a?b=1#c", ref("UrlStr"), resolve)).toEqual({ href: "http://example.org/a?b=1#c", kind: "web" });
    expect(webLink("https://x.com/usefenel", ref("Homepage"), resolve)?.href).toBe("https://x.com/usefenel");
    expect(webLink("https://instagram.com/a", ref("InstagramUrl"), resolve)?.href).toBe("https://instagram.com/a");
    expect(webLink("https://usefenel.com", ref("SecureUrl"), resolve)?.kind).toBe("web");
    expect(webLink("https://usefenel.com", types.UrlStr, resolve)?.kind).toBe("web");
  });

  test("an e-mail type's value opens with mailto:", () => {
    expect(webLink("contact@usefenel.com", ref("EmailStr"), resolve)).toEqual({ href: "mailto:contact@usefenel.com", kind: "mail" });
  });

  test("no other scheme ever becomes a link, whatever the type says", () => {
    for (const value of ["javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "data:text/html,<b>x</b>",
      "vbscript:x", "file:///etc/passwd", "//evil.example", "https://", "https://a b", "https://a\nb", "mailto:x@y.z"]) {
      expect(webLink(value, ref("UrlStr"), resolve)).toBeUndefined();
      expect(webLink(value, undefined)).toBeUndefined();
    }
    for (const value of ["javascript:alert(1)@x.com", "a@b.com?cc=c@d.com", "a@b.com,c@d.com", "a@b", "<a@b.com>", "a b@c.com"]) {
      expect(webLink(value, ref("EmailStr"), resolve)).toBeUndefined();
    }
  });

  test("a known type that is not an address stays text, even when the text looks like one", () => {
    expect(webLink("https://usefenel.com", ref("String"), resolve)).toBeUndefined();
    expect(webLink("contact@usefenel.com", ref("UrlStr"), resolve)).toBeUndefined();
    expect(webLink("https://usefenel.com", ref("EmailStr"), resolve)).toBeUndefined();
    // A union promises none of its branches.
    expect(webLink("https://usefenel.com", ref("UrlOrName"), resolve)).toBeUndefined();
    expect(webLink(42, ref("UrlStr"), resolve)).toBeUndefined();
  });

  test("without a type, only an http(s) address written in full is a link", () => {
    expect(webLink("https://usefenel.com", undefined)?.href).toBe("https://usefenel.com");
    expect(webLink("contact@usefenel.com", undefined)).toBeUndefined();
    expect(webLink("usefenel.com", undefined)).toBeUndefined();
  });

  test("a resolver that fails or loops answers no format", () => {
    expect(stringFormats(ref("UrlStr"), () => { throw new Error("no registry"); })).toEqual([]);
    expect(stringFormats(ref("Loop"), name => ({ $ref: name === "Loop" ? "Loop2" : "Loop" }) as FenelType)).toEqual([]);
  });
});

describe("the read surfaces use it", () => {
  const source = async (path: string) => (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll("\r\n", "\n");

  test("a string read is an anchor that opens a new tab without an opener", async () => {
    const preview = await source("./data-transfer/DataPreview.tsx");
    const anchor = preview.slice(preview.indexOf("export function DelimitedText"), preview.indexOf("/** Media uses a bounded preview"));
    expect(anchor).toContain("webLink(props.value, props.type, props.resolveType)");
    expect(anchor).toContain('target="_blank" rel="noopener noreferrer"');
    expect(anchor).toContain("href={address().href}");
    expect(anchor).not.toContain("title=");
  });

  test("the typed reader and the variant renderer pass the value's type", async () => {
    expect(await source("./layout-renderer/TypedReadValue.tsx")).toContain("<DelimitedText value={props.value as string} type={valueType()} resolveType={resolveType} />");
    expect(await source("./variant-value/VariantValueRenderer.tsx")).toContain("<StringRender value={v() as string} type={props.type} resolveType={props.resolveType} />");
  });
});
