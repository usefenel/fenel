import { expect, test } from "bun:test";
import { decodeColdPolicyControls } from "./compiled-artifact-cold-policy-wire";

const bytes = (text: string) => new TextEncoder().encode(text);
const row = { functionId: "ownerinputpolicy:ownerIdentityRowRetained", args: [{ kind: "field",
  declaredInEntityOnlySource: true, neededByFullConsumerDomain: false }] };
test("cold policy accepts only closed primitive fact bytes", () => {
  const decoded = decodeColdPolicyControls(bytes(JSON.stringify([row])));
  expect(decoded[0]!.args[0].kind).toBe("field");
  expect(Object.getPrototypeOf(decoded[0]!.args[0])).toBe(null);
  expect(Object.isFrozen(decoded[0]!.args[0])).toBe(true);
  for (const facts of [
    { kind: "function", declaredInEntityOnlySource: true },
    { ...row.args[0], neededByFullConsumerDomain: "false" },
    { ...row.args[0], neededByFullConsumerDomain: null },
    { ...row.args[0], extra: true },
    { ...row.args[0], kind: "unknown" },
    [],
  ]) expect(() => decodeColdPolicyControls(bytes(JSON.stringify([{ ...row, args: [facts] }])))).toThrow();
  expect(() => decodeColdPolicyControls(bytes('[{"functionId":"ownerinputpolicy:ownerIdentityRowRetained","args":[{"kind":"function","declaredInEntityOnlySource":true,"neededByFullConsumerDomain":false,"neededByFullConsumerDomain":true}]}]'))).toThrow();
  // Accessor/prototype/Proxy capabilities have no representation at this wire
  // entry. It accepts bytes, never an arbitrary fact object; no host field is
  // read from a caller object by the fact decoder.
});
