import { dispatchEngineBody, marshalStoredBodyForValidation, marshalTraversalType } from "../engine-bodies-dispatch";
import { checkAuthoringSchemeStructure } from "../signature-inference";
import type { FenelType, Kind, SchemeApplication, TypeScheme } from "../types";
import type { EvaluateContext } from "../json-logic";
import { Just, Nothing } from "../type-foundation";
import { assertAcyclicAuthoringData } from "./json-value";

export type AuthoringSchemeBodyResult = { readonly ok: true; readonly scheme: TypeScheme }
  | { readonly ok: false; readonly message: string };
type Root = { path: readonly string[]; scope: readonly string[]; nominalScope: readonly string[]; type: unknown };
type EvidenceMove = { index: number; path: readonly string[] };
type ApplicationMove = EvidenceMove & { headVarId: string; headRef: string; kind: Kind; argPaths: readonly (readonly string[])[] };
type BodyPlan = { ok: boolean; message: string; applications: readonly ApplicationMove[];
  nominals: readonly EvidenceMove[]; diagnostics: readonly EvidenceMove[];
  capturedNominals: NonNullable<TypeScheme["nominals"]> };

function bodyPath(body: unknown, path: readonly string[]): unknown {
  let value = body;
  for (const segment of path) {
    if (value === null || typeof value !== "object") throw new TypeError("Scheme evidence path is not an object");
    const slot = Object.getOwnPropertyDescriptor(value, segment);
    if (!slot || !("value" in slot)) throw new TypeError("Scheme evidence path is not own data");
    value = slot.value;
  }
  return value;
}

function bodyRoots(body: FenelType): Root[] | { ok: false; message: string } {
  const roots: Root[] = [{ path: ["scheme", "body"], scope: [], nominalScope: [], type: marshalTraversalType(body) }];
  while (true) {
    // GLOBAL_ONLY: source chooses annotation slots in supplied data, no reader lookup/perform.
    const scan = dispatchEngineBody("engine:authoringSchemeBodyScanPlan", [roots]) as {
      ok: boolean; message: string; annotations: Array<Omit<Root, "type">>;
    };
    if (!scan.ok) return { ok: false, message: scan.message };
    if (scan.annotations.length === 0) return roots;
    for (const annotation of scan.annotations) roots.push({ ...annotation,
      type: marshalTraversalType(bodyPath(body, annotation.path.slice(2))) });
  }
}

/** Mechanical reattachment of source-selected paths to the existing scheme.
 * No host walker discovers binders, infers a kind or matches field ownership.
 * The original quantified records remain authoritative and untouched. */
export function reconcileAuthoringSchemeBody(input: { readonly scheme: TypeScheme; readonly nextBody: FenelType;
  readonly context?: EvaluateContext }): AuthoringSchemeBodyResult {
  try {
    assertAcyclicAuthoringData({ scheme: input.scheme, nextBody: input.nextBody });
    const { scheme, nextBody } = input;
    const oldScan = bodyRoots(scheme.body), nextScan = bodyRoots(nextBody);
    // Source permits raw shape staging only when no declaration evidence
    // exists to preserve. This is not an inferred or validated type result.
    const mayKeepShape = dispatchEngineBody("engine:authoringSchemeBodyMayKeepShape", [
      scheme.quantified, scheme.applications ?? [], scheme.nominals ?? [], scheme.diagnostics ?? [],
    ]) as boolean;
    if (!Array.isArray(nextScan)) return mayKeepShape ? { ok: true, scheme: { ...scheme, body: nextBody } } : nextScan;
    if (!Array.isArray(oldScan) && !mayKeepShape) return oldScan;
    const oldRoots = Array.isArray(oldScan) ? oldScan : [], nextRoots = nextScan;
    const applications = (scheme.applications ?? []).map(application => ({ path: application.path,
      headVarId: application.headVarId ?? "", headRef: application.headRef ?? "", kind: application.kind,
      args: application.args.map(argument => marshalTraversalType(argument)) }));
    const oldBody = marshalStoredBodyForValidation(scheme.body), newBody = marshalStoredBodyForValidation(nextBody);
    // B3 reference observations only, over container paths selected by source.
    // Equal bytes do not establish positional declaration continuity.
    const oldPaths = dispatchEngineBody("engine:authoringSchemePositionalPaths", [oldBody]) as readonly (readonly string[])[];
    const nextPaths = dispatchEngineBody("engine:authoringSchemePositionalPaths", [newBody]) as readonly (readonly string[])[];
    const origins = oldPaths.flatMap(oldPath => nextPaths.map(nextPath => ({ oldPath, nextPath,
      sameContainer: Object.is(bodyPath(scheme.body, oldPath), bodyPath(nextBody, nextPath)) })));
    const requests = dispatchEngineBody("engine:authoringSchemeBodyNominalRequests", [nextRoots, scheme.quantified]) as
      { $tag: "Ok"; _0: string[] } | { $tag: "Err"; _0: string };
    if (requests.$tag === "Err") return { ok: false, message: requests._0 };
    const captures = requests._0.flatMap(name => {
      // Existing captured-reader owner lookup only. No registry/global/name
      // fallback is permitted after a missing or unreadable selection.
      const owner = input.context?._typeFamilyOwner?.(name, input.context._sourceFunction);
      if (owner === undefined) return [];
      assertAcyclicAuthoringData(owner);
      if (typeof owner.identity !== "string" || typeof owner.ownerIdentity !== "string"
        || !owner.typeScheme || !Array.isArray(owner.typeScheme.quantified)) {
        throw new TypeError("The selected type constructor has no readable declaration evidence.");
      }
      return [{ name, identity: owner.identity, ownerIdentity: owner.ownerIdentity, variables: owner.typeScheme.quantified,
        parameterNames: owner.parameterNames === undefined ? Nothing : Just(owner.parameterNames) }];
    });
    // GLOBAL_ONLY: declaration-data reconciliation; all selection is Fenel-owned.
    const plan = dispatchEngineBody("engine:authoringSchemeBodyPlan", [
      oldBody, newBody, oldRoots, nextRoots, scheme.quantified, applications, scheme.nominals ?? [], scheme.diagnostics ?? [], origins, captures,
    ]) as BodyPlan;
    if (!plan.ok) return { ok: false, message: plan.message };
    const nextApplications = plan.applications.map((move): SchemeApplication => {
      const prior = move.index < 0 ? undefined : scheme.applications?.[move.index];
      if (move.index >= 0 && prior === undefined) throw new TypeError("Scheme plan selected a missing application");
      const { headVarId: _oldVariable, headRef: _oldNominal, ...retained } = prior ?? {};
      return { ...retained, path: move.path, kind: move.kind,
        args: move.argPaths.map(path => bodyPath(nextBody, path) as FenelType),
        ...(move.headVarId === "" ? { headRef: move.headRef } : { headVarId: move.headVarId }) };
    });
    const moved = <T extends { readonly path: readonly string[] }>(rows: readonly T[] | undefined, moves: readonly EvidenceMove[]): T[] =>
      moves.map(move => {
        const prior = rows?.[move.index];
        if (prior === undefined) throw new TypeError("Scheme plan selected missing evidence");
        return { ...prior, path: move.path };
      });
    const nextScheme: TypeScheme = { ...scheme, body: nextBody,
      ...(scheme.applications === undefined && nextApplications.length === 0 ? {} : { applications: nextApplications }),
      ...(scheme.nominals === undefined && plan.capturedNominals.length === 0 ? {} : {
        nominals: [...moved(scheme.nominals, plan.nominals), ...plan.capturedNominals.map(nominal => ({
          path: nominal.path, identity: nominal.identity, publicName: nominal.publicName,
        }))],
      }),
      ...(scheme.diagnostics === undefined ? {} : { diagnostics: moved(scheme.diagnostics, plan.diagnostics) }),
    };
    const checked = checkAuthoringSchemeStructure(nextScheme);
    return checked.ok ? { ok: true, scheme: nextScheme } : checked;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Scheme body reconciliation failed" };
  }
}
