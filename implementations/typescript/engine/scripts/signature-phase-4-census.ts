/**
 * Signature-substrate Phase 4 census.
 *
 * Two modes:
 *
 *   --entry   The P4 entry-gate routing projection (entry gate 6 of the
 *             combined P4+4b brief). Captures, per authoritative profile
 *             (SYSTEM, seed), the canonical P2 routing projection:
 *             function-to-container membership, every source
 *             function/constructor resolution row's
 *             `{name,targetId,status,diagnostics}`, capability-method rows
 *             with transitional trust OMITTED, every constructor
 *             target-to-wire entry, and the session-mode posture. It
 *             classifies NO P4 verdict. The same mode reproduces both the
 *             pre-prep and post-prep/pre-validation checkpoints; byte
 *             parity between runs is the D0 route-parity proof.
 *
 *   --observe The slice-3b quantified-observation-fence BOOTSTRAP census.
 *             Measures CONSERVATIVE FALLOUT — with no callee provenance
 *             summaries available, every call into a Fenel body fences for
 *             want of one, so the number is a call-topology and
 *             missing-summary-frontier measurement, not a precision or
 *             quality score. Reports every reason, not just the first, and
 *             names its own modelling limits in the output.
 *
 *   (default) The Phase-4 invariant census. The verdict/eligibility
 *             computation is a registered Fenel function in the validation
 *             module; this TypeScript command is descriptor-safe
 *             invocation, result decoding, and deterministic JSON emission
 *             only. It lands with the validation slices; until then the
 *             default mode exits with an explicit error instead of
 *             pretending an empty verdict set is a census.
 *
 * The runner is read-only and prints one deterministic JSON document (no
 * timestamps, no durations). Recovery and differential flags are rejected
 * before any Fenel module is imported.
 */

import { createHash } from "node:crypto";

import type { FenelModule } from "../src/types";
import type { ModuleRegistry, RegistryCapabilityMethodSignature } from "../src/registry";
import type { SignatureResolutionRow } from "../src/signature-inference";

type Environment = Readonly<Record<string, string | undefined>>;

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function fenelEnvironmentOverrides(environment: Environment): string[] {
  return Object.keys(environment)
    .filter((name) => name.startsWith("FENEL_") && environment[name] !== undefined)
    .sort(compareCodeUnits);
}

export function assertFlagFreeMode(environment: Environment = process.env): void {
  const set = fenelEnvironmentOverrides(environment);
  if (set.length > 0) {
    throw new Error(
      `signature Phase 4 census requires an unflagged fresh process; unset ${set.join(", ")}`,
    );
  }
}

/** Canonical JSON: recursively sorts record keys by UTF-16 code units and
 * keeps array order (arrays are semantically ordered registry egress). This
 * is the checkpoint-capture serialization only — it is NOT the S2
 * certificate byte encoder and must never be used as certificate hash
 * material. */
export function canonicalProjectionJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareCodeUnits)) {
      const slot = record[key];
      if (slot !== undefined) out[key] = sortKeysDeep(slot);
    }
    return out;
  }
  return value;
}

export function projectionSha256(canonicalJson: string): string {
  return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
}

type RouteParityRow = {
  name: string;
  targetId: string;
  status: SignatureResolutionRow["status"];
  diagnostics: unknown;
};

/** The dispatch-class declaration surface (the process-global seed registry —
 * the same `defaultSpecRegistry` production registries consume). This is the
 * D0b-sensitive capability surface: the census-style profile registries use a
 * fresh ISOLATED dispatch registry, so their `listCapabilityMethodSignatures`
 * is empty by construction; the class catalog below carries the actual
 * capability/interface parity signal for the P4-prep consolidation. */
function dispatchClassCatalog(
  registry: { listClasses: () => readonly unknown[] },
  schemeSourceOf: (iface: unknown) => { sourceModule?: { name?: unknown } } | undefined,
): unknown[] {
  const rows = registry.listClasses().map((cls) => {
    const record = cls as Record<string, unknown>;
    const methods = Array.isArray(record.methods)
      ? (record.methods as Record<string, unknown>[]).map((method) => ({
          name: method.name,
          params: method.params ?? [],
          returns: method.returns ?? null,
        }))
      : [];
    // The parser-owned TypeScheme rides an exact-object WeakMap sidecar
    // (signature-declaration-transport.ts), NOT an Interface property.
    const schemeSource = schemeSourceOf(cls);
    const sourceName = schemeSource?.sourceModule?.name;
    return {
      name: record.name,
      params: record.params ?? [],
      sourceModule: typeof sourceName === "string" ? sourceName : null,
      hasTypeScheme: schemeSource !== undefined,
      methods,
    };
  });
  return rows.sort((a, b) => compareCodeUnits(String(a.name), String(b.name)));
}

function routeParityRow(row: SignatureResolutionRow): RouteParityRow {
  return {
    name: row.name,
    targetId: row.targetId,
    status: row.status,
    diagnostics: row.diagnostics ?? [],
  };
}

function sortedRouteRows(rows: readonly SignatureResolutionRow[]): RouteParityRow[] {
  return rows
    .map(routeParityRow)
    .sort((a, b) =>
      compareCodeUnits(a.name, b.name)
      || compareCodeUnits(a.targetId, b.targetId)
      || compareCodeUnits(a.status, b.status)
    );
}

type CapabilityMethodProjectionRow = {
  name: string;
  targetId: string;
  ownerName: string;
  scheme: unknown;
  outcome: unknown;
};

/** Transitional `trust` is deliberately omitted so the projection stays
 * byte-stable across the P4-D7 `SignatureTrust` deletion. */
function capabilityMethodProjection(
  rows: readonly RegistryCapabilityMethodSignature[],
): CapabilityMethodProjectionRow[] {
  return rows
    .map((row) => ({
      name: row.name,
      targetId: row.targetId,
      ownerName: row.ownerName,
      scheme: row.scheme ?? null,
      outcome: row.outcome,
    }))
    .sort((a, b) =>
      compareCodeUnits(a.ownerName, b.ownerName) || compareCodeUnits(a.name, b.name)
    );
}

export function profileEntryProjection(
  profile: "SYSTEM" | "seed",
  modules: readonly FenelModule[],
  registry: ModuleRegistry,
): Record<string, unknown> {
  const moduleNames = modules
    .map((module) => module.name)
    .sort(compareCodeUnits);

  const membership: Record<string, readonly string[]> = {};
  const sourceFunctionRows: Record<string, RouteParityRow[]> = {};
  const sourceConstructorRows: Record<string, RouteParityRow[]> = {};
  for (const name of moduleNames) {
    membership[name] = [...registry.listModuleMembers(name)].sort(compareCodeUnits);
    sourceFunctionRows[name] = sortedRouteRows(registry.listSourceFunctionResolutions(name));
    sourceConstructorRows[name] = sortedRouteRows(registry.listSourceConstructorResolutions(name));
  }

  const context = registry.evaluateContext() as unknown as Record<string, unknown>;
  const wireNames = context._constructorWireNames;
  const constructorTargetToWire: Record<string, string> = {};
  if (wireNames && typeof wireNames === "object") {
    for (const key of Object.keys(wireNames as Record<string, unknown>).sort(compareCodeUnits)) {
      const wire = (wireNames as Record<string, unknown>)[key];
      if (typeof wire === "string") constructorTargetToWire[key] = wire;
    }
  }

  return {
    profile,
    modules: moduleNames,
    membership,
    sourceFunctionRows,
    sourceConstructorRows,
    capabilityMethods: capabilityMethodProjection(registry.listCapabilityMethodSignatures()),
    constructorTargetToWire,
    /** P2 session-mode posture (design/signatures-and-contracts.md §5, P2
     * completion record): registered modules author in a module session over
     * their frozen source frame; unknown/account/draft definitions use the
     * detached exact-ID session; an account session overlays only the
     * authenticated account's live roster. Recorded so a P4 change to the
     * session posture would break checkpoint parity. */
    sessionModes: {
      registeredModules: "module-source-frame",
      unknownAccountOrDraft: "detached-exact-id-only",
      accountSession: "authenticated-roster-overlay-no-imports-no-bare-aliases",
    },
  };
}

function sectionDigests(profile: unknown): Record<string, unknown> {
  const record = profile as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort(compareCodeUnits)) {
    const canonical = canonicalProjectionJson(record[key]);
    const value = record[key];
    const count = Array.isArray(value)
      ? value.length
      : value !== null && typeof value === "object"
        ? Object.keys(value as object).length
        : 1;
    out[key] = { sha256: projectionSha256(canonical), count, bytes: canonical.length };
  }
  return out;
}

async function entryMain(digestOnly: boolean): Promise<void> {
  assertFlagFreeMode();

  // Dynamic imports are load-bearing: recovery flags must be rejected before
  // module-manifest evaluation parses any Fenel source.
  const { createDispatchRegistry } = await import("../src/dispatch-registry");
  const { createRepositoryRegistry } = await import("../src/repository-registry");
  const { SYSTEM_REGISTRY_MODULES } = await import("../src/system-registry-modules");
  const { modulesFor } = await import("../src/module-manifest");
  const { dispatchRegistry } = await import("../src/system-entities");
  const { getInterfaceTypeSchemeSource } = await import("../src/signature-declaration-transport");

  const profileInputs = [
    ["SYSTEM", SYSTEM_REGISTRY_MODULES],
    ["seed", modulesFor("seed")],
  ] as const;

  const classCatalog = dispatchClassCatalog(
    dispatchRegistry,
    getInterfaceTypeSchemeSource as (
      iface: unknown,
    ) => { sourceModule?: { name?: unknown } } | undefined,
  );
  const profiles: Record<string, unknown> = {};
  for (const [profile, modules] of profileInputs) {
    const registry = createRepositoryRegistry([...modules], {
      dispatchRegistry: createDispatchRegistry(),
    });
    profiles[profile] = profileEntryProjection(profile, [...modules], registry);
  }

  const body = {
    schema: "fenel.signature-substrate.phase-4-entry-projection.v1",
    mode: {
      artifactPath: "default",
      registryIdentity: "strict-embedded-repository",
      registryDispatch: "fresh-isolated-per-profile",
      environmentOverrides: { rejectedPrefix: "FENEL_*", detected: [] },
    },
    dispatchClassCatalog: classCatalog,
    profiles,
  };
  const canonical = canonicalProjectionJson(body);
  const projectionHash = projectionSha256(canonical);
  if (digestOnly) {
    const digest = {
      schema: "fenel.signature-substrate.phase-4-entry-projection-digest.v1",
      projectionHash,
      dispatchClassCatalog: {
        sha256: projectionSha256(canonicalProjectionJson(classCatalog)),
        count: classCatalog.length,
      },
      profiles: Object.fromEntries(
        Object.keys(profiles).sort(compareCodeUnits).map((profile) => [
          profile,
          sectionDigests(profiles[profile]),
        ]),
      ),
    };
    console.log(JSON.stringify(sortKeysDeep(digest), null, 2));
    return;
  }
  const report = { ...body, projectionHash };
  console.log(canonicalProjectionJson(report));
}

// ---------------------------------------------------------------------------
// `--observe` — the slice-3b BOOTSTRAP census of the quantified-observation
// fence.
//
// WHAT THIS MEASURES, stated up front so the number is not read as a quality
// score: **conservative fallout**. In slice 3b no callee provenance summary
// exists, so EVERY call into a Fenel body fences for want of one. The census
// therefore mostly measures call topology and the missing-summary frontier, NOT
// the classifier's semantic precision. The counterfactual proof-enabled census
// is slice 3d's, once the SCC machinery can populate summaries.
//
// SLICE 3d CHANGED WHAT THIS MEASURES, in two ways that both move numbers:
//   * ELIGIBILITY IS NOW CORRECT. The native maps were being read off fields
//     that do not exist on `ModuleRegistry`, so every host native was
//     invisible and the census analysed bodies that never run. Functions whose
//     ACTIVE branch is a native now land in `shadowedByHostImplementation`.
//   * ORIGINATION IS NOW THE JUDGMENT'S OWN. The census no longer decides what
//     a declared type means; it states the quantifier vector and the declared
//     types and the registered originator does the rest. A parameter that
//     mentions a quantifier anywhere — or carries a `$el` node — is now OPAQUE
//     rather than CLEAN, so the 3b under-count is closed in the conservative
//     direction and fences RISE.
//
// It is honest about its own harness limits, each reported as an explicit
// modelling note rather than folded into a fence count:
//   * ORIGINATION NEVER WITNESSES A SHELL. A declared type is not a
//     representation proof, so `Maybe κ` originates as the opaque atom rather
//     than as a `Maybe` shell over an opaque payload. That OVER-fences (a
//     `$tag` discrimination on it is refused where a witnessed shell would
//     admit it) and it is the safe direction; a real per-profile
//     representation witness is what would relax it.
//   * FROZEN ROUTES are flat-registry only. The real source-frame carrier is
//     the slice-2b ledger's; here `sourceTargetId` and `flatTargetId` are both
//     the flat resolution, so the route-disagreement rule (`obs.gate.route`)
//     is never exercised and the census under-counts there.
//   * ROUTE AUTHORITY IS CANONICAL-ID ONLY. `invokeFunction` selects per
//     written spelling; `routeAmbiguous` counts the functions where an alias
//     reaches a different implementation than the id does.
//   * The raw-key harvest is syntactic. It collects every object key and call
//     head in the raw body; a key with no registry resolution simply has no
//     frozen record, which the gate reports as an unresolved use.
// No silent caps: every eligible function is analysed and every reason is
// tallied, not just the first.
// ---------------------------------------------------------------------------

const OBSERVE_PROFILES = ["interpreted"] as const;
const VALIDATOR_VERSION = "signature-substrate-3d";

/** SLICE 3d-D6 — the origination and harvest helpers that used to live here
 *  (`bareQuantifiedOrdinalOf`, `mentionsQuantified`, `harvestRawKeys` and the
 *  parameter loop) are GONE. They were pure logic over declared types and
 *  marshalled bodies, so under the Fenel-first rule they belong in `.fenel`,
 *  and they were a SECOND authority besides the fence's own: the census
 *  measured what its private copy decided, not what the judgment decides. They
 *  are now `engine:vobDeriveRepr` / `engine:vobHarvestRawKeys` inside
 *  `validation-observe.fenel`, reached through the frozen `ObsRequest`.
 *
 *  Two defects died with them, both of which made the census UNDER-count:
 *   * `bareQuantifiedOrdinalOf` matched a `$var` against a quantifier's `id`
 *     OR its `sourceName`. The generated ids are `q0`, `q1`, … and source
 *     names are user-authored, so `collide : a -> q0 -> a` resolved
 *     `{$var:"q0"}` to the FIRST quantifier by id when it denotes the SECOND
 *     by source name.
 *   * `mentionsQuantified` capped at depth 12 and returned FALSE on
 *     exhaustion, so a quantifier below that depth read as absent. The Fenel
 *     port degrades to the whole scope on exhaustion instead.
 *
 *  `activeOrigin` is gone too, and its defect was the load-bearing one — see
 *  `observeMain`. */

/** The two AST-shaped counters the fence itself does not report, kept as an
 *  INDEPENDENT cross-check on the acceptance measure. Without them the census
 *  would use the ported originator both to produce the provenance and to
 *  report that nothing was missed, which is not a check at all. These count
 *  the raw declared type directly: how many parameters mention a quantifier
 *  somewhere, and how many carry a `$el` node (the compatibility spelling of a
 *  higher-kinded application, whose head identity lives in the scheme sidecar
 *  and is invisible to any `$var` scan). */
function countTypeShapes(
  node: unknown,
  quantifierSourceNames: ReadonlySet<string>,
  seen: { mentionsVar: boolean; hasEl: boolean; truncated: boolean },
  depth = 0,
): void {
  // ROUND-2 REPAIR: this returned SILENTLY at the depth cap, which is the same
  // blindness the ported predicate had — a valid chain of `$complement` nodes
  // could hide a `$var` below it, and the cross-check would report "nothing
  // missed" while missing something. Exhaustion is now RECORDED, and the census
  // reports it as its own number.
  if (depth > 40) { seen.truncated = true; return; }
  if (node === null || typeof node !== "object") return;
  if (!Array.isArray(node)) {
    const record = node as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "$el")) seen.hasEl = true;
    const handle = record.$var;
    if (typeof handle === "string" && quantifierSourceNames.has(handle)) seen.mentionsVar = true;
  }
  for (const child of Object.values(node as Record<string, unknown>)) {
    countTypeShapes(child, quantifierSourceNames, seen, depth + 1);
  }
}

async function observeMain(): Promise<void> {
  assertFlagFreeMode();

  const { createDispatchRegistry } = await import("../src/dispatch-registry");
  const { createRepositoryRegistry } = await import("../src/repository-registry");
  const { SYSTEM_REGISTRY_MODULES } = await import("../src/system-registry-modules");
  const { modulesFor } = await import("../src/module-manifest");
  const { dispatchEngineBody, marshalStoredBodyForValidation } = await import(
    "../src/engine-bodies-dispatch"
  );
  const { activeRouteFor, activeRouteForSpelling } = await import(
    "./generate-signature-honesty-claims"
  );

  const CANARIES = new Set([
    "id", "const", "fromMaybe", "head", "tail", "appendItem",
    "reverse", "zip", "map", "concat",
  ]);

  const profileInputs = [
    ["SYSTEM", SYSTEM_REGISTRY_MODULES],
    ["seed", modulesFor("seed")],
  ] as const;

  const profiles: Record<string, unknown> = {};
  for (const [profile, modules] of profileInputs) {
    const registry = createRepositoryRegistry([...modules], {
      dispatchRegistry: createDispatchRegistry(),
    });
    // SLICE 3d-D6, and this is the correction that moves every number below.
    //
    // The maps used to be read as `registry.nativeImpls` / `.nativeImplsCtx`.
    // NEITHER EXISTS ON `ModuleRegistry` — they live on the evaluate context —
    // so both were `{}`, every host native was invisible, and `activeOrigin`
    // classified all 891 SYSTEM functions as either a Fenel body or an
    // external handler while printing a plausible-looking origin-strata table.
    // The census was therefore ANALYSING bodies whose active implementation is
    // a native, i.e. reporting a verdict about code that does not run.
    const ctx = registry.evaluateContext() as unknown as {
      natives?: Record<string, unknown>;
      nativesCtx?: Record<string, unknown>;
    };
    const natives = ctx.natives ?? {};
    const nativesCtx = ctx.nativesCtx ?? {};
    // Every native key that resolves to a given spec, so the route enumerator
    // sees the code-name spellings and not only the id. `rekeyNativesById`
    // builds `<modulePrefix>:<mapKey>` blindly, so a `@codeName` breaks the
    // id equality and an id-only scan calls a real native an external handler.
    const keysByFnId = new Map<string, string[]>();
    for (const key of [...Object.keys(nativesCtx), ...Object.keys(natives)]) {
      const spec = registry.getFunction(key);
      if (spec === undefined) continue;
      const list = keysByFnId.get(spec.id) ?? [];
      if (!list.includes(key)) list.push(key);
      keysByFnId.set(spec.id, list);
    }
    const routeOf = (id: string, hasBody: boolean) =>
      activeRouteFor(
        [id, ...(keysByFnId.get(id) ?? []).filter((k) => k !== id)],
        natives,
        nativesCtx,
        hasBody,
      );

    const functions = registry.listFunctions();
    const reasonTally: Record<string, number> = {};
    const channelTally: Record<string, number> = {};
    const notEligible: Record<string, number> = {};
    const canaries: Record<string, unknown> = {};
    let eligible = 0;
    let admitted = 0;
    let fenced = 0;
    let quantifiedEligible = 0;
    let quantifiedAdmitted = 0;
    // How often origination actually produced a rigid. This makes coverage
    // MEASURABLE rather than merely stated: an eligible quantified function
    // with NO opaque parameter was analysed as if nothing were κ-typed, so its
    // verdict says nothing about the fence.
    let withOpaqueParam = 0;
    // The INDEPENDENT cross-check (see `countTypeShapes`). `mentionsQuantifier`
    // is read off the raw declared type, NOT off the originator's answer, so a
    // regression that made origination blind would show up as this number
    // staying high while `withOpaqueParam` fell. `elParams` counts the
    // higher-kinded-application spelling specifically.
    let mentioningParams = 0;
    let elParams = 0;
    // The cross-check's OWN blindness, reported as a number rather than hidden
    // behind a silent depth cap.
    let crossCheckTruncatedParams = 0;
    let routeAmbiguous = 0;
    const originStrata: Record<string, number> = {};

    for (const fn of functions) {
      const hasBody = fn.body !== undefined;
      const active = routeOf(fn.id, hasBody);
      originStrata[active.origin] = (originStrata[active.origin] ?? 0) + 1;
      if (active.ambiguous) routeAmbiguous++;
      if (!hasBody) { notEligible.noBody = (notEligible.noBody ?? 0) + 1; continue; }
      if (active.origin !== "FenelBody") {
        notEligible.shadowedByHostImplementation =
          (notEligible.shadowedByHostImplementation ?? 0) + 1;
        continue;
      }
      const info = registry.getFunctionSignatureInfo(fn.id);
      if (info === undefined) {
        notEligible.noSignatureInfo = (notEligible.noSignatureInfo ?? 0) + 1;
        continue;
      }
      const quantified = (info.scheme?.quantified ?? []) as readonly {
        id?: unknown; sourceName?: unknown;
      }[];
      eligible++;
      if (quantified.length > 0) quantifiedEligible++;

      let body: unknown;
      try {
        body = marshalStoredBodyForValidation(fn.body, `${fn.id} body`);
      } catch {
        notEligible.bodyNotMarshallable = (notEligible.bodyNotMarshallable ?? 0) + 1;
        eligible--;
        if (quantified.length > 0) quantifiedEligible--;
        continue;
      }

      // The quantifier vector, verbatim. The census states WHO the quantifiers
      // are and nothing else — matching a `$var` to one of them, and deciding
      // what a `$el` node means, is the registered originator's job now.
      const quantifierRecords = quantified.map((q) => ({
        $tag: "ObsQuantifier",
        id: typeof q.id === "string" ? q.id : "",
        sourceName: typeof q.sourceName === "string" ? q.sourceName : "",
      }));
      const sourceNames = new Set(
        quantified.map((q) => q.sourceName).filter((n): n is string => typeof n === "string"),
      );

      let params: unknown[];
      try {
        params = fn.params.map((param, index) => {
          const paramType = (param as { type?: unknown }).type;
          const shapes = { mentionsVar: false, hasEl: false, truncated: false };
          countTypeShapes(paramType, sourceNames, shapes);
          if (shapes.mentionsVar) mentioningParams++;
          if (shapes.hasEl) elParams++;
          if (shapes.truncated) crossCheckTruncatedParams++;
          return {
            $tag: "ObsParam",
            name: param.name,
            declared: marshalStoredBodyForValidation(
              paramType ?? null,
              `${fn.id} param ${index} type`,
            ),
          };
        });
      } catch {
        notEligible.paramTypeNotMarshallable =
          (notEligible.paramTypeNotMarshallable ?? 0) + 1;
        eligible--;
        if (quantified.length > 0) quantifiedEligible--;
        continue;
      }

      // frozen call-target records — flat-registry resolution only
      const keys = dispatchEngineBody("engine:vobHarvestRawKeys", [body, []]) as string[];
      const targets: unknown[] = [];
      for (const key of keys) {
        const spec = registry.getFunction(key);
        if (spec === undefined) continue;
        // ROUND-2 REPAIR — freeze the route for the WRITTEN key, not for the
        // canonical id. `invokeFunction` resolves the spec and then tries
        // `nativesCtx[spec.id]` → `nativesCtx[written]` → `natives[spec.id]` →
        // `natives[written]` → body, so a body-having spec whose ALIAS carries a
        // native is a NATIVE at that call site and a body at its canonical one.
        // Canonicalizing here would have described a call as a Fenel body while
        // the runtime executed a native — and once summaries exist, the analysis
        // would authorize the call from the BODY's summary.
        const specActive = activeRouteForSpelling(
          spec.id,
          key,
          natives as Record<string, unknown>,
          nativesCtx as Record<string, unknown>,
          spec.body !== undefined,
        );
        targets.push({
          $tag: "ObsCallTarget",
          rawKey: key,
          sourceTargetId: spec.id,
          flatTargetId: spec.id,
          origin: specActive.origin === "ExternalHandlerDeclaration"
            ? "ExternalHandler"
            : specActive.origin,
          tier: specActive.tier,
          key: specActive.key,
          dispatchRoute: "RDirect",
          dispatchPos: 0,
          arity: spec.params.length,
          resultRigids: [],
          profile: "interpreted",
          // The invalidation identity is the ROUTE, not the target id. A
          // summary proved before a native was installed under an alias does
          // not cover the registration afterwards, and `spec.id` alone cannot
          // see that change.
          dependencyId: `${specActive.origin}|${specActive.tier}|${specActive.key}|${spec.id}`,
          summary: { $tag: "Nothing" },
        });
      }

      const outcome = dispatchEngineBody("engine:vobAnalyze", [{
        $tag: "ObsRequest",
        callerId: fn.id,
        body,
        params,
        quantified: quantifierRecords,
        targets,
        bodyHash: `census:${fn.id}`,
        schemeHash: `census-scheme:${fn.id}`,
        validatorVersion: VALIDATOR_VERSION,
        registryProfile: profile,
        lowering: "interpreted",
        evaluator: "Direct",
        analysedProfiles: [...OBSERVE_PROFILES],
        requiredProfiles: [...OBSERVE_PROFILES],
      }]) as { $tag?: string; prov?: unknown; reasons?: { $tag?: string; channel?: string }[] };

      // Coverage is read off the ORIGINATED scope, not off a private copy of
      // the rule: re-derive it through the same registered originator the
      // request used.
      const originated = dispatchEngineBody("engine:vobOriginateParams", [
        params,
        quantifierRecords,
        dispatchEngineBody("engine:vobScopeOrdinals", [quantifierRecords, 0, []]),
        [],
      ]) as { prov?: { $tag?: string } }[];
      if (originated.some((b) => b.prov?.$tag !== "PvClean")) withOpaqueParam++;

      if (outcome?.$tag === "ObsAdmitted") {
        admitted++;
        if (quantified.length > 0) quantifiedAdmitted++;
      } else {
        fenced++;
        // ALL reasons, never just the first — rule ablation needs the multiset
        for (const reason of outcome?.reasons ?? []) {
          const tag = String(reason?.$tag ?? "?");
          reasonTally[tag] = (reasonTally[tag] ?? 0) + 1;
          if (typeof reason?.channel === "string") {
            channelTally[reason.channel] = (channelTally[reason.channel] ?? 0) + 1;
          }
        }
      }
      const short = fn.id.includes(":") ? fn.id.slice(fn.id.indexOf(":") + 1) : fn.id;
      if (CANARIES.has(short)) {
        canaries[fn.id] = {
          verdict: outcome?.$tag ?? "?",
          quantified: quantified.length,
          reasons: [...new Set((outcome?.reasons ?? []).map((r) => String(r?.$tag ?? "?")))].sort(
            compareCodeUnits,
          ),
        };
      }
    }

    profiles[profile] = {
      registered: functions.length,
      eligible,
      admitted,
      fenced,
      quantifiedEligible,
      quantifiedAdmitted,
      withOpaqueParam,
      quantifiedWithoutOpaqueParam: quantifiedEligible - withOpaqueParam,
      mentioningParams,
      elParams,
      crossCheckTruncatedParams,
      routeAmbiguous,
      notEligible: sortKeysDeep(notEligible),
      activeOriginStrata: sortKeysDeep(originStrata),
      reasonTally: sortKeysDeep(reasonTally),
      observationChannelTally: sortKeysDeep(channelTally),
      canaries: sortKeysDeep(canaries),
    };
  }

  console.log(JSON.stringify(sortKeysDeep({
    schema: "fenel.signature-substrate.phase-4-slice-3d-observation-census.v1",
    measures: "conservative fallout, NOT precision or correctness",
    bootstrap: true,
    summariesAvailable: false,
    originatedBy: "engine:vobAnalyze via the frozen ObsRequest — the census no longer decides what a declared type means",
    modellingLimits: [
      "origination NEVER witnesses a shell: a declared type is not a representation proof, so `Maybe κ` starts as the opaque atom rather than a Maybe shell over an opaque payload. That OVER-fences and is the safe direction. `withOpaqueParam` counts how many eligible quantified functions actually got a non-clean parameter; `quantifiedWithoutOpaqueParam` is the residue whose verdict says nothing about the fence",
      "`mentioningParams` and `elParams` are read off the RAW declared types by an independent AST scan, not off the originator's answer — they are the cross-check that origination has not gone blind. `elParams` counts the compatibility spelling of a higher-kinded application, whose head identity lives in the TypeScheme.applications sidecar and is invisible to any $var scan",
      "frozen routes are flat-registry only, so the source-frame-vs-flat disagreement rule is never exercised",
      "route authority is CANONICAL-ID only: invokeFunction selects per written call spelling, and `routeAmbiguous` counts the functions where an alias reaches a different implementation than the id does",
      "every call into a Fenel body fences for want of a provenance summary, so the reason tally is dominated by the missing-summary frontier",
      "dispatch routes are reported as RDirect, so the dispatch-argument reflection rule is not exercised by this census",
    ],
    profiles,
  }), null, 2));
}

async function main(): Promise<void> {
  if (process.argv.includes("--entry")) {
    await entryMain(process.argv.includes("--digest"));
    return;
  }
  if (process.argv.includes("--observe")) {
    await observeMain();
    return;
  }
  console.error(
    "signature-phase-4-census: the Phase-4 verdict census is supplied by the "
      + "registered Fenel validation module and lands with the validation "
      + "slices. Until then `--entry` (the entry-gate routing projection; add "
      + "`--digest` for the retained digest tree) and `--observe` (the slice-3b "
      + "quantified-observation-fence BOOTSTRAP census, which measures "
      + "conservative fallout rather than precision) are available.",
  );
  process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
