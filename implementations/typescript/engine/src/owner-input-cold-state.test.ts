import { expect, test } from "bun:test";
import { beginOwnerInputColdScope, assertOwnerInputPreparationAllowed } from "./owner-input-cold-state";

test("cold guard rejects swallowed registry/harness attempts and restores ordinary mode", () => {
  const scope = beginOwnerInputColdScope();
  expect(() => assertOwnerInputPreparationAllowed("registry")).toThrow();
  expect(() => assertOwnerInputPreparationAllowed("harness")).toThrow();
  expect(() => scope.finish()).toThrow("registry=1, harness=1");
  expect(() => assertOwnerInputPreparationAllowed("registry")).not.toThrow();
});

test("cold scopes cannot nest and successful closure attests only zero attempts", () => {
  const scope = beginOwnerInputColdScope();
  expect(() => beginOwnerInputColdScope()).toThrow("cannot nest");
  expect(scope.finish()).toEqual({ registry: 0, harness: 0 });
  expect(() => scope.finish()).toThrow("already closed");
});
