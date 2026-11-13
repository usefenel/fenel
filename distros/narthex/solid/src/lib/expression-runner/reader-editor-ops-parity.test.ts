import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";
import type { FenelType } from "@fenel/engine/types";

// B4 wave 4 lane E: each closed editor operation of a Local reader's worker
// (`reader-editor-ops.ts`) answers exactly what the page owner it moved
// answers in the same session, over a corpus, as the worker's structured
// clone; a cancelled request answers nothing; a malformed one is refused.
// Heavy: one Local registry; run alone in the heavy slot.
const fixture = await import("./reader-function-options.fixture");
const [catalogue, mint, extensions, artifact, detached, transfer, lens, validation, authority, fieldRender, json, engine] = await Promise.all([
  import("./authoring-catalog"), import("../../../../../../implementations/typescript/runtime/src/authority-mint"),
  import("./authoring-worker-reader-extensions"), import("./authoring-catalogue-artifact"), import("./detached-authoring-environment"),
  import("../data-transfer/expressions"), import("../lens-shortcuts"), import("@fenel/engine/validation"), import("@fenel/engine/authority"),
  import("@fenel/engine/authoring/field-render"), import("../../../../../../implementations/typescript/engine/src/json-logic"),
  import("@fenel/engine/engine-bodies-dispatch"),
]);
const { registry, snapshot } = await fixture.buildParityRegistry();
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([fixture.SOURCE]) as unknown as string[] });
const localCatalogue = artifact.projectLocalAuthoringCatalogue(registry, frame, { localSourceId: fixture.SOURCE, snapshot,
  entities: [], functions: [fixture.definition as never] });
const environment = detached.createDetachedAuthoringEnvironment(catalogue.environmentForCatalog(localCatalogue.catalog, registry));
const session = Object.freeze({ mode: "detached", registry, evaluateContext: frame, environment, catalog: environment.catalog }) as unknown as AuthoringSession;
const ask = async (query: Record<string, unknown>, cancelled = () => false) => structuredClone(
  await extensions.runReaderExtension(query as never, session, undefined, async () => {}, cancelled)) as Record<string, unknown> | undefined;
const number: FenelType = { $ref: "Number" }, text: FenelType = { $ref: "String" };

describe("B4 wave 4 lane E: the worker's editor operations answer as their page owners", () => {
  test("resolve-reader-dependent-type is the variant editor's resolveElInType (scopedConcreteType)", async () => {
    const corpus: Array<[FenelType, Record<string, unknown>]> = [
      [{ $el: { var: "siblingType" } } as FenelType, { siblingType: number }],
      [{ $el: { var: "siblingType" } } as FenelType, { siblingType: "not a type" }],
      [{ $el: { var: "siblingType" } } as FenelType, {}],
      [{ $el: { call: ["List", number] } } as FenelType, {}],
      [{ $el: { call: ["Maybe", text] } } as FenelType, {}],
      [{ $el: { call: ["no-such-type-function"] } } as FenelType, {}],
      [{ $refined: { base: { $el: { var: "t" } }, pred: { var: "x" } } } as unknown as FenelType, { t: text }],
    ];
    let resolvedCount = 0;
    for (const [type, values] of corpus) {
      const page = transfer.scopedConcreteType(type, session.evaluateContext, session.environment, session.registry, values);
      const reply = await ask({ method: "resolve-reader-dependent-type", type, values, priority: "guidance" });
      expect(reply).toEqual({ dependentType: page === undefined ? {} : { resolved: structuredClone(page) } });
      if (page) resolvedCount++;
    }
    expect(resolvedCount).toBeGreaterThanOrEqual(3);
  });

  test("select-reader-union-branch is the union editor's admission, selection and captions", async () => {
    const branches: FenelType[] = [number, text, { $ref: "Bool" }, { $record: { fields: [] } } as unknown as FenelType];
    let selectedCount = 0;
    for (const value of [3, "x", { $tag: "True" }, true, null, {}, [1], { $tag: "Just", _0: 1 }]) {
      for (const representationTypeName of [undefined, "Number"]) {
        const captured = representationTypeName === undefined ? frame : json.runtimeRepresentationNativeContext(frame, representationTypeName);
        const account = authority.frameAccount(captured);
        const options = { registry, functions: captured, coerce: false, strict: { primitiveTypes: true, membership: true } };
        const admitted = branches.map(branch => { try { return validation.validateValue(branch, value, account, options).valid; } catch { return false; } });
        const selected = fieldRender.fieldUnionBranchSelectionPlan(admitted, captured);
        const labels = branches.map(type => fieldRender.fieldTypeLabelPlan(type, { kind: 1 }, captured));
        const reply = await ask({ method: "select-reader-union-branch", branches, value, recordValues: { kind: 1 },
          ...(representationTypeName ? { representationTypeName } : {}), priority: "guidance" });
        expect(reply).toEqual({ unionBranch: { ...(selected === undefined ? {} : { selected }), labels } });
        if (selected !== undefined) selectedCount++;
      }
    }
    expect(selectedCount).toBeGreaterThanOrEqual(4);
  });

  test("project-reader-lens-policy evaluates only the closed policies, with their declarations", async () => {
    const declaration = (name: string) => (registry.getIdentifiedEntity(`view.${name}`) ?? registry.getIdentifiedEntity(name))!.id;
    const node = (id: string, label: string) => ({ $tag: "DependencyNode", id, label });
    const graphArgs = ["This card", node("a", "A"), [node("b", "B")], [node("c", "C"), node("a", "A")]];
    expect(await ask({ method: "project-reader-lens-policy", policy: "dependencyGraph", args: graphArgs, priority: "guidance" })).toEqual({
      lensPolicy: { $tag: "Ok", _0: { declarationId: declaration("DependencyGraph"),
        value: structuredClone(lens.lensPolicyData(session, "dependencyGraph", ...graphArgs)) } } });
    const batch = { $tag: "SuggestionPresentationBatch", suggestions: [], undecided: [] };
    expect(await ask({ method: "project-reader-lens-policy", policy: "suggestionPanelRows", args: [batch], priority: "guidance" })).toEqual({
      lensPolicy: { $tag: "Ok", _0: { declarationId: declaration("SuggestionPresentation"),
        value: structuredClone(lens.lensPolicyData(session, "suggestionPanelRows", batch)) } } });
    // Declaration only: no policy runs.
    expect(await ask({ method: "project-reader-lens-policy", policy: "dependencyGraph", priority: "guidance" })).toEqual({
      lensPolicy: { $tag: "Ok", _0: { declarationId: declaration("DependencyGraph") } } });
    // A policy outside the closed list, or a display read without its class, is refused.
    await expect(ask({ method: "project-reader-lens-policy", policy: "defaultLensShortcuts", args: [], priority: "guidance" })).rejects.toThrow("could not be read");
    await expect(ask({ method: "project-reader-lens-policy", policy: "dependencyGraph" })).rejects.toThrow("could not be read");
  });

  test("read-reader-returned-expression is the returned-expression lens's codec read", async () => {
    const expressions = [{ $tag: "ELambda", params: ["text"], body: { $tag: "ECall", fnId: "add", args: [{ $tag: "EVar", name: "text" }] } },
      { $tag: "EVar", name: "x" }, { $tag: "ECall", fnId: "add", args: [{ $tag: "ELit", value: 1 }, { $tag: "ELit", value: 2 }] },
      ...[{ call: ["add", 1, 2] }, { var: "x" }].map(logic => { try { return engine.dispatchedJsonLogicToExpr(logic as never); } catch { return undefined; } })
        .filter(Boolean)];
    let readCount = 0;
    for (const value of [...expressions, 42, "text", { $tag: "Nothing" }, null, [1, 2]]) {
      const page = lens.returnedExpressionNode(session, value);
      const reply = await ask({ method: "read-reader-returned-expression", value, priority: "guidance" });
      expect(reply).toEqual({ returnedExpression: page === undefined ? {} : { node: structuredClone(page) } });
      if (page) readCount++;
    }
    expect(readCount).toBeGreaterThanOrEqual(1);
  });

  test("project-reader-text-shortcuts is Lens settings' Use text shortcuts", async () => {
    const page = [...lens.defaultLensShortcuts(session), ...lens.textLensShortcuts(session)];
    expect(page.length).toBeGreaterThan(0);
    expect(await ask({ method: "project-reader-text-shortcuts" })).toEqual({ textShortcuts: { $tag: "Ok", _0: structuredClone(page) } });
    // A user's button: never at the guidance class.
    await expect(ask({ method: "project-reader-text-shortcuts", priority: "guidance" })).rejects.toThrow("could not be read");
  });

  test("a request cancelled before its turn answers nothing", async () => {
    expect(await ask({ method: "read-reader-returned-expression", value: 1, priority: "guidance" }, () => true)).toBeUndefined();
  });
});
