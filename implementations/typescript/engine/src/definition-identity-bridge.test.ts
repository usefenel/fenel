import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

test("definition admission accepts only an own-data Ok true receipt", () => {
  const parent = resolve(process.cwd(), ".tmp");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "definition-admission-bridge-"));
  try {
    // Run the complete production module against a stub of its sole runtime
    // dependency in a fresh process. No global mock can affect another test.
    copyFileSync(new URL("./field-identity.ts", import.meta.url), join(directory, "field-identity.ts"));
    writeFileSync(join(directory, "engine-bodies-dispatch.ts"), `
      export const state = { result: undefined, calls: [] };
      export function dispatchEngineBody(name, args) { state.calls.push({ name, args }); return state.result; }
      export function marshalTraversalDeclarationType() { throw new Error("unrelated bridge invoked"); }
    `);
    writeFileSync(join(directory, "receipt-controls.mjs"), String.raw`
      import assert from "node:assert/strict";
      import { state } from "./engine-bodies-dispatch.ts";
      import { assertOwnedDefinitionIdentities, FieldIdentityKernelError } from "./field-identity.ts";
      const handles = ["first", "unused", "last"];
      const kinds = new Map([["first", "function"], ["last", "reserved"]]);
      const invoke = () => assertOwnedDefinitionIdentities(handles, kinds);
      const invalid = [{}, { $tag: "Ok", _0: false }, undefined, null, false, true, 0, "Ok", [],
        { $tag: "Unknown", _0: true }, { $tag: "Ok" },
        { $tag: "Ok", _0: 1 }, { $tag: "Ok", _0: "true" }, { $tag: "Ok", _0: { $tag: "True" } },
        { $tag: "Err" }, Object.create({ $tag: "Ok", _0: true })];
      for (const result of invalid) {
        state.result = result;
        assert.throws(invoke, /kernel returned an invalid Result value/);
      }
      let reads = 0;
      state.result = { get $tag() { reads++; return "Ok"; }, _0: true };
      assert.throws(invoke, /kernel returned an invalid Result value/);
      state.result = { $tag: "Ok", get _0() { reads++; return true; } };
      assert.throws(invoke, /kernel returned an invalid Result value/);
      assert.equal(reads, 0, "receipt accessors ran during admission");
      const inherited = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      try {
        const descriptor = Object.create(null);
        descriptor.value = "Ok"; descriptor.configurable = true;
        Object.defineProperty(Object.prototype, "value", descriptor);
        state.result = { get $tag() { reads++; return "Ok"; }, _0: true };
        assert.throws(invoke, /kernel returned an invalid Result value/);
      } finally {
        if (inherited) Object.defineProperty(Object.prototype, "value", inherited);
        else delete Object.prototype.value;
      }
      assert.equal(reads, 0, "descriptor prototype pollution admitted an accessor");
      const diagnostic = { $tag: "ReservedDefinitionIdentity", handle: "first",
        repositoryKind: "function", message: "reserved fixture" };
      state.result = { $tag: "Err", _0: diagnostic };
      assert.throws(invoke, error => error instanceof FieldIdentityKernelError
        && error.diagnostic === diagnostic && error.message === diagnostic.message);
      state.result = { $tag: "Ok", _0: true };
      assert.doesNotThrow(invoke);
      assert.deepEqual(state.calls.at(-1), { name: "engine:admitOwnedDefinitionIdentities", args: [[
        { handle: "first", repositoryKind: { $tag: "Just", _0: "function" } },
        { handle: "unused", repositoryKind: { $tag: "Nothing" } },
        { handle: "last", repositoryKind: { $tag: "Just", _0: "reserved" } },
      ]] });
      console.log(JSON.stringify({ invalid: invalid.length, accessorReads: reads, structuredRefusal: true, admitted: true }));
    `);
    const child = Bun.spawnSync([process.execPath, "--no-env-file", join(directory, "receipt-controls.mjs")], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    expect(JSON.parse(child.stdout.toString())).toEqual({ invalid: 16, accessorReads: 0,
      structuredRefusal: true, admitted: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
