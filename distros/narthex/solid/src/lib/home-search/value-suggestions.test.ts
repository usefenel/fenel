import { describe, expect, test } from "bun:test";
import { buildSetExpr } from "@fenel/engine/set-marker";
import { templateStringToPattern } from "@fenel/engine";
import type { DataItem } from "../data-search";
import { buildValueCandidates, suggestValues } from "./value-suggestions";

const email: DataItem = { kind: "type", routeId: "format:email", routeBase: "/app/types/", label: "Email Address",
  description: "", source: "system", type: { $refined: { base: { $ref: "String" }, set: buildSetExpr.ref("format:email") } } };
const candidates = buildValueCandidates([email]);
const suggest = (input: string) => suggestValues(input, candidates);

describe("search value suggestions", () => {
  test("ranks Int before Number and preserves the parsed numeric value", () => {
    const results = suggest("15");
    expect(results.slice(0, 3).map((row) => row.typeName)).toEqual(["Int", "Number", "String"]);
    expect(results[0]).toMatchObject({ status: "complete", value: 15 });
    expect(results.some((row) => row.typeName === "Date")).toBe(false);
    expect(suggest("15.2")[0]).toMatchObject({ typeName: "Number", status: "complete", value: 15.2 });
    expect(suggest("15.2").some((row) => row.typeName === "Int")).toBe(false);
    expect(suggest("-15")[0]).toMatchObject({ typeName: "Int", value: -15 });
  }, 120_000); // The first parser call initializes the engine's lazy evaluator.

  test("always offers exact text including whitespace without interpreting it", () => {
    for (const text of ["hello", "  hello  ", "   ", "test@", "String -> String", "entity:profile", "<script>x</script>"]) {
      expect(suggest(text)[0]).toMatchObject({ typeName: "String", value: text, status: "complete" });
    }
    expect(suggest("")).toEqual([]);
  });

  test("shows an incomplete email and only accepts a validated address", () => {
    expect(suggest("test@").find((row) => row.id === email.routeId)).toMatchObject({ status: "partial" });
    expect(suggest("test@@").some((row) => row.id === email.routeId)).toBe(false);
    expect(suggest("test").some((row) => row.id === email.routeId)).toBe(false);
    expect(suggest(" TEST@EXAMPLE.COM ").find((row) => row.id === email.routeId))
      .toMatchObject({ status: "complete", value: "test@example.com" });
  });

  test("does not turn arbitrary text or dates into phone suggestions", () => {
    const phone: DataItem = { ...email, routeId: "format:phone", label: "Phone Number",
      type: { $refined: { base: { $ref: "String" }, set: buildSetExpr.ref("format:phone") } } };
    const all = buildValueCandidates([email, phone]);
    for (const text of ["test@", "String -> String", "15/03/2026"]) {
      expect(suggestValues(text, all).some((row) => row.id === phone.routeId)).toBe(false);
    }
    expect(suggestValues("+33 6 12 34 56 78", all).find((row) => row.id === phone.routeId))
      .toMatchObject({ status: "complete", value: "+33612345678" });
  });

  test("uses date patterns for partials and normalizes completed locale dates", () => {
    expect(suggest("15/").find((row) => row.id === "date:eu")).toMatchObject({ status: "partial" });
    expect(suggest("15/").some((row) => row.id === "date:us")).toBe(false);
    expect(suggest("2026-").find((row) => row.id === "date:iso")).toMatchObject({ status: "partial" });
    expect(suggest("15/03/2026").find((row) => row.id === "date:eu"))
      .toMatchObject({ typeName: "Date", status: "complete", value: "2026-03-15" });
    expect(suggest("03/15/2026").find((row) => row.id === "date:us"))
      .toMatchObject({ status: "complete", value: "2026-03-15" });
    expect(suggest("15.03.2026").find((row) => row.id === "date:eu-dot"))
      .toMatchObject({ status: "complete", value: "2026-03-15" });
  });

  test("keeps ambiguous dates distinct and rejects impossible calendar dates", () => {
    expect(suggest("03/04/2026").filter((row) => row.typeName === "Date"))
      .toMatchObject([{ id: "date:eu", value: "2026-04-03" }, { id: "date:us", value: "2026-03-04" }]);
    for (const text of ["31/02/2026", "29/02/2026", "2026-02-30", "35/", "15/13/"]) {
      expect(suggest(text).some((row) => row.typeName === "Date")).toBe(false);
    }
    expect(suggest("29/02/2024").find((row) => row.id === "date:eu")).toMatchObject({ status: "complete", value: "2024-02-29" });
  });

  test("discovers catalog refinements and validates after numeric parsing", () => {
    const score: DataItem = { ...email, kind: "entity", routeId: "entity:Score", label: "Score", source: "user",
      type: { $refined: { base: { $ref: "Int" }, set: buildSetExpr.enum([15, 20]) } } };
    const ticket: DataItem = { ...score, routeId: "entity:Ticket", label: "Ticket",
      type: { $refined: { base: { $ref: "String" }, set: buildSetExpr.pattern(templateStringToPattern("T-yyyy")) } } };
    const custom = buildValueCandidates([score, ticket]);
    expect(suggestValues("15", custom).find((row) => row.typeName === "Score")).toMatchObject({ status: "complete", value: 15 });
    expect(suggestValues("16", custom).some((row) => row.typeName === "Score")).toBe(false);
    expect(suggestValues("T-20", custom).find((row) => row.typeName === "Ticket")).toMatchObject({ status: "partial" });
    expect(suggestValues("T-2026", custom).find((row) => row.typeName === "Ticket")).toMatchObject({ status: "complete", value: "T-2026" });
  });
});
