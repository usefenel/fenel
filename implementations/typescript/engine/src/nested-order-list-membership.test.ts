import { beforeAll, describe, expect, test } from "bun:test";
import { withInterpretedResolver } from "./engine-bodies-dispatch";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRepositoryRegistry } from "./repository-registry";
import type { ModuleRegistry, RegistryConstructorSignature } from "./registry";
import type { CallSiteGroundType } from "./signature-inference";
import { stdModule } from "./modules/std";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { publicCheckDemoModule, publicPasswordRecordDemoModule } from "./modules/public-demos";

// Extends ledgered C1: capture the actual repository declaration/slot facts
// and query the unchanged strict membership hook. These pins authorize no
// array admission, replacement validator or production representation lift.
type Order = {
  readonly $tag: string;
  readonly customer: { readonly $tag: string; readonly name: string; readonly country: { readonly $tag: string } };
  readonly items: readonly { readonly $tag: string; readonly name: string; readonly quantity: number }[];
  readonly shipping: { readonly $tag: string; readonly country: { readonly $tag: string }; readonly zip: string };
};
const source = "PasswordRecordDemo:checkNestedOrder";
let registry: ModuleRegistry;
let context: EvaluateContext;
let original: Order;
let candidate: Order;
let sourceBefore: string;
let cons: RegistryConstructorSignature;
let nil: RegistryConstructorSignature;

beforeAll(() => withInterpretedResolver(() => {
  registry = createRepositoryRegistry([
    stdModule, setExprEntityModule, decidableMembershipModule,
    publicCheckDemoModule, publicPasswordRecordDemoModule,
  ]);
  context = registry.evaluateContext();
  const starts = call("passwordRecordDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: Order[] }>;
  const start = starts.find(row => registry.getFunction(row.function.$ref)?.id === source);
  if (!start || !start.arguments[0]) throw new Error("The real source nested-order default is unavailable.");
  original = start.arguments[0];
  sourceBefore = JSON.stringify(original);
  candidate = Object.freeze({ ...original,
    customer: Object.freeze({ ...original.customer, country: Object.freeze({ ...original.customer.country }) }),
    items: Object.freeze(original.items.map(item => Object.freeze({ ...item }))),
    shipping: Object.freeze({ ...original.shipping, country: Object.freeze({ ...original.shipping.country }), zip: "10001" }),
  });
  const owner = registry.callSiteTyping.reflect(candidate.items)?.identity;
  if (!owner) throw new Error("The captured array has no system List owner.");
  const constructors = registry.listConstructorSignatures().filter(row => row.ownerIdentity === owner);
  const consRows = constructors.filter(row => row.name === "Cons");
  const nilRows = constructors.filter(row => row.name === "Nil");
  if (consRows.length !== 1 || nilRows.length !== 1) throw new Error("List constructors are missing or ambiguous.");
  cons = consRows[0]!;
  nil = nilRows[0]!;
}), 120_000);

function call(name: string, ...args: unknown[]): unknown {
  return invokeCallable({ $ref: `PasswordRecordDemo:${name}` }, args, context);
}
function resolved(name: string): CallSiteGroundType {
  const result = registry.callSiteTyping.resolveType({ $ref: name }, source);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.type;
}
function member(name: string, value: unknown, frame = context): "yes" | "no" | "unknown" {
  return registry.callSiteTyping.member(resolved(name), value, null, frame);
}
function namedItems(item: unknown): Record<string, unknown> {
  const head = cons.params.find(field => field.name === "head");
  const tail = cons.params.find(field => field.name === "tail");
  if (!head || !tail) throw new Error("The captured List constructor has no head/tail slots.");
  return Object.freeze({ $tag: cons.name, [head.name]: item, [tail.name]: Object.freeze({ $tag: nil.name }) });
}

describe("the source nested order at the strict List membership boundary", () => {
  test("the corrected source data has admitted children and unknown complete types", () => withInterpretedResolver(() => {
    expect(original.shipping.zip).toBe("ABCDE");
    expect(candidate.shipping.zip).toBe("10001");
    expect(member("OrderExampleCountry", candidate.customer.country)).toBe("yes");
    expect(member("OrderExampleCustomer", candidate.customer)).toBe("yes");
    expect(member("OrderExampleItem", candidate.items[0])).toBe("yes");
    expect(member("OrderExampleShipping", candidate.shipping)).toBe("yes");
    expect(member("NestedOrderDraft", candidate)).toBe("unknown");
    expect(member("CheckedNestedOrder", candidate)).toBe("unknown");
    expect(call("nestedOrderAdmitted", candidate)).toBe(true);
    expect(JSON.stringify(original)).toBe(sourceBefore);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.items)).toBe(true);
    expect(Object.isFrozen(candidate.items[0])).toBe(true);
    expect(Object.isFrozen(candidate.customer)).toBe(true);
    expect(Object.isFrozen(candidate.shipping)).toBe(true);
  }));

  test("the exact captured named slots do not grant a refinement-preserving bridge", () => withInterpretedResolver(() => {
    expect(cons.ownerModule).toBe("system");
    expect(cons.ownerName).toBe("List");
    expect(cons.outcome.$tag).toBe("AnnotationRequired");
    expect(cons.scheme).toBeUndefined();
    expect(nil.params).toHaveLength(0);
    expect(cons.params.map(field => field.name)).toEqual(["head", "tail"]);
    const keys = cons.params.map(field => {
      expect(field.key?.$tag).toBe("NamedField");
      if (field.key?.$tag !== "NamedField") throw new Error("List slot lost its semantic key.");
      expect(context._fieldCurrentWire?.[field.key.ref.$ref]).toBe(field.name);
      expect(registry.getFieldIdentityByHandle(field.key.ref.$ref)?.field.key).toEqual(field.key);
      return field.key.ref.$ref;
    });
    expect(new Set(keys).size).toBe(2);
    const instance = context._specRegistry?.listInstances("Reprable").find(row =>
      row.args[0] === "JsRuntime" && row.args[1] === "List");
    expect(instance).toBeDefined();
    const lower = instance!.methods.lower as { $ref: string };
    expect(registry.getFunction(lower.$ref)?.id).toBe("std:arrayToList");
    const positional = invokeCallable(lower, [candidate.items], context) as Record<string, unknown>;
    expect(positional).toEqual({ $tag: "Cons", _0: candidate.items[0], _1: { $tag: "Nil" } });
    expect(positional._0).toBe(candidate.items[0]);
    expect(member("NestedOrderDraft", { ...candidate, items: positional })).toBe("no");
    const named = Object.freeze({ ...candidate, items: namedItems(candidate.items[0]) });
    expect(member("NestedOrderDraft", named)).toBe("yes");
    expect(member("CheckedNestedOrder", named)).toBe("no");
    expect(call("nestedOrderAdmitted", named)).toBe(false);
    expect(call("nestedOrderAdmitted", candidate)).toBe(true);
    expect(JSON.stringify(original)).toBe(sourceBefore);
    expect(candidate.items[0]?.quantity).toBe(2);
  }));

  test("an invalid item refutes its child type and captured named List, without admitting arrays", () => withInterpretedResolver(() => {
    const invalid = Object.freeze({ ...candidate.items[0], quantity: "two" });
    expect(member("OrderExampleItem", invalid)).toBe("no");
    expect(member("NestedOrderDraft", { ...candidate, items: namedItems(invalid) })).toBe("no");
    expect(member("NestedOrderDraft", { ...candidate, items: [invalid] })).toBe("unknown");
  }));

  test.each([
    ["zero quantity", (value: Order) => ({ ...value, items: [{ ...value.items[0], quantity: 0 }] })],
    ["mismatched country", (value: Order) => ({ ...value, shipping: { ...value.shipping, country: { $tag: "OrderFrance" } } })],
    ["bad ZIP", (value: Order) => ({ ...value, shipping: { ...value.shipping, zip: "ABCDE" } })],
    ["Unicode ZIP digits", (value: Order) => ({ ...value, shipping: { ...value.shipping, zip: "１２３４５" } })],
    ["empty item list", (value: Order) => ({ ...value, items: [] })],
    ["overlong item list", (value: Order) => ({ ...value, items: Array.from({ length: 9 }, () => value.items[0]) })],
  ] as const)("the original %s control is refused by its actual complete refinement", (_label, change) => withInterpretedResolver(() => {
    const changed = change(candidate);
    expect(call("nestedOrderAdmitted", changed)).toBe(false);
    expect(member("NestedOrderDraft", changed)).toBe("unknown");
    expect(member("CheckedNestedOrder", changed)).toBe("no");
    expect(JSON.stringify(original)).toBe(sourceBefore);
  }));

  test("withheld nominal facts or unavailable bridge declarations cannot grant array admission", () => withInterpretedResolver(() => {
    const { nominals: _nominals, ...withoutOwners } = resolved("OrderExampleCustomer");
    expect(registry.callSiteTyping.member(withoutOwners, candidate.customer, null, context)).toBe("unknown");
    const missingBridge: EvaluateContext = { ...context, getFunction: name =>
      name === "std:arrayToList" || name === "std.arrayToList" ? undefined : context.getFunction?.(name) };
    // The current hook has no bridge admission lane at all; withholding its
    // declaration cannot convert the original array's abstention into yes.
    expect(member("NestedOrderDraft", candidate, missingBridge)).toBe("unknown");
  }));
});
