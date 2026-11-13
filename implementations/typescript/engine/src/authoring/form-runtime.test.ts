import { describe, expect, test } from "bun:test";
import type { FieldDef, FenelType, FormDefinition, LayoutDef } from "../types";
import { Just, Maybe, Nothing } from "../type-foundation";
import {
  formDefaultsPlan,
  formFieldsPlan,
  formRecordDrillPlan,
  formSessionPlan,
  formSlidePlan,
  formSuccessPlan,
  formValidationPlan,
} from "./form-runtime";

const str = { $ref: "String" } as FenelType;
const num = { $ref: "Number" } as FenelType;
const bool = { $ref: "Boolean" } as FenelType;

function field(name: string, type: FenelType, label?: string): FieldDef {
  return { name, label: label ? Just(label) : Nothing, type, meta: {}, ui: Nothing };
}

const profileFields = [
  field("name", str, "Name"),
  field("age", num, "Age"),
  field("active", bool, "Active"),
];

const profileForm: FormDefinition = {
  slug: "profile",
  type: { $record: { fields: profileFields } },
  config: { submitLabel: "Save profile" },
};

describe("form runtime authoring plan", () => {
  test("extracts fields from record and opaque record definitions", () => {
    expect(formFieldsPlan({ definition: profileForm }).map((f) => f.name)).toEqual([
      "name",
      "age",
      "active",
    ]);

    const opaque: FormDefinition = {
      slug: "opaque-profile",
      type: {
        $opaque: {
          name: "ProfileInput",
          repr: "object",
          pure: { $record: { fields: profileFields } },
        },
      } as FenelType,
    };
    expect(formFieldsPlan({ definition: opaque }).map((f) => f.name)).toEqual([
      "name",
      "age",
      "active",
    ]);
  });

  test("builds defaults and lets initial/current values override without deleting defaults", () => {
    expect(formDefaultsPlan({ fields: profileFields })).toEqual({
      name: "",
      age: 0,
      active: false,
    });

    const maybeNick = field("nickname", Maybe(str));
    const plan = formSessionPlan({
      fields: [...profileFields, maybeNick],
      initialValues: { age: 37 },
      currentValues: { name: "Ada" },
    });

    expect(plan.values).toEqual({ name: "Ada", age: 37, active: false });
    expect(plan.fields.map((f) => [f.name, f.value])).toEqual([
      ["name", "Ada"],
      ["age", 37],
      ["active", false],
      ["nickname", undefined],
    ]);
  });

  test("centralizes submit/saving label precedence", () => {
    const definitionFirst = formSessionPlan({
      definition: profileForm,
      submitLabel: "Create",
      savingLabel: "Creating...",
      defaultSubmitLabel: "Submit",
      submitLabelPriority: "definition-first",
    });
    expect(definitionFirst.submitLabel).toBe("Save profile");
    expect(definitionFirst.savingLabel).toBe("Creating...");

    const overrideFirst = formSessionPlan({
      definition: profileForm,
      submitLabel: "Create",
      defaultSubmitLabel: "Submit",
      submitLabelPriority: "override-first",
    });
    expect(overrideFirst.submitLabel).toBe("Create");
  });

  test("projects validation errors into stable field plans", () => {
    const validation = formValidationPlan([
      { path: "name", message: "Name is required" },
      { path: "age", message: { en: "Age must be a number" } },
    ]);
    expect(validation.hasErrors).toBe(true);
    expect(validation.errorMap).toEqual({
      name: "Name is required",
      age: "Age must be a number",
    });

    const plan = formSessionPlan({
      definition: profileForm,
      errors: [{ path: "name", message: "Name is required" }],
    });
    expect(plan.fields.find((f) => f.name === "name")?.error).toBe("Name is required");
  });

  test("plans success display for links and general typed values", () => {
    expect(formSuccessPlan(undefined, { submitted: false })).toEqual({ kind: "none" });

    const link = formSuccessPlan(
      { $tag: "Link", url: "https://example.com", label: Just("Continue") },
      { submitted: true },
    );
    expect(link).toEqual({ kind: "link", url: "https://example.com", label: "Continue" });

    const typed = formSuccessPlan({ $tag: "Profile", id: "p1" }, { submitted: true });
    expect(typed.kind).toBe("typed-read-plan");
    if (typed.kind !== "typed-read-plan") throw new Error("expected typed-read-plan");
    expect(typed.value).toEqual({ $tag: "Profile", id: "p1" });

    expect(formSuccessPlan(undefined, { submitted: true })).toEqual({
      kind: "thank-you",
      text: "Thank you for your submission!",
    });
  });

  test("plans slides from layout sections and explicit slide configs", () => {
    const layout: LayoutDef = {
      sections: [
        { title: "Identity", rows: [{ slots: [{ field: "name" }, { field: "age" }] }] },
        { title: "Status", rows: [{ slots: [{ field: "active" }] }] },
      ],
    };
    const layoutPlan = formSlidePlan({
      layout,
      fields: profileFields,
      values: { name: "Ada", age: 37, active: true },
    });
    expect(layoutPlan.slides.map((slide) => slide.title)).toEqual(["Identity", "Status"]);
    expect(layoutPlan.slides[0]?.fields.map((f) => [f.name, f.value])).toEqual([
      ["name", "Ada"],
      ["age", 37],
    ]);

    const explicitPlan = formSlidePlan({
      layout,
      fields: profileFields,
      values: { active: false },
      config: { mode: "slide", slides: [{ title: "Only status", fields: ["active"] }] },
    });
    expect(explicitPlan.slides).toHaveLength(1);
    expect(explicitPlan.slides[0]?.title).toBe("Only status");
    expect(explicitPlan.slides[0]?.fields[0]?.name).toBe("active");
  });

  test("plans record drill-in fields with parent path prefixes", () => {
    const address = field("address", {
      $record: {
        fields: [
          field("street", str, "Street"),
          field("city", str, "City"),
        ],
      },
    } as FenelType, "Address");

    const plan = formRecordDrillPlan(address, {
      values: { address: { street: "Rue Morgue" } },
    });
    expect(plan.prefix).toBe("address");
    expect(plan.slides.map((slide) => slide.title)).toEqual(["street", "city"]);
    expect(plan.slides.map((slide) => slide.fields[0]?.name)).toEqual([
      "address.street",
      "address.city",
    ]);
    expect(plan.slides[0]?.fields[0]?.value).toBe("Rue Morgue");
  });
});
