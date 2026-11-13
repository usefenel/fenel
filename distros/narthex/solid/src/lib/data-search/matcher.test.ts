// A bare-name query that names no type must not run the subset decider over
// the universe; names that do denote a type keep the decider path.
import { beforeEach, describe, expect, mock, test } from "bun:test";

let subsetCalls = 0;
// The decider behind the mock: always "no" unless a test installs a model.
let decide: (a: unknown, b: unknown) => boolean = () => false;
// The matcher's decider entry points, counted; the parser's type builders
// (List/Maybe come from the same barrel) are inert stand-ins here.
mock.module("@fenel/engine", () => ({
  isSubtype: (a: unknown, b: unknown) => { subsetCalls += 1; return decide(a, b); },
  peelList: () => undefined,
  peelMaybe: () => undefined,
  peelResult: () => undefined,
  List: (elem: unknown) => ({ $list: elem }),
  Maybe: (value: unknown) => ({ $maybe: value }),
}));

const { search, takeDeciderThrowCount } = await import("./matcher");
const { parseQuery } = await import("./parser");
type DataItem = import("./matcher").DataItem;

const item = (fields: Partial<DataItem> & Pick<DataItem, "kind" | "routeId" | "label">): DataItem => ({
  routeBase: fields.kind === "function" ? "/app/functions/" : "/app/types/",
  description: "", source: "system", ...fields,
});

const fn = item({ kind: "function", routeId: "fn-probe", label: "probe42", codeName: "probe42",
  signature: { params: [{ name: "n", type: { $ref: "Number" } }], returns: { $ref: "Number" } } });
const holder = item({ kind: "type", routeId: "holder", label: "Holder",
  type: { $record: { fields: [{ name: "p", type: { $ref: "Probe42" } }] } } as never });
const maker = item({ kind: "function", routeId: "fn-make", label: "makeProbe",
  signature: { params: [], returns: { $ref: "Probe42" } } });
const text = item({ kind: "type", routeId: "text", label: "Text", type: { $ref: "String" } });
const universe = [fn, holder, maker, text];

describe("bare-name type queries", () => {
  beforeEach(() => { subsetCalls = 0; decide = () => false; });

  test("a name that no type carries keeps name and exact-reference matches without the decider", () => {
    const query = parseQuery("probe42");
    expect(query).toMatchObject({ kind: "type", type: { $ref: "Probe42" } });
    const matches = search(universe, query);
    expect(subsetCalls).toBe(0);
    expect(matches.map((m) => [m.item.routeId, m.score, m.reason])).toEqual([
      ["fn-probe", 100, "name"],
      ["fn-make", 65, "signature-uses"],
      ["holder", 50, "field-mention"],
    ]);
  });

  test("a slice is judged against its whole universe", () => {
    const probeType = item({ kind: "type", routeId: "probe42", label: "Probe42", type: { $ref: "String" } });
    const whole = [...universe, probeType];
    search(whole.slice(0, 2), parseQuery("probe42"), whole);
    expect(subsetCalls).toBeGreaterThan(0);
  });

  test("one query run decides each distinct type pair once", () => {
    const twin = (id: string) => item({ kind: "type", routeId: id, label: id,
      type: { $record: { fields: [{ name: "s", type: { $ref: "String" } }] } } as never });
    search([twin("a")], parseQuery("string"));
    const single = subsetCalls;
    expect(single).toBeGreaterThan(0);
    subsetCalls = 0;
    const query = parseQuery("string");
    const triple = [twin("a"), twin("b"), twin("c")];
    search(triple, query);
    expect(subsetCalls).toBe(single);
    // Later slices of the same run reuse the answers; a new query decides again.
    subsetCalls = 0;
    search(triple.slice(1), query, triple);
    expect(subsetCalls).toBe(0);
    search(triple, parseQuery("string"));
    expect(subsetCalls).toBe(single);
  });

  test("a name a type carries, or a well-known atom, still uses the decider", () => {
    search(universe, parseQuery("holder"));
    expect(subsetCalls).toBeGreaterThan(0);
    subsetCalls = 0;
    search(universe, parseQuery("string"));
    expect(subsetCalls).toBeGreaterThan(0);
  });
});

// The catalogue hands the matcher DISPLAY COPIES of definitions: an entity's
// named record fields carry no `key` semantic slot, and the engine's
// field-identity boundary refuses to decide on such a type (it throws). This
// model decider does the same, and otherwise answers over references only:
// equal references, and the refinements listed in `refines`.
const refines = new Map<string, string>([["Email", "String"]]);
let throwingCalls = 0;
const namedFieldWithoutSlot = (t: unknown): boolean => {
  if (t === null || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  const fields = [
    ...(((o.$record as { fields?: unknown[] } | undefined)?.fields) ?? []),
    ...((((o.$variant as { cases?: { fields?: unknown[] }[] } | undefined)?.cases) ?? []).flatMap((c) => c.fields ?? [])),
  ] as Record<string, unknown>[];
  if (fields.some((f) => !("key" in f))) return true;
  return Object.values(o).some(namedFieldWithoutSlot)
    || fields.some((f) => namedFieldWithoutSlot(f.type));
};
const refName = (t: unknown): string | undefined => {
  const r = (t as { $ref?: unknown }).$ref;
  return typeof r === "string" ? r : undefined;
};
const modelDecider = (a: unknown, b: unknown): boolean => {
  if (namedFieldWithoutSlot(a) || namedFieldWithoutSlot(b)) {
    throwingCalls += 1;
    throw new TypeError("field-identity semantic boundary (subset): record: field semantic slot: invalid named field");
  }
  // A refinement is a subset of its base: `String{…} ⊆ String`.
  const refined = (a as { $refined?: { base: unknown } }).$refined;
  if (refined !== undefined) return modelDecider(refined.base, b);
  const left = refName(a), right = refName(b);
  if (left === undefined || right === undefined) return false;
  for (let at: string | undefined = left; at !== undefined; at = refines.get(at)) if (at === right) return true;
  return false;
};

const named = (name: string, type: unknown) => ({ name, label: { $tag: "Nothing" }, type, meta: {} });
const recipe = item({ kind: "entity", routeId: "entity:Recipe", label: "Recipe", ref: { $ref: "Recipe" },
  type: { $record: { fields: [named("title", { $ref: "String" }), named("pantry", { $ref: "Pantry" })] } } as never });
const contact = item({ kind: "entity", routeId: "entity:Contact", label: "Contact", ref: { $ref: "Contact" },
  type: { $record: { fields: [named("email", { $ref: "Email" })] } } as never });
const emailType = item({ kind: "type", routeId: "format:email", label: "Email Address", type: { $ref: "Email" } });
const shout = item({ kind: "function", routeId: "fn-shout", label: "shout",
  signature: { params: [{ name: "s", type: { $ref: "String" } }], returns: { $ref: "String" } } });
const mail = item({ kind: "function", routeId: "fn-mail", label: "mailTo",
  signature: { params: [{ name: "to", type: contact.type! }], returns: { $ref: "String" } } });
const catalogue = [recipe, contact, emailType, shout, mail];

describe("type queries decide on references, never on display copies", () => {
  beforeEach(() => { subsetCalls = 0; throwingCalls = 0; decide = modelDecider; takeDeciderThrowCount?.(); });

  test("an entity with named record fields matches the query of its own name as type-self", () => {
    const matches = search(catalogue, parseQuery("recipe"));
    expect(matches.find((m) => m.item.routeId === "entity:Recipe")).toMatchObject({ score: 95, reason: "type-self" });
    expect(throwingCalls).toBe(0);
  });

  test("a named-field record whose field is Email mentions String through Email ⊆ String", () => {
    const matches = search(catalogue, parseQuery("String"));
    expect(throwingCalls).toBe(0);
    expect(matches.find((m) => m.item.routeId === "entity:Contact")).toMatchObject({ reason: "field-mention" });
    // The refinement itself, judged by its reference.
    expect(matches.find((m) => m.item.routeId === "format:email")).toMatchObject({ reason: "type-refinement" });
  });

  test("an alias entity whose definition is a field-free refinement is a refinement of its base", () => {
    // By reference the decider sees an unrelated name (`PhoneStr ⊆ String` is false); the
    // definition `String{format:phone}` carries no field, so it is judged as well.
    const phone = item({ kind: "entity", routeId: "entity:PhoneStr", label: "Phone", ref: { $ref: "PhoneStr" },
      type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:phone" } } } as never });
    // An opaque type over such a refinement carries no field either.
    const token = item({ kind: "entity", routeId: "entity:BotToken", label: "Bot token", ref: { $ref: "BotToken" },
      type: { $opaque: { name: "BotToken", pure: (phone.type as never) } } as never });
    const opaque = (a: unknown, b: unknown): boolean => {
      const inner = (a as { $opaque?: { pure: unknown } }).$opaque;
      return inner !== undefined ? opaque(inner.pure, b) : modelDecider(a, b);
    };
    decide = opaque;
    const matches = search([phone, token], parseQuery("String"));
    expect(matches.map((m) => [m.item.routeId, m.reason])).toEqual([
      ["entity:PhoneStr", "type-refinement"], ["entity:BotToken", "type-refinement"],
    ]);
    expect(throwingCalls).toBe(0);
  });

  test("a List field mentions its element type, found without the shape recognisers", () => {
    // The engine's List: an opaque whose pure form is a cons cell with named fields.
    const listOf = (elem: unknown) => ({ $opaque: { name: "List", pure: { $variant: { cases: [
      { name: "Nil", label: { $tag: "Nothing" } },
      { name: "Cons", label: { $tag: "Nothing" }, fields: [named("head", elem), named("tail", { $ref: "List" })] },
    ] } } } });
    const mailingList = item({ kind: "entity", routeId: "entity:MailingList", label: "MailingList",
      ref: { $ref: "MailingList" }, type: { $record: { fields: [named("to", listOf({ $ref: "Email" }))] } } as never });
    const matches = search([mailingList], parseQuery("email"));
    expect(matches.map((m) => [m.item.routeId, m.reason])).toEqual([["entity:MailingList", "field-mention"]]);
    expect(throwingCalls).toBe(0);
  });

  test("the seed queries make no throwing decider call", () => {
    for (const q of ["recipe", "email", "String", "String -> String"]) {
      search(catalogue, parseQuery(q));
      expect([q, throwingCalls]).toEqual([q, 0]);
      expect([q, takeDeciderThrowCount()]).toEqual([q, 0]);
    }
    // Signature matching still decides between references.
    const sig = search(catalogue, parseQuery("String -> String"));
    expect(sig.map((m) => [m.item.routeId, m.reason])).toEqual([["fn-shout", "signature-match"]]);
    // A display-copy parameter is not decided: mailTo still matches by mention.
    const email = search(catalogue, parseQuery("email"));
    expect(email.map((m) => [m.item.routeId, m.reason])).toEqual([
      ["format:email", "type-self"], ["fn-mail", "signature-uses"], ["entity:Contact", "field-mention"],
    ]);
  });
});
