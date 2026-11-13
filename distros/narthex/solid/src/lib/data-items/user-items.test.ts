import { expect, test } from "bun:test";
import { matchesUserQuery, userTypeRouteId } from "./user-items";

// The /app/types search box filters its cards through `matchesUserQuery`: a
// card offers its shown label, its description and the route id its link
// carries (which holds the bare type name).
const card = (label: string, name: string, description = "") =>
  ({ label, description, routeId: userTypeRouteId(name) });

test("an empty or blank query keeps every card", () => {
  expect(matchesUserQuery(card("Order", "Order"), "")).toBe(true);
  expect(matchesUserQuery(card("Order", "Order"), "   ")).toBe(true);
});

test("a query matches the label or the name, case-insensitively and trimmed", () => {
  const order = card("Customer order", "PurchaseOrder");
  expect(matchesUserQuery(order, "customer")).toBe(true);
  expect(matchesUserQuery(order, "  ORDER ")).toBe(true);
  expect(matchesUserQuery(order, "purchase")).toBe(true);
  expect(matchesUserQuery(order, "invoice")).toBe(false);
});

test("a module type matches by its module-qualified name", () => {
  const animation = card("Animation", "telegram.Animation");
  expect(matchesUserQuery(animation, "telegram")).toBe(true);
  expect(matchesUserQuery(animation, "telegram.anim")).toBe(true);
  expect(matchesUserQuery(animation, "email")).toBe(false);
});

test("the description matches too", () => {
  expect(matchesUserQuery(card("Lead", "Lead", "A prospect from a funnel"), "prospect")).toBe(true);
});
