import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";

// B4 wave 4 lane H, worker side: each Home operation, answered by the real
// reader-extension router over a structured clone in the frame of a real Local
// registry, equals the page's former code run with the same session (the
// editors' signature guards, the Call form's `resolvedParams` /
// `parameterSchemes`, the registry's `getUuid`, Browse's value half). Heavy:
// one Local registry; run alone in the heavy slot.
const fixture = await import("./reader-function-options.fixture");
const [catalogue, mint, extensions, artifact, environmentModule, bindings, transfer, suggestions, slicedSearch] = await Promise.all([
  import("./authoring-catalog"), import("../../../../../../implementations/typescript/runtime/src/authority-mint"),
  import("./authoring-worker-reader-extensions"), import("./authoring-catalogue-artifact"),
  import("@fenel/engine/authoring/environment"), import("@fenel/engine/authoring/binding-edits"),
  import("../data-transfer/expressions"), import("../home-search/value-suggestions"), import("../home-search/sliced-search"),
]);
console.info("[reader-home-ops] building the Local registry");
const { registry, snapshot } = await fixture.buildParityRegistry();
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([fixture.SOURCE]) as unknown as string[] });
const local = artifact.projectLocalAuthoringCatalogue(registry, frame, { localSourceId: fixture.SOURCE, snapshot,
  entities: [], functions: [fixture.definition as never] });
const environment = catalogue.environmentForCatalog(local.catalog, registry);
const session = Object.freeze({ mode: "detached", registry, evaluateContext: frame, environment, catalog: environment.catalog }) as unknown as AuthoringSession;
console.info("[reader-home-ops] ready");
const ask = async (query: Record<string, unknown>, othersWaiting = () => false): Promise<unknown> => structuredClone(
  await extensions.runReaderExtension(structuredClone(query) as never, session, undefined, async () => {}, () => false, othersWaiting));
const clone = <T>(value: T): T => structuredClone(value);
const nothing = { $tag: "Nothing" } as const;
// Fixture data (plain records, as the transport carries them).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const field = (name: string, type: unknown, id?: string): any => ({ name, type, label: nothing, ui: nothing, meta: {},
  ...(id ? { key: { $tag: "NamedField", ref: { $ref: id } } } : {}) });
const number = { $ref: "Number" }, text = { $ref: "String" };

describe("B4 wave 4 lane H: reconcile-reader-signature answers as the page's guards", () => {
  const params = [field("amount", number, "f-amount"), field("rate", number, "f-rate")];
  const body = { kind: "call", fnId: "std.add", args: [{ kind: "param", name: "amount" }, { kind: "param", name: "rate" }] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheme: any = { quantified: [], body: { $arrow: { params, returns: number } } };
  const generic = { quantified: [{ id: "a", name: "a", kind: { $tag: "Star" } }], body: { $arrow: { params: [field("x", { $var: "a" })], returns: { $var: "a" } } } };
  const schemeCorpus = [
    { scheme, nextBody: { $arrow: { params, returns: text } } },
    { scheme, nextBody: { $arrow: { params: params.slice(0, 1), returns: number } } },
    { scheme: generic, nextBody: { $arrow: { params: generic.body.$arrow.params, returns: number } } },
    { scheme: generic, nextBody: { $arrow: { params: [field("x", text)], returns: { $var: "a" } } } },
    { scheme: { quantified: [], body: { $record: { fields: [field("name", text)] } } }, nextBody: { $record: { fields: [field("title", text)] } } },
  ];
  test("scheme edits: the same scheme or refusal as `reconcileAuthoringSchemeBody` in the session's frame", async () => {
    for (const input of schemeCorpus) {
      const page = environmentModule.reconcileAuthoringSchemeBody({ ...clone(input), context: session.evaluateContext } as never);
      const reply = await ask({ method: "reconcile-reader-signature", edit: { kind: "scheme", ...clone(input) } });
      expect(reply).toEqual({ reconciled: page.ok ? { $tag: "Ok", _0: { scheme: clone(page.scheme) } } : { $tag: "Err", _0: page.message } });
    }
  });
  const rowCorpus = [
    [field("total", number, "f-amount"), field("rate", number, "f-rate")],
    [field("amount", number, "f-amount")],
    [field("amount", text, "f-amount"), field("rate", number, "f-rate")],
    [field("rate", number, "f-rate"), field("amount", number, "f-amount")],
    [...params, field("extra", number, "f-extra")],
  ];
  test("binding-row edits: the page's two calls in order, the same rows, body and scheme or the same refusal", async () => {
    for (const next of rowCorpus) {
      const draft = { params: clone(params), body: clone(body), returns: number };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any = bindings.reconcileAuthoringBindingRows(clone(draft) as never, clone(next) as never, session.evaluateContext);
      let expected: unknown;
      if (!rows.ok) expected = { $tag: "Err", _0: rows.diagnostics[0]?.message ?? "Resolve the parameter's uses before changing it." };
      else {
        const reconciled = environmentModule.reconcileAuthoringSchemeBody({ scheme: clone(scheme), context: session.evaluateContext,
          nextBody: { $arrow: { ...scheme.body.$arrow, params: [...rows.value.params], returns: rows.value.returns } } });
        expected = reconciled.ok ? { $tag: "Ok", _0: { scheme: clone(reconciled.scheme), binding: clone({ params: [...rows.value.params],
          body: rows.value.body, returns: rows.value.returns }) } } : { $tag: "Err", _0: reconciled.message };
      }
      const reply = await ask({ method: "reconcile-reader-signature", edit: { kind: "binding-rows", draft, next, scheme } });
      expect(reply).toEqual({ reconciled: expected });
    }
  });
  test("a malformed edit is refused before any reconciliation", async () => {
    await expect(ask({ method: "reconcile-reader-signature", edit: { kind: "other", scheme } })).rejects.toThrow("could not be read");
    await expect(ask({ method: "reconcile-reader-signature", edit: { kind: "binding-rows", scheme, draft: { params, body }, next: params } }))
      .rejects.toThrow("could not be read");
  });
});

describe("B4 wave 4 lane H: project-reader-call-signature answers as the Call form's memos", () => {
  const fn = fixture.definition as { id: string; params: Array<{ name: string; type: unknown }> };
  test("the declared parameters, sibling-dependent types and closed schemes of the page's memos", async () => {
    const declared = clone(fn.params);
    for (const inputValues of [{}, { amount: 3 }, { amount: "x" }]) {
      const page = declared.map((param, index) => {
        if (!declared.slice(0, index).every(previous => (inputValues as Record<string, unknown>)[previous.name] !== undefined)) return param;
        const type = transfer.scopedConcreteType(param.type as never, session.evaluateContext, session.environment, session.registry, inputValues);
        return type && type !== param.type ? { ...param, type } : param;
      });
      const entry = session.environment.getFunctionEntry?.(fn.id);
      const schemes = entry?.signatureOutcome?.$tag !== "Solved" || !entry.scheme ? [] : page.map((param, index) => {
        const projected = environmentModule.projectAuthoringScheme(entry.scheme!, ["$arrow", "params", String(index), "type"]);
        if (!projected || param.type === declared[index]?.type) return projected;
        const resolved = session.registry.callSiteTyping.resolveType(param.type as never, fn.id);
        return resolved.ok ? resolved.type : undefined;
      });
      const reply = await ask({ method: "project-reader-call-signature", fnId: fn.id, functionId: fn.id, params: declared, inputValues, priority: "guidance" });
      expect(reply).toEqual({ callSignature: clone({ params: page, schemes: schemes.map(scheme => scheme ? { scheme } : {}) }) });
      expect(schemes.length).toBeGreaterThan(0);
    }
  });
  test("fieldIcons: the registry's Iconable field representation for each id", async () => {
    const ids = [(fixture.definition as { params: Array<{ key: { ref: { $ref: string } } }> }).params[0]!.key.ref.$ref, "missing-field", ""];
    const reply = await ask({ method: "project-reader-call-signature", fieldIcons: ids, priority: "guidance" });
    expect(reply).toEqual({ fieldIcons: ids.map(id => { const icon = session.registry.getFieldRepresentation("Iconable", id)?.methods.icon;
      return typeof icon === "string" ? { icon } : {}; }) });
    await expect(ask({ method: "project-reader-call-signature", fieldIcons: [3], priority: "guidance" })).rejects.toThrow("could not be read");
  });
  test("handles: the registry's `getUuid` for each name", async () => {
    const names = ["List", "String", "std.add", fn.id, "add", "missing-name", ""];
    const reply = await ask({ method: "project-reader-call-signature", handles: names, priority: "guidance" });
    expect(reply).toEqual({ handles: names.map(name => { const handle = session.registry.getUuid(name); return handle === undefined ? {} : { handle }; }) });
    expect((reply as { handles: Array<{ handle?: string }> }).handles[0]!.handle).toBeString();
  });
});

describe("B4 wave 4 lane H: query-reader-value-search answers as Browse's value half", () => {
  const items = [
    { kind: "entity", routeId: "entity:Email", routeBase: "/app/types/", label: "Email", description: "", type: { $ref: "Email" }, source: "system" },
    { kind: "entity", routeId: "entity:Nat", routeBase: "/app/types/", label: "Nat", description: "", type: { $ref: "Nat" }, source: "system" },
    { kind: "entity", routeId: "entity:Point", routeBase: "/app/types/", label: "Point", description: "", type: { $record: { fields: [] } }, source: "user" },
  ];
  test("the page's candidates, verdicts and ranking for each query", async () => {
    for (const query of ["42", "hello", "a@b.co", "2024-02-29", "31/12/2024", "true", "-3", ""]) {
      let pageValues: unknown;
      await slicedSearch.runSlicedSearch(query, clone(items) as never, registry as never, () => false,
        result => { if (!result.running) pageValues = result.values; }, { now: () => 0, yieldNow: async () => {} });
      const reply = await ask({ method: "query-reader-value-search", query, items, priority: "guidance" });
      expect(reply).toEqual({ matches: clone(pageValues) });
    }
    expect(suggestions.buildValueCandidates(clone(items) as never, registry as never).length).toBeGreaterThan(4);
  });
  test("a stopped run answers nothing (the router answers yielded); a request without the guidance class is refused", async () => {
    const ops = await import("./reader-home-ops");
    let checks = 0;
    expect(await ops.queryReaderValueSearch("42", clone(items) as never, session, () => { checks++; return false; })).toBeUndefined();
    expect(checks).toBe(1);
    const whole = await ops.queryReaderValueSearch("42", clone(items) as never, session, () => true);
    expect(clone(whole)).toEqual(await ask({ method: "query-reader-value-search", query: "42", items, priority: "guidance" }) as never);
    await expect(ask({ method: "query-reader-value-search", query: "42", items })).rejects.toThrow("could not be read");
  });
});
