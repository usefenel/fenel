// C1 actual-caller gate for the approved CalendarDate owner.
// Requires the final normal identity artifacts and the approved admission repair.
// This file adds no validator, generated identity, or replacement membership rule.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { moduleSourceCoordinate, pureEvaluateContext, type EvaluateContext } from "@fenel/engine/expressions";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import { Just } from "@fenel/engine/type-foundation";
import { validateValue } from "@fenel/engine/validation";
import { literalMembershipFor } from "./literal-membership";
import { sessionCatalogSections } from "./authoring-catalog";

const VALID = [
  { year: 1, month: 1, day: 1 },
  { year: 99, month: 12, day: 31 },
  { year: 400, month: 2, day: 29 },
  { year: 1900, month: 2, day: 28 },
  { year: 2000, month: 2, day: 29 },
  { year: 2024, month: 2, day: 29 },
  { year: 2024, month: 4, day: 30 },
  { year: 2024, month: 12, day: 31 },
  { year: 2400, month: 2, day: 29 },
  { year: 9999, month: 12, day: 31 },
] as const;

// The complete invalid-value corpus is retained from the frozen engine suite.
const INVALID_VALUE: readonly unknown[] = [
  { year: 0, month: 1, day: 1 }, { year: 10000, month: 1, day: 1 },
  { year: 2024.5, month: 1, day: 1 }, { year: 2024, month: 2.5, day: 1 },
  { year: 2024, month: 2, day: 1.5 }, { year: 2024, month: 2, day: 30 },
  { year: 1900, month: 2, day: 29 }, { year: 2024, month: 13, day: 1 },
  { year: 2024, month: 1, day: 0 }, { year: "2024", month: 2, day: 29 },
  { year: Number.NaN, month: 1, day: 1 }, { year: Number.POSITIVE_INFINITY, month: 1, day: 1 },
  { year: 2024, month: 2 }, { year: 2024, month: 2, day: 29, hour: 0 },
  { $tag: "Date", year: 2024, month: 2, day: 29 },
  "2024-02-29", [2024, 2, 29], 7, null,
];

describe("CalendarDate — actual original-input literal admission", () => {
  let registry: ModuleRegistry;
  let reader: EvaluateContext;
  let exact: FenelType;
  let expected: TypeScheme;
  let judge: ReturnType<typeof literalMembershipFor>;

  beforeAll(() => {
    registry = getSystemRegistry();
    reader = pureEvaluateContext(registry.evaluateContext());
    const owner = reader._typeFamilyOwner?.("CalendarDate", moduleSourceCoordinate("time"));
    const generatedIdentity = registry.getTypeUuid("time", "CalendarDate");
    if (!owner || !generatedIdentity || owner.identity !== generatedIdentity) {
      throw new Error("CalendarDate requires its actual generated time owner; no source handle or invented UUID substitutes for this final gate.");
    }
    const declaration = registry.getIdentifiedEntity(owner.identity);
    if (!declaration || !("$refined" in declaration.type)) {
      throw new Error("The selected CalendarDate owner lost its authored refinement.");
    }
    exact = { $ref: owner.identity };
    // The declaration scope resolves the owner's own source spelling, as the
    // validator's exact-declaration lookup does (validationExactDeclaration).
    const captured = reader._callSiteTyping?.resolveTypeInDeclaration?.({ $ref: owner.name }, owner.ownerIdentity);
    if (!captured?.ok) throw new Error("CalendarDate declaration scheme is unavailable in its captured source scope.");
    expected = captured.type;
    const sections = sessionCatalogSections(registry, [], id => ({ name: id, description: "Captured source type" }));
    const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot(sections, { registry }));
    judge = literalMembershipFor(environment, { registry, evaluateContext: reader });
  }, 180_000);

  test("admits valid originals and refuses every frozen invalid-value input", () => {
    for (const original of VALID) {
      const before = structuredClone(original);
      expect(judge(original, expected)).toEqual(Just(true));
      expect(original).toEqual(before);
    }
    for (const original of INVALID_VALUE) {
      const before = structuredClone(original);
      expect(judge(original, expected), JSON.stringify(original)).toEqual(Just(false));
      expect(original).toEqual(before);
    }
    expect(judge({ day: 29, month: 2, year: 2024 }, expected)).toEqual(Just(true));
  }, 180_000);

  test("normal form projection does not admit an extra-field original", () => {
    const projected = { year: 2024, month: 2, day: 29 };
    for (const original of [
      { ...projected, hour: 0 },
      { $tag: "Date", ...projected },
    ]) {
      const before = structuredClone(original);
      const form = validateValue(exact, original, null, {
        registry, functions: reader, coerce: false,
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
      });
      expect(form.valid).toBe(true);
      expect(form.value).toEqual(projected);
      expect(judge(original, expected)).toEqual(Just(false));
      expect(judge(form.value, expected)).toEqual(Just(true));
      expect(original).toEqual(before);
    }
  }, 180_000);
});

