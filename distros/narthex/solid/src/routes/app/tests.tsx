import { For, Show, Switch, Match, createSignal, createMemo } from "solid-js";
import { contains, formatSetExpr, validateWithHints, regexStringToPattern, List, parseFenel, isJustTrue, isJustFalse, evaluate } from "@fenel/engine";
import type { SetExpr, FieldDef, FenelType, MaybeBool, Expression } from "@fenel/engine";
import { createRegistry } from "@fenel/engine/registry";
import { pureEvaluateContext, type EvaluateContext } from "@fenel/engine/expressions";
import { stdModule } from "@fenel/engine/modules/std";
import { setExprEntityModule } from "../../../../../../implementations/typescript/engine/src/modules/set-expr-entities";
import { decidableMembershipModule } from "@fenel/engine/modules/decidable-membership";
import { publicCheckDemoModule, publicPasswordRecordDemoModule } from "../../../../../../implementations/typescript/engine/src/modules/public-demos";
import { ExpressionDisplay } from "~/lib/expression-builder";
import {
  EntityComponentProvider,
  FieldListRenderer,
  FieldPresentationRegistryProvider,
  FieldRenderer,
  RefResolverProvider,
} from "~/lib/field-renderer";
import { IconCircleCheck, IconCircleX } from "~/lib/icons";
import { LocusSelect } from "~/lib/locus-select";
import "./tests.css";
import { Just, Nothing } from "@fenel/engine/type-foundation";

function regexSet(re: string): SetExpr {
  const p = regexStringToPattern(re);
  if (!p) throw new Error(`Invalid regex /${re}/`);
  return { $tag: "SePattern", pattern: p };
}

// ---------------------------------------------------------------------------
// Test case definitions
// ---------------------------------------------------------------------------

type TestCase = {
  id: string;
  label: string;
  description: string;
  category: string;
  constraint: SetExpr;
  value: unknown;
  expected: boolean;
  comparison?: { lang: string; lines: number }[];
  evaluationContext?: () => EvaluateContext;
  criteriaExpression?: Expression;
};

const CATEGORIES = [
  "Primitives",
  "Enums",
  "Intervals",
  "Patterns",
  "Named Sets",
  "Composition",
  "Where Predicates",
  "Real-World Types",
  "Advanced Composition",
  "Edge Cases",
  "Record Constraints",
  "Nested Records",
  "Business Rules",
  "Statistical Predicates",
  "Password Schemes",
  "Format Composition",
  "Datetime Formats",
  "Mask Formats",
  "Dependent Refinements",
  "Multi-Entity Rules",
  "Health & Nutrition",
  "Risk Assessment",
  "Filesystem Paths",
] as const;

const UNIQUE_CONTACT_EMAILS: SetExpr = {
  $tag: "SeWhere",
  pred: parseFenel("length (unique (map (\\contact -> contact.email) contacts)) == length contacts"),
};

const PW_BASIC: SetExpr = { $tag: "SeIntersect", branches: [
    regexSet("^\\S+$"),
    regexSet("[A-Z]"),
    regexSet("[a-z]"),
    regexSet("\\d"),
    regexSet("[^a-zA-Z0-9]"),
    regexSet(".{8,}"),
  ] };

// These diagnostic fixtures share the public example's Fenel bodies and keep
// their captured pure functions out of the default membership harness.
let passwordContext: EvaluateContext | undefined;
function passwordEvaluationContext(): EvaluateContext {
  if (passwordContext) return passwordContext;
  const captured = createRegistry([
    stdModule, setExprEntityModule, decidableMembershipModule,
    publicCheckDemoModule, publicPasswordRecordDemoModule,
  ]).evaluateContext();
  // Pure function lookup stays fenced; these inert tables let the same source
  // constructors produce the criteria's actual Maybe payloads for inspection.
  return passwordContext = {
    ...pureEvaluateContext(captured),
    _constructors: captured._constructors,
    _constructorWireNames: captured._constructorWireNames,
    _ctorFieldKeys: captured._ctorFieldKeys,
    _caseOwner: captured._caseOwner,
  };
}

const PW_HARDENED: SetExpr = {
  $tag: "SeWhere", pred: parseFenel("passwordHardenedAdmitted value"),
};
const PW_SMART: SetExpr = {
  $tag: "SeWhere", pred: parseFenel("passwordSmartAdmitted value"),
};

const US_ADDRESS_ZIP: SetExpr = {
  $tag: "SeWhere",
  pred: parseFenel('address.country != "US" || (length address.zip == 5 && all (chars address.zip) (\\digit -> includes ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] digit))'),
};

// ---------------------------------------------------------------------------
// Shared constraints — Multi-Entity Rules
// ---------------------------------------------------------------------------

const ORDER_RULES: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { ">=": [{ var: "customer.age" }, 18] } },
    { $tag: "SeWhere", pred: { ">": [{ var: "items.length" }, 0] } },
    { $tag: "SeWhere", pred: {
      all: [{ var: "items" }, { ">": [{ var: "quantity" }, 0] }],
    } },
    { $tag: "SeWhere", pred: {
      all: [{ var: "items" }, { ">": [{ var: "unitPrice" }, 0] }],
    } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "total" }, 50000] } },
    { $tag: "SeWhere", pred: { "==": [
      { var: "shippingCountry" },
      { var: "customer.country" },
    ] } },
  ] };

const APPOINTMENT_RULES: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { in: [{ var: "patient.insurance" }, ["PPO", "HMO", "Medicare", "Medicaid"]] } },
    { $tag: "SeWhere", pred: { in: [{ var: "doctor.specialty" }, { var: "department.specialties" }] } },
    { $tag: "SeWhere", pred: { ">=": [{ var: "duration" }, 15] } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "duration" }, 120] } },
  ] };

const ENROLLMENT_RULES: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { ">=": [{ var: "student.gpa" }, { var: "course.minGpa" }] } },
    { $tag: "SeWhere", pred: { "<": [{ var: "course.enrolled" }, { var: "course.capacity" }] } },
    { $tag: "SeWhere", pred: { "<=": [
      { "+": [{ var: "student.credits" }, { var: "course.credits" }] },
      21,
    ] } },
  ] };

// ---------------------------------------------------------------------------
// Dependent date — refinement-typed {year, month, day}
//
// Validates a date *record* with cross-field constraints: day ≤ daysInMonth,
// where daysInMonth depends on month AND year (Gregorian leap rule). This is
// dependent typing in a form field — `day` is not Day(1..31) but
// Day(month, year), narrowing as month and year are filled.
// ---------------------------------------------------------------------------

const IS_LEAP_YEAR = {
  or: [
    { and: [
      { "===": [{ "%": [{ var: "year" }, 4] }, 0] },
      { "!==": [{ "%": [{ var: "year" }, 100] }, 0] },
    ] },
    { "===": [{ "%": [{ var: "year" }, 400] }, 0] },
  ],
};

const DAYS_IN_MONTH = {
  if: [
    { "===": [{ var: "month" }, 2] },
    { if: [IS_LEAP_YEAR, 29, 28] },
    { in: [{ var: "month" }, [4, 6, 9, 11]] },
    30,
    31,
  ],
};

const DEPENDENT_DATE: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { ">=": [{ var: "year" }, 1900] } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "year" }, 2100] } },
    { $tag: "SeWhere", pred: { ">=": [{ var: "month" }, 1] } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "month" }, 12] } },
    { $tag: "SeWhere", pred: { ">=": [{ var: "day" }, 1] } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "day" }, DAYS_IN_MONTH] } },
  ] };

// ---------------------------------------------------------------------------
// Shared constraints — Domain-Inspired (BayneFrame, DripCollector)
// ---------------------------------------------------------------------------

const TIER_RULES: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { in: [{ var: "tier" }, ["free", "starter", "pro", "elite"]] } },
    { $tag: "SeWhere", pred: { if: [
      { "==": [{ var: "tier" }, "starter"] },
      { in: ["free", { var: "completedTiers" }] },
      { if: [
        { "==": [{ var: "tier" }, "pro"] },
        { in: ["starter", { var: "completedTiers" }] },
        { if: [
          { "==": [{ var: "tier" }, "elite"] },
          { in: ["pro", { var: "completedTiers" }] },
          true,
        ] },
      ] },
    ] } },
    { $tag: "SeWhere", pred: { ">=": [{ var: "sessionsCompleted" }, { var: "tierMinSessions" }] } },
  ] };

const SELLBACK_RULES: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { "<=": [
      { "-": [{ var: "now" }, { var: "purchaseDate" }] },
      30,
    ] } },
    { $tag: "SeWhere", pred: { "==": [
      { var: "buybackPrice" },
      { "*": [{ var: "marketValue" }, 0.7] },
    ] } },
    { $tag: "SeWhere", pred: { "==": [{ var: "item.condition" }, "unused"] } },
  ] };

// ---------------------------------------------------------------------------
// Shared constraints — Health & Nutrition
// ---------------------------------------------------------------------------

const RECIPE_RULES: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { ">": [{ var: "ingredients.length" }, 0] } },
    { $tag: "SeWhere", pred: {
      all: [{ var: "ingredients" }, { ">": [{ var: "amount" }, 0] }],
    } },
    { $tag: "SeWhere", pred: { if: [
      { "!": [{ var: "rawPrep" }] },
      true,
      { "<=": [{ var: "maxTemp" }, 40.6] },
    ] } },
  ] };

const NUTRITION_RULES: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { ">=": [{ var: "protein" }, 0] } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "protein" }, 100] } },
    { $tag: "SeWhere", pred: { ">=": [{ var: "carbs" }, 0] } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "carbs" }, 100] } },
    { $tag: "SeWhere", pred: { ">=": [{ var: "fat" }, 0] } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "fat" }, 100] } },
    { $tag: "SeWhere", pred: { "<=": [
      { "+": [{ var: "protein" }, { var: "carbs" }, { var: "fat" }] },
      100,
    ] } },
  ] };

// ---------------------------------------------------------------------------
// Shared constraints — Risk Assessment
// ---------------------------------------------------------------------------

const PROPERTY_RISK: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { "<=": [{ var: "buildingAge" }, 100] } },
    { $tag: "SeWhere", pred: { if: [
      { "==": [{ var: "construction" }, "wood"] },
      { "==": [{ var: "fireSuppression" }, true] },
      true,
    ] } },
    { $tag: "SeWhere", pred: { if: [
      { "==": [{ var: "floodZone" }, true] },
      { "==": [{ var: "floodInsurance" }, true] },
      true,
    ] } },
    { $tag: "SeWhere", pred: { "<=": [
      { "-": [{ var: "currentYear" }, { var: "lastInspection" }] },
      5,
    ] } },
  ] };

const VEHICLE_INS: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { ">=": [{ var: "driver.age" }, 16] } },
    { $tag: "SeWhere", pred: { "<=": [{ var: "accidents" }, 3] } },
    { $tag: "SeWhere", pred: { if: [
      { "<": [{ var: "driver.age" }, 25] },
      { "==": [{ var: "coverageType" }, "comprehensive"] },
      true,
    ] } },
  ] };

const COMPANY_LIABILITY: SetExpr = { $tag: "SeIntersect", branches: [
    { $tag: "SeWhere", pred: { ">": [{ var: "revenue" }, 0] } },
    { $tag: "SeWhere", pred: { in: [{ var: "industry" }, ["tech", "healthcare", "finance", "manufacturing", "retail"]] } },
    { $tag: "SeWhere", pred: { if: [
      { "==": [{ var: "industry" }, "healthcare"] },
      { "==": [{ var: "hipaaCompliant" }, true] },
      true,
    ] } },
    { $tag: "SeWhere", pred: { if: [
      { ">=": [{ var: "employees" }, 50] },
      { "==": [{ var: "hasSafetyOfficer" }, true] },
      true,
    ] } },
  ] };

const TEST_CASES: TestCase[] = [
  // -------------------------------------------------------------------------
  // Primitives
  // -------------------------------------------------------------------------
  {
    id: "prim-all-str",
    label: "Universal set accepts anything",
    description: "The SeAll set contains every possible value",
    category: "Primitives",
    constraint: { $tag: "SeAll" },
    value: "hello",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 1 },
      { lang: "TypeScript", lines: 1 },
    ],
  },
  {
    id: "prim-all-num",
    label: "Universal set accepts numbers",
    description: "SeAll contains 42",
    category: "Primitives",
    constraint: { $tag: "SeAll" },
    value: 42,
    expected: true,
  },
  {
    id: "prim-none",
    label: "Empty set rejects everything",
    description: "SeNone contains nothing",
    category: "Primitives",
    constraint: { $tag: "SeNone" },
    value: "anything",
    expected: false,
    comparison: [
      { lang: "JSON Schema", lines: 3 },
      { lang: "TypeScript", lines: 1 },
    ],
  },
  {
    id: "prim-none-num",
    label: "Empty set rejects numbers",
    description: "SeNone rejects 0",
    category: "Primitives",
    constraint: { $tag: "SeNone" },
    value: 0,
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Enums
  // -------------------------------------------------------------------------
  {
    id: "enum-color-pass",
    label: "Color enum — valid",
    description: '"blue" is in {red, green, blue}',
    category: "Enums",
    constraint: { $tag: "SeEnum", values: ["red", "green", "blue"] },
    value: "blue",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 5 },
      { lang: "TypeScript", lines: 1 },
      { lang: "SQL", lines: 3 },
    ],
  },
  {
    id: "enum-color-fail",
    label: "Color enum — invalid",
    description: '"yellow" is not in {red, green, blue}',
    category: "Enums",
    constraint: { $tag: "SeEnum", values: ["red", "green", "blue"] },
    value: "yellow",
    expected: false,
  },
  {
    id: "enum-http-pass",
    label: "HTTP success codes",
    description: "200 is a valid success code",
    category: "Enums",
    constraint: { $tag: "SeEnum", values: [200, 201, 204, 301, 302] },
    value: 200,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 5 },
      { lang: "TypeScript", lines: 1 },
    ],
  },
  {
    id: "enum-http-fail",
    label: "HTTP success codes — 404 rejected",
    description: "404 is not in the success code set",
    category: "Enums",
    constraint: { $tag: "SeEnum", values: [200, 201, 204, 301, 302] },
    value: 404,
    expected: false,
  },
  {
    id: "enum-bool",
    label: "Boolean enum",
    description: "true is in {true, false}",
    category: "Enums",
    constraint: { $tag: "SeEnum", values: [true, false] },
    value: true,
    expected: true,
  },
  {
    id: "enum-mixed-types",
    label: "Mixed-type enum — number in {1, 'one', true}",
    description: "Enums can contain mixed types",
    category: "Enums",
    constraint: { $tag: "SeEnum", values: [1, "one", true] },
    value: 1,
    expected: true,
  },
  {
    id: "enum-mixed-fail",
    label: "Mixed-type enum — 2 rejected",
    description: "2 is not in {1, 'one', true}",
    category: "Enums",
    constraint: { $tag: "SeEnum", values: [1, "one", true] },
    value: 2,
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Intervals
  // -------------------------------------------------------------------------
  {
    id: "int-age-valid",
    label: "Age range [0, 150]",
    description: "25 is a valid age",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 150, inclusive: true }) } },
    value: 25,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 4 },
      { lang: "TypeScript", lines: 3 },
      { lang: "SQL", lines: 1 },
    ],
  },
  {
    id: "int-age-boundary-lo",
    label: "Age range — lower boundary",
    description: "0 is valid (inclusive)",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 150, inclusive: true }) } },
    value: 0,
    expected: true,
  },
  {
    id: "int-age-boundary-hi",
    label: "Age range — upper boundary",
    description: "150 is valid (inclusive)",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 150, inclusive: true }) } },
    value: 150,
    expected: true,
  },
  {
    id: "int-age-negative",
    label: "Age range — negative rejected",
    description: "-1 is below [0, 150]",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 150, inclusive: true }) } },
    value: -1,
    expected: false,
  },
  {
    id: "int-age-over",
    label: "Age range — 151 rejected",
    description: "151 exceeds upper bound",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 150, inclusive: true }) } },
    value: 151,
    expected: false,
  },
  {
    id: "int-exclusive",
    label: "Exclusive interval (0, 1)",
    description: "0.5 passes, boundaries excluded",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: false }), hi: Just({ value: 1, inclusive: false }) } },
    value: 0.5,
    expected: true,
  },
  {
    id: "int-exclusive-boundary",
    label: "Exclusive interval — boundary excluded",
    description: "0 fails exclusive lower bound",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: false }), hi: Just({ value: 1, inclusive: false }) } },
    value: 0,
    expected: false,
  },
  {
    id: "int-unbounded-hi",
    label: "Unbounded upper — [0, +inf)",
    description: "Non-negative numbers",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }) , hi: Nothing } },
    value: 999999,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 3 },
      { lang: "TypeScript", lines: 1 },
    ],
  },
  {
    id: "int-unbounded-lo",
    label: "Unbounded lower — (-inf, 100]",
    description: "At most 100",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { hi: Just({ value: 100, inclusive: true }) , lo: Nothing } },
    value: -50,
    expected: true,
  },
  {
    id: "int-percentage",
    label: "Percentage [0, 100]",
    description: "73.5 is a valid percentage",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
    value: 73.5,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 4 },
      { lang: "TypeScript", lines: 3 },
      { lang: "SQL", lines: 1 },
    ],
  },
  {
    id: "int-percentage-fail",
    label: "Percentage — 101 rejected",
    description: "101% is out of range",
    category: "Intervals",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
    value: 101,
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Patterns
  // -------------------------------------------------------------------------
  {
    id: "pat-email-pass",
    label: "Email pattern — valid",
    description: "Standard email format",
    category: "Patterns",
    constraint: regexSet("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"),
    value: "user@example.com",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 4 },
      { lang: "TypeScript", lines: 5 },
      { lang: "SQL", lines: 2 },
    ],
  },
  {
    id: "pat-email-fail",
    label: "Email pattern — no @",
    description: '"not-an-email" lacks @ separator',
    category: "Patterns",
    constraint: regexSet("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"),
    value: "not-an-email",
    expected: false,
  },
  {
    id: "pat-hex-pass",
    label: "Hex color — #ff0000",
    description: "Valid 6-digit hex",
    category: "Patterns",
    constraint: regexSet("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"),
    value: "#ff0000",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 4 },
      { lang: "TypeScript", lines: 3 },
    ],
  },
  {
    id: "pat-hex-short",
    label: "Hex color — #f00 (shorthand)",
    description: "Valid 3-digit hex",
    category: "Patterns",
    constraint: regexSet("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"),
    value: "#f00",
    expected: true,
  },
  {
    id: "pat-hex-fail",
    label: "Hex color — #xyz invalid",
    description: "Non-hex characters rejected",
    category: "Patterns",
    constraint: regexSet("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"),
    value: "#xyz",
    expected: false,
  },
  {
    id: "pat-uuid",
    label: "UUID v4 pattern",
    description: "Valid UUID passes",
    category: "Patterns",
    constraint: regexSet("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
    value: "550e8400-e29b-41d4-a716-446655440000",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 4 },
      { lang: "TypeScript", lines: 5 },
    ],
  },
  {
    id: "pat-uuid-fail",
    label: "UUID — wrong version digit",
    description: "Version digit must be 4",
    category: "Patterns",
    constraint: regexSet("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
    value: "550e8400-e29b-31d4-a716-446655440000",
    expected: false,
  },
  {
    id: "pat-ip",
    label: "IPv4 address",
    description: "192.168.1.1 is valid",
    category: "Patterns",
    constraint: regexSet("^((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$"),
    value: "192.168.1.1",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 4 },
      { lang: "TypeScript", lines: 8 },
    ],
  },
  {
    id: "pat-ip-fail",
    label: "IPv4 — 999.0.0.1 invalid",
    description: "Octet > 255 rejected",
    category: "Patterns",
    constraint: regexSet("^((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$"),
    value: "999.0.0.1",
    expected: false,
  },
  {
    id: "pat-slug",
    label: "URL slug",
    description: "my-blog-post is a valid slug",
    category: "Patterns",
    constraint: regexSet("^[a-z0-9]+(-[a-z0-9]+)*$"),
    value: "my-blog-post",
    expected: true,
  },
  {
    id: "pat-slug-fail",
    label: "URL slug — spaces rejected",
    description: '"my blog post" contains spaces',
    category: "Patterns",
    constraint: regexSet("^[a-z0-9]+(-[a-z0-9]+)*$"),
    value: "my blog post",
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Named Sets
  // -------------------------------------------------------------------------
  {
    id: "named-string",
    label: "Named set: String",
    description: '"hello" is a string',
    category: "Named Sets",
    constraint: { $tag: "SeRef", handle: "String" },
    value: "hello",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 3 },
      { lang: "TypeScript", lines: 1 },
      { lang: "SQL", lines: 1 },
    ],
  },
  {
    id: "named-string-fail",
    label: "Named set: String — number rejected",
    description: "42 is not a string",
    category: "Named Sets",
    constraint: { $tag: "SeRef", handle: "String" },
    value: 42,
    expected: false,
  },
  {
    id: "named-int",
    label: "Named set: Int",
    description: "42 is an integer",
    category: "Named Sets",
    constraint: { $tag: "SeRef", handle: "Int" },
    value: 42,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 4 },
      { lang: "TypeScript", lines: 3 },
    ],
  },
  {
    id: "named-int-fail",
    label: "Named set: Int — 3.14 rejected",
    description: "3.14 is not an integer",
    category: "Named Sets",
    constraint: { $tag: "SeRef", handle: "Int" },
    value: 3.14,
    expected: false,
  },
  {
    id: "named-nat",
    label: "Named set: Nat (natural numbers)",
    description: "5 is a natural number",
    category: "Named Sets",
    constraint: { $tag: "SeRef", handle: "Nat" },
    value: 5,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 5 },
      { lang: "TypeScript", lines: 4 },
    ],
  },
  {
    id: "named-nat-fail",
    label: "Named set: Nat — -1 rejected",
    description: "-1 is not a natural number",
    category: "Named Sets",
    constraint: { $tag: "SeRef", handle: "Nat" },
    value: -1,
    expected: false,
  },
  {
    id: "named-bool",
    label: "Named set: Boolean",
    description: "true is a boolean",
    category: "Named Sets",
    constraint: { $tag: "SeRef", handle: "Boolean" },
    value: true,
    expected: true,
  },
  {
    id: "named-bool-fail",
    label: "Named set: Boolean — string rejected",
    description: '"true" (string) is not a boolean',
    category: "Named Sets",
    constraint: { $tag: "SeRef", handle: "Boolean" },
    value: "true",
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Composition — Union, Intersect, Diff
  // -------------------------------------------------------------------------
  {
    id: "union-str-num-str",
    label: "Union: String | Number — string passes",
    description: '"hello" matches String in the union',
    category: "Composition",
    constraint: { $tag: "SeUnion", branches: [{ $tag: "SeRef", handle: "String" }, { $tag: "SeRef", handle: "Number" }] },
    value: "hello",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 6 },
      { lang: "TypeScript", lines: 1 },
      { lang: "SQL", lines: 3 },
    ],
  },
  {
    id: "union-str-num-num",
    label: "Union: String | Number — number passes",
    description: "42 matches Number in the union",
    category: "Composition",
    constraint: { $tag: "SeUnion", branches: [{ $tag: "SeRef", handle: "String" }, { $tag: "SeRef", handle: "Number" }] },
    value: 42,
    expected: true,
  },
  {
    id: "union-str-num-fail",
    label: "Union: String | Number — boolean rejected",
    description: "true is neither String nor Number",
    category: "Composition",
    constraint: { $tag: "SeUnion", branches: [{ $tag: "SeRef", handle: "String" }, { $tag: "SeRef", handle: "Number" }] },
    value: true,
    expected: false,
  },
  {
    id: "union-ranges",
    label: "Union of ranges: [0,10] | [90,100]",
    description: "5 is in the first range",
    category: "Composition",
    constraint: { $tag: "SeUnion", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 90, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
      ] },
    value: 5,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 12 },
      { lang: "TypeScript", lines: 5 },
    ],
  },
  {
    id: "union-ranges-gap",
    label: "Union of ranges — 50 in the gap",
    description: "50 is between the two ranges",
    category: "Composition",
    constraint: { $tag: "SeUnion", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 90, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
      ] },
    value: 50,
    expected: false,
  },
  {
    id: "intersect-pos-int",
    label: "Intersect: Int AND [1, +inf) = positive integers",
    description: "7 is a positive integer",
    category: "Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }) , hi: Nothing } },
      ] },
    value: 7,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 8 },
      { lang: "TypeScript", lines: 4 },
    ],
  },
  {
    id: "intersect-pos-int-zero",
    label: "Positive integers — 0 rejected",
    description: "0 is an integer but not positive",
    category: "Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }) , hi: Nothing } },
      ] },
    value: 0,
    expected: false,
  },
  {
    id: "intersect-pos-int-float",
    label: "Positive integers — 3.5 rejected",
    description: "3.5 is positive but not an integer",
    category: "Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }) , hi: Nothing } },
      ] },
    value: 3.5,
    expected: false,
  },
  {
    id: "diff-colors",
    label: "Diff: Colors \\ {red} = all except red",
    description: '"blue" passes — it is not excluded',
    category: "Composition",
    constraint: { $tag: "SeDiff", left: { $tag: "SeEnum", values: ["red", "green", "blue", "yellow"] }, right: { $tag: "SeEnum", values: ["red"] } },
    value: "blue",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 8 },
      { lang: "TypeScript", lines: 3 },
    ],
  },
  {
    id: "diff-colors-fail",
    label: "Diff: Colors \\ {red} — red rejected",
    description: '"red" is explicitly excluded',
    category: "Composition",
    constraint: { $tag: "SeDiff", left: { $tag: "SeEnum", values: ["red", "green", "blue", "yellow"] }, right: { $tag: "SeEnum", values: ["red"] } },
    value: "red",
    expected: false,
  },
  {
    id: "complement-enum",
    label: "Complement: NOT {admin}",
    description: '"user" passes — it is not admin',
    category: "Composition",
    constraint: { $tag: "SeComplement", inner: { $tag: "SeEnum", values: ["admin"] } },
    value: "user",
    expected: true,
  },
  {
    id: "complement-enum-fail",
    label: "Complement: NOT {admin} — admin rejected",
    description: '"admin" is excluded by complement',
    category: "Composition",
    constraint: { $tag: "SeComplement", inner: { $tag: "SeEnum", values: ["admin"] } },
    value: "admin",
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Where Predicates
  // -------------------------------------------------------------------------
  {
    id: "where-even",
    label: "Where: even numbers",
    description: "4 is even (4 % 2 === 0)",
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "" }, 2] }, 0] } },
    value: 4,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
      { lang: "Haskell", lines: 1 },
    ],
  },
  {
    id: "where-even-fail",
    label: "Where: even — 7 rejected",
    description: "7 is odd",
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "" }, 2] }, 0] } },
    value: 7,
    expected: false,
  },
  {
    id: "where-positive",
    label: "Where: positive number",
    description: "5 > 0",
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { ">": [{ var: "" }, 0] } },
    value: 5,
    expected: true,
  },
  {
    id: "where-length",
    label: "Where: string length >= 3",
    description: '"hello" has length 5 >= 3',
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { ">=": [{ length: { var: "" } }, 3] } },
    value: "hello",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 3 },
      { lang: "TypeScript", lines: 3 },
    ],
  },
  {
    id: "where-length-fail",
    label: "Where: string length >= 3 — too short",
    description: '"ab" has length 2 < 3',
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { ">=": [{ length: { var: "" } }, 3] } },
    value: "ab",
    expected: false,
  },
  {
    id: "where-and",
    label: "Where: AND compound — [0,100] via predicates",
    description: "50 satisfies both >= 0 and <= 100",
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { and: [{ ">=": [{ var: "" }, 0] }, { "<=": [{ var: "" }, 100] }] } },
    value: 50,
    expected: true,
  },
  {
    id: "where-or",
    label: "Where: OR — negative or > 1000",
    description: '-5 satisfies "< 0"',
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { or: [{ "<": [{ var: "" }, 0] }, { ">": [{ var: "" }, 1000] }] } },
    value: -5,
    expected: true,
  },
  {
    id: "where-or-fail",
    label: "Where: OR — 500 in the gap",
    description: "500 is neither < 0 nor > 1000",
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { or: [{ "<": [{ var: "" }, 0] }, { ">": [{ var: "" }, 1000] }] } },
    value: 500,
    expected: false,
  },
  {
    id: "where-in",
    label: "Where: IN list",
    description: '"b" is in ["a", "b", "c"]',
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { in: [{ var: "" }, ["a", "b", "c"]] } },
    value: "b",
    expected: true,
  },
  {
    id: "where-divisible",
    label: "Where: divisible by 3",
    description: "9 % 3 === 0",
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "" }, 3] }, 0] } },
    value: 9,
    expected: true,
  },
  {
    id: "where-divisible-fail",
    label: "Where: divisible by 3 — 10 rejected",
    description: "10 % 3 === 1",
    category: "Where Predicates",
    constraint: { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "" }, 3] }, 0] } },
    value: 10,
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Real-World Refinement Types
  // -------------------------------------------------------------------------
  {
    id: "rw-email",
    label: "Email address",
    description: "Pattern + min length",
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "String" },
        regexSet("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"),
      ] },
    value: "user@example.com",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 5 },
      { lang: "TypeScript", lines: 7 },
      { lang: "SQL", lines: 3 },
      { lang: "Haskell", lines: 4 },
    ],
  },
  {
    id: "rw-email-fail",
    label: "Email — invalid format",
    description: '"not-email" lacks @ and domain',
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "String" },
        regexSet("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"),
      ] },
    value: "not-email",
    expected: false,
  },
  {
    id: "rw-username",
    label: "Username: 3-20 chars, alphanumeric",
    description: '"feneluser42" passes all constraints',
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        regexSet("^[a-zA-Z0-9_]+$"),
        { $tag: "SeWhere", pred: { and: [{ ">=": [{ length: { var: "" } }, 3] }, { "<=": [{ length: { var: "" } }, 20] }] } },
      ] },
    value: "feneluser42",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 6 },
      { lang: "TypeScript", lines: 8 },
      { lang: "SQL", lines: 4 },
    ],
  },
  {
    id: "rw-username-short",
    label: "Username — too short",
    description: '"ab" has only 2 characters',
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        regexSet("^[a-zA-Z0-9_]+$"),
        { $tag: "SeWhere", pred: { and: [{ ">=": [{ length: { var: "" } }, 3] }, { "<=": [{ length: { var: "" } }, 20] }] } },
      ] },
    value: "ab",
    expected: false,
  },
  {
    id: "rw-username-special",
    label: "Username — special chars rejected",
    description: '"user@name" contains @',
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        regexSet("^[a-zA-Z0-9_]+$"),
        { $tag: "SeWhere", pred: { and: [{ ">=": [{ length: { var: "" } }, 3] }, { "<=": [{ length: { var: "" } }, 20] }] } },
      ] },
    value: "user@name",
    expected: false,
  },
  {
    id: "rw-latitude",
    label: "Latitude [-90, 90]",
    description: "40.7128 (New York) is valid",
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Number" },
        { $tag: "SeInterval", interval: { lo: Just({ value: -90, inclusive: true }), hi: Just({ value: 90, inclusive: true }) } },
      ] },
    value: 40.7128,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 5 },
      { lang: "TypeScript", lines: 3 },
    ],
  },
  {
    id: "rw-latitude-fail",
    label: "Latitude — 91 out of range",
    description: "91 exceeds maximum latitude",
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Number" },
        { $tag: "SeInterval", interval: { lo: Just({ value: -90, inclusive: true }), hi: Just({ value: 90, inclusive: true }) } },
      ] },
    value: 91,
    expected: false,
  },
  {
    id: "rw-longitude",
    label: "Longitude [-180, 180]",
    description: "-74.0060 (New York) is valid",
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Number" },
        { $tag: "SeInterval", interval: { lo: Just({ value: -180, inclusive: true }), hi: Just({ value: 180, inclusive: true }) } },
      ] },
    value: -74.006,
    expected: true,
  },
  {
    id: "rw-port",
    label: "Port number: Int AND [1, 65535]",
    description: "8080 is a valid port",
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }), hi: Just({ value: 65535, inclusive: true }) } },
      ] },
    value: 8080,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 6 },
      { lang: "TypeScript", lines: 4 },
    ],
  },
  {
    id: "rw-port-zero",
    label: "Port — 0 rejected",
    description: "Port 0 is reserved",
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }), hi: Just({ value: 65535, inclusive: true }) } },
      ] },
    value: 0,
    expected: false,
  },
  {
    id: "rw-port-float",
    label: "Port — 80.5 rejected (not integer)",
    description: "Ports must be whole numbers",
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }), hi: Just({ value: 65535, inclusive: true }) } },
      ] },
    value: 80.5,
    expected: false,
  },
  {
    id: "rw-discount",
    label: "Discount code: uppercase + length [4,12]",
    description: '"SAVE20" passes',
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        regexSet("^[A-Z0-9]+$"),
        { $tag: "SeWhere", pred: { and: [{ ">=": [{ length: { var: "" } }, 4] }, { "<=": [{ length: { var: "" } }, 12] }] } },
      ] },
    value: "SAVE20",
    expected: true,
  },
  {
    id: "rw-discount-lc",
    label: "Discount code — lowercase rejected",
    description: '"save20" fails uppercase pattern',
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        regexSet("^[A-Z0-9]+$"),
        { $tag: "SeWhere", pred: { and: [{ ">=": [{ length: { var: "" } }, 4] }, { "<=": [{ length: { var: "" } }, 12] }] } },
      ] },
    value: "save20",
    expected: false,
  },
  {
    id: "rw-currency",
    label: "Currency amount: [0, +inf) AND Int (cents)",
    description: "1999 cents ($19.99) is valid",
    category: "Real-World Types",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }) , hi: Nothing } },
      ] },
    value: 1999,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 5 },
      { lang: "TypeScript", lines: 4 },
      { lang: "SQL", lines: 2 },
    ],
  },
  {
    id: "rw-temperature-k",
    label: "Temperature (Kelvin): [0, +inf)",
    description: "Absolute zero is 0K — minimum possible",
    category: "Real-World Types",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }) , hi: Nothing } },
    value: 273.15,
    expected: true,
  },
  {
    id: "rw-temperature-k-fail",
    label: "Temperature (Kelvin) — negative rejected",
    description: "-1K is below absolute zero",
    category: "Real-World Types",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }) , hi: Nothing } },
    value: -1,
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Advanced Composition
  // -------------------------------------------------------------------------
  {
    id: "adv-score",
    label: "Game score: Int AND [0,100] AND NOT {13, 666}",
    description: "42 is a valid, non-superstitious score",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
        { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [13, 666] } },
      ] },
    value: 42,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 14 },
      { lang: "TypeScript", lines: 6 },
      { lang: "Haskell", lines: 3 },
    ],
  },
  {
    id: "adv-score-unlucky",
    label: "Game score — 13 excluded (superstitious)",
    description: "13 is in the blacklist",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
        { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [13, 666] } },
      ] },
    value: 13,
    expected: false,
  },
  {
    id: "adv-priority",
    label: "Priority: {low, med, high} | Nat (custom level)",
    description: '"high" is a named priority',
    category: "Advanced Composition",
    constraint: { $tag: "SeUnion", branches: [
        { $tag: "SeEnum", values: ["low", "med", "high"] },
        { $tag: "SeRef", handle: "Nat" },
      ] },
    value: "high",
    expected: true,
  },
  {
    id: "adv-priority-num",
    label: "Priority — numeric level 5",
    description: "5 is a valid Nat priority level",
    category: "Advanced Composition",
    constraint: { $tag: "SeUnion", branches: [
        { $tag: "SeEnum", values: ["low", "med", "high"] },
        { $tag: "SeRef", handle: "Nat" },
      ] },
    value: 5,
    expected: true,
  },
  {
    id: "adv-priority-fail",
    label: "Priority — -1 invalid",
    description: "-1 is not a named level and not Nat",
    category: "Advanced Composition",
    constraint: { $tag: "SeUnion", branches: [
        { $tag: "SeEnum", values: ["low", "med", "high"] },
        { $tag: "SeRef", handle: "Nat" },
      ] },
    value: -1,
    expected: false,
  },
  {
    id: "adv-ascii-printable",
    label: "ASCII printable: pattern AND length [1, 140]",
    description: "Tweet-like constraint",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        regexSet("^[ -~]+$"),
        { $tag: "SeWhere", pred: { and: [{ ">=": [{ length: { var: "" } }, 1] }, { "<=": [{ length: { var: "" } }, 140] }] } },
      ] },
    value: "Hello, world!",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 6 },
      { lang: "TypeScript", lines: 6 },
    ],
  },
  {
    id: "adv-ascii-empty",
    label: "ASCII printable — empty string rejected",
    description: "Min length is 1",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        regexSet("^[ -~]+$"),
        { $tag: "SeWhere", pred: { and: [{ ">=": [{ length: { var: "" } }, 1] }, { "<=": [{ length: { var: "" } }, 140] }] } },
      ] },
    value: "",
    expected: false,
  },
  {
    id: "adv-even-positive-small",
    label: "Even AND positive AND < 100",
    description: "42 meets all three constraints",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "" }, 2] }, 0] } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: false }), hi: Just({ value: 100, inclusive: false }) } },
      ] },
    value: 42,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 6 },
      { lang: "Haskell", lines: 2 },
    ],
  },
  {
    id: "adv-even-positive-odd",
    label: "Even AND positive AND < 100 — 43 rejected",
    description: "43 is odd",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "" }, 2] }, 0] } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: false }), hi: Just({ value: 100, inclusive: false }) } },
      ] },
    value: 43,
    expected: false,
  },
  {
    id: "adv-rgb-component",
    label: "RGB component: Int AND [0, 255]",
    description: "128 is a valid color channel value",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 255, inclusive: true }) } },
      ] },
    value: 128,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 6 },
      { lang: "TypeScript", lines: 4 },
    ],
  },
  {
    id: "adv-rgb-overflow",
    label: "RGB component — 256 overflow",
    description: "256 exceeds 8-bit range",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 255, inclusive: true }) } },
      ] },
    value: 256,
    expected: false,
  },
  {
    id: "adv-semver-like",
    label: "Semantic version pattern",
    description: '"1.2.3" matches semver pattern',
    category: "Advanced Composition",
    constraint: regexSet("^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$"),
    value: "1.2.3",
    expected: true,
  },
  {
    id: "adv-semver-fail",
    label: "Semver — leading zero rejected",
    description: '"01.2.3" has leading zero in major',
    category: "Advanced Composition",
    constraint: regexSet("^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$"),
    value: "01.2.3",
    expected: false,
  },
  {
    id: "adv-weekday",
    label: "Weekday union — not weekend",
    description: "Diff: all days minus weekend",
    category: "Advanced Composition",
    constraint: { $tag: "SeDiff", left: { $tag: "SeEnum", values: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] }, right: { $tag: "SeEnum", values: ["Sat", "Sun"] } },
    value: "Wed",
    expected: true,
  },
  {
    id: "adv-weekday-fail",
    label: "Weekday — Saturday rejected",
    description: '"Sat" is in the excluded weekend set',
    category: "Advanced Composition",
    constraint: { $tag: "SeDiff", left: { $tag: "SeEnum", values: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] }, right: { $tag: "SeEnum", values: ["Sat", "Sun"] } },
    value: "Sat",
    expected: false,
  },
  {
    id: "adv-triple-intersect",
    label: "Triple intersect: Int AND [1,1000] AND divisible by 7",
    description: "49 = 7*7, integer, in range",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }), hi: Just({ value: 1000, inclusive: true }) } },
        { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "" }, 7] }, 0] } },
      ] },
    value: 49,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 7 },
      { lang: "Haskell", lines: 3 },
    ],
  },
  {
    id: "adv-triple-intersect-fail",
    label: "Triple intersect — 50 not divisible by 7",
    description: "50 % 7 = 1",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }), hi: Just({ value: 1000, inclusive: true }) } },
        { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "" }, 7] }, 0] } },
      ] },
    value: 50,
    expected: false,
  },
  {
    id: "adv-power-of-2",
    label: "Power of 2 via bitwise check",
    description: "16 AND (16-1) === 0 for powers of 2",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }) , hi: Nothing } },
        { $tag: "SeWhere", pred: { "===": [{ "&": [{ var: "" }, { "-": [{ var: "" }, 1] }] }, 0] } },
      ] },
    value: 16,
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
      { lang: "Haskell", lines: 2 },
    ],
  },
  {
    id: "adv-power-of-2-fail",
    label: "Power of 2 — 15 rejected",
    description: "15 is not a power of 2",
    category: "Advanced Composition",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeRef", handle: "Int" },
        { $tag: "SeInterval", interval: { lo: Just({ value: 1, inclusive: true }) , hi: Nothing } },
        { $tag: "SeWhere", pred: { "===": [{ "&": [{ var: "" }, { "-": [{ var: "" }, 1] }] }, 0] } },
      ] },
    value: 15,
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------
  {
    id: "edge-nan",
    label: "NaN rejected by interval",
    description: "NaN is not a number in any range",
    category: "Edge Cases",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
    value: NaN,
    expected: false,
  },
  {
    id: "edge-infinity",
    label: "Infinity rejected by bounded interval",
    description: "Infinity exceeds [0, 100]",
    category: "Edge Cases",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
    value: Infinity,
    expected: false,
  },
  {
    id: "edge-neg-zero",
    label: "-0 accepted in [0, 100]",
    description: "Negative zero equals zero",
    category: "Edge Cases",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
    value: -0,
    expected: true,
  },
  {
    id: "edge-empty-string",
    label: 'Empty string "" is a String',
    description: "Empty string is still a string",
    category: "Edge Cases",
    constraint: { $tag: "SeRef", handle: "String" },
    value: "",
    expected: true,
  },
  {
    id: "edge-unicode",
    label: "Unicode string matches String",
    description: "Emoji and CJK characters are strings",
    category: "Edge Cases",
    constraint: { $tag: "SeRef", handle: "String" },
    value: "\u{1F600}\u4F60\u597D",
    expected: true,
  },
  {
    id: "edge-null",
    label: "null rejected by String",
    description: "null is not a string",
    category: "Edge Cases",
    constraint: { $tag: "SeRef", handle: "String" },
    value: null,
    expected: false,
  },
  {
    id: "edge-undefined",
    label: "undefined rejected by Number",
    description: "undefined is not a number",
    category: "Edge Cases",
    constraint: { $tag: "SeRef", handle: "Number" },
    value: undefined,
    expected: false,
  },
  {
    id: "edge-zero-interval",
    label: "Point interval [5, 5] — only 5",
    description: "5 is the only value in [5, 5]",
    category: "Edge Cases",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 5, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } },
    value: 5,
    expected: true,
  },
  {
    id: "edge-zero-interval-fail",
    label: "Point interval [5, 5] — 6 rejected",
    description: "6 is not 5",
    category: "Edge Cases",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 5, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } },
    value: 6,
    expected: false,
  },
  {
    id: "edge-empty-enum",
    label: "Empty SeEnum rejects all",
    description: "No values in empty set",
    category: "Edge Cases",
    constraint: { $tag: "SeEnum", values: [] },
    value: "anything",
    expected: false,
  },
  {
    id: "edge-single-enum",
    label: 'Singleton enum {42} — exact match only',
    description: "42 is the only member",
    category: "Edge Cases",
    constraint: { $tag: "SeEnum", values: [42] },
    value: 42,
    expected: true,
  },
  {
    id: "edge-nested-union",
    label: "Nested union: (A | B) | C",
    description: "Flattened union still works",
    category: "Edge Cases",
    constraint: { $tag: "SeUnion", branches: [
        { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeEnum", values: [2] }] },
        { $tag: "SeEnum", values: [3] },
      ] },
    value: 2,
    expected: true,
  },
  {
    id: "edge-nested-intersect",
    label: "Nested intersect: (A AND B) AND C",
    description: "Flattened intersection still works",
    category: "Edge Cases",
    constraint: { $tag: "SeIntersect", branches: [
        { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Int" }, { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }) , hi: Nothing } }] },
        { $tag: "SeInterval", interval: { hi: Just({ value: 100, inclusive: true }) , lo: Nothing } },
      ] },
    value: 50,
    expected: true,
  },
  {
    id: "edge-diff-self",
    label: "A \\ A = empty set",
    description: "Removing a set from itself yields nothing",
    category: "Edge Cases",
    constraint: { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeEnum", values: [1, 2, 3] } },
    value: 1,
    expected: false,
  },
  {
    id: "edge-complement-all",
    label: "Complement of SeAll = SeNone",
    description: "Nothing passes the complement of everything",
    category: "Edge Cases",
    constraint: { $tag: "SeComplement", inner: { $tag: "SeAll" } },
    value: "anything",
    expected: false,
  },
  {
    id: "edge-complement-none",
    label: "Complement of SeNone = SeAll",
    description: "Everything passes the complement of nothing",
    category: "Edge Cases",
    constraint: { $tag: "SeComplement", inner: { $tag: "SeNone" } },
    value: "anything",
    expected: true,
  },
  {
    id: "edge-very-long-string",
    label: "Long string matches pattern",
    description: "100-char string matches ^[a-z]+$",
    category: "Edge Cases",
    constraint: regexSet("^[a-z]+$"),
    value: "a".repeat(100),
    expected: true,
  },
  {
    id: "edge-float-precision",
    label: "Float precision: 0.1 + 0.2 in [0, 1]",
    description: "IEEE 754 edge case",
    category: "Edge Cases",
    constraint: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 1, inclusive: true }) } },
    value: 0.1 + 0.2,
    expected: true,
  },

  // -------------------------------------------------------------------------
  // Record Constraints — cross-field validation
  // -------------------------------------------------------------------------
  {
    id: "rec-drinking-us-pass",
    label: "Drinking age — US, 21yo",
    description: "Person { name, age, country }. Drinking age by country: US=21, UK/FR=18, DE=16, JP=20",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "country" }, "US"] }, { ">=": [{ var: "age" }, 21] },
      { "===": [{ var: "country" }, "UK"] }, { ">=": [{ var: "age" }, 18] },
      { "===": [{ var: "country" }, "DE"] }, { ">=": [{ var: "age" }, 16] },
      { "===": [{ var: "country" }, "JP"] }, { ">=": [{ var: "age" }, 20] },
      { ">=": [{ var: "age" }, 18] },
    ] } },
    value: { name: "John", age: 21, country: "US" },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 15 },
      { lang: "SQL", lines: 10 },
      { lang: "Haskell", lines: 6 },
    ],
  },
  {
    id: "rec-drinking-us-fail",
    label: "Drinking age — US, 20yo rejected",
    description: "20 < 21 minimum for US",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "country" }, "US"] }, { ">=": [{ var: "age" }, 21] },
      { "===": [{ var: "country" }, "UK"] }, { ">=": [{ var: "age" }, 18] },
      { "===": [{ var: "country" }, "DE"] }, { ">=": [{ var: "age" }, 16] },
      { "===": [{ var: "country" }, "JP"] }, { ">=": [{ var: "age" }, 20] },
      { ">=": [{ var: "age" }, 18] },
    ] } },
    value: { name: "Jake", age: 20, country: "US" },
    expected: false,
  },
  {
    id: "rec-drinking-de-pass",
    label: "Drinking age — Germany, 17yo",
    description: "17 >= 16 minimum for DE (beer/wine)",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "country" }, "US"] }, { ">=": [{ var: "age" }, 21] },
      { "===": [{ var: "country" }, "UK"] }, { ">=": [{ var: "age" }, 18] },
      { "===": [{ var: "country" }, "DE"] }, { ">=": [{ var: "age" }, 16] },
      { "===": [{ var: "country" }, "JP"] }, { ">=": [{ var: "age" }, 20] },
      { ">=": [{ var: "age" }, 18] },
    ] } },
    value: { name: "Hans", age: 17, country: "DE" },
    expected: true,
  },
  {
    id: "rec-drinking-de-fail",
    label: "Drinking age — Germany, 15yo rejected",
    description: "15 < 16 minimum for DE",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "country" }, "US"] }, { ">=": [{ var: "age" }, 21] },
      { "===": [{ var: "country" }, "UK"] }, { ">=": [{ var: "age" }, 18] },
      { "===": [{ var: "country" }, "DE"] }, { ">=": [{ var: "age" }, 16] },
      { "===": [{ var: "country" }, "JP"] }, { ">=": [{ var: "age" }, 20] },
      { ">=": [{ var: "age" }, 18] },
    ] } },
    value: { name: "Lena", age: 15, country: "DE" },
    expected: false,
  },
  {
    id: "rec-drinking-jp-pass",
    label: "Drinking age — Japan, 20yo",
    description: "20 >= 20 minimum for JP",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "country" }, "US"] }, { ">=": [{ var: "age" }, 21] },
      { "===": [{ var: "country" }, "UK"] }, { ">=": [{ var: "age" }, 18] },
      { "===": [{ var: "country" }, "DE"] }, { ">=": [{ var: "age" }, 16] },
      { "===": [{ var: "country" }, "JP"] }, { ">=": [{ var: "age" }, 20] },
      { ">=": [{ var: "age" }, 18] },
    ] } },
    value: { name: "Yuki", age: 20, country: "JP" },
    expected: true,
  },
  {
    id: "rec-drinking-jp-fail",
    label: "Drinking age — Japan, 19yo rejected",
    description: "19 < 20 minimum for JP",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "country" }, "US"] }, { ">=": [{ var: "age" }, 21] },
      { "===": [{ var: "country" }, "UK"] }, { ">=": [{ var: "age" }, 18] },
      { "===": [{ var: "country" }, "DE"] }, { ">=": [{ var: "age" }, 16] },
      { "===": [{ var: "country" }, "JP"] }, { ">=": [{ var: "age" }, 20] },
      { ">=": [{ var: "age" }, 18] },
    ] } },
    value: { name: "Kenji", age: 19, country: "JP" },
    expected: false,
  },
  {
    id: "rec-daterange-pass",
    label: "Date range — end > start",
    description: "Event { start_ts, end_ts }. End must be after start",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { ">": [{ var: "end_ts" }, { var: "start_ts" }] } },
    value: { start_ts: 1700000000, end_ts: 1700003600 },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
      { lang: "SQL", lines: 2 },
    ],
  },
  {
    id: "rec-daterange-fail",
    label: "Date range — end before start rejected",
    description: "End timestamp is before start",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { ">": [{ var: "end_ts" }, { var: "start_ts" }] } },
    value: { start_ts: 1700003600, end_ts: 1700000000 },
    expected: false,
  },
  {
    id: "rec-password-confirm-pass",
    label: "Password confirmation matches",
    description: "Registration { password, confirm }. Must match",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { "===": [{ var: "password" }, { var: "confirm" }] } },
    value: { password: "s3cur3P@ss", confirm: "s3cur3P@ss" },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 3 },
    ],
  },
  {
    id: "rec-password-confirm-fail",
    label: "Password confirmation — mismatch",
    description: "Password and confirm differ",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { "===": [{ var: "password" }, { var: "confirm" }] } },
    value: { password: "s3cur3P@ss", confirm: "s3curep@ss" },
    expected: false,
  },
  {
    id: "rec-discount-threshold-pass",
    label: "Discount requires min subtotal",
    description: "Cart { subtotal, discount_pct }. Discount only if subtotal > 50",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { or: [
      { "===": [{ var: "discount_pct" }, 0] },
      { ">": [{ var: "subtotal" }, 50] },
    ] } },
    value: { subtotal: 75, discount_pct: 10 },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
      { lang: "SQL", lines: 3 },
    ],
  },
  {
    id: "rec-discount-threshold-fail",
    label: "Discount on small order rejected",
    description: "Subtotal 30 < 50 minimum for discount",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { or: [
      { "===": [{ var: "discount_pct" }, 0] },
      { ">": [{ var: "subtotal" }, 50] },
    ] } },
    value: { subtotal: 30, discount_pct: 10 },
    expected: false,
  },
  {
    id: "rec-shipping-weight-pass",
    label: "Shipping method supports weight",
    description: "Shipment { weight_kg, method }. Standard ≤ 30kg, Express ≤ 5kg",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "method" }, "express"] }, { "<=": [{ var: "weight_kg" }, 5] },
      { "===": [{ var: "method" }, "standard"] }, { "<=": [{ var: "weight_kg" }, 30] },
      true,
    ] } },
    value: { weight_kg: 3, method: "express" },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 8 },
    ],
  },
  {
    id: "rec-shipping-weight-fail",
    label: "Express too heavy",
    description: "8kg > 5kg express limit",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "method" }, "express"] }, { "<=": [{ var: "weight_kg" }, 5] },
      { "===": [{ var: "method" }, "standard"] }, { "<=": [{ var: "weight_kg" }, 30] },
      true,
    ] } },
    value: { weight_kg: 8, method: "express" },
    expected: false,
  },
  {
    id: "rec-salary-range-pass",
    label: "Salary within band for role",
    description: "JobOffer { role, salary }. Junior: 40-70k, Senior: 80-150k, Lead: 120-200k",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "role" }, "junior"] }, { and: [{ ">=": [{ var: "salary" }, 40000] }, { "<=": [{ var: "salary" }, 70000] }] },
      { "===": [{ var: "role" }, "senior"] }, { and: [{ ">=": [{ var: "salary" }, 80000] }, { "<=": [{ var: "salary" }, 150000] }] },
      { "===": [{ var: "role" }, "lead"] }, { and: [{ ">=": [{ var: "salary" }, 120000] }, { "<=": [{ var: "salary" }, 200000] }] },
      false,
    ] } },
    value: { role: "senior", salary: 95000 },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 12 },
      { lang: "SQL", lines: 8 },
    ],
  },
  {
    id: "rec-salary-range-fail",
    label: "Junior salary too high for band",
    description: "75000 > 70000 max for junior",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "role" }, "junior"] }, { and: [{ ">=": [{ var: "salary" }, 40000] }, { "<=": [{ var: "salary" }, 70000] }] },
      { "===": [{ var: "role" }, "senior"] }, { and: [{ ">=": [{ var: "salary" }, 80000] }, { "<=": [{ var: "salary" }, 150000] }] },
      { "===": [{ var: "role" }, "lead"] }, { and: [{ ">=": [{ var: "salary" }, 120000] }, { "<=": [{ var: "salary" }, 200000] }] },
      false,
    ] } },
    value: { role: "junior", salary: 75000 },
    expected: false,
  },
  {
    id: "rec-geo-radius-pass",
    label: "Delivery within radius",
    description: "Delivery { store_lat, store_lon, dest_lat, dest_lon }. Distance² < 0.01 (~1km)",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { "<": [
      { "+": [
        { "*": [{ "-": [{ var: "dest_lat" }, { var: "store_lat" }] }, { "-": [{ var: "dest_lat" }, { var: "store_lat" }] }] },
        { "*": [{ "-": [{ var: "dest_lon" }, { var: "store_lon" }] }, { "-": [{ var: "dest_lon" }, { var: "store_lon" }] }] },
      ] },
      0.01,
    ] } },
    value: { store_lat: 48.8566, store_lon: 2.3522, dest_lat: 48.8600, dest_lon: 2.3550 },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 8 },
      { lang: "SQL", lines: 5 },
    ],
  },
  {
    id: "rec-geo-radius-fail",
    label: "Delivery too far",
    description: "Destination 0.5 degrees away — outside radius",
    category: "Record Constraints",
    constraint: { $tag: "SeWhere", pred: { "<": [
      { "+": [
        { "*": [{ "-": [{ var: "dest_lat" }, { var: "store_lat" }] }, { "-": [{ var: "dest_lat" }, { var: "store_lat" }] }] },
        { "*": [{ "-": [{ var: "dest_lon" }, { var: "store_lon" }] }, { "-": [{ var: "dest_lon" }, { var: "store_lon" }] }] },
      ] },
      0.01,
    ] } },
    value: { store_lat: 48.8566, store_lon: 2.3522, dest_lat: 49.3, dest_lon: 2.8 },
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Nested Records — types inside types
  // -------------------------------------------------------------------------
  {
    id: "nest-ceo-adult",
    label: "Company CEO is adult",
    description: "Company { ceo: Person, employees: Person[] }. CEO must be >= 18",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { ">=": [{ var: "ceo.age" }, 18] } },
    value: { name: "Acme Corp", ceo: { name: "Alice", age: 45 }, employees: [{ name: "Bob", age: 30 }] },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
    ],
  },
  {
    id: "nest-ceo-minor",
    label: "Company CEO — minor rejected",
    description: "17-year-old CEO fails age check",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { ">=": [{ var: "ceo.age" }, 18] } },
    value: { name: "Kid Inc", ceo: { name: "Timmy", age: 17 }, employees: [] },
    expected: false,
  },
  {
    id: "nest-all-employees-adult",
    label: "All employees are adults",
    description: "Every employee.age >= 18",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { all: [{ var: "employees" }, { ">=": [{ var: "age" }, 18] }] } },
    value: {
      ceo: { name: "Alice", age: 45 },
      employees: [
        { name: "Bob", age: 30 },
        { name: "Carol", age: 25 },
        { name: "Dave", age: 22 },
      ],
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
    ],
  },
  {
    id: "nest-underage-employee",
    label: "Underage employee rejected",
    description: "16-year-old employee fails all-adults check",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { all: [{ var: "employees" }, { ">=": [{ var: "age" }, 18] }] } },
    value: {
      ceo: { name: "Alice", age: 45 },
      employees: [
        { name: "Bob", age: 30 },
        { name: "Eve", age: 16 },
      ],
    },
    expected: false,
  },
  {
    id: "nest-min-employees",
    label: "Company has minimum 3 employees",
    description: "employees.length >= 3",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { ">=": [{ var: "employees.length" }, 3] } },
    value: {
      name: "BigCo",
      ceo: { name: "Alice", age: 45 },
      employees: [{ name: "A", age: 30 }, { name: "B", age: 25 }, { name: "C", age: 28 }],
    },
    expected: true,
  },
  {
    id: "nest-too-few-employees",
    label: "Company understaffed",
    description: "Only 1 employee < 3 minimum",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { ">=": [{ var: "employees.length" }, 3] } },
    value: {
      name: "TinyCo",
      ceo: { name: "Solo", age: 40 },
      employees: [{ name: "A", age: 30 }],
    },
    expected: false,
  },
  {
    id: "nest-parent-older",
    label: "Parent older than all children",
    description: "Family { parent: Person, children: Person[] }. Parent must be older than every child",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { all: [{ var: "children" }, { "<": [{ var: "age" }, { var: "parent.age" }] }] } },
    value: { parent: { name: "Mom", age: 40 }, children: [{ name: "Kid1", age: 12 }, { name: "Kid2", age: 8 }] },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
    ],
  },
  {
    id: "nest-order-all-positive-prices",
    label: "Order — all item prices positive",
    description: "Order { items: Item[] }. Every item.price > 0",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { all: [{ var: "items" }, { ">": [{ var: "price" }, 0] }] } },
    value: {
      items: [
        { name: "Widget", price: 9.99, qty: 2 },
        { name: "Gadget", price: 24.99, qty: 1 },
      ],
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 3 },
    ],
  },
  {
    id: "nest-order-zero-price",
    label: "Order — zero-price item rejected",
    description: "Item with price 0 fails positive check",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { all: [{ var: "items" }, { ">": [{ var: "price" }, 0] }] } },
    value: {
      items: [
        { name: "Widget", price: 9.99, qty: 2 },
        { name: "Freebie", price: 0, qty: 1 },
      ],
    },
    expected: false,
  },
  {
    id: "nest-school-teacher-older",
    label: "Teacher older than all students",
    description: "Classroom { teacher: Person, students: Person[] }",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { all: [{ var: "students" }, { "<": [{ var: "age" }, { var: "teacher.age" }] }] } },
    value: {
      teacher: { name: "Prof. Smith", age: 50 },
      students: [{ name: "A", age: 20 }, { name: "B", age: 22 }, { name: "C", age: 19 }],
    },
    expected: true,
  },
  {
    id: "nest-address-zip-country",
    label: "US address has 5-digit zip",
    description: "Address { country, zip }. US zip must match 5-digit pattern",
    category: "Nested Records",
    constraint: US_ADDRESS_ZIP,
    value: { name: "Alice", address: { country: "US", zip: "10001", city: "New York" } },
    expected: true,
  },
  {
    id: "nest-address-zip-bad",
    label: "US address — short zip rejected",
    description: "3-digit zip fails US validation",
    category: "Nested Records",
    constraint: US_ADDRESS_ZIP,
    value: { name: "Bob", address: { country: "US", zip: "100", city: "NYC" } },
    expected: false,
  },
  {
    id: "nest-address-zip-letters",
    label: "US address — five letters rejected",
    description: "Matching the length is insufficient: US zip requires five ASCII digits",
    category: "Nested Records",
    constraint: US_ADDRESS_ZIP,
    value: { name: "Bob", address: { country: "US", zip: "ABCDE", city: "NYC" } },
    expected: false,
  },
  {
    id: "nest-address-zip-nonus",
    label: "Non-US address — US zip rule bypassed",
    description: "This example checks the US pattern only; it does not validate another country's postal format",
    category: "Nested Records",
    constraint: US_ADDRESS_ZIP,
    value: { name: "Alice", address: { country: "FR", zip: "ABCDE", city: "Paris" } },
    expected: true,
  },
  {
    id: "nest-team-positions-covered",
    label: "Soccer team — has goalkeeper",
    description: "Team { players: Player[] }. At least one player with position 'GK'",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { some: [{ var: "players" }, { "===": [{ var: "position" }, "GK"] }] } },
    value: {
      sport: "soccer",
      players: [
        { name: "A", position: "GK" },
        { name: "B", position: "DEF" },
        { name: "C", position: "MID" },
      ],
    },
    expected: true,
  },
  {
    id: "nest-team-no-gk",
    label: "Soccer team — no goalkeeper",
    description: "No player has position 'GK'",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { some: [{ var: "players" }, { "===": [{ var: "position" }, "GK"] }] } },
    value: {
      sport: "soccer",
      players: [
        { name: "B", position: "DEF" },
        { name: "C", position: "MID" },
        { name: "D", position: "FWD" },
      ],
    },
    expected: false,
  },
  {
    id: "nest-no-duplicate-emails",
    label: "No duplicate emails in contacts",
    description: "ContactList { contacts: Contact[] }. Mapping contacts to emails and removing duplicates preserves the list length.",
    category: "Nested Records",
    constraint: UNIQUE_CONTACT_EMAILS,
    value: {
      contacts: [
        { name: "Alice", email: "alice@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    },
    expected: true,
  },
  {
    id: "nest-duplicate-emails-rejected",
    label: "Duplicate contact emails rejected",
    description: "Two differently named contacts share one email. Removing duplicate emails reduces the list length.",
    category: "Nested Records",
    constraint: UNIQUE_CONTACT_EMAILS,
    value: {
      contacts: [
        { name: "Alice", email: "alice@example.com" },
        { name: "Bob", email: "alice@example.com" },
      ],
    },
    expected: false,
  },
  {
    id: "nest-empty-contact-emails",
    label: "Empty contact list has no duplicates",
    description: "An empty contact list has zero emails before and after removing duplicates.",
    category: "Nested Records",
    constraint: UNIQUE_CONTACT_EMAILS,
    value: { contacts: [] },
    expected: true,
  },
  {
    id: "nest-booking-passengers-named",
    label: "All passengers have names",
    description: "Booking { passengers: Passenger[] }. Every name.length > 0",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { all: [{ var: "passengers" }, { ">": [{ var: "name.length" }, 0] }] } },
    value: {
      flight: "AF123",
      passengers: [
        { name: "Alice Smith", seat: "12A" },
        { name: "Bob Jones", seat: "12B" },
      ],
    },
    expected: true,
  },
  {
    id: "nest-booking-passenger-noname",
    label: "Passenger without name rejected",
    description: "Empty name fails length check",
    category: "Nested Records",
    constraint: { $tag: "SeWhere", pred: { all: [{ var: "passengers" }, { ">": [{ var: "name.length" }, 0] }] } },
    value: {
      flight: "AF123",
      passengers: [
        { name: "Alice Smith", seat: "12A" },
        { name: "", seat: "12B" },
      ],
    },
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Business Rules — real-world multi-field logic
  // -------------------------------------------------------------------------
  {
    id: "biz-loan-dti-pass",
    label: "Loan DTI ratio < 43%",
    description: "LoanApp { income, monthly_debt, requested }. Debt-to-income ratio must be under 43%",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { "<": [
      { "/": [{ var: "monthly_debt" }, { var: "monthly_income" }] },
      0.43,
    ] } },
    value: { monthly_income: 8000, monthly_debt: 2500, requested: 250000, credit_score: 720 },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 6 },
      { lang: "SQL", lines: 4 },
    ],
  },
  {
    id: "biz-loan-dti-fail",
    label: "Loan DTI ratio — too high",
    description: "4000/8000 = 50% > 43% limit",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { "<": [
      { "/": [{ var: "monthly_debt" }, { var: "monthly_income" }] },
      0.43,
    ] } },
    value: { monthly_income: 8000, monthly_debt: 4000, requested: 250000, credit_score: 720 },
    expected: false,
  },
  {
    id: "biz-loan-credit-pass",
    label: "Credit score OK for large loan",
    description: "Loans > $100k require credit_score >= 680",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { or: [
      { "<=": [{ var: "requested" }, 100000] },
      { ">=": [{ var: "credit_score" }, 680] },
    ] } },
    value: { monthly_income: 10000, monthly_debt: 2000, requested: 200000, credit_score: 720 },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
    ],
  },
  {
    id: "biz-loan-credit-fail",
    label: "Credit score too low for large loan",
    description: "650 < 680 required for $200k loan",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { or: [
      { "<=": [{ var: "requested" }, 100000] },
      { ">=": [{ var: "credit_score" }, 680] },
    ] } },
    value: { monthly_income: 10000, monthly_debt: 2000, requested: 200000, credit_score: 650 },
    expected: false,
  },
  {
    id: "biz-cart-max-items",
    label: "Cart max 50 items",
    description: "Order { items: Item[] }. No more than 50 line items",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { "<=": [{ var: "items.length" }, 50] } },
    value: { items: Array.from({ length: 10 }, (_, i) => ({ name: `Item ${i}`, price: 10, qty: 1 })) },
    expected: true,
  },
  {
    id: "biz-cart-too-many",
    label: "Cart — 51 items rejected",
    description: "51 > 50 item limit",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { "<=": [{ var: "items.length" }, 50] } },
    value: { items: Array.from({ length: 51 }, (_, i) => ({ name: `Item ${i}`, price: 10, qty: 1 })) },
    expected: false,
  },
  {
    id: "biz-booking-max-pax",
    label: "Flight booking max 9 passengers",
    description: "Standard booking allows 1-9 passengers",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { and: [
      { ">=": [{ var: "passengers.length" }, 1] },
      { "<=": [{ var: "passengers.length" }, 9] },
    ] } },
    value: {
      flight: "BA456",
      passengers: [
        { name: "Alice" }, { name: "Bob" }, { name: "Carol" },
      ],
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 8 },
      { lang: "TypeScript", lines: 4 },
    ],
  },
  {
    id: "biz-booking-too-many-pax",
    label: "Flight booking — 10 passengers rejected",
    description: "10 > 9 passenger limit",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { and: [
      { ">=": [{ var: "passengers.length" }, 1] },
      { "<=": [{ var: "passengers.length" }, 9] },
    ] } },
    value: {
      flight: "BA456",
      passengers: Array.from({ length: 10 }, (_, i) => ({ name: `Pax ${i}` })),
    },
    expected: false,
  },
  {
    id: "biz-insurance-young-driver",
    label: "Insurance — young driver premium zone",
    description: "Driver { age, years_licensed }. Under-25 needs >= 2 years license",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { or: [
      { ">=": [{ var: "age" }, 25] },
      { ">=": [{ var: "years_licensed" }, 2] },
    ] } },
    value: { name: "Sam", age: 23, years_licensed: 3 },
    expected: true,
  },
  {
    id: "biz-insurance-young-driver-fail",
    label: "Insurance — inexperienced young driver rejected",
    description: "22yo with 1 year experience fails both checks",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { or: [
      { ">=": [{ var: "age" }, 25] },
      { ">=": [{ var: "years_licensed" }, 2] },
    ] } },
    value: { name: "Kim", age: 22, years_licensed: 1 },
    expected: false,
  },
  {
    id: "biz-subscription-limit-pass",
    label: "Subscription — within plan limits",
    description: "Account { plan, member_count }. Free: ≤5, Pro: ≤50, Enterprise: ≤500",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "plan" }, "free"] }, { "<=": [{ var: "member_count" }, 5] },
      { "===": [{ var: "plan" }, "pro"] }, { "<=": [{ var: "member_count" }, 50] },
      { "===": [{ var: "plan" }, "enterprise"] }, { "<=": [{ var: "member_count" }, 500] },
      false,
    ] } },
    value: { plan: "pro", member_count: 30 },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 10 },
      { lang: "SQL", lines: 6 },
    ],
  },
  {
    id: "biz-subscription-limit-fail",
    label: "Subscription — free plan over limit",
    description: "8 members > 5 free limit",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { if: [
      { "===": [{ var: "plan" }, "free"] }, { "<=": [{ var: "member_count" }, 5] },
      { "===": [{ var: "plan" }, "pro"] }, { "<=": [{ var: "member_count" }, 50] },
      { "===": [{ var: "plan" }, "enterprise"] }, { "<=": [{ var: "member_count" }, 500] },
      false,
    ] } },
    value: { plan: "free", member_count: 8 },
    expected: false,
  },
  {
    id: "biz-recipe-time-pass",
    label: "Recipe total time under 2 hours",
    description: "Recipe { prep_min, cook_min }. Total must be ≤ 120",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { "<=": [{ "+": [{ var: "prep_min" }, { var: "cook_min" }] }, 120] } },
    value: { name: "Pasta", prep_min: 15, cook_min: 20, servings: 4 },
    expected: true,
  },
  {
    id: "biz-recipe-time-fail",
    label: "Recipe — too long",
    description: "45 + 90 = 135 > 120 limit",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { "<=": [{ "+": [{ var: "prep_min" }, { var: "cook_min" }] }, 120] } },
    value: { name: "Beef Stew", prep_min: 45, cook_min: 90, servings: 6 },
    expected: false,
  },
  {
    id: "biz-pricing-tier-pass",
    label: "Volume pricing tier valid",
    description: "Order { qty, unit_price }. qty >= 100 requires unit_price <= 8, qty >= 1000 requires <= 5",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { if: [
      { ">=": [{ var: "qty" }, 1000] }, { "<=": [{ var: "unit_price" }, 5] },
      { ">=": [{ var: "qty" }, 100] }, { "<=": [{ var: "unit_price" }, 8] },
      true,
    ] } },
    value: { product: "Widget", qty: 500, unit_price: 7.50 },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 8 },
    ],
  },
  {
    id: "biz-pricing-tier-fail",
    label: "Volume pricing — price too high for qty",
    description: "500 units at $9 > $8 max for 100+ tier",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { if: [
      { ">=": [{ var: "qty" }, 1000] }, { "<=": [{ var: "unit_price" }, 5] },
      { ">=": [{ var: "qty" }, 100] }, { "<=": [{ var: "unit_price" }, 8] },
      true,
    ] } },
    value: { product: "Widget", qty: 500, unit_price: 9 },
    expected: false,
  },
  {
    id: "biz-event-capacity-pass",
    label: "Event within venue capacity",
    description: "Event { venue_capacity, registered, waitlist_enabled }",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { or: [
      { "<=": [{ var: "registered" }, { var: "venue_capacity" }] },
      { "===": [{ var: "waitlist_enabled" }, true] },
    ] } },
    value: { venue_capacity: 200, registered: 180, waitlist_enabled: false },
    expected: true,
  },
  {
    id: "biz-event-capacity-fail",
    label: "Event overcapacity, no waitlist",
    description: "210 > 200 and waitlist disabled",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { or: [
      { "<=": [{ var: "registered" }, { var: "venue_capacity" }] },
      { "===": [{ var: "waitlist_enabled" }, true] },
    ] } },
    value: { venue_capacity: 200, registered: 210, waitlist_enabled: false },
    expected: false,
  },
  {
    id: "biz-coupon-currency-match",
    label: "Coupon currency matches cart",
    description: "Cart { currency, coupon_currency }. Must match or coupon_currency null",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { or: [
      { "!": [{ var: "coupon_currency" }] },
      { "===": [{ var: "currency" }, { var: "coupon_currency" }] },
    ] } },
    value: { currency: "USD", coupon_currency: "USD", total: 50 },
    expected: true,
  },
  {
    id: "biz-coupon-currency-mismatch",
    label: "Coupon currency mismatch",
    description: "EUR coupon on USD cart rejected",
    category: "Business Rules",
    constraint: { $tag: "SeWhere", pred: { or: [
      { "!": [{ var: "coupon_currency" }] },
      { "===": [{ var: "currency" }, { var: "coupon_currency" }] },
    ] } },
    value: { currency: "USD", coupon_currency: "EUR", total: 50 },
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Statistical Predicates — aggregates over nested data
  // -------------------------------------------------------------------------
  {
    id: "stat-avg-age-pass",
    label: "Company average age < 50",
    description: "Company { employees: Person[] }. Mean age must be under 50",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        sum: { reduce: [{ var: "employees" }, { "+": [{ var: "accumulator" }, { var: "current.age" }] }, 0] },
        count: { var: "employees.length" },
        _check: { "<": [{ "/": [{ var: "sum" }, { var: "count" }] }, 50] },
      }],
    } },
    value: {
      name: "Young Co",
      employees: [
        { name: "Alice", age: 28 },
        { name: "Bob", age: 32 },
        { name: "Carol", age: 35 },
        { name: "Dave", age: 40 },
      ],
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 8 },
      { lang: "SQL", lines: 5 },
      { lang: "Haskell", lines: 4 },
    ],
  },
  {
    id: "stat-avg-age-fail",
    label: "Company average age — too old",
    description: "Mean of [45, 55, 60, 52] = 53 > 50",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        sum: { reduce: [{ var: "employees" }, { "+": [{ var: "accumulator" }, { var: "current.age" }] }, 0] },
        count: { var: "employees.length" },
        _check: { "<": [{ "/": [{ var: "sum" }, { var: "count" }] }, 50] },
      }],
    } },
    value: {
      name: "Senior Co",
      employees: [
        { name: "Alice", age: 45 },
        { name: "Bob", age: 55 },
        { name: "Carol", age: 60 },
        { name: "Dave", age: 52 },
      ],
    },
    expected: false,
  },
  {
    id: "stat-ceo-vs-avg-pass",
    label: "CEO older than average employee",
    description: "CEO age > mean employee age. CEO=55, avg(30,40,35)=35",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        avg: { "/": [
          { reduce: [{ var: "employees" }, { "+": [{ var: "accumulator" }, { var: "current.age" }] }, 0] },
          { var: "employees.length" },
        ] },
        _check: { ">": [{ var: "ceo.age" }, { var: "avg" }] },
      }],
    } },
    value: {
      ceo: { name: "Alice", age: 55 },
      employees: [{ name: "B", age: 30 }, { name: "C", age: 40 }, { name: "D", age: 35 }],
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 10 },
      { lang: "Haskell", lines: 5 },
    ],
  },
  {
    id: "stat-ceo-vs-avg-fail",
    label: "CEO younger than average employee",
    description: "CEO=30, avg(45,50,55)=50. CEO too young",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        avg: { "/": [
          { reduce: [{ var: "employees" }, { "+": [{ var: "accumulator" }, { var: "current.age" }] }, 0] },
          { var: "employees.length" },
        ] },
        _check: { ">": [{ var: "ceo.age" }, { var: "avg" }] },
      }],
    } },
    value: {
      ceo: { name: "Kim", age: 30 },
      employees: [{ name: "B", age: 45 }, { name: "C", age: 50 }, { name: "D", age: 55 }],
    },
    expected: false,
  },
  {
    id: "stat-total-revenue-pass",
    label: "Order total matches sum of line items",
    description: "Order { items, total }. total == sum(item.price * item.qty)",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        computed_total: { reduce: [
          { var: "items" },
          { "+": [{ var: "accumulator" }, { "*": [{ var: "current.price" }, { var: "current.qty" }] }] },
          0,
        ] },
        _check: { "===": [{ var: "total" }, { var: "computed_total" }] },
      }],
    } },
    value: {
      items: [
        { name: "Widget", price: 10, qty: 3 },
        { name: "Gadget", price: 25, qty: 2 },
      ],
      total: 80,
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 8 },
      { lang: "SQL", lines: 6 },
    ],
  },
  {
    id: "stat-total-revenue-fail",
    label: "Order total — amount mismatch",
    description: "Declared total 100 != computed 80",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        computed_total: { reduce: [
          { var: "items" },
          { "+": [{ var: "accumulator" }, { "*": [{ var: "current.price" }, { var: "current.qty" }] }] },
          0,
        ] },
        _check: { "===": [{ var: "total" }, { var: "computed_total" }] },
      }],
    } },
    value: {
      items: [
        { name: "Widget", price: 10, qty: 3 },
        { name: "Gadget", price: 25, qty: 2 },
      ],
      total: 100,
    },
    expected: false,
  },
  {
    id: "stat-all-scores-above-avg",
    label: "No student below class average",
    description: "Class { students }. No score < mean score. Impossible for most data — tests edge case",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        avg: { "/": [
          { reduce: [{ var: "students" }, { "+": [{ var: "accumulator" }, { var: "current.score" }] }, 0] },
          { var: "students.length" },
        ] },
        _check: { all: [{ var: "students" }, { ">=": [{ var: "score" }, { var: "avg" }] }] },
      }],
    } },
    value: {
      students: [
        { name: "A", score: 85 },
        { name: "B", score: 85 },
        { name: "C", score: 85 },
      ],
    },
    expected: true,
  },
  {
    id: "stat-all-scores-above-avg-fail",
    label: "Student below class average",
    description: "avg(90,80,60)=76.67. Student C (60) is below",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        avg: { "/": [
          { reduce: [{ var: "students" }, { "+": [{ var: "accumulator" }, { var: "current.score" }] }, 0] },
          { var: "students.length" },
        ] },
        _check: { all: [{ var: "students" }, { ">=": [{ var: "score" }, { var: "avg" }] }] },
      }],
    } },
    value: {
      students: [
        { name: "A", score: 90 },
        { name: "B", score: 80 },
        { name: "C", score: 60 },
      ],
    },
    expected: false,
  },
  {
    id: "stat-weighted-score-pass",
    label: "Weighted GPA above threshold",
    description: "Transcript { courses: { credits, grade } }. Weighted avg >= 3.0",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        weighted_sum: { reduce: [
          { var: "courses" },
          { "+": [{ var: "accumulator" }, { "*": [{ var: "current.credits" }, { var: "current.grade" }] }] },
          0,
        ] },
        total_credits: { reduce: [
          { var: "courses" },
          { "+": [{ var: "accumulator" }, { var: "current.credits" }] },
          0,
        ] },
        _check: { ">=": [{ "/": [{ var: "weighted_sum" }, { var: "total_credits" }] }, 3.0] },
      }],
    } },
    value: {
      courses: [
        { name: "Math", credits: 4, grade: 3.7 },
        { name: "English", credits: 3, grade: 3.0 },
        { name: "Physics", credits: 4, grade: 3.3 },
      ],
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 12 },
      { lang: "SQL", lines: 8 },
      { lang: "Haskell", lines: 5 },
    ],
  },
  {
    id: "stat-weighted-score-fail",
    label: "Weighted GPA — below threshold",
    description: "Low grades pull weighted avg below 3.0",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      let: [{
        weighted_sum: { reduce: [
          { var: "courses" },
          { "+": [{ var: "accumulator" }, { "*": [{ var: "current.credits" }, { var: "current.grade" }] }] },
          0,
        ] },
        total_credits: { reduce: [
          { var: "courses" },
          { "+": [{ var: "accumulator" }, { var: "current.credits" }] },
          0,
        ] },
        _check: { ">=": [{ "/": [{ var: "weighted_sum" }, { var: "total_credits" }] }, 3.0] },
      }],
    } },
    value: {
      courses: [
        { name: "Math", credits: 4, grade: 2.0 },
        { name: "English", credits: 3, grade: 2.7 },
        { name: "Physics", credits: 4, grade: 2.3 },
      ],
    },
    expected: false,
  },
  {
    id: "stat-budget-allocation-pass",
    label: "Budget allocations sum to 100%",
    description: "Budget { allocations: { category, pct }[] }. Sum of pct must equal 100",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      "===": [
        { reduce: [{ var: "allocations" }, { "+": [{ var: "accumulator" }, { var: "current.pct" }] }, 0] },
        100,
      ],
    } },
    value: {
      allocations: [
        { category: "Engineering", pct: 40 },
        { category: "Marketing", pct: 25 },
        { category: "Operations", pct: 20 },
        { category: "R&D", pct: 15 },
      ],
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 5 },
      { lang: "SQL", lines: 4 },
    ],
  },
  {
    id: "stat-budget-allocation-fail",
    label: "Budget allocations don't sum to 100%",
    description: "40 + 25 + 20 + 10 = 95 != 100",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      "===": [
        { reduce: [{ var: "allocations" }, { "+": [{ var: "accumulator" }, { var: "current.pct" }] }, 0] },
        100,
      ],
    } },
    value: {
      allocations: [
        { category: "Engineering", pct: 40 },
        { category: "Marketing", pct: 25 },
        { category: "Operations", pct: 20 },
        { category: "R&D", pct: 10 },
      ],
    },
    expected: false,
  },
  {
    id: "stat-inventory-reorder",
    label: "Inventory needs reorder",
    description: "Product { stock, daily_sales, lead_days }. stock < daily_sales * lead_days triggers reorder",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      "<": [{ var: "stock" }, { "*": [{ var: "daily_sales" }, { var: "lead_days" }] }],
    } },
    value: { name: "Widget", stock: 50, daily_sales: 20, lead_days: 5 },
    expected: true,
  },
  {
    id: "stat-inventory-ok",
    label: "Inventory sufficient",
    description: "200 stock > 20 * 5 = 100 needed. No reorder",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: {
      "<": [{ var: "stock" }, { "*": [{ var: "daily_sales" }, { var: "lead_days" }] }],
    } },
    value: { name: "Widget", stock: 200, daily_sales: 20, lead_days: 5 },
    expected: false,
  },
  {
    id: "stat-compound-company",
    label: "Company: CEO adult AND avg age < 50 AND min 3 employees",
    description: "Three constraints combined on nested Company type",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: { and: [
      { ">=": [{ var: "ceo.age" }, 18] },
      { ">=": [{ var: "employees.length" }, 3] },
      {
        let: [{
          avg: { "/": [
            { reduce: [{ var: "employees" }, { "+": [{ var: "accumulator" }, { var: "current.age" }] }, 0] },
            { var: "employees.length" },
          ] },
          _check: { "<": [{ var: "avg" }, 50] },
        }],
      },
    ] } },
    value: {
      name: "Good Corp",
      ceo: { name: "Alice", age: 45 },
      employees: [
        { name: "Bob", age: 28 },
        { name: "Carol", age: 32 },
        { name: "Dave", age: 35 },
        { name: "Eve", age: 30 },
      ],
    },
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 0 },
      { lang: "TypeScript", lines: 18 },
      { lang: "SQL", lines: 12 },
      { lang: "Haskell", lines: 8 },
    ],
  },
  {
    id: "stat-compound-company-fail-age",
    label: "Company compound — avg age too high",
    description: "CEO OK, 4 employees, but avg(55,60,52,58)=56.25 > 50",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: { and: [
      { ">=": [{ var: "ceo.age" }, 18] },
      { ">=": [{ var: "employees.length" }, 3] },
      {
        let: [{
          avg: { "/": [
            { reduce: [{ var: "employees" }, { "+": [{ var: "accumulator" }, { var: "current.age" }] }, 0] },
            { var: "employees.length" },
          ] },
          _check: { "<": [{ var: "avg" }, 50] },
        }],
      },
    ] } },
    value: {
      name: "Old Corp",
      ceo: { name: "Alice", age: 65 },
      employees: [
        { name: "B", age: 55 },
        { name: "C", age: 60 },
        { name: "D", age: 52 },
        { name: "E", age: 58 },
      ],
    },
    expected: false,
  },
  {
    id: "stat-compound-company-fail-count",
    label: "Company compound — too few employees",
    description: "CEO OK, avg OK, but only 2 employees < 3",
    category: "Statistical Predicates",
    constraint: { $tag: "SeWhere", pred: { and: [
      { ">=": [{ var: "ceo.age" }, 18] },
      { ">=": [{ var: "employees.length" }, 3] },
      {
        let: [{
          avg: { "/": [
            { reduce: [{ var: "employees" }, { "+": [{ var: "accumulator" }, { var: "current.age" }] }, 0] },
            { var: "employees.length" },
          ] },
          _check: { "<": [{ var: "avg" }, 50] },
        }],
      },
    ] } },
    value: {
      name: "Tiny Corp",
      ceo: { name: "Alice", age: 35 },
      employees: [
        { name: "B", age: 25 },
        { name: "C", age: 30 },
      ],
    },
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Password Schemes — multi-rule pattern intersections
  // -------------------------------------------------------------------------
  {
    id: "pw-basic-pass",
    label: "Basic password — valid",
    description: "Satisfies all 6 example rules: no ASCII whitespace, has ASCII uppercase/lowercase/digit, a non-alphanumeric character and at least 8 codepoints",
    category: "Password Schemes",
    constraint: PW_BASIC,
    value: "Tr0ub4dor&3",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 20 },
      { lang: "TypeScript (Zod)", lines: 8 },
      { lang: "Python", lines: 10 },
      { lang: "SQL CHECK", lines: 12 },
    ],
  },
  {
    id: "pw-basic-short",
    label: "Basic password — too short",
    description: "Only 4 characters — fails minimum length despite having all character classes",
    category: "Password Schemes",
    constraint: PW_BASIC,
    value: "Ab1!",
    expected: false,
  },
  {
    id: "pw-basic-noupper",
    label: "Basic password — no uppercase",
    description: "All lowercase — fails uppercase requirement",
    category: "Password Schemes",
    constraint: PW_BASIC,
    value: "tr0ub4dor&3",
    expected: false,
  },
  {
    id: "pw-hardened-pass",
    label: "Hardened password — valid",
    description: "Six basic rules, minimum 12 characters, no 3 consecutive repeated or ascending ASCII characters, and exclusion from the example blocklist",
    category: "Password Schemes",
    constraint: PW_HARDENED,
    evaluationContext: passwordEvaluationContext,
    criteriaExpression: parseFenel("passwordHardenedCriteria value"),
    value: "K9$mPx!vR2@nWq",
    expected: true,
    comparison: [
      { lang: "JSON Schema", lines: 35 },
      { lang: "TypeScript", lines: 20 },
      { lang: "Python", lines: 18 },
      { lang: "SQL CHECK", lines: 0 },
    ],
  },
  {
    id: "pw-hardened-repeated",
    label: "Hardened password — repeated chars",
    description: "Contains 'AAA' — 3 consecutive identical characters violate anti-repeat rule",
    category: "Password Schemes",
    constraint: PW_HARDENED,
    evaluationContext: passwordEvaluationContext,
    criteriaExpression: parseFenel("passwordHardenedCriteria value"),
    value: "AAAb1!kcwpmzvq",
    expected: false,
  },
  {
    id: "pw-hardened-sequential",
    label: "Hardened password — sequential chars",
    description: "Contains 'xyz' — 3 ascending consecutive characters violate anti-sequential rule",
    category: "Password Schemes",
    constraint: PW_HARDENED,
    evaluationContext: passwordEvaluationContext,
    criteriaExpression: parseFenel("passwordHardenedCriteria value"),
    value: "Wq$5mPxyz!vR2n",
    expected: false,
  },
  {
    id: "pw-hardened-blocklist",
    label: "Hardened password — common password",
    description: "Passes the character and run rules but appears in the exact example blocklist",
    category: "Password Schemes",
    constraint: PW_HARDENED,
    evaluationContext: passwordEvaluationContext,
    criteriaExpression: parseFenel("passwordHardenedCriteria value"),
    value: "M0nk3y$ecure!",
    expected: false,
  },
  {
    id: "pw-smart-runs-pass",
    label: "Smart password — collapsed runs ≥ 10",
    description: "Replaces the blunt 'no 3 consecutive identical chars' rule with a smarter run-collapsing length: collapse repeats (AAA→A, bb→b, ccccc→c) and require ≥ 10 distinct runs. 'AAAb1!kcwpmzvq' collapses to 12 runs, so it passes.",
    category: "Password Schemes",
    constraint: PW_SMART,
    evaluationContext: passwordEvaluationContext,
    criteriaExpression: parseFenel("passwordSmartCriteria value"),
    value: "AAAb1!kcwpmzvq",
    expected: true,
  },
  {
    id: "pw-smart-runs-short",
    label: "Smart password — too few collapsed runs",
    description: "AAAAAbbbbb11111!!!!! contains every character class but collapses to only four consecutive runs",
    category: "Password Schemes",
    constraint: PW_SMART,
    evaluationContext: passwordEvaluationContext,
    criteriaExpression: parseFenel("passwordSmartCriteria value"),
    value: "AAAAAbbbbb11111!!!!!",
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Format Composition
  // -------------------------------------------------------------------------
  {
    id: "fmt-handle-lowercase",
    label: "Social handle — lowercase only",
    description: "Combines the handle preset format with a lowercase-only pattern constraint",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:handle" }, regexSet("^@?[a-z][a-z0-9._]*$")] },
    value: "@cool_user.name",
    expected: true,
  },
  {
    id: "fmt-handle-uppercase-rejected",
    label: "Social handle — uppercase rejected",
    description: "A valid handle format but fails the additional lowercase-only pattern constraint",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:handle" }, regexSet("^@?[a-z][a-z0-9._]*$")] },
    value: "@CoolUser",
    expected: false,
  },
  {
    id: "fmt-instagram-url",
    label: "Instagram profile URL",
    description: "Web URL preset intersected with an instagram.com path pattern — composing named sets with custom patterns",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:url:web" }, regexSet("instagram\\.com/[a-zA-Z0-9._]+")] },
    value: "https://instagram.com/fenel_app",
    expected: true,
  },
  {
    id: "fmt-instagram-wrong-domain",
    label: "Instagram URL — wrong domain",
    description: "Valid web URL but doesn't match the instagram.com domain pattern",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:url:web" }, regexSet("instagram\\.com/[a-zA-Z0-9._]+")] },
    value: "https://twitter.com/fenel_app",
    expected: false,
  },
  {
    id: "fmt-secure-api",
    label: "Secure API endpoint",
    description: "Combines web+secure preset with an /api/ path pattern — ensures HTTPS and API namespace",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:url:web+secure" }, regexSet("/api/v[0-9]+/")] },
    value: "https://api.example.com/api/v2/users",
    expected: true,
  },
  {
    id: "fmt-secure-api-http-rejected",
    label: "API endpoint — HTTP rejected",
    description: "Correct API path but plain HTTP fails the secure (TLS-required) preset",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:url:web+secure" }, regexSet("/api/v[0-9]+/")] },
    value: "http://api.example.com/api/v2/users",
    expected: false,
  },
  {
    id: "fmt-corporate-email",
    label: "Corporate email — company domain only",
    description: "Email format intersected with a corporate domain pattern — rejects consumer mail providers",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:email" }, regexSet("@[a-z0-9-]+\\.(com|io|co)$"), { $tag: "SeComplement", inner: regexSet("@(gmail|yahoo|hotmail|outlook)\\.") }] },
    value: "rom@usefenel.com",
    expected: true,
  },
  {
    id: "fmt-corporate-email-gmail-rejected",
    label: "Corporate email — Gmail rejected",
    description: "Valid email format but gmail.com is excluded by the complement pattern",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:email" }, regexSet("@[a-z0-9-]+\\.(com|io|co)$"), { $tag: "SeComplement", inner: regexSet("@(gmail|yahoo|hotmail|outlook)\\.") }] },
    value: "rom@gmail.com",
    expected: false,
  },
  {
    id: "fmt-uuid-v4",
    label: "UUID v4 — version digit check",
    description: "UUID format intersected with a v4-specific pattern (4 in version position, 8/9/a/b in variant position)",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:uuid" }, regexSet("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")] },
    value: "550e8400-e29b-41d4-a716-446655440000",
    expected: true,
  },
  {
    id: "fmt-uuid-v1-rejected",
    label: "UUID v4 — v1 UUID rejected",
    description: "Valid UUID format but version digit is 1, not 4 — fails v4 pattern",
    category: "Format Composition",
    constraint: { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:uuid" }, regexSet("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")] },
    value: "550e8400-e29b-11d4-a716-446655440000",
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Datetime Formats — placeholder templates compiled to Patterns
  //
  // Each $named here is a Pattern built by templateStringToPattern(). Every
  // segment carries a bounded char-class, so 13/.../... fails on month and
  // ../32/... fails on day at the *string* level (calendar-month bounds are
  // checked separately in Dependent Refinements below).
  // -------------------------------------------------------------------------
  {
    id: "dt-date-us-pass",
    label: "Date (US) — MM/dd/yyyy",
    description: "Template 'MM/dd/yyyy' (LDML) compiled to Pattern. Month segment is bounded 01–12, day 01–31, year 4 digits.",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:date:us" },
    value: "12/25/2025",
    expected: true,
  },
  {
    id: "dt-date-us-bad-month",
    label: "Date (US) — month 13 rejected",
    description: "Same Pattern, month=13 is outside the bounded segment '0[1-9] | 1[0-2]'",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:date:us" },
    value: "13/25/2025",
    expected: false,
  },
  {
    id: "dt-date-us-bad-sep",
    label: "Date (US) — wrong separator",
    description: "Template uses '/'. A '-' separator fails the literal-character segments.",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:date:us" },
    value: "12-25-2025",
    expected: false,
  },
  {
    id: "dt-date-eu-pass",
    label: "Date (EU) — dd/MM/yyyy",
    description: "Template 'dd/MM/yyyy' — day-first locales (UK, FR, IT, ES, AU)",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:date:eu" },
    value: "25/12/2025",
    expected: true,
  },
  {
    id: "dt-date-eu-dot-pass",
    label: "Date (DE) — dd.MM.yyyy",
    description: "Template 'dd.MM.yyyy' — German/Russian/Polish convention",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:date:eu-dot" },
    value: "25.12.2025",
    expected: true,
  },
  {
    id: "dt-date-eu-dash-pass",
    label: "Date — dd-MM-yyyy",
    description: "Template 'dd-MM-yyyy' — alternate dash form for day-first locales",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:date:eu-dash" },
    value: "25-12-2025",
    expected: true,
  },
  {
    id: "dt-date-iso-pass",
    label: "Date (ISO) — yyyy-MM-dd",
    description: "Template 'yyyy-MM-dd' — ISO 8601 / RFC 3339 calendar date",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:date:iso" },
    value: "2025-12-25",
    expected: true,
  },
  {
    id: "dt-time-24h-pass",
    label: "Time (24h) — HH:mm",
    description: "Template 'HH:mm'. Hour bounded 00–23, minute bounded 00–59.",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:time:24h" },
    value: "23:59",
    expected: true,
  },
  {
    id: "dt-time-24h-fail-hour",
    label: "Time (24h) — hour 24 rejected",
    description: "Hour 24 falls outside the bounded segment '[0-1]\\d | 2[0-3]' from template 'HH:mm'",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:time:24h" },
    value: "24:00",
    expected: false,
  },
  {
    id: "dt-time-24h-sec-pass",
    label: "Time (24h, sec) — HH:mm:ss",
    description: "Template 'HH:mm:ss' for second-precision time",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:time:24h-sec" },
    value: "10:30:45",
    expected: true,
  },
  {
    id: "dt-datetime-iso-pass",
    label: "Datetime (ISO) — yyyy-MM-ddTHH:mm:ss",
    description: "Template 'yyyy-MM-ddTHH:mm:ss' composes date + time tokens with literal T separator",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:datetime:iso-t" },
    value: "2025-12-25T10:30:45",
    expected: true,
  },
  {
    id: "dt-datetime-space-pass",
    label: "Datetime (SQL-ish) — yyyy-MM-dd HH:mm:ss",
    description: "Template 'yyyy-MM-dd HH:mm:ss' — same shape as ISO datetime but with a space separator instead of T",
    category: "Datetime Formats",
    constraint: { $tag: "SeRef", handle: "format:datetime:iso" },
    value: "2025-12-25 10:30:45",
    expected: true,
  },

  // -------------------------------------------------------------------------
  // Mask Formats — fixed-width string formats authored as templates
  // -------------------------------------------------------------------------
  {
    id: "mask-hex-color-long",
    label: "HEX color — #XXXXXX",
    description: "Pattern: '#' literal followed by exactly 6 hex chars (any case)",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:hex-color" },
    value: "#FF00AA",
    expected: true,
  },
  {
    id: "mask-hex-color-short",
    label: "HEX color — #XXX",
    description: "3-digit short form (alt-branch of the same Pattern)",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:hex-color" },
    value: "#abc",
    expected: true,
  },
  {
    id: "mask-hex-color-bad-length",
    label: "HEX color — wrong length",
    description: "4 hex chars matches neither the 3-char nor the 6-char branch",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:hex-color" },
    value: "#FFFF",
    expected: false,
  },
  {
    id: "mask-mac-upper",
    label: "MAC address — uppercase",
    description: "6 groups of 2 hex chars, separator can be ':' or '-'",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:mac" },
    value: "AA:BB:CC:DD:EE:FF",
    expected: true,
  },
  {
    id: "mask-mac-lower-dash",
    label: "MAC address — lowercase, dashes",
    description: "Same Pattern, lowercase hex and dash separator",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:mac" },
    value: "aa-bb-cc-dd-ee-ff",
    expected: true,
  },
  {
    id: "mask-semver-pass",
    label: "Semver — 1.2.3",
    description: "Three groups of one-or-more digits, separated by '.'",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:semver" },
    value: "12.345.6789",
    expected: true,
  },
  {
    id: "mask-semver-fail",
    label: "Semver — missing patch",
    description: "Only 2 groups — fails the third digit-group requirement",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:semver" },
    value: "1.2",
    expected: false,
  },
  {
    id: "mask-cc-spaces",
    label: "Credit card — space-separated",
    description: "4 × 4 digits with optional ' ' / '-' / no separator between groups",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:credit-card" },
    value: "4242 4242 4242 4242",
    expected: true,
  },
  {
    id: "mask-cc-dashes",
    label: "Credit card — dash-separated",
    description: "Same Pattern, dash separator",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:credit-card" },
    value: "4242-4242-4242-4242",
    expected: true,
  },
  {
    id: "mask-cc-no-sep",
    label: "Credit card — no separators",
    description: "Same Pattern with the optional separator empty",
    category: "Mask Formats",
    constraint: { $tag: "SeRef", handle: "format:credit-card" },
    value: "4242424242424242",
    expected: true,
  },

  // -------------------------------------------------------------------------
  // Dependent Refinements — types whose validity depends on another field
  //
  // The 'day' field's valid range depends on 'month' and 'year' (Gregorian
  // leap rule). The same Day record is parametric over (month, year) — this
  // is dependent typing in a form, narrowing as upstream segments fill in.
  // -------------------------------------------------------------------------
  {
    id: "dep-date-feb29-leap",
    label: "Feb 29 2024 — valid (leap year)",
    description: "day ≤ daysInMonth(2, 2024). 2024 is divisible by 4 and not by 100, so February has 29 days.",
    category: "Dependent Refinements",
    constraint: DEPENDENT_DATE,
    value: { year: 2024, month: 2, day: 29 },
    expected: true,
  },
  {
    id: "dep-date-feb29-nonleap",
    label: "Feb 29 2025 — rejected",
    description: "Same {month: 2, day: 29} but year=2025 makes daysInMonth=28. The day field's type narrows as year changes.",
    category: "Dependent Refinements",
    constraint: DEPENDENT_DATE,
    value: { year: 2025, month: 2, day: 29 },
    expected: false,
  },
  {
    id: "dep-date-1900-centurial",
    label: "Feb 29 1900 — rejected (centurial non-leap)",
    description: "1900 is divisible by 100 but not 400, so it's NOT a leap year per Gregorian rules. Feb 29 fails.",
    category: "Dependent Refinements",
    constraint: DEPENDENT_DATE,
    value: { year: 1900, month: 2, day: 29 },
    expected: false,
  },
  {
    id: "dep-date-2000-centurial",
    label: "Feb 29 2000 — valid (centurial leap)",
    description: "2000 is divisible by 400, so it IS a leap year. Demonstrates the full Gregorian rule, not just /4.",
    category: "Dependent Refinements",
    constraint: DEPENDENT_DATE,
    value: { year: 2000, month: 2, day: 29 },
    expected: true,
  },
  {
    id: "dep-date-apr31",
    label: "Apr 31 — rejected (30-day month)",
    description: "April is in {4,6,9,11}, so daysInMonth=30. day=31 fails the dependent bound.",
    category: "Dependent Refinements",
    constraint: DEPENDENT_DATE,
    value: { year: 2025, month: 4, day: 31 },
    expected: false,
  },
  {
    id: "dep-date-jul31-pass",
    label: "Jul 31 — valid (31-day month)",
    description: "July's daysInMonth=31, so day=31 passes",
    category: "Dependent Refinements",
    constraint: DEPENDENT_DATE,
    value: { year: 2025, month: 7, day: 31 },
    expected: true,
  },

  // -------------------------------------------------------------------------
  // Multi-Entity Rules
  // -------------------------------------------------------------------------
  {
    id: "order-valid",
    label: "E-commerce order — valid",
    description: "3-entity order: customer (age, country), items (quantity, price), shipping — all rules pass",
    category: "Multi-Entity Rules",
    constraint: ORDER_RULES,
    value: {
      customer: { age: 25, country: "US" },
      items: [
        { name: "Keyboard", quantity: 1, unitPrice: 89.99 },
        { name: "Mouse", quantity: 2, unitPrice: 29.99 },
      ],
      total: 149.97,
      shippingCountry: "US",
    },
    expected: true,
  },
  {
    id: "order-underage",
    label: "E-commerce order — underage customer",
    description: "Customer is 16 — fails the minimum age of 18 requirement",
    category: "Multi-Entity Rules",
    constraint: ORDER_RULES,
    value: {
      customer: { age: 16, country: "US" },
      items: [{ name: "Laptop", quantity: 1, unitPrice: 999 }],
      total: 999,
      shippingCountry: "US",
    },
    expected: false,
  },
  {
    id: "order-country-mismatch",
    label: "E-commerce order — shipping country mismatch",
    description: "Customer country (US) doesn't match shipping country (CA) — cross-entity equality constraint fails",
    category: "Multi-Entity Rules",
    constraint: ORDER_RULES,
    value: {
      customer: { age: 30, country: "US" },
      items: [{ name: "Book", quantity: 1, unitPrice: 15 }],
      total: 15,
      shippingCountry: "CA",
    },
    expected: false,
  },
  {
    id: "appointment-valid",
    label: "Hospital appointment — valid",
    description: "3-entity appointment: patient (insurance), doctor (specialty), department — all cross-references valid",
    category: "Multi-Entity Rules",
    constraint: APPOINTMENT_RULES,
    value: {
      patient: { name: "Jane Doe", insurance: "PPO" },
      doctor: { name: "Dr. Smith", specialty: "Cardiology" },
      department: { name: "Heart Center", specialties: ["Cardiology", "Vascular Surgery"] },
      duration: 30,
    },
    expected: true,
  },
  {
    id: "appointment-specialty-mismatch",
    label: "Hospital appointment — specialty not in department",
    description: "Doctor's specialty (Dermatology) is not listed in the department's specialties — cross-entity membership fails",
    category: "Multi-Entity Rules",
    constraint: APPOINTMENT_RULES,
    value: {
      patient: { name: "Jane Doe", insurance: "PPO" },
      doctor: { name: "Dr. Lee", specialty: "Dermatology" },
      department: { name: "Heart Center", specialties: ["Cardiology", "Vascular Surgery"] },
      duration: 45,
    },
    expected: false,
  },
  {
    id: "enrollment-valid",
    label: "University enrollment — valid",
    description: "3-entity enrollment: student (GPA, credits), course (minGpa, capacity, credits) — all constraints met",
    category: "Multi-Entity Rules",
    constraint: ENROLLMENT_RULES,
    value: {
      student: { name: "Alex", gpa: 3.5, credits: 12 },
      course: { name: "Advanced Algorithms", minGpa: 3.0, enrolled: 28, capacity: 30, credits: 3 },
    },
    expected: true,
  },
  {
    id: "enrollment-credit-overload",
    label: "University enrollment — credit overload",
    description: "Student has 19 credits + 3-credit course = 22, exceeding the 21-credit semester cap",
    category: "Multi-Entity Rules",
    constraint: ENROLLMENT_RULES,
    value: {
      student: { name: "Alex", gpa: 3.8, credits: 19 },
      course: { name: "Database Systems", minGpa: 2.5, enrolled: 10, capacity: 30, credits: 3 },
    },
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Multi-Entity Rules — Domain-Inspired
  // -------------------------------------------------------------------------
  {
    id: "tier-progression-valid",
    label: "Coaching tier — valid progression",
    description: "BayneFrame-inspired: user advancing to 'pro' has completed 'starter' tier and met minimum sessions",
    category: "Multi-Entity Rules",
    constraint: TIER_RULES,
    value: {
      tier: "pro",
      completedTiers: ["free", "starter"],
      sessionsCompleted: 20,
      tierMinSessions: 15,
    },
    expected: true,
  },
  {
    id: "tier-progression-skipped",
    label: "Coaching tier — skipped prerequisite",
    description: "BayneFrame-inspired: jumping to 'elite' without completing 'pro' — prerequisite chain broken",
    category: "Multi-Entity Rules",
    constraint: TIER_RULES,
    value: {
      tier: "elite",
      completedTiers: ["free", "starter"],
      sessionsCompleted: 50,
      tierMinSessions: 10,
    },
    expected: false,
  },
  {
    id: "sellback-valid",
    label: "Digital sellback — valid window",
    description: "DripCollector-inspired: unused item within 30-day window, buyback = 70% of market value",
    category: "Multi-Entity Rules",
    constraint: SELLBACK_RULES,
    value: {
      now: 105,
      purchaseDate: 100,
      marketValue: 100,
      buybackPrice: 70,
      item: { name: "Rare Hoodie", condition: "unused" },
    },
    expected: true,
  },
  {
    id: "sellback-expired",
    label: "Digital sellback — expired window",
    description: "DripCollector-inspired: purchase was 45 days ago, exceeds the 30-day sellback window",
    category: "Multi-Entity Rules",
    constraint: SELLBACK_RULES,
    value: {
      now: 145,
      purchaseDate: 100,
      marketValue: 100,
      buybackPrice: 70,
      item: { name: "Vintage Tee", condition: "unused" },
    },
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Health & Nutrition
  // -------------------------------------------------------------------------
  {
    id: "recipe-cooked-valid",
    label: "Recipe — cooked dish valid",
    description: "Healthfully-inspired: cooked recipe (rawPrep=false) with valid ingredients — temperature constraint doesn't apply",
    category: "Health & Nutrition",
    constraint: RECIPE_RULES,
    value: {
      ingredients: [
        { name: "Chicken breast", amount: 200, unit: "g" },
        { name: "Olive oil", amount: 15, unit: "ml" },
      ],
      rawPrep: false,
      maxTemp: 180,
    },
    expected: true,
  },
  {
    id: "recipe-raw-enzyme-safe",
    label: "Recipe — raw prep below enzyme threshold",
    description: "Healthfully-inspired: raw preparation at 38°C — safely below the 40.6°C enzyme denaturation threshold",
    category: "Health & Nutrition",
    constraint: RECIPE_RULES,
    value: {
      ingredients: [
        { name: "Cashews", amount: 150, unit: "g" },
        { name: "Dates", amount: 100, unit: "g" },
      ],
      rawPrep: true,
      maxTemp: 38,
    },
    expected: true,
  },
  {
    id: "recipe-raw-too-hot",
    label: "Recipe — raw prep exceeds enzyme threshold",
    description: "Healthfully-inspired: raw preparation at 45°C — exceeds the 40.6°C limit, enzymes would denature",
    category: "Health & Nutrition",
    constraint: RECIPE_RULES,
    value: {
      ingredients: [
        { name: "Almonds", amount: 200, unit: "g" },
        { name: "Cacao", amount: 50, unit: "g" },
      ],
      rawPrep: true,
      maxTemp: 45,
    },
    expected: false,
  },
  {
    id: "recipe-no-ingredients",
    label: "Recipe — empty ingredients",
    description: "A recipe with zero ingredients — fails the non-empty ingredient list constraint",
    category: "Health & Nutrition",
    constraint: RECIPE_RULES,
    value: {
      ingredients: [],
      rawPrep: false,
      maxTemp: 100,
    },
    expected: false,
  },
  {
    id: "nutrition-valid",
    label: "Nutritional composition — valid split",
    description: "Healthfully-inspired: macronutrient percentages (30+40+25=95) are each 0-100 and sum ≤ 100",
    category: "Health & Nutrition",
    constraint: NUTRITION_RULES,
    value: { protein: 30, carbs: 40, fat: 25 },
    expected: true,
  },
  {
    id: "nutrition-overcap",
    label: "Nutritional composition — exceeds 100%",
    description: "Macros sum to 110% (40+40+30) — impossible nutritional split violates sum ≤ 100 constraint",
    category: "Health & Nutrition",
    constraint: NUTRITION_RULES,
    value: { protein: 40, carbs: 40, fat: 30 },
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Risk Assessment
  // -------------------------------------------------------------------------
  {
    id: "property-brick-valid",
    label: "Property risk — brick building, inspected",
    description: "Brick construction (no fire suppression needed), not in flood zone, recently inspected — all conditions met",
    category: "Risk Assessment",
    constraint: PROPERTY_RISK,
    value: {
      buildingAge: 20,
      construction: "brick",
      fireSuppression: false,
      floodZone: false,
      floodInsurance: false,
      currentYear: 2026,
      lastInspection: 2024,
    },
    expected: true,
  },
  {
    id: "property-wood-no-fire",
    label: "Property risk — wood without fire suppression",
    description: "Wood construction requires fire suppression (conditional constraint) — missing it fails validation",
    category: "Risk Assessment",
    constraint: PROPERTY_RISK,
    value: {
      buildingAge: 15,
      construction: "wood",
      fireSuppression: false,
      floodZone: false,
      floodInsurance: false,
      currentYear: 2026,
      lastInspection: 2023,
    },
    expected: false,
  },
  {
    id: "property-flood-no-insurance",
    label: "Property risk — flood zone without insurance",
    description: "Property in a flood zone but lacking flood insurance — conditional constraint fails",
    category: "Risk Assessment",
    constraint: PROPERTY_RISK,
    value: {
      buildingAge: 10,
      construction: "concrete",
      fireSuppression: false,
      floodZone: true,
      floodInsurance: false,
      currentYear: 2026,
      lastInspection: 2025,
    },
    expected: false,
  },
  {
    id: "vehicle-adult-basic",
    label: "Vehicle insurance — adult driver, basic coverage",
    description: "Driver aged 30 with basic coverage and clean record — no comprehensive requirement for drivers ≥ 25",
    category: "Risk Assessment",
    constraint: VEHICLE_INS,
    value: { driver: { age: 30 }, accidents: 0, coverageType: "basic" },
    expected: true,
  },
  {
    id: "vehicle-young-comprehensive",
    label: "Vehicle insurance — young driver, comprehensive",
    description: "Driver aged 20 with comprehensive coverage — meets the under-25 conditional requirement",
    category: "Risk Assessment",
    constraint: VEHICLE_INS,
    value: { driver: { age: 20 }, accidents: 1, coverageType: "comprehensive" },
    expected: true,
  },
  {
    id: "vehicle-young-basic-rejected",
    label: "Vehicle insurance — young driver, basic rejected",
    description: "Driver aged 19 chose basic coverage — under-25 drivers must have comprehensive coverage",
    category: "Risk Assessment",
    constraint: VEHICLE_INS,
    value: { driver: { age: 19 }, accidents: 0, coverageType: "basic" },
    expected: false,
  },
  {
    id: "company-tech-valid",
    label: "Company liability — tech company valid",
    description: "Tech company with 30 employees — no HIPAA needed (not healthcare), no safety officer needed (<50 employees)",
    category: "Risk Assessment",
    constraint: COMPANY_LIABILITY,
    value: { industry: "tech", revenue: 5000000, employees: 30, hipaaCompliant: false, hasSafetyOfficer: false },
    expected: true,
  },
  {
    id: "company-healthcare-no-hipaa",
    label: "Company liability — healthcare without HIPAA",
    description: "Healthcare company must be HIPAA compliant — conditional industry constraint fails",
    category: "Risk Assessment",
    constraint: COMPANY_LIABILITY,
    value: { industry: "healthcare", revenue: 2000000, employees: 25, hipaaCompliant: false, hasSafetyOfficer: false },
    expected: false,
  },
  {
    id: "company-large-no-safety",
    label: "Company liability — 50+ employees, no safety officer",
    description: "Manufacturing company with 200 employees but no safety officer — conditional headcount constraint fails",
    category: "Risk Assessment",
    constraint: COMPANY_LIABILITY,
    value: { industry: "manufacturing", revenue: 10000000, employees: 200, hipaaCompliant: false, hasSafetyOfficer: false },
    expected: false,
  },

  // -------------------------------------------------------------------------
  // Filesystem Paths — string-side `format:path:*` family
  //
  // Sister to the structural Path ADT (PathSegment + PathRoot + Path variants
  // in type-foundation.ts). These tests exercise the refined-string view: the
  // composable named-set presets that turn an arbitrary string into a path
  // with proven shape (POSIX/Windows/portable) and proven absence of common
  // hazards (parent traversal, reserved names, NUL bytes, alternate streams).
  //
  // Composition syntax: `format:path:posix+absolute+no-traversal` is sugar
  // for the intersection of the three named sets. Same `+` mechanism as
  // `format:url:web+secure`.
  // -------------------------------------------------------------------------
  {
    id: "path-posix-absolute",
    label: "POSIX path — absolute",
    description: "A canonical POSIX absolute path. Passes the base format:path predicate.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix" },
    value: "/etc/hosts",
    expected: true,
  },
  {
    id: "path-posix-relative",
    label: "POSIX path — relative",
    description: "Relative POSIX path. Still passes :posix (no drive, no backslash).",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix" },
    value: "src/components/Button.tsx",
    expected: true,
  },
  {
    id: "path-posix-rejects-backslash",
    label: "POSIX path — backslash rejected",
    description: "POSIX preset rejects backslash. Use :windows for those.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix" },
    value: "src\\components\\Button.tsx",
    expected: false,
  },
  {
    id: "path-posix-rejects-drive",
    label: "POSIX path — drive letter rejected",
    description: "`C:` prefix is Windows-only. Fails :posix.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix" },
    value: "C:/Users/foo",
    expected: false,
  },
  {
    id: "path-windows-drive",
    label: "Windows path — drive letter",
    description: "Standard `C:\\` Windows path. Backslash separator accepted.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:windows" },
    value: "C:\\Users\\alice\\repos\\fenel",
    expected: true,
  },
  {
    id: "path-windows-drive-lowercase",
    label: "Windows path — lowercase drive accepted",
    description: "Drive letters are case-insensitive in NTFS. `c:\\` is the same as `C:\\`.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:windows" },
    value: "c:\\temp\\file.txt",
    expected: true,
  },
  {
    id: "path-windows-unc",
    label: "Windows path — UNC `\\\\server\\share\\…`",
    description: "Universal Naming Convention path for network shares.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:windows" },
    value: "\\\\fileserver\\public\\docs",
    expected: true,
  },
  {
    id: "path-windows-rejects-reserved-chars",
    label: "Windows path — `<` rejected",
    description: "Windows forbids `<>:\"|?*` in paths (outside the drive prefix and UNC server/share).",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:windows" },
    value: "C:\\Users\\bad<name>\\file.txt",
    expected: false,
  },
  {
    id: "path-portable-pass",
    label: "Portable path — works on every OS",
    description: "ASCII-safe, forward-slash separators, no Windows reserved chars or names.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:portable" },
    value: "assets/images/logo-2024.png",
    expected: true,
  },
  {
    id: "path-portable-rejects-backslash",
    label: "Portable path — backslash rejected",
    description: "Portable form picks one separator (`/`) and sticks with it. Backslash fails.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:portable" },
    value: "assets\\images\\logo.png",
    expected: false,
  },
  {
    id: "path-portable-rejects-trailing-dot",
    label: "Portable path — trailing dot rejected",
    description: "Windows silently strips trailing dots from filenames; portable form rejects them outright to avoid the surprise.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:portable" },
    value: "assets/images/file.",
    expected: false,
  },
  {
    id: "path-no-traversal-pass",
    label: "No-traversal — clean relative path",
    description: "No `..` segment anywhere. Safe to join under a sandboxed root.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix+no-traversal" },
    value: "uploads/images/avatar-42.png",
    expected: true,
  },
  {
    id: "path-no-traversal-zip-slip",
    label: "No-traversal — zip-slip attempt rejected",
    description: "Classic archive-extraction attack: `../../etc/passwd` tries to escape the extraction root. The :no-traversal modifier blocks it at the type level — an attacker literally cannot construct a value of this type.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix+no-traversal" },
    value: "../../etc/passwd",
    expected: false,
  },
  {
    id: "path-no-traversal-embedded",
    label: "No-traversal — embedded `..` segment rejected",
    description: "`..` anywhere along the path fails — `safe/../../etc` would resolve out of the safe root.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix+no-traversal" },
    value: "safe/sub/../../etc/passwd",
    expected: false,
  },
  {
    id: "path-no-traversal-allows-dotdot-in-name",
    label: "No-traversal — `..` inside a name is fine",
    description: "Only the bare `..` segment is forbidden. A filename like `my..file.txt` is a normal name and passes.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix+no-traversal" },
    value: "uploads/my..file.txt",
    expected: true,
  },
  {
    id: "path-no-hidden-rejects-dotfile",
    label: "No-hidden — POSIX dotfile rejected",
    description: "`.ssh` is a hidden directory by POSIX convention. The :no-hidden modifier rejects any segment starting with a dot (excluding the `.` and `..` traversal segments, handled separately).",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix+no-hidden" },
    value: "/home/user/.ssh/id_rsa",
    expected: false,
  },
  {
    id: "path-no-reserved-windows-con",
    label: "No-reserved — Windows `CON` rejected",
    description: "Windows reserves CON, NUL, PRN, AUX, COM1-9, LPT1-9 as device names — files with these names cause IO weirdness (or worse, are unrepresentable). :no-reserved blocks them in any segment, with or without extension.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:windows+no-reserved" },
    value: "C:\\projects\\CON.txt",
    expected: false,
  },
  {
    id: "path-no-reserved-allows-similar-name",
    label: "No-reserved — `Connor.txt` is fine",
    description: "`CON` is reserved but `Connor` is not. Only exact reserved-name matches (with optional extension) are rejected.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:windows+no-reserved" },
    value: "C:\\projects\\Connor.txt",
    expected: true,
  },
  {
    id: "path-no-alt-stream-rejected",
    label: "No-alt-stream — NTFS `:stream` rejected",
    description: "NTFS supports alternate data streams via `file.txt:hidden`. Attackers use them to smuggle data past inspection. :no-alt-stream rejects any `:` after the optional drive prefix.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:windows+no-alt-stream" },
    value: "C:\\notes.txt:secret",
    expected: false,
  },
  {
    id: "path-no-null-byte-rejected",
    label: "No-null-byte — NUL truncation attack rejected",
    description: "A NUL byte truncates C strings; passing `evil.png\\0.exe` to a C-API check on extension passes (it sees `.png`) but the kernel opens `evil.png`. Already covered by base format:path; this asserts it.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:no-null-byte" },
    value: "uploads/evil.png\u0000.exe",
    expected: false,
  },
  {
    id: "path-no-empty-segment-rejected",
    label: "No-empty-segment — `//` collision rejected",
    description: "Adjacent separators (`/foo//bar`) usually mean a join bug. Leading and trailing separators are still allowed (they encode absolute / directory marker).",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix+no-empty-segment" },
    value: "/var/log//app/error.log",
    expected: false,
  },
  {
    id: "path-no-trailing-sep-pass",
    label: "No-trailing-sep — file path passes",
    description: "Distinguishes file paths from directory paths at the type level. A trailing `/` is the conventional directory marker; rejecting it ensures the value names a file.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix+no-trailing-sep" },
    value: "/var/log/app/error.log",
    expected: true,
  },
  {
    id: "path-no-trailing-sep-rejected",
    label: "No-trailing-sep — directory marker rejected",
    description: "Trailing `/` fails — value is a directory, not a file.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:posix+no-trailing-sep" },
    value: "/var/log/app/",
    expected: false,
  },
  {
    id: "path-max-depth-pass",
    label: "Max-depth — within limit",
    description: "Parameterized preset `format:path:max-depth:5` — at most 5 segments. A 4-segment path passes.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:max-depth:5" },
    value: "/a/b/c/d",
    expected: true,
  },
  {
    id: "path-max-depth-rejected",
    label: "Max-depth — limit exceeded",
    description: "6 segments exceeds the depth-5 cap. Useful for bounding recursive walks, archive-extraction limits, etc.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:max-depth:5" },
    value: "/a/b/c/d/e/f",
    expected: false,
  },
  {
    id: "path-max-length-pass",
    label: "Max-length — within Windows MAX_PATH",
    description: "260 chars is the historic Windows MAX_PATH. Bounding the string length keeps cross-platform code safe even when the runtime supports longer.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:max-length:260" },
    value: "C:\\Users\\alice\\Documents\\file.txt",
    expected: true,
  },
  {
    id: "path-ext-single-pass",
    label: "Extension — `.png` accepted",
    description: "Parameterized `format:path:ext:png` — last segment must end in `.png` (case-insensitive).",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:ext:png" },
    value: "/uploads/avatar.PNG",
    expected: true,
  },
  {
    id: "path-ext-single-rejected",
    label: "Extension — wrong ext rejected",
    description: "`.gif` doesn't match the `.png` requirement.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:ext:png" },
    value: "/uploads/avatar.gif",
    expected: false,
  },
  {
    id: "path-ext-multiple-pass",
    label: "Extension — `png|jpg|webp` accepted",
    description: "OR-list inside the parameter: `ext:png|jpg|webp` accepts any of the three. Image-upload constraint in one preset.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeRef", handle: "format:path:ext:png|jpg|webp" },
    value: "/uploads/photo.webp",
    expected: true,
  },
  {
    id: "path-hardened-upload",
    label: "Hardened upload destination — chained constraints",
    description: "Realistic stack: portable + absolute + no-traversal + no-hidden + no-reserved + max-depth:8 + extension whitelist. The value `/uploads/2025/04/clean-name.png` satisfies all of them.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeIntersect", branches: [
      { $tag: "SeRef", handle: "format:path:portable" },
      { $tag: "SeRef", handle: "format:path:absolute" },
      { $tag: "SeRef", handle: "format:path:no-traversal" },
      { $tag: "SeRef", handle: "format:path:no-hidden" },
      { $tag: "SeRef", handle: "format:path:no-reserved" },
      { $tag: "SeRef", handle: "format:path:max-depth:8" },
      { $tag: "SeRef", handle: "format:path:ext:png|jpg|webp|svg" },
    ] },
    value: "/uploads/2025/04/clean-name.png",
    expected: true,
  },
  {
    id: "path-hardened-upload-rejected-hidden",
    label: "Hardened upload — hidden segment rejected",
    description: "Same chain as the previous test. `.cache` segment is hidden — fails the no-hidden modifier even though everything else is fine.",
    category: "Filesystem Paths",
    constraint: { $tag: "SeIntersect", branches: [
      { $tag: "SeRef", handle: "format:path:portable" },
      { $tag: "SeRef", handle: "format:path:absolute" },
      { $tag: "SeRef", handle: "format:path:no-traversal" },
      { $tag: "SeRef", handle: "format:path:no-hidden" },
      { $tag: "SeRef", handle: "format:path:no-reserved" },
      { $tag: "SeRef", handle: "format:path:max-depth:8" },
      { $tag: "SeRef", handle: "format:path:ext:png|jpg|webp|svg" },
    ] },
    value: "/uploads/.cache/avatar.png",
    expected: false,
  },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

type TestResult = {
  tc: TestCase;
  actual: MaybeBool;
  match: boolean;
};

function inferType(v: unknown): FenelType {
  if (typeof v === "number") return { $ref: "Number" };
  if (typeof v === "boolean") return { $ref: "Boolean" };
  if (Array.isArray(v)) {
    return List(v.length > 0 ? inferType(v[0]) : { $ref: "String" });
  }
  if (typeof v === "object" && v !== null) {
    return {
      $record: {
        fields: Object.entries(v as Record<string, unknown>).map(([k, val]) => ({
          name: k,
          label: Nothing,
          type: inferType(val),
          meta: {},
          ui: Nothing,
        })),
      },
    };
  }
  return { $ref: "String" };
}

function formatValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") {
    if (v.length > 40) return `"${v.slice(0, 37)}..."`;
    return `"${v}"`;
  }
  if (typeof v === "number" && isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (Object.is(v, -0)) return "-0";
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length <= 3) return `{${keys.join(", ")}}`;
    return `{${keys.slice(0, 3).join(", ")}, \u2026}`;
  }
  return String(v);
}

function diagnosticVerdict(tc: TestCase, value: unknown): MaybeBool {
  // GLOBAL_ONLY: these source-owned diagnostics hold no authenticated account
  // and cannot authorize a host act or a write.
  return contains(tc.constraint, value, null, {}, tc.evaluationContext?.());
}

function diagnosticState(tc: TestCase, value: unknown): {
  actual: MaybeBool;
  criteria: { label: string; verdict: MaybeBool }[];
} {
  const actual = diagnosticVerdict(tc, value);
  if (actual.$tag === "Nothing") return { actual, criteria: [] };
  if (tc.criteriaExpression) {
    const criteria = evaluate(tc.criteriaExpression, { value }, tc.evaluationContext?.()) as {
      name: string; verdict: MaybeBool; explanation: string;
    }[];
    return { actual, criteria: criteria.map(criterion => ({
      label: `${criterion.name}: ${criterion.explanation}`, verdict: criterion.verdict,
    })) };
  }
  return { actual, criteria: validateWithHints(value, tc.constraint).constraints.map(hint => ({
    label: hint.label, verdict: Just(hint.passed),
  })) };
}

export default function TestsPage() {
  const results = createMemo<TestResult[]>(() =>
    TEST_CASES.map((tc) => {
      const actual = diagnosticVerdict(tc, tc.value);
      return { tc, actual, match: actual.$tag === "Just" && actual._0 === tc.expected };
    }),
  );

  const passCount = createMemo(() => results().filter((r) => r.match).length);
  const unknownCount = createMemo(() => results().filter((r) => r.actual.$tag === "Nothing").length);
  const total = createMemo(() => results().length);
  const allPass = createMemo(() => passCount() === total());

  const [filterCat, setFilterCat] = createSignal<string | null>(null);
  const [filterResult, setFilterResult] = createSignal<"all" | "pass" | "fail" | "unknown">("all");
  const [expandedTests, setExpandedTests] = createSignal<Set<string>>(new Set());

  const filtered = createMemo(() => {
    let list = results();
    const cat = filterCat();
    if (cat) list = list.filter((r) => r.tc.category === cat);
    const fr = filterResult();
    if (fr === "pass") list = list.filter((r) => r.match);
    if (fr === "fail") list = list.filter((r) => r.actual.$tag === "Just" && !r.match);
    if (fr === "unknown") list = list.filter((r) => r.actual.$tag === "Nothing");
    return list;
  });

  const categories = createMemo(() => {
    const seen = new Set<string>();
    const cats: string[] = [];
    for (const tc of TEST_CASES) {
      if (!seen.has(tc.category)) {
        seen.add(tc.category);
        cats.push(tc.category);
      }
    }
    return cats;
  });

  function toggleExpand(id: string) {
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpandedTests(new Set(filtered().map((r: TestResult) => r.tc.id)));
  }

  function collapseAll() {
    setExpandedTests(new Set<string>());
  }

  return (
    <FieldPresentationRegistryProvider registry={undefined}>
      <div class="tests-page">
      <div class="tests-header">
        <h1 class="page-title">Validator Tests</h1>
        <div

          class={["tests-score", { "tests-score--pass": allPass(), "tests-score--fail": !allPass() }]}
        >
          <span class="tests-score__num">{passCount()}</span>
          <span class="tests-score__sep">/</span>
          <span class="tests-score__total">{total()}</span>
          <span class="tests-score__label">{allPass() ? "ALL PASS" : "ISSUES"}</span>
        </div>
      </div>

      <div class="tests-toolbar">
        <div class="tests-filters">
          <LocusSelect
            class="tests-filter-select"
            label="Test category"
            value={filterCat() ?? ""}
            options={[{ value: "", label: "All categories" }, ...categories().map((cat) => ({ value: cat, label: cat }))]}
            onChange={(value) => setFilterCat(value || null)}
          />

          <div class="tests-filter-btns">
            <button

              class={["tests-filter-btn", { "tests-filter-btn--active": !!(filterResult() === "all") }]}
              onClick={() => setFilterResult("all")}
            >
              All
            </button>
            <button

              class={["tests-filter-btn", { "tests-filter-btn--active": !!(filterResult() === "pass") }]}
              onClick={() => setFilterResult("pass")}
            >
              Matching
            </button>
            <button

              class={["tests-filter-btn", { "tests-filter-btn--active": !!(filterResult() === "fail") }]}
              onClick={() => setFilterResult("fail")}
            >
              Mismatched
            </button>
            <button
              class={["tests-filter-btn", { "tests-filter-btn--active": filterResult() === "unknown" }]}
              onClick={() => setFilterResult("unknown")}
            >
              Unknown
            </button>
          </div>

          <div class="tests-expand-btns">
            <button class="tests-filter-btn" onClick={expandAll}>Expand all</button>
            <button class="tests-filter-btn" onClick={collapseAll}>Collapse all</button>
          </div>
        </div>

        <div class="tests-summary">
          {filtered().length} test{filtered().length !== 1 ? "s" : ""} shown
          {unknownCount() > 0 ? ` · ${unknownCount()} unknown overall` : ""}
        </div>
      </div>

      <div class="tests-list">
        <For each={filtered()}>
          {(r) => {
            const expanded = () => expandedTests().has(r.tc.id);
            const isComplex = typeof r.tc.value === "object" && r.tc.value !== null;
            const [valView, setValView] = createSignal<"form" | "code">("form");
            const [editedValue, setEditedValue] = createSignal<unknown>(
              isComplex ? JSON.parse(JSON.stringify(r.tc.value)) : r.tc.value,
            );
            const [codeText, setCodeText] = createSignal(
              JSON.stringify(r.tc.value, null, 2),
            );
            const [codeError, setCodeError] = createSignal(false);

            const formFields: FieldDef[] = isComplex
              ? Object.entries(r.tc.value as Record<string, unknown>).map(([k, val]) => ({
                  name: k, label: Just(k), type: inferType(val),
                  meta: {},
                  ui: Nothing,
                }))
              : [{
                  name: "value", label: Just(r.tc.label),
                  type: typeof r.tc.value === "number"
                    ? { $refined: { base: { $ref: "Number" }, set: r.tc.constraint } }
                    : { $refined: { base: { $ref: "String" }, set: r.tc.constraint } },
                  meta: {},
                  ui: Nothing,
                }];

            const liveTest = createMemo(() => diagnosticState(r.tc, editedValue()));

            function switchValView(view: "form" | "code") {
              if (view === "code") {
                setCodeText(JSON.stringify(editedValue(), null, 2));
                setCodeError(false);
              }
              setValView(view);
            }

            function resetValue() {
              const orig = isComplex ? JSON.parse(JSON.stringify(r.tc.value)) : r.tc.value;
              setEditedValue(orig);
              setCodeText(JSON.stringify(r.tc.value, null, 2));
              setCodeError(false);
            }
            return (
              <div
                data-test-id={r.tc.id}
                class={["test-card", {
                  "test-card--pass": r.match,
                  "test-card--fail": r.actual.$tag === "Just" && !r.match,
                }]}
              >
                <div class="test-card__header" onClick={() => toggleExpand(r.tc.id)}>
                  <span class="test-card__indicator">{r.actual.$tag === "Nothing" ? "?" : r.match ? <IconCircleCheck size={18} class="icon-pass" /> : <IconCircleX size={18} class="icon-fail" />}</span>
                  <div class="test-card__info">
                    <span class="test-card__label">{r.tc.label}</span>
                    <span class="test-card__cat">{r.tc.category}</span>
                  </div>
                  <div class="test-card__values">
                    <span class="test-card__value">
                      <span class="test-card__value-label">Value:</span>
                      <code>{formatValue(r.tc.value)}</code>
                    </span>
                    <span class="test-card__expected">
                      <span class="test-card__value-label">Expected:</span>
                      <code class={{ "val-pass": r.tc.expected, "val-fail": !r.tc.expected }}>
                        {r.tc.expected ? "ACCEPTED" : "REJECTED"}
                      </code>
                    </span>
                    <span class="test-card__actual">
                      <span class="test-card__value-label">Actual:</span>
                      <code class={{ "val-pass": r.actual.$tag === "Just" && r.actual._0, "val-fail": r.actual.$tag === "Just" && !r.actual._0 }}>
                        {r.actual.$tag === "Nothing" ? "UNKNOWN" : r.actual._0 ? "ACCEPTED" : "REJECTED"}
                      </code>
                    </span>
                  </div>
                  <span class="test-card__chevron">{expanded() ? "\u25B2" : "\u25BC"}</span>
                </div>

                <Show when={expanded()}>
                  <div class="test-card__body">
                    <p class="test-card__desc">{r.tc.description}</p>

                    <div class="test-card__sections">
                      <div class="test-card__section">
                        <div class="test-val__header">
                          <h4 style="margin: 0;">Test value</h4>
                          <div class="fe-view-toggle" style="margin-left: auto;">
                            <button
                              class={`fe-view-btn ${valView() === "form" ? "fe-view-btn--active" : ""}`}
                              onClick={() => switchValView("form")}
                            >Form</button>
                            <button
                              class={`fe-view-btn ${valView() === "code" ? "fe-view-btn--active" : ""}`}
                              onClick={() => switchValView("code")}
                            >{"</>"}</button>
                          </div>
                        </div>
                        <div class="card" style="padding: 0.75rem; margin: 0;">
                          <Switch>
                            <Match when={valView() === "form"}>
                              <EntityComponentProvider value={() => null}>
                              <RefResolverProvider value={async () => []}>
                                <Show when={isComplex} fallback={
                                  <div style="margin-bottom: 0.75rem;">
                                    <FieldRenderer
                                      field={formFields[0]}
                                      value={editedValue()}
                                      onChange={setEditedValue}
                                    />
                                  </div>
                                }>
                                  <For each={formFields}>
                                    {(ff) => (
                                      <div style="margin-bottom: 0.75rem;">
                                        <FieldRenderer
                                          field={ff}
                                          value={(editedValue() as Record<string, unknown>)[ff.name]}
                                          onChange={(v) => setEditedValue((prev) => ({
                                            ...(prev as Record<string, unknown>),
                                            [ff.name]: v,
                                          }))}
                                        />
                                      </div>
                                    )}
                                  </For>
                                </Show>
                              </RefResolverProvider>
                              </EntityComponentProvider>
                            </Match>
                            <Match when={valView() === "code"}>
                              <textarea

                                class={["test-val__textarea", { "test-val__textarea--error": !!(codeError()) }]}
                                value={codeText()}
                                onInput={(e) => {
                                  const text = e.currentTarget.value;
                                  setCodeText(text);
                                  try {
                                    setEditedValue(JSON.parse(text));
                                    setCodeError(false);
                                  } catch {
                                    setCodeError(true);
                                  }
                                }}
                                rows={Math.min(codeText().split("\n").length + 1, 15)}
                              />
                            </Match>
                          </Switch>
                        </div>
                        <div class="test-val__actions">
                          <button class="test-val__reset-btn" onClick={resetValue}>Reset</button>
                          <span class={{
                            "test-val__live-result": true,
                            "test-val__live-result--pass": isJustTrue(liveTest().actual),
                            "test-val__live-result--fail": isJustFalse(liveTest().actual),
                          }}>
                            {liveTest().actual.$tag === "Nothing" ? "?" : isJustTrue(liveTest().actual) ? <IconCircleCheck size={14} class="icon-pass" /> : <IconCircleX size={14} class="icon-fail" />}
                            {liveTest().actual.$tag === "Nothing" ? " Unknown — membership could not be decided" : isJustTrue(liveTest().actual) ? " Accepted" : " Rejected"}
                          </span>
                        </div>
                      </div>

                      <div class="test-card__section">
                        <h4>Constraint</h4>
                        <ExpressionDisplay
                          expr={r.tc.constraint}
                          mode="set"
                          showRawToggle
                        />
                      </div>

                      <Show when={r.tc.comparison && r.tc.comparison.length > 0}>
                        <div class="test-card__section">
                          <h4>Equivalent complexity</h4>
                          <div class="test-card__comparison">
                            <div class="comparison-row comparison-row--fenel">
                              <span class="comparison-lang">Fenel</span>
                              <span class="comparison-lines">1 expr</span>
                            </div>
                            <For each={r.tc.comparison!}>
                              {(c) => (
                                <div class="comparison-row">
                                  <span class="comparison-lang">{c.lang}</span>
                                  <span

                                    class={["comparison-lines", { "comparison-lines--impossible": !!(c.lines === 0) }]}
                                  >
                                    {c.lines === 0 ? "impossible" : `~${c.lines} lines`}
                                  </span>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>

                      <Show when={liveTest().criteria.length > 0}>
                        <div class="test-card__section">
                          <h4>Constraint breakdown</h4>
                          <ul class="test-card__constraints">
                            <For each={liveTest().criteria}>
                              {(ch) => (
                                <li class={{ "hint-pass": isJustTrue(ch.verdict), "hint-fail": isJustFalse(ch.verdict) }}>
                                  <span class="hint-icon">{ch.verdict.$tag === "Nothing" ? "?" : isJustTrue(ch.verdict) ? <IconCircleCheck size={14} class="icon-pass" /> : <IconCircleX size={14} class="icon-fail" />}</span>
                                  {ch.label}
                                </li>
                              )}
                            </For>
                          </ul>
                        </div>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
      </div>
    </FieldPresentationRegistryProvider>
  );
}
