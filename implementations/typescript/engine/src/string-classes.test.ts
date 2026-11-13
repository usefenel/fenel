import { describe, it, expect } from "vitest";
import "./string-classes";
import {
  stringByteLength,
  stringCodepointLength,
  stringGraphemeLength,
} from "./string-classes";
import { containsB as contains } from "./set-algebra";

const named = (name: string) => ({ $tag: "SeRef", handle: name }) as const;
const yes = (name: string, v: unknown) => expect(contains(named(name), v, null)).toBe(true);
const no  = (name: string, v: unknown) => expect(contains(named(name), v, null)).toBe(false);

describe("str:case:*", () => {
  it("camel — accepts camelCase, rejects all-lower / Pascal / underscored", () => {
    yes("str:case:camel", "myVariable");
    yes("str:case:camel", "isHttpRequest");
    no("str:case:camel", "myvariable");        // no boundary
    no("str:case:camel", "MyVariable");        // pascal
    no("str:case:camel", "my_variable");       // snake
    no("str:case:camel", "");
  });

  it("pascal — accepts PascalCase", () => {
    yes("str:case:pascal", "MyClass");
    yes("str:case:pascal", "Foo");
    yes("str:case:pascal", "HTTPServer");
    no("str:case:pascal", "myClass");
    no("str:case:pascal", "my_class");
  });

  it("snake — accepts lower_snake", () => {
    yes("str:case:snake", "my_variable");
    yes("str:case:snake", "abc");
    yes("str:case:snake", "abc123");
    no("str:case:snake", "MyVariable");
    no("str:case:snake", "my-variable");
    no("str:case:snake", "_leading");
    no("str:case:snake", "trailing_");
    no("str:case:snake", "double__under");
  });

  it("kebab — accepts kebab-case", () => {
    yes("str:case:kebab", "my-variable");
    yes("str:case:kebab", "page-not-found");
    yes("str:case:kebab", "myvariable");       // single word counts
    no("str:case:kebab", "my_variable");
    no("str:case:kebab", "-leading");
    no("str:case:kebab", "trailing-");
    no("str:case:kebab", "double--dash");
  });

  it("screaming — accepts SCREAMING_SNAKE", () => {
    yes("str:case:screaming", "MAX_LENGTH");
    yes("str:case:screaming", "ABC");
    no("str:case:screaming", "Max_Length");
    no("str:case:screaming", "max_length");
  });

  it("title — accepts Title Case", () => {
    yes("str:case:title", "Hello World");
    yes("str:case:title", "Hello");
    no("str:case:title", "hello world");
    no("str:case:title", "Hello world");
    no("str:case:title", "HELLO WORLD");
  });
});

describe("str:encoding:*", () => {
  it("utf8/utf16 — well-formed JS strings pass", () => {
    yes("str:encoding:utf8", "hello");
    yes("str:encoding:utf16", "hello");
    yes("str:encoding:utf8", "é");
    yes("str:encoding:utf8", "😀");  // 😀 — surrogate pair
  });

  it("utf16 — lone surrogate fails", () => {
    no("str:encoding:utf16", "\ud83d");
    no("str:encoding:utf16", "\udc00abc");
    no("str:encoding:utf8", "\ud83d");
  });

  it("ascii-compat — codepoints ≤ 0x7f", () => {
    yes("str:encoding:ascii-compat", "hello world");
    yes("str:encoding:ascii-compat", "");
    no("str:encoding:ascii-compat", "héllo");
    no("str:encoding:ascii-compat", "helloÿ");
  });
});

describe("str:nf:*", () => {
  it("NFC — composed form passes", () => {
    yes("str:nf:c", "café");                   // composed by source
    yes("str:nf:c", "abc");
  });

  it("NFD — decomposed form passes", () => {
    yes("str:nf:d", "café");             // 'e' + combining acute
    no("str:nf:d", "café");               // composed é
  });

  it("NFKC / NFKD — work", () => {
    yes("str:nf:kc", "abc");
    yes("str:nf:kd", "abc");
  });
});

describe("str:identifier:*", () => {
  it("js — accepts standard JS identifiers, rejects reserved + invalid first char", () => {
    yes("str:identifier:js", "myVar");
    yes("str:identifier:js", "_private");
    yes("str:identifier:js", "$jquery");
    yes("str:identifier:js", "x123");
    no("str:identifier:js", "1abc");
    no("str:identifier:js", "");
    no("str:identifier:js", "class");
    no("str:identifier:js", "if");
    no("str:identifier:js", "my-var");
  });

  it("py — accepts unicode + underscore, rejects reserved", () => {
    yes("str:identifier:py", "snake_case");
    yes("str:identifier:py", "_private");
    yes("str:identifier:py", "café");
    no("str:identifier:py", "1abc");
    no("str:identifier:py", "$dollar");        // py disallows $
    no("str:identifier:py", "def");
  });

  it("rust — accepts unicode XID, rejects reserved", () => {
    yes("str:identifier:rust", "my_func");
    no("str:identifier:rust", "fn");
    no("str:identifier:rust", "$foo");
  });

  it("sql — ascii letters/digits/underscore, no reserved (case-insensitive)", () => {
    yes("str:identifier:sql", "user_id");
    yes("str:identifier:sql", "MyTable");
    no("str:identifier:sql", "select");
    no("str:identifier:sql", "SELECT");
    no("str:identifier:sql", "1col");
    no("str:identifier:sql", "café");
  });

  it("c / cpp / java / go / csharp — basic checks", () => {
    yes("str:identifier:c", "foo_bar");
    no("str:identifier:c", "for");
    yes("str:identifier:cpp", "foo");
    no("str:identifier:cpp", "namespace");
    yes("str:identifier:java", "myVar");
    no("str:identifier:java", "class");
    yes("str:identifier:go", "myFunc");
    no("str:identifier:go", "func");
    yes("str:identifier:csharp", "foo");
    yes("str:identifier:csharp", "@class");    // @-escape allowed
    no("str:identifier:csharp", "class");
  });
});

describe("str:ws:*", () => {
  it("single-line — no LF/CR/U+2028/U+2029", () => {
    yes("str:ws:single-line", "hello");
    yes("str:ws:single-line", "  spaces  ");
    no("str:ws:single-line", "a\nb");
    no("str:ws:single-line", "a\rb");
    no("str:ws:single-line", "a b");
    no("str:ws:single-line", "a b");
  });

  it("trimmed — no leading/trailing whitespace", () => {
    yes("str:ws:trimmed", "hello");
    yes("str:ws:trimmed", "");
    yes("str:ws:trimmed", "hello world");
    no("str:ws:trimmed", " hello");
    no("str:ws:trimmed", "hello ");
    no("str:ws:trimmed", "\thello");
  });

  it("no-ws — no whitespace at all", () => {
    yes("str:ws:no-ws", "hello");
    no("str:ws:no-ws", "hello world");
    no("str:ws:no-ws", "hello\tworld");
  });

  it("collapsed — no consecutive whitespace, no edges", () => {
    yes("str:ws:collapsed", "hello world");
    yes("str:ws:collapsed", "");
    yes("str:ws:collapsed", "abc");
    no("str:ws:collapsed", "hello  world");    // double space
    no("str:ws:collapsed", " hello world");    // leading
    no("str:ws:collapsed", "hello world ");    // trailing
  });
});

describe("str:bytes / codepoints / graphemes — fixed limits", () => {
  it("bytes — exact UTF-8 byte length", () => {
    yes("str:bytes:5", "hello");
    no("str:bytes:5", "hi");
    no("str:bytes:5", "héllo");                // é is 2 bytes
  });

  it("max-bytes — at-most UTF-8 byte length", () => {
    yes("str:max-bytes:10", "hello");
    yes("str:max-bytes:10", "héllo");
    no("str:max-bytes:10", "0123456789a");
  });

  it("min-bytes — at-least UTF-8 byte length", () => {
    yes("str:min-bytes:5", "hello");
    yes("str:min-bytes:5", "hello world");
    no("str:min-bytes:5", "hi");
  });

  it("codepoints — exact codepoint count", () => {
    yes("str:codepoints:5", "hello");
    yes("str:codepoints:5", "héllo");          // 5 codepoints
    no("str:codepoints:5", "hi");
  });

  it("max-codepoints — surrogate pair counts as 1", () => {
    yes("str:max-codepoints:1", "😀");
    no("str:max-codepoints:0", "😀");
  });
});

describe("length-by-measure helpers", () => {
  it("stringByteLength — UTF-8", () => {
    expect(stringByteLength("hello")).toBe(5);
    expect(stringByteLength("héllo")).toBe(6);  // é = 2 bytes
    expect(stringByteLength("")).toBe(0);
  });

  it("stringCodepointLength — handles surrogate pairs", () => {
    expect(stringCodepointLength("hello")).toBe(5);
    expect(stringCodepointLength("😀")).toBe(1);
    expect(stringCodepointLength("a😀b")).toBe(3);
  });

  it("stringGraphemeLength — falls back to codepoints if Intl.Segmenter missing", () => {
    expect(stringGraphemeLength("hello")).toBe(5);
    // Family emoji: 👨‍👩‍👧 — 1 grapheme cluster, 5 codepoints (3 emoji + 2 ZWJ)
    const family = "👨‍👩‍👧";
    const result = stringGraphemeLength(family);
    // Either 1 (with Segmenter) or 5 (fallback)
    expect([1, 5]).toContain(result);
  });
});
