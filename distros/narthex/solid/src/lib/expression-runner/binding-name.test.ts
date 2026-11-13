// The editor's name validation: `using` is reserved where a NAME is bound
// (let-bindings, lambda params, pattern binds, constructor tags) because an
// expression can never read it back (modules-as-values Phase 5c-1a), but a
// record FIELD named `using` is valid: both parsers accept `{ using = 1 }`,
// `r.using` and the record pattern `{ using = x }` (astra review of 5c-1a,
// finding 5). Test/tooling harness only.

import { describe, expect, test } from "bun:test";
import { validateBindingName } from "./binding-name";

describe("binding names and field names", () => {
  test("`using` is refused as a binding name", () => {
    expect(validateBindingName("using")).toBe('"using" is a reserved keyword');
    expect(validateBindingName("using", { role: "binding" })).toBe('"using" is a reserved keyword');
    expect(validateBindingName("using", { allowUppercase: true })).toBe('"using" is a reserved keyword');
  });

  test("`using` is a valid record field name", () => {
    expect(validateBindingName("using", { role: "field" })).toBeNull();
    expect(validateBindingName("using", { role: "field", usedNames: ["other"] })).toBeNull();
  });

  test("the other field rules are unchanged", () => {
    expect(validateBindingName("using", { role: "field", usedNames: ["using"] })).toBe('"using" is already used in this record');
    expect(validateBindingName("", { role: "field" })).toBe("Name cannot be empty");
    expect(validateBindingName("Using", { role: "field" })).toBe("Must start with a lowercase letter or underscore");
    expect(validateBindingName("let", { role: "field" })).toBe('"let" is a reserved keyword');
    expect(validateBindingName("value", { role: "field" })).toBeNull();
  });

  test("the other binding rules are unchanged", () => {
    expect(validateBindingName("let")).toBe('"let" is a reserved keyword');
    expect(validateBindingName("import")).toBe('"import" is a reserved keyword');
    expect(validateBindingName("x1")).toBeNull();
    expect(validateBindingName("Just", { allowUppercase: true })).toBeNull();
  });
});
