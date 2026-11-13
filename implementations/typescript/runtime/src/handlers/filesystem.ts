// ---------------------------------------------------------------------------
// Filesystem IO handlers — JS impls for the `HasFileSystem` capability
// declared in `@fenel/engine/builtin-classes`. Phase 2 of the
// implementation roadmap (codec / iso / lens) needs read/write file
// support so codec-shaped use cases can land — read base64 from disk,
// decode through `IsoBase64`, write JSON, etc.
//
// Handler convention (per CLAUDE.md > "IO handler conventions"):
//   - One irreducible IO action per handler (read, write, list).
//   - Honour the declared return type (Result-shape, Maybe-shape).
//   - No orchestration / control flow in TS — that lives in `.fenel`
//     bodies that compose these primitives.
//
// Handlers registered:
//   fs.read_file(path)           → Result DecodeError Bytes
//   fs.write_file(path, bytes)   → Result EncodeError Unit
//   fs.list_dir(path)            → Result Error (List String)
//
// Each handler validates inputs at the JS boundary and returns a tagged
// Fenel value. The Fenel-side `defineFunction` declarations are
// in-flight (see "Future" comment at the bottom of this file); for now
// the handlers are wired directly so callers can dispatch via
// `{ call: ["fs.read_file", path] }` from JSON Logic, or through any
// future `HasFileSystem` typeclass methods that reference these action
// names.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModuleRegistry } from "@fenel/engine/registry";

function ok<T>(value: T): { $tag: "Ok"; _0: T } {
  return { $tag: "Ok", _0: value };
}

function err(reason: string): { $tag: "Err"; _0: string } {
  return { $tag: "Err", _0: reason };
}

// Resolve a string path argument (the handlers take it under the
// canonical `path` param key).
function pathArg(params: Record<string, unknown>, action: string): string {
  const p = params["path"];
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`${action}: 'path' (non-empty string) required`);
  }
  return p;
}

export function registerFilesystemHandlers(reg: ModuleRegistry): void {
  // ---------------- read_file ----------------
  //
  // Read raw bytes from a file path. Returns a tagged Result so callers
  // can pattern-match on Err and avoid surprising throws across the
  // Fenel boundary.
  reg.registerIOHandler("fs.read_file", async (params) => {
    let p: string;
    try {
      p = pathArg(params, "fs.read_file");
    } catch (e) {
      return { action: "continue", value: err((e as Error).message) };
    }
    try {
      const buf = await fs.readFile(p);
      // Convert Node Buffer → plain Uint8Array. Buffer is a Uint8Array
      // subclass; deep-equality comparisons (e.g. round-trip law checks)
      // get the most predictable behaviour on the bare typed array.
      const out = new Uint8Array(buf.byteLength);
      for (let i = 0; i < buf.byteLength; i++) out[i] = buf[i]!;
      return { action: "continue", value: ok(out) };
    } catch (e) {
      return {
        action: "continue",
        value: err(`fs.read_file: ${(e as Error).message}`),
      };
    }
  });

  // ---------------- write_file ----------------
  //
  // Write raw bytes to a file path. Accepts Uint8Array, ArrayBuffer, or
  // number[] for the bytes payload — same shapes the codec module
  // produces — and a String for text writes.
  reg.registerIOHandler("fs.write_file", async (params) => {
    let p: string;
    try {
      p = pathArg(params, "fs.write_file");
    } catch (e) {
      return { action: "continue", value: err((e as Error).message) };
    }
    const bytes = params["bytes"];
    let payload: Uint8Array | string;
    if (bytes === undefined) {
      // Allow string-shaped writes via the `text` arg as a convenience —
      // common when the file is plain text (logs, config). Either bytes
      // or text must be provided.
      const text = params["text"];
      if (typeof text !== "string") {
        return {
          action: "continue",
          value: err("fs.write_file: provide either 'bytes' (Uint8Array | ArrayBuffer | number[]) or 'text' (String)"),
        };
      }
      payload = text;
    } else if (bytes instanceof Uint8Array) {
      payload = bytes;
    } else if (bytes instanceof ArrayBuffer) {
      payload = new Uint8Array(bytes);
    } else if (
      Array.isArray(bytes) &&
      bytes.every((b) => typeof b === "number" && b >= 0 && b <= 255)
    ) {
      payload = Uint8Array.from(bytes as number[]);
    } else {
      return {
        action: "continue",
        value: err(`fs.write_file: 'bytes' must be Uint8Array | ArrayBuffer | number[]; got ${typeof bytes}`),
      };
    }
    try {
      await fs.writeFile(p, payload);
      // Unit is encoded as null in the engine — see the `Unit` type in
      // type-foundation. The Result wraps it per the typeclass return
      // declaration.
      return { action: "continue", value: ok(null) };
    } catch (e) {
      return {
        action: "continue",
        value: err(`fs.write_file: ${(e as Error).message}`),
      };
    }
  });

  // ---------------- list_dir ----------------
  //
  // Enumerate the immediate children of a directory. Returns just the
  // names (not full paths) so the result is the same shape regardless
  // of how the caller built `path`. Recursive walks compose at the
  // Fenel level — `bracket(listDir, ...)`-style.
  reg.registerIOHandler("fs.list_dir", async (params) => {
    let p: string;
    try {
      p = pathArg(params, "fs.list_dir");
    } catch (e) {
      return { action: "continue", value: err((e as Error).message) };
    }
    try {
      const entries = await fs.readdir(p);
      // Stable order — readdir's order is platform-dependent; sort for
      // round-trip predictability.
      entries.sort();
      return { action: "continue", value: ok(entries) };
    } catch (e) {
      return {
        action: "continue",
        value: err(`fs.list_dir: ${(e as Error).message}`),
      };
    }
  });

  // ---------------- exists / stat helper ----------------
  //
  // A small bonus primitive the round-trip codec workflow leans on:
  // "does this path resolve to a regular file?" Returns a Maybe rather
  // than a Result because the caller usually treats absence as a
  // domain-level case, not an error.
  reg.registerIOHandler("fs.file_exists", async (params) => {
    let p: string;
    try {
      p = pathArg(params, "fs.file_exists");
    } catch {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
    try {
      const st = await fs.stat(p);
      return {
        action: "continue",
        value: { $tag: "Just", _0: st.isFile() },
      };
    } catch {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
  });
}

// `path` import is for any future helpers that need to resolve relative
// paths against a per-account workspace root. Currently the handlers
// trust the caller's path verbatim — callers in `.fenel` bodies should
// build paths via std functions that confine them to safe roots when
// running per-account code.
void path;

// ---------------------------------------------------------------------------
// Future — wire these handlers behind `HasFileSystem` typeclass methods
// (currently the typeclass declares method names but no Fenel-function
// specs reference `fs.read_file` / `fs.write_file` / `fs.list_dir`).
// Once the engine has a `defineFunction` block for each method (parallel
// to `state.ts`'s pattern), the typeclass's dispatch resolver will route
// through the function id and these handlers fire automatically.
// Tracked separately from the codec / law work — registering the Fenel
// function specs is mechanical once a use case lands them.
// ---------------------------------------------------------------------------
