/**
 * Canonical signature-substrate Phase 2 closeout census.
 *
 * Run only after every generated artifact passes its flag-free write/check
 * pair:
 *
 *   bun --no-env-file implementations/typescript/engine/scripts/signature-phase-2-census.ts
 *
 * The runner is deliberately read-only. It prints one deterministic JSON
 * document and no timestamps or durations, so the result can be audited and
 * transcribed into `workstreams/signature-substrate/roadmap.md`. Recovery and
 * differential flags are rejected before any Fenel module is imported.
 */

import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import type {
  FenelFunction,
  FenelModule,
  FunctionSignatureInfo,
  TypeScheme,
} from "../src/types";
import type {
  ParsedSourceTypeBinding,
  ParsedSourceTypeScheme,
  SourceSchemeApplication,
  SourceSchemeDiagnostic,
} from "../src/fenel-parser";
import type { ModuleRegistry } from "../src/registry";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");

type CountMap = Map<string, number>;
type Environment = Readonly<Record<string, string | undefined>>;

type DescriptorAudit = {
  accessorProperties: number;
};

type ApplicationCounts = {
  total: number;
  headVarId: number;
  headRef: number;
  malformed: number;
};

type BoundReferenceLeak = {
  file: string;
  declaration: string;
  spelling: string;
  path: readonly string[];
};

type SccEvidence = {
  scc: boolean;
  sccId: string;
  sccSize: number;
};

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
      `signature Phase 2 census requires an unflagged fresh process; unset ${set.join(", ")}`,
    );
  }
}

function bump(counts: CountMap, key: string, amount = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + amount);
}

function sortedCounts(counts: CountMap): Record<string, number> {
  return Object.fromEntries([...counts].sort(([left], [right]) => compareCodeUnits(left, right)));
}

function fixedCounts(keys: readonly string[], counts: CountMap): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, counts.get(key) ?? 0]));
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function ownData(value: unknown, key: PropertyKey): unknown {
  if (!isObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function ownString(value: unknown, key: PropertyKey): string | undefined {
  const found = ownData(value, key);
  return typeof found === "string" ? found : undefined;
}

function propertyPathSegment(key: PropertyKey): string {
  return typeof key === "symbol" ? key.toString() : String(key);
}

/** Descriptor-only graph walk. Accessor descriptors are counted and never
 * invoked. The separate hostile-boundary probe measures actual getter reads. */
function walkOwnData(
  value: unknown,
  visit: (node: object, path: readonly string[]) => void,
  audit: DescriptorAudit,
  path: readonly string[] = [],
  active: WeakSet<object> = new WeakSet<object>(),
): void {
  if (!isObject(value) || active.has(value)) return;
  active.add(value);
  try {
    visit(value, path);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        audit.accessorProperties += 1;
        continue;
      }
      walkOwnData(
        descriptor.value,
        visit,
        audit,
        [...path, propertyPathSegment(key)],
        active,
      );
    }
  } finally {
    active.delete(value);
  }
}

function walkRootDataPropertiesExcept(
  value: unknown,
  excluded: ReadonlySet<string>,
  visit: (node: object, path: readonly string[]) => void,
  audit: DescriptorAudit,
): void {
  if (!isObject(value)) return;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable) continue;
    const segment = propertyPathSegment(key);
    if (excluded.has(segment)) continue;
    if (!("value" in descriptor)) {
      audit.accessorProperties += 1;
      continue;
    }
    walkOwnData(descriptor.value, visit, audit, [segment]);
  }
}

function emptyApplicationCounts(): ApplicationCounts {
  return { total: 0, headVarId: 0, headRef: 0, malformed: 0 };
}

function addApplications(
  target: ApplicationCounts,
  applications: readonly SourceSchemeApplication[],
): void {
  for (const application of applications) {
    target.total += 1;
    const hasVar = typeof application.headVarId === "string";
    const hasRef = typeof application.headRef === "string";
    if (hasVar === hasRef) {
      target.malformed += 1;
    } else if (hasVar) {
      target.headVarId += 1;
    } else {
      target.headRef += 1;
    }
  }
}

function addDiagnostics(
  counts: CountMap,
  diagnostics: readonly SourceSchemeDiagnostic[],
): void {
  for (const diagnostic of diagnostics) bump(counts, diagnostic.code);
}

function parsedFrames(parsed: unknown): object[] {
  const program = ownData(parsed, "program");
  if (Array.isArray(program)) return program.filter(isObject);
  return isObject(parsed) ? [parsed] : [];
}

function sourceScheme(value: unknown): ParsedSourceTypeScheme | undefined {
  const scheme = ownData(value, "scheme");
  return isObject(scheme) ? scheme as ParsedSourceTypeScheme : undefined;
}

function sourceBinding(value: unknown): ParsedSourceTypeBinding | undefined {
  const binding = ownData(value, "binding");
  return isObject(binding) ? binding as ParsedSourceTypeBinding : undefined;
}

function markerVisitor(
  boundNames: ReadonlySet<string>,
  onVar: () => void,
  onEl: () => void,
  onLeak: (spelling: string, path: readonly string[]) => void,
): (node: object, path: readonly string[]) => void {
  return (node, path) => {
    if (Object.getOwnPropertyDescriptor(node, "$el")?.value !== undefined) onEl();
    const variable = ownString(node, "$var");
    if (variable !== undefined) onVar();
    const nominal = ownString(node, "$ref");
    if (nominal !== undefined && boundNames.has(nominal)) onLeak(nominal, path);
  };
}

function parserCensus(
  parse: (source: string) => unknown,
  tsFallbackFenceLedger: ReadonlySet<string>,
): {
  report: Record<string, unknown>;
  invariantFailures: string[];
} {
  const files = globSync("fenel/**/*.fenel", { cwd: ROOT }).sort();
  const normalizedFiles = files.map((file) => file.replaceAll("\\", "/"));
  const discoveredFileSet = new Set(normalizedFiles);
  const ledgeredTsFallbackFences = normalizedFiles.filter(
    (file) => tsFallbackFenceLedger.has(file),
  );
  const staleTsFallbackFenceEntries = [...tsFallbackFenceLedger]
    .filter((file) => !discoveredFileSet.has(file))
    .sort();
  const unparsedFiles: Array<{ file: string; error: string }> = [];
  const diagnostics = new Map<string, number>();
  const functionApplications = emptyApplicationCounts();
  const typeDefinitionApplications = emptyApplicationCounts();
  const leaks: BoundReferenceLeak[] = [];
  const audit: DescriptorAudit = { accessorProperties: 0 };

  let parsedFiles = 0;
  let signatureFrames = 0;
  let quantifiedSignatureFrames = 0;
  let functionBinders = 0;
  let typeDefinitions = 0;
  let parameterizedTypeDefinitions = 0;
  let typeDefinitionBinders = 0;
  let varOccurrences = 0;
  let elNodes = 0;
  let missingSignatureSidecars = 0;
  let missingTypeDefinitionSidecars = 0;

  for (const relativeFile of files) {
    const file = relativeFile.replaceAll("\\", "/");
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(join(ROOT, relativeFile), "utf8"));
      parsedFiles += 1;
    } catch (error) {
      unparsedFiles.push({
        file,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const frame of parsedFrames(parsed)) {
      const signature = ownData(frame, "type_sig");
      if (isObject(signature)) {
        signatureFrames += 1;
        const declaration = ownString(signature, "name") ?? "<type-signature>";
        const scheme = sourceScheme(signature);
        if (scheme === undefined) {
          missingSignatureSidecars += 1;
          continue;
        }
        const quantified = Array.isArray(scheme.quantified) ? scheme.quantified : [];
        if (quantified.length > 0) quantifiedSignatureFrames += 1;
        functionBinders += quantified.length;
        addApplications(functionApplications, scheme.applications ?? []);
        addDiagnostics(diagnostics, scheme.diagnostics ?? []);
        const boundNames = new Set(quantified.map(({ sourceName }) => sourceName));
        walkOwnData(
          ownData(signature, "type"),
          markerVisitor(
            boundNames,
            () => { varOccurrences += 1; },
            () => { elNodes += 1; },
            (spelling, path) => leaks.push({ file, declaration, spelling, path }),
          ),
          audit,
        );
      }

      const typeDefinition = ownData(frame, "type_def");
      if (isObject(typeDefinition)) {
        typeDefinitions += 1;
        const declaration = ownString(typeDefinition, "name") ?? "<type-definition>";
        const binding = sourceBinding(typeDefinition);
        if (binding === undefined) {
          missingTypeDefinitionSidecars += 1;
          continue;
        }
        const quantified = Array.isArray(binding.quantified) ? binding.quantified : [];
        if (quantified.length > 0) parameterizedTypeDefinitions += 1;
        typeDefinitionBinders += quantified.length;
        addApplications(typeDefinitionApplications, binding.applications ?? []);
        addDiagnostics(diagnostics, binding.diagnostics ?? []);
        const boundNames = new Set(quantified.map(({ sourceName }) => sourceName));
        walkRootDataPropertiesExcept(
          typeDefinition,
          new Set(["binding"]),
          markerVisitor(
            boundNames,
            () => { varOccurrences += 1; },
            () => { elNodes += 1; },
            (spelling, path) => leaks.push({ file, declaration, spelling, path }),
          ),
          audit,
        );
      }
    }
  }

  const applications = functionApplications.total + typeDefinitionApplications.total;
  const genuineDependentFences = elNodes - applications;
  const kindMismatches = diagnostics.get("KindMismatch") ?? 0;
  const malformedApplicationHeads =
    functionApplications.malformed + typeDefinitionApplications.malformed;
  const invariantFailures: string[] = [];
  if (leaks.length !== 0) invariantFailures.push(`parser.boundReferenceLeaks=${leaks.length}`);
  if (kindMismatches !== 0) invariantFailures.push(`parser.kindMismatches=${kindMismatches}`);
  if (malformedApplicationHeads !== 0) {
    invariantFailures.push(`parser.malformedApplicationHeads=${malformedApplicationHeads}`);
  }
  if (genuineDependentFences < 0) {
    invariantFailures.push(`parser.genuineDependentFences=${genuineDependentFences}`);
  }
  if (missingSignatureSidecars !== 0) {
    invariantFailures.push(`parser.missingSignatureSidecars=${missingSignatureSidecars}`);
  }
  if (missingTypeDefinitionSidecars !== 0) {
    invariantFailures.push(
      `parser.missingTypeDefinitionSidecars=${missingTypeDefinitionSidecars}`,
    );
  }
  if (audit.accessorProperties !== 0) {
    invariantFailures.push(`parser.accessorProperties=${audit.accessorProperties}`);
  }
  if (staleTsFallbackFenceEntries.length !== 0) {
    invariantFailures.push(
      `parser.staleTsFallbackFenceEntries=${staleTsFallbackFenceEntries.length}`,
    );
  }

  return {
    report: {
      files: {
        discovered: files.length,
        parsed: parsedFiles,
        unparsed: {
          count: unparsedFiles.length,
          files: unparsedFiles,
        },
        tsFallbackFences: {
          declared: tsFallbackFenceLedger.size,
          discovered: ledgeredTsFallbackFences.length,
          files: ledgeredTsFallbackFences,
          staleEntries: staleTsFallbackFenceEntries,
        },
      },
      declarations: {
        signatureFrames,
        quantifiedSignatureFrames,
        functionBinders,
        typeDefinitions,
        parameterizedTypeDefinitions,
        typeDefinitionBinders,
        declarationLocalBinders: functionBinders + typeDefinitionBinders,
      },
      typeMarkers: {
        varOccurrences,
        elNodes,
        genuineDependentFences,
      },
      applications: {
        functions: functionApplications,
        typeDefinitions: typeDefinitionApplications,
        total: applications,
      },
      diagnosticsByCode: sortedCounts(diagnostics),
      invariants: {
        boundReferenceLeaks: leaks.length,
        boundReferenceLeakDetails: leaks,
        kindMismatches,
        malformedApplicationHeads,
        missingSignatureSidecars,
        missingTypeDefinitionSidecars,
        accessorProperties: audit.accessorProperties,
      },
    },
    invariantFailures,
  };
}

export function containsSolverMeta(value: unknown): boolean {
  let found = false;
  const audit: DescriptorAudit = { accessorProperties: 0 };
  walkOwnData(value, (node) => {
    // The live solver meta is the PLAIN-record internal form
    // `{ tag: "ItMeta", id: "<path>#m<N>", kind }` (inference.fenel — `.fenel`
    // bodies cannot author `$`-keys). The original detector probed only a
    // `$tag` spelling and a `?m:` id prefix, neither of which the solver ever
    // produces, so the "escaped metas: zero" census figure was vacuously
    // measured (Fable review 2026-07-23, Codex finding). Detect both
    // spellings plus the real `…#m<N>` id shape.
    if (ownString(node, "$tag") === "ItMeta" || ownString(node, "tag") === "ItMeta") {
      found = true;
    }
    for (const key of Reflect.ownKeys(node)) {
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      if (
        descriptor
        && "value" in descriptor
        && typeof descriptor.value === "string"
        && (descriptor.value.startsWith("?m:") || /#m\d+$/.test(descriptor.value))
      ) found = true;
    }
  }, audit);
  return found;
}

function asTypeScheme(value: unknown): TypeScheme | undefined {
  if (!isObject(value)) return undefined;
  return Array.isArray(ownData(value, "quantified")) && ownData(value, "body") !== undefined
    ? value as TypeScheme
    : undefined;
}

function unboundSchemeVariables(
  scheme: TypeScheme,
): Array<{ spelling: string; path: readonly string[] }> {
  const unbound: Array<{ spelling: string; path: readonly string[] }> = [];
  const visit = (
    value: unknown,
    bound: ReadonlySet<string>,
    path: readonly string[],
    active: WeakSet<object>,
  ): void => {
    if (!isObject(value) || active.has(value)) return;
    active.add(value);
    try {
      const spelling = ownString(value, "$var");
      if (spelling !== undefined && !bound.has(spelling)) unbound.push({ spelling, path });

      const mu = ownData(value, "$mu");
      const muVar = ownString(mu, "var");
      const muBody = ownData(mu, "body");
      if (isObject(mu) && muVar !== undefined && muBody !== undefined) {
        visit(
          muBody,
          new Set([...bound, muVar]),
          [...path, "$mu", "body"],
          active,
        );
        return;
      }

      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) continue;
        visit(descriptor.value, bound, [...path, propertyPathSegment(key)], active);
      }
    } finally {
      active.delete(value);
    }
  };
  visit(
    scheme.body,
    new Set(scheme.quantified.map(({ sourceName }) => sourceName)),
    [],
    new WeakSet<object>(),
  );
  return unbound;
}

export function unboundSchemeApplicationHeads(
  scheme: TypeScheme,
): Array<{ spelling: string; path: readonly string[] }> {
  const quantified = ownData(scheme, "quantified");
  const boundIds = new Set(
    Array.isArray(quantified)
      ? quantified.map((variable) => ownString(variable, "id")).filter(
        (id): id is string => id !== undefined,
      )
      : [],
  );
  const applications = ownData(scheme, "applications");
  if (!Array.isArray(applications)) return [];

  const unbound: Array<{ spelling: string; path: readonly string[] }> = [];
  for (let index = 0; index < applications.length; index += 1) {
    const application = ownData(applications, index);
    const headVarId = ownString(application, "headVarId");
    if (headVarId === undefined || boundIds.has(headVarId)) continue;
    const rawPath = ownData(application, "path");
    const path: string[] = [];
    if (Array.isArray(rawPath)) {
      const length = ownData(rawPath, "length");
      for (
        let segmentIndex = 0;
        typeof length === "number" && segmentIndex < length;
        segmentIndex += 1
      ) {
        const value = ownData(rawPath, segmentIndex);
        if (typeof value === "string") path.push(value);
      }
    }
    unbound.push({
      spelling: headVarId,
      path: ["applications", String(index), ...path],
    });
  }
  return unbound;
}

function descriptorAudit(roots: readonly unknown[]): DescriptorAudit {
  const audit: DescriptorAudit = { accessorProperties: 0 };
  for (const root of roots) walkOwnData(root, () => {}, audit);
  return audit;
}

function decodedSccEvidence(info: FunctionSignatureInfo): SccEvidence | undefined {
  if (info.outcome.$tag !== "Solved") return undefined;
  const derivation = info.outcome.derivation;
  const scc = ownData(derivation, "scc");
  const sccId = ownData(derivation, "sccId");
  const sccSize = ownData(derivation, "sccSize");
  if (
    typeof scc !== "boolean"
    || typeof sccId !== "string"
    || typeof sccSize !== "number"
    || !Number.isSafeInteger(sccSize)
    || sccSize < 1
  ) return undefined;
  return { scc, sccId, sccSize };
}

function functionSlots(info: FunctionSignatureInfo): readonly { readonly $tag: string }[] {
  return [...info.params, info.returns];
}

function profileCensus(
  profile: "SYSTEM" | "seed",
  inputModules: readonly FenelModule[],
  registry: ModuleRegistry,
): {
  report: Record<string, unknown>;
  invariantFailures: string[];
} {
  const functions = [...registry.listFunctions()].sort(({ id: left }, { id: right }) =>
    compareCodeUnits(left, right)
  );
  const origins = new Map<string, number>();
  const outcomes = new Map<string, number>();
  const trust = new Map<string, number>();
  const trustAuthorities = new Map<string, number>();
  const declarationCompleteness = new Map<string, number>();
  const slotProvenance = new Map<string, number>();
  const slotAuthorities = new Map<string, number>();
  const originMaps = new Map<string, number>();
  const schemes = { ground: 0, quantified: 0 };
  const missingSignatureIds: string[] = [];
  const effectiveViewMismatches: string[] = [];
  const sccGroups = new Map<string, {
    evidence: SccEvidence;
    members: string[];
    inconsistent: boolean;
  }>();
  let malformedSccDerivations = 0;
  let inferredFunctions = 0;

  const infoRows: Array<{ fn: FenelFunction; info: FunctionSignatureInfo }> = [];
  for (const fn of functions) {
    const info = registry.getFunctionSignatureInfo(fn.id);
    if (info === undefined) {
      missingSignatureIds.push(fn.id);
      continue;
    }
    infoRows.push({ fn, info });
    bump(origins, info.implementationOrigin.$tag);
    const originMap = ownString(info.implementationOrigin, "map");
    if (originMap !== undefined) {
      bump(originMaps, `${info.implementationOrigin.$tag}.${originMap}`);
    }
    bump(outcomes, info.outcome.$tag);
    bump(trust, info.trust.$tag);
    const authority = ownString(
      info.trust.$tag === "Advisory" ? undefined : info.trust.evidence,
      "authority",
    );
    if (authority !== undefined) bump(trustAuthorities, authority);
    if (info.scheme.quantified.length === 0) schemes.ground += 1;
    else schemes.quantified += 1;

    const slots = functionSlots(info);
    let authored = 0;
    let inferred = 0;
    for (const slot of slots) {
      bump(slotProvenance, slot.$tag);
      if (slot.$tag === "Authored") {
        authored += 1;
        bump(
          slotAuthorities,
          `Authored.${ownString(ownData(slot, "source"), "$tag") ?? "Unknown"}`,
        );
      } else if (slot.$tag === "Inferred") {
        inferred += 1;
        bump(slotAuthorities, "Inferred");
      } else {
        bump(slotAuthorities, slot.$tag);
      }
    }
    if (inferred === 0) bump(declarationCompleteness, "complete");
    else if (authored === 0) bump(declarationCompleteness, "absent");
    else bump(declarationCompleteness, "partial");

    if (!isDeepStrictEqual(info.scheme.body, {
      $arrow: { params: [...fn.params], returns: fn.returns },
    })) effectiveViewMismatches.push(fn.id);

    if (inferred > 0) {
      inferredFunctions += 1;
      const evidence = decodedSccEvidence(info);
      if (evidence === undefined) {
        malformedSccDerivations += 1;
      } else {
        const prior = sccGroups.get(evidence.sccId);
        if (prior === undefined) {
          sccGroups.set(evidence.sccId, {
            evidence,
            members: [fn.id],
            inconsistent: false,
          });
        } else {
          prior.members.push(fn.id);
          if (
            prior.evidence.scc !== evidence.scc
            || prior.evidence.sccSize !== evidence.sccSize
          ) prior.inconsistent = true;
        }
      }
    }
  }

  const constructors = registry.listConstructorSignatures();
  const entities = registry.listIdentifiedEntities();
  const allSchemes: Array<{ context: string; scheme: TypeScheme }> = infoRows.map(({ fn, info }) => ({
    context: `function ${fn.id}`,
    scheme: info.scheme,
  }));
  for (const constructor of constructors) {
    if (constructor.scheme !== undefined) {
      allSchemes.push({ context: `constructor ${constructor.targetId}`, scheme: constructor.scheme });
    }
  }
  for (const entity of entities) {
    const scheme = asTypeScheme(ownData(entity, "typeScheme"));
    if (scheme !== undefined) {
      allSchemes.push({
        context: `entity ${ownString(entity, "module") ?? "<module>"}:${ownString(entity, "id") ?? "<id>"}`,
        scheme,
      });
    }
  }

  const authoritativeSharedPlaceholderDetails: Array<{
    context: string;
    spelling: string;
    path: readonly string[];
  }> = [];
  const unboundApplicationHeadDetails: Array<{
    context: string;
    spelling: string;
    path: readonly string[];
  }> = [];
  for (const { context, scheme } of allSchemes) {
    for (const variable of unboundSchemeVariables(scheme)) {
      authoritativeSharedPlaceholderDetails.push({ context, ...variable });
    }
    for (const application of unboundSchemeApplicationHeads(scheme)) {
      unboundApplicationHeadDetails.push({ context, ...application });
    }
  }

  const publicRoots: unknown[] = [
    functions,
    infoRows.map(({ info }) => info),
    constructors,
    entities,
  ];
  const accessorAudit = descriptorAudit([...inputModules, ...registry.modules, ...publicRoots]);
  const escapedMetaRoots = publicRoots.filter(containsSolverMeta).length;
  const ids = functions.map(({ id }) => id);
  const duplicateCanonicalIds = ids.length - new Set(ids).size;
  const effectiveAbsentSlots = slotProvenance.get("Absent") ?? 0;

  let acyclicComponents = 0;
  let acyclicFunctions = 0;
  let recursiveComponents = 0;
  let recursiveFunctions = 0;
  let selfRecursiveComponents = 0;
  let mutualRecursiveComponents = 0;
  let mutualRecursiveFunctions = 0;
  let unpublishedPartialSccs = 0;
  let maxSccSize = 0;
  for (const group of [...sccGroups.values()]) {
    group.members.sort();
    const { evidence } = group;
    maxSccSize = Math.max(maxSccSize, evidence.sccSize);
    if (group.inconsistent) malformedSccDerivations += 1;
    if (group.members.length !== evidence.sccSize) unpublishedPartialSccs += 1;
    if (!evidence.scc) {
      acyclicComponents += 1;
      acyclicFunctions += group.members.length;
      if (evidence.sccSize !== 1) malformedSccDerivations += 1;
    } else {
      recursiveComponents += 1;
      recursiveFunctions += group.members.length;
      if (evidence.sccSize === 1) {
        selfRecursiveComponents += 1;
      } else {
        mutualRecursiveComponents += 1;
        mutualRecursiveFunctions += group.members.length;
      }
    }
  }

  const invariantFailures: string[] = [];
  const invariantValues: Record<string, number> = {
    missingSignatureRecords: missingSignatureIds.length,
    effectiveAbsentSlots,
    escapedMetas: escapedMetaRoots,
    authoritativeSharedPlaceholders: authoritativeSharedPlaceholderDetails.length,
    unboundApplicationHeads: unboundApplicationHeadDetails.length,
    duplicateCanonicalIds,
    accessorProperties: accessorAudit.accessorProperties,
    unpublishedPartialSccs,
    malformedSccDerivations,
    effectiveViewMismatches: effectiveViewMismatches.length,
  };
  for (const [name, value] of Object.entries(invariantValues)) {
    if (value !== 0) invariantFailures.push(`${profile}.${name}=${value}`);
  }

  return {
    report: {
      modules: {
        canonicalProfileEntries: inputModules.length,
        inputEntries: inputModules.length,
        registryEntries: registry.modules.length,
        uniqueInputNames: new Set(inputModules.map(({ name }) => name)).size,
        uniqueRegistryNames: new Set(registry.modules.map(({ name }) => name)).size,
      },
      functions: {
        unique: functions.length,
        implementationOrigins: fixedCounts(
          ["FenelBody", "HostNative", "NativeWithFallback", "ExternalHandler"],
          origins,
        ),
        implementationOriginMaps: sortedCounts(originMaps),
        declarationCompleteness: fixedCounts(
          ["complete", "partial", "absent"],
          declarationCompleteness,
        ),
        slotProvenance: fixedCounts(["Authored", "Inferred", "Absent"], slotProvenance),
        slotAuthorities: fixedCounts(
          ["Authored.SourceTypeSig", "Authored.HostSpec", "Inferred", "Absent"],
          slotAuthorities,
        ),
        outcomes: fixedCounts(["Solved", "AnnotationRequired", "Invalid"], outcomes),
        schemes,
        trust: fixedCounts(["Advisory", "InferredDerivation", "TrustedPrimitive"], trust),
        trustAuthorities: sortedCounts(trustAuthorities),
      },
      inferenceScc: {
        inferredFunctions,
        authoredNotSccPlanned: functions.length - inferredFunctions,
        plannedFunctions: [...sccGroups.values()].reduce(
          (sum, group) => sum + group.members.length,
          0,
        ),
        components: sccGroups.size,
        acyclicComponents,
        acyclicFunctions,
        recursiveComponents,
        recursiveFunctions,
        selfRecursiveComponents,
        mutualRecursiveComponents,
        mutualRecursiveFunctions,
        maxSccSize,
      },
      invariants: {
        ...invariantValues,
        missingSignatureIds,
        effectiveViewMismatches,
        authoritativeSharedPlaceholderDetails,
        unboundApplicationHeadDetails,
      },
    },
    invariantFailures,
  };
}

function accessorBoundaryProbe(
  createRegistry: (modules: FenelModule[]) => ModuleRegistry,
): {
  report: { accessorReads: number; rejectedAccessorProperty: boolean };
  invariantFailures: string[];
} {
  let accessorReads = 0;
  const module: FenelModule = {
    name: "signature-phase-2-census-accessor-probe",
    label: "Signature Phase 2 census accessor probe",
    entities: [],
    functions: [],
    instances: [],
  };
  Object.defineProperty(module, "imports", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return [];
    },
  });

  let rejectedAccessorProperty = false;
  try {
    createRegistry([module]);
  } catch (error) {
    rejectedAccessorProperty = error instanceof Error
      && error.message.includes('accessor property "imports" is not allowed');
  }
  const invariantFailures: string[] = [];
  if (accessorReads !== 0) {
    invariantFailures.push(`hostileBoundary.accessorReads=${accessorReads}`);
  }
  if (!rejectedAccessorProperty) {
    invariantFailures.push("hostileBoundary.rejectedAccessorProperty=false");
  }
  return {
    report: { accessorReads, rejectedAccessorProperty },
    invariantFailures,
  };
}

async function main(): Promise<void> {
  assertFlagFreeMode();

  // Dynamic imports are load-bearing: recovery flags must be rejected before
  // module-manifest evaluation parses any Fenel source.
  const { parsedViaCache } = await import("../src/parse-cache");
  const { FENCE_FALLBACK } = await import("./generate-parse-cache");
  const { createDispatchRegistry } = await import("../src/dispatch-registry");
  const { createRegistry } = await import("../src/registry");
  const { createRepositoryRegistry } = await import("../src/repository-registry");
  const { SYSTEM_REGISTRY_MODULES } = await import("../src/system-registry-modules");
  const { modulesFor } = await import("../src/module-manifest");

  const parser = parserCensus(parsedViaCache, FENCE_FALLBACK);
  const hostileBoundary = accessorBoundaryProbe(createRegistry);
  const profileInputs = [
    ["SYSTEM", SYSTEM_REGISTRY_MODULES],
    ["seed", modulesFor("seed")],
  ] as const;
  const profiles: Record<string, unknown> = {};
  const invariantFailures = [
    ...parser.invariantFailures,
    ...hostileBoundary.invariantFailures,
  ];
  for (const [profile, modules] of profileInputs) {
    const registry = createRepositoryRegistry([...modules], {
      dispatchRegistry: createDispatchRegistry(),
    });
    const result = profileCensus(profile, modules, registry);
    profiles[profile] = result.report;
    invariantFailures.push(...result.invariantFailures);
  }

  invariantFailures.sort();
  const report = {
    schema: "fenel.signature-substrate.phase-2-census.v1",
    mode: {
      artifactPath: "default",
      parserDriver: "parsedViaCache",
      registryIdentity: "strict-embedded-repository",
      registryDispatch: "fresh-isolated-per-profile",
      environmentOverrides: {
        rejectedPrefix: "FENEL_*",
        detected: [],
      },
    },
    parser: parser.report,
    profiles,
    hostileBoundary: hostileBoundary.report,
    invariantFailures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (invariantFailures.length > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
