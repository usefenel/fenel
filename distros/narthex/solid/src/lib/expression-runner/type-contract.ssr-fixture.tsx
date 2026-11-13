// SSR fixture for type-contract-signature.test.ts (no browser).
import { renderToString } from "@solidjs/web";
import { TypeContract } from "./type-contract";

export function cases(): Record<string, string> {
  return {
    declared: renderToString(() => <TypeContract signature={{
      params: [{ name: "x", type: "Number", icon: "hash", origin: "declared" }],
      returns: { type: "Number", icon: "hash", origin: "declared" } }} />),
    inferred: renderToString(() => <TypeContract signature={{
      params: [{ name: "food", type: "Food", origin: "inferred" }],
      returns: { type: "Boolean", origin: "inferred" } }} />),
    unsettled: renderToString(() => <TypeContract signature={{
      params: [{ name: "food" }], returns: {} }} />),
    several: renderToString(() => <TypeContract signature={{
      params: [{ name: "foods", type: "List of foods", origin: "declared" }, { name: "pantry", type: "Set of foods", origin: "declared" }],
      returns: { type: "List of preparations", origin: "declared" } }} />),
    nullary: renderToString(() => <TypeContract signature={{ params: [], returns: { type: "Text", origin: "declared" } }} />),
    single: renderToString(() => <TypeContract inferred="Number" declared="Text" />),
  };
}
