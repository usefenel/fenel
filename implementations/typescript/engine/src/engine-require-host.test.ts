import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";

// Read the exported source rather than Function.toString(): Bun folds its own
// lexical `typeof require` to a constant when compiling an imported function.
const source = readFileSync(new URL("./engine-require.ts", import.meta.url), "utf8");
const declaration = source.match(/export function hostRequireUnavailable\(\): boolean \{[\s\S]*?\n\}/)?.[0];
if (!declaration) throw new Error("The native-host guard source was not found");
const guard = declaration.replace("export function hostRequireUnavailable(): boolean", "function hostRequireUnavailable()");

function unavailable(process: unknown, require: unknown): boolean {
  // The real exported guard runs under isolated host bindings. In particular,
  // the browser bundle can provide a function named require without providing
  // native Node modules; mutating Bun's process/require would not model that.
  return runInNewContext(`(${guard})()`, { process, require }) as boolean;
}

test("bundler require shims do not grant native host-module availability", () => {
  const shim = () => ({});
  expect(unavailable(undefined, shim)).toBe(true);
  expect(unavailable({ env: { NODE_ENV: "production" }, versions: {} }, shim)).toBe(true);
  expect(unavailable(undefined, undefined)).toBe(true);
});

test("native Node/Bun availability and browser simulation remain distinct", () => {
  const hostRequire = () => ({});
  expect(unavailable({ env: {}, versions: { node: "22.0.0" } }, hostRequire)).toBe(false);
  expect(unavailable({ env: {}, versions: { bun: "1.3.13" } }, hostRequire)).toBe(false);
  expect(unavailable({ env: { FENEL_SIMULATE_BROWSER: "1" }, versions: { node: "22.0.0", bun: "1.3.13" } }, hostRequire)).toBe(true);
  expect(unavailable({ env: {}, versions: { node: "22.0.0" } }, {})).toBe(true);
});
