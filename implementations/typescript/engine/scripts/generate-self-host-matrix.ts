/**
 * Internal guarded worker for the self-host matrix transaction.
 *
 * TypeScript owns acquisition, descriptor-safe host projection, classifier
 * scheduling, closed wire decoding, hashing, and private output.  All report
 * policy and every Markdown byte are owned by self-host-matrix-report.fenel.
 */

import type { FenelFunction, FenelModule } from "@fenel/engine/types";
import type { ClassifierResult } from "../src/compile-js-self-host-classifier";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";
import {
  ArtifactWireContractError,
  encodeCanonicalJson,
  expectClosedKeys,
  expectNonEmptyWireString,
  expectSafeUint,
  expectSha256,
  expectWireArray,
  expectWireLiteral,
  expectWireRecord,
  expectWireString,
  parseCanonicalJson,
} from "./lib/artifact-wire-json";

const MATRIX_WORKER_REQUEST_NAME = ".m4-matrix-worker-request.json";
const MATRIX_WORKER_REQUEST_SCHEMA = "fenel.self-host-matrix-worker-request.v1";
const MATRIX_WORKER_AUTHORIZATION_SCHEMA =
  "fenel.self-host-matrix-worker-authorization.v1";
const MATRIX_REPORT_SOURCE =
  "implementations/typescript/engine/scripts/self-host-matrix-report.fenel";
const MATRIX_REPORT_SMOKE_OUTPUT = ".m4-private/report-smoke.json";
const MATRIX_REPORT_CANDIDATE_OUTPUT = ".m4-private/candidate.md";
const MATRIX_REPORT_RAW_FACETS_OUTPUT = ".m4-private/raw-facets.json";
const MATRIX_REPORT_AUDIT_OUTPUT = ".m4-private/audit.json";
const MATRIX_REPORT_SMOKE_SCHEMA = "fenel.self-host-matrix-report-smoke.v1";
const MATRIX_REPORT_RAW_FACETS_SCHEMA = "fenel.self-host-matrix-raw-facets.v1";
const MATRIX_REPORT_AUDIT_SCHEMA = "fenel.self-host-matrix-report-audit.v1";
const MATRIX_REPORT_SMOKE_RESULT = "matrix-report-isolated-v1";
const MATRIX_WORKER_AUTHORIZATION_GLOBAL =
  "__FENEL_SELF_HOST_MATRIX_WORKER_AUTHORIZATION__";

function sha256Raw(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type MatrixWorkerTask = "report-smoke" | "render";

type MatrixReportPresentation = Readonly<{
  verified: string;
  verifiedAtSha: string;
}>;

type MatrixSmokeRequest = Readonly<{
  schema: typeof MATRIX_WORKER_REQUEST_SCHEMA;
  task: "report-smoke";
  reportSource: typeof MATRIX_REPORT_SOURCE;
  outputs: Readonly<{ smoke: typeof MATRIX_REPORT_SMOKE_OUTPUT }>;
}>;

type MatrixRenderRequest = Readonly<{
  schema: typeof MATRIX_WORKER_REQUEST_SCHEMA;
  task: "render";
  reportSource: typeof MATRIX_REPORT_SOURCE;
  reportSourceDigest: string;
  presentation: MatrixReportPresentation;
  progress: boolean;
  outputs: Readonly<{
    candidate: typeof MATRIX_REPORT_CANDIDATE_OUTPUT;
    rawFacets: typeof MATRIX_REPORT_RAW_FACETS_OUTPUT;
    audit: typeof MATRIX_REPORT_AUDIT_OUTPUT;
  }>;
}>;

type MatrixWorkerRequest = MatrixSmokeRequest | MatrixRenderRequest;

type MatrixWorkerAuthorization = Readonly<{
  schema: typeof MATRIX_WORKER_AUTHORIZATION_SCHEMA;
  requestPath: string;
  requestDigest: string;
  task: MatrixWorkerTask;
}>;

type MatrixReportSmokeEvidence = Readonly<{
  result: typeof MATRIX_REPORT_SMOKE_RESULT;
  provenanceDelta: Readonly<{ fenel: 1; ts: 0 }>;
  bootDeficitDelta: 0;
  loadDepthBefore: 0;
}>;

type MatrixTargetProjection = Readonly<{
  samples: number;
  gapPresent: boolean;
  gap: string;
  status: "OK" | "SKIP" | "FAIL" | "NO_SAMPLES";
  samplesCompared: number;
  reason: string;
}>;

type MatrixFunctionProjection = Readonly<{
  fnId: string;
  bodyPresent: boolean;
  js: MatrixTargetProjection;
  wasm: MatrixTargetProjection;
  llvm: MatrixTargetProjection;
}>;

export type MatrixInstanceFacetObservation = Readonly<{
  typeName: "Categorizable" | "Taggable";
  fnId: string;
  valueString: string;
  valueStrings: readonly string[];
}>;

type MatrixModuleLoader = () => Promise<FenelModule>;

// Fenel owns which keys are requested.  This map owns only the mechanical
// acquisition corresponding to every possible key in that closed roster.
const MATRIX_ACQUISITION_LOADERS: Readonly<Record<string, MatrixModuleLoader>> =
  Object.freeze({
    std: async () => (await import("@fenel/engine/modules/std")).stdModule,
    codec: async () => (await import("@fenel/engine/modules/codec")).codecModule,
    dashboard: async () => (await import("@fenel/engine/modules/dashboard")).dashboardModule,
    "email-webhooks": async () =>
      (await import("@fenel/engine/modules/email-webhooks")).emailWebhooksModule,
    notify: async () => (await import("@fenel/engine/modules/notify")).notifyModule,
    webhooks: async () => (await import("@fenel/engine/modules/webhooks")).webhooksModule,
    subscriptions: async () =>
      (await import("@fenel/engine/modules/subscriptions")).subscriptionsModule,
    "proxy-links": async () =>
      (await import("@fenel/engine/modules/proxyLinks")).proxyLinksModule,
    pages: async () => (await import("@fenel/engine/modules/pages")).pagesModule,
    receipt: async () => (await import("@fenel/engine/modules/receipt")).receiptModule,
    inventory: async () => (await import("@fenel/engine/modules/inventory")).inventoryModule,
    purchases: async () => (await import("@fenel/engine/modules/purchases")).purchasesModule,
    payments: async () => (await import("@fenel/engine/modules/payments")).paymentsModule,
    profiles: async () => (await import("@fenel/engine/modules/profiles")).profilesModule,
    imports: async () => (await import("@fenel/engine/modules/imports")).importsModule,
    items: async () => (await import("@fenel/engine/modules/items")).itemsModule,
    types: async () => (await import("@fenel/engine/modules/types")).typesModule,
    plans: async () => (await import("@fenel/engine/modules/plans")).plansModule,
    entitlements: async () =>
      (await import("@fenel/engine/modules/entitlements")).entitlementsModule,
    channels: async () => (await import("@fenel/engine/modules/channels")).channelsModule,
    "action-result": async () =>
      (await import("@fenel/engine/modules/action-result")).actionResultModule,
    auth: async () => (await import("@fenel/engine/modules/auth")).authModule,
    authority: async () =>
      (await import("@fenel/engine/modules/authority")).authorityModule,
    telegram: async () => (await import("@fenel/engine/modules/telegram")).telegramModule,
    engine: async () => (await import("@fenel/engine/modules/engine")).engineModule,
    locale: async () => (await import("@fenel/engine/modules/locale")).localeModule,
    events: async () => (await import("@fenel/engine/modules/events")).eventsModule,
    time: async () => (await import("@fenel/engine/modules/time")).timeModule,
    animation: async () => (await import("@fenel/engine/modules/animation")).animationModule,
    path: async () => (await import("@fenel/engine/modules/path")).pathModule,
    track: async () => (await import("@fenel/engine/modules/track")).trackModule,
    email: async () => (await import("@fenel/engine/modules/email")).emailModule,
    picture: async () => (await import("@fenel/engine/modules/picture")).pictureModule,
    sound: async () => (await import("@fenel/engine/modules/sound")).soundModule,
    algebra: async () => (await import("../src/modules/algebra")).algebraModule,
    "compile-js": async () =>
      (await import("@fenel/engine/modules/compile-js")).compileJsModule,
    "compile-wasm": async () =>
      (await import("@fenel/engine/modules/compile-wasm")).compileWasmModule,
    "compile-llvm": async () =>
      (await import("@fenel/engine/modules/compile-llvm")).compileLlvmModule,
    runtime: async () => (await import("@fenel/engine/modules/runtime")).runtimeModule,
    notion: async () => (await import("@fenel/engine/modules/notion")).notionModule,
    phase20: async () => {
      const { effectfulCanary } = await import("@fenel/engine/self-host-samples");
      return Object.freeze({
        name: "phase20",
        label: "Phase 20 synthetic canary",
        functions: [effectfulCanary],
        instances: [],
      });
    },
  });

const MATRIX_ACQUISITION_KEYS = Object.freeze(Object.keys(MATRIX_ACQUISITION_LOADERS));

/** Import-inert evidence for the complete mechanical acquisition inventory. */
export function matrixAcquisitionKeys(): readonly string[] {
  return MATRIX_ACQUISITION_KEYS;
}

/** Prove a duplicate-free closed bijection before any acquisition executes. */
export function validateMatrixAcquisitionRoster(
  keys: readonly string[],
  inventoryKeys: readonly string[] = MATRIX_ACQUISITION_KEYS,
): void {
  const requested = new Set(keys);
  if (requested.size !== keys.length) {
    throw new TypeError("Fenel matrix roster contains duplicate keys");
  }
  const inventory = new Set(inventoryKeys);
  if (inventory.size !== inventoryKeys.length) {
    throw new TypeError("TypeScript matrix acquisition inventory contains duplicate keys");
  }
  for (const key of keys) {
    if (!inventory.has(key)) throw new TypeError(`missing matrix acquisition entry ${key}`);
  }
  for (const key of inventoryKeys) {
    if (!requested.has(key)) throw new TypeError(`unused matrix acquisition entry ${key}`);
  }
  if (keys.length !== inventoryKeys.length) {
    throw new TypeError("Fenel matrix roster and TypeScript acquisition inventory differ in size");
  }
}

function expectWireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ArtifactWireContractError(path, "expected a boolean");
  }
  return value;
}

function expectPresentationSha(value: unknown, path: string): string {
  const result = expectWireString(value, path);
  if (!/^[0-9a-f]{7,40}$/.test(result)) {
    throw new ArtifactWireContractError(
      path,
      "expected 7 to 40 lowercase hexadecimal digits",
    );
  }
  return result;
}

function decodeMatrixWorkerRequest(bytes: Uint8Array): MatrixWorkerRequest {
  const record = expectWireRecord(parseCanonicalJson(bytes), "matrixWorkerRequest");
  expectWireLiteral(
    record.schema,
    [MATRIX_WORKER_REQUEST_SCHEMA],
    "matrixWorkerRequest.schema",
  );
  const task = expectWireLiteral(
    record.task,
    ["report-smoke", "render"],
    "matrixWorkerRequest.task",
  );
  expectWireLiteral(
    record.reportSource,
    [MATRIX_REPORT_SOURCE],
    "matrixWorkerRequest.reportSource",
  );
  if (task === "report-smoke") {
    expectClosedKeys(
      record,
      ["schema", "task", "reportSource", "outputs"],
      [],
      "matrixWorkerRequest",
    );
    const outputs = expectWireRecord(record.outputs, "matrixWorkerRequest.outputs");
    expectClosedKeys(outputs, ["smoke"], [], "matrixWorkerRequest.outputs");
    expectWireLiteral(
      outputs.smoke,
      [MATRIX_REPORT_SMOKE_OUTPUT],
      "matrixWorkerRequest.outputs.smoke",
    );
    return Object.freeze({
      schema: MATRIX_WORKER_REQUEST_SCHEMA,
      task: "report-smoke",
      reportSource: MATRIX_REPORT_SOURCE,
      outputs: Object.freeze({ smoke: MATRIX_REPORT_SMOKE_OUTPUT }),
    });
  }

  expectClosedKeys(
    record,
    [
      "schema",
      "task",
      "reportSource",
      "reportSourceDigest",
      "presentation",
      "progress",
      "outputs",
    ],
    [],
    "matrixWorkerRequest",
  );
  const presentation = expectWireRecord(
    record.presentation,
    "matrixWorkerRequest.presentation",
  );
  expectClosedKeys(
    presentation,
    ["verified", "verifiedAtSha"],
    [],
    "matrixWorkerRequest.presentation",
  );
  const verified = expectWireString(
    presentation.verified,
    "matrixWorkerRequest.presentation.verified",
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verified)) {
    throw new ArtifactWireContractError(
      "matrixWorkerRequest.presentation.verified",
      "expected YYYY-MM-DD",
    );
  }
  const outputs = expectWireRecord(record.outputs, "matrixWorkerRequest.outputs");
  expectClosedKeys(
    outputs,
    ["candidate", "rawFacets", "audit"],
    [],
    "matrixWorkerRequest.outputs",
  );
  expectWireLiteral(
    outputs.candidate,
    [MATRIX_REPORT_CANDIDATE_OUTPUT],
    "matrixWorkerRequest.outputs.candidate",
  );
  expectWireLiteral(
    outputs.rawFacets,
    [MATRIX_REPORT_RAW_FACETS_OUTPUT],
    "matrixWorkerRequest.outputs.rawFacets",
  );
  expectWireLiteral(
    outputs.audit,
    [MATRIX_REPORT_AUDIT_OUTPUT],
    "matrixWorkerRequest.outputs.audit",
  );
  return Object.freeze({
    schema: MATRIX_WORKER_REQUEST_SCHEMA,
    task: "render",
    reportSource: MATRIX_REPORT_SOURCE,
    reportSourceDigest: expectSha256(
      record.reportSourceDigest,
      "matrixWorkerRequest.reportSourceDigest",
    ),
    presentation: Object.freeze({
      verified,
      verifiedAtSha: expectPresentationSha(
        presentation.verifiedAtSha,
        "matrixWorkerRequest.presentation.verifiedAtSha",
      ),
    }),
    progress: expectWireBoolean(record.progress, "matrixWorkerRequest.progress"),
    outputs: Object.freeze({
      candidate: MATRIX_REPORT_CANDIDATE_OUTPUT,
      rawFacets: MATRIX_REPORT_RAW_FACETS_OUTPUT,
      audit: MATRIX_REPORT_AUDIT_OUTPUT,
    }),
  });
}

function authorizationDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`matrix worker authorization field ${key} must be own data`);
  }
  return descriptor.value;
}

function readMatrixWorkerAuthorization(requestPath: string): MatrixWorkerAuthorization {
  const globalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    MATRIX_WORKER_AUTHORIZATION_GLOBAL,
  );
  if (
    globalDescriptor === undefined
    || !("value" in globalDescriptor)
    || globalDescriptor.configurable
    || globalDescriptor.writable
  ) {
    throw new TypeError("matrix worker authorization was not immutably injected by the preload");
  }
  const value = globalDescriptor.value;
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.isFrozen(value)) {
    throw new TypeError("matrix worker authorization must be a frozen object");
  }
  const names = Object.getOwnPropertyNames(value);
  const expected = new Set(["requestDigest", "requestPath", "schema", "task"]);
  if (names.length !== expected.size || names.some((name) => !expected.has(name))) {
    throw new TypeError("matrix worker authorization has unknown or missing fields");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError("matrix worker authorization has symbol fields");
  }
  const schema = authorizationDataValue(value, "schema");
  const authorizedPath = authorizationDataValue(value, "requestPath");
  const requestDigest = authorizationDataValue(value, "requestDigest");
  const task = authorizationDataValue(value, "task");
  if (schema !== MATRIX_WORKER_AUTHORIZATION_SCHEMA) {
    throw new TypeError("matrix worker authorization has the wrong schema");
  }
  if (authorizedPath !== requestPath) {
    throw new TypeError("matrix worker authorization does not bind the requested path");
  }
  if (typeof requestDigest !== "string" || !/^[0-9a-f]{64}$/.test(requestDigest)) {
    throw new TypeError("matrix worker authorization has an invalid request digest");
  }
  if (task !== "report-smoke" && task !== "render") {
    throw new TypeError("matrix worker authorization has an unauthorized task");
  }
  return Object.freeze({
    schema: MATRIX_WORKER_AUTHORIZATION_SCHEMA,
    requestPath: authorizedPath,
    requestDigest,
    task,
  });
}

function matrixWorkerRequestPath(argv: readonly string[]): string {
  if (argv.length !== 1 || !argv[0]!.startsWith("--worker-request=")) {
    throw new TypeError("matrix worker requires exactly one --worker-request=<absolute-path>");
  }
  const value = argv[0]!.slice("--worker-request=".length);
  if (!isAbsolute(value) || normalize(value) !== value || basename(value) !== MATRIX_WORKER_REQUEST_NAME) {
    throw new TypeError(`matrix worker request must be the absolute ${MATRIX_WORKER_REQUEST_NAME} path`);
  }
  return value;
}

type LoadedReport = Readonly<{
  source: string;
  module: FenelModule;
  evidence: MatrixReportSmokeEvidence;
}>;

function isolatedReportFunctionModule(loaded: LoadedReport, fnId: string): FenelModule {
  const definition = loaded.module.functions?.find((candidate) => candidate.id === fnId);
  if (definition === undefined) {
    throw new TypeError(`matrix report source did not define ${fnId}`);
  }
  return Object.freeze({
    name: loaded.module.name,
    label: loaded.module.label,
    functions: [definition],
  });
}

async function loadMatrixReport(): Promise<LoadedReport> {
  const { harnessForTests } = await import("../src/engine-bodies-dispatch");
  harnessForTests();
  const raw = await import("./self-host-matrix-report.fenel?raw");
  const { loadFenelModule } = await import("../src/fenel-module");
  const { parseProvenanceCounts } = await import("../src/parse-cache");
  const { bootParseDeficits, fenelModuleLoadDepth } = await import("../src/engine-require");
  const reportSource = raw.default;
  if (typeof reportSource !== "string") {
    throw new TypeError("matrix report raw source did not load as text");
  }
  const loadDepthBefore = fenelModuleLoadDepth();
  const provenanceBefore = parseProvenanceCounts();
  const bootDeficitsBefore = bootParseDeficits().length;
  const reportModule = loadFenelModule(reportSource, "matrixreport");
  const provenanceAfter = parseProvenanceCounts();
  const provenanceDelta = Object.freeze({
    fenel: provenanceAfter.fenel - provenanceBefore.fenel,
    ts: provenanceAfter.ts - provenanceBefore.ts,
  });
  const bootDeficitDelta = bootParseDeficits().length - bootDeficitsBefore;
  if (
    loadDepthBefore !== 0
    || provenanceDelta.fenel !== 1
    || provenanceDelta.ts !== 0
    || bootDeficitDelta !== 0
  ) {
    throw new TypeError("matrix report did not use the proved default Fenel parser path");
  }
  return Object.freeze({
    source: reportSource,
    module: reportModule,
    evidence: Object.freeze({
      result: MATRIX_REPORT_SMOKE_RESULT,
      provenanceDelta: Object.freeze({ fenel: 1, ts: 0 }),
      bootDeficitDelta: 0,
      loadDepthBefore: 0,
    }),
  });
}

async function invokeFenelMatrixReportSmoke(loaded: LoadedReport): Promise<MatrixReportSmokeEvidence> {
  const { createRegistry } = await import("../src/registry");
  const { evaluate } = await import("../src/json-logic");
  const smokeModule = isolatedReportFunctionModule(
    loaded,
    "matrixreport:matrixReportSmoke",
  );
  const registry = createRegistry([smokeModule]);
  const result = evaluate(
    { call: ["matrixreport:matrixReportSmoke", "stage-0"] },
    {},
    registry.evaluateContext(),
  );
  if (result !== MATRIX_REPORT_SMOKE_RESULT) {
    throw new TypeError("matrix report smoke function returned an unexpected result");
  }
  return loaded.evidence;
}

/** Read one own data property without invoking an accessor. */
export function ownDataValue(record: object, key: string, context: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    throw new TypeError(`${context}.${key} must be an own data property`);
  }
  if (!("value" in descriptor)) {
    throw new TypeError(`${context}.${key} accessor properties are forbidden`);
  }
  if (typeof descriptor.value === "function") {
    throw new TypeError(`${context}.${key} callable values are forbidden`);
  }
  return descriptor.value;
}

function expectHostRecord(value: unknown, context: string): object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context} must be a record`);
  }
  return value;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function ownDenseArray(value: unknown, context: string): readonly unknown[] {
  if (!isUnknownArray(value)) throw new TypeError(`${context} must be a list`);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new TypeError(`${context}.length must be own safe unsigned data`);
  }
  const length = lengthDescriptor.value;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
      throw new TypeError(`${context} has an extra or symbol property`);
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= length) {
      throw new TypeError(`${context}.${key} is outside the dense list extent`);
    }
  }
  const out: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(`${context}[${index}] must be own dense data`);
    }
    if (typeof descriptor.value === "function") {
      throw new TypeError(`${context}[${index}] callable values are forbidden`);
    }
    out.push(descriptor.value);
  }
  return Object.freeze(out);
}

function ownRequiredString(record: object, key: string, context: string): string {
  const value = ownDataValue(record, key, context);
  if (typeof value !== "string") throw new TypeError(`${context}.${key} must be a string`);
  return value;
}

function ownStringList(value: unknown, context: string): readonly string[] {
  const values = ownDenseArray(value, context);
  const out: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (typeof item !== "string") throw new TypeError(`${context}[${index}] must be a string`);
    out.push(item);
  }
  return Object.freeze(out);
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Descriptor-safe mechanical projection of canonical instance facet payloads. */
export function projectMatrixInstanceFacets(
  modules: readonly unknown[],
): readonly MatrixInstanceFacetObservation[] {
  const moduleRecords = ownDenseArray(modules, "matrix modules");
  const out: MatrixInstanceFacetObservation[] = [];
  const categoryById = new Map<string, string>();
  const tagsById = new Map<string, readonly string[]>();
  for (let moduleIndex = 0; moduleIndex < moduleRecords.length; moduleIndex += 1) {
    const moduleContext = `matrix module[${moduleIndex}]`;
    const moduleRecord = expectHostRecord(moduleRecords[moduleIndex], moduleContext);
    const instancesDescriptor = Object.getOwnPropertyDescriptor(moduleRecord, "instances");
    if (instancesDescriptor === undefined) continue;
    if (!("value" in instancesDescriptor)) {
      throw new TypeError(`${moduleContext}.instances accessor properties are forbidden`);
    }
    if (instancesDescriptor.value === undefined) continue;
    const instances = ownDenseArray(instancesDescriptor.value, `${moduleContext}.instances`);
    for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex += 1) {
      const context = `${moduleContext}.instances[${instanceIndex}]`;
      const instance = expectHostRecord(instances[instanceIndex], context);
      if (Object.getOwnPropertyDescriptor(instance, "class") !== undefined) {
        throw new TypeError(`${context}.class is a forbidden legacy identity field`);
      }
      const typeName = ownRequiredString(instance, "typeName", context);
      if (typeName !== "Categorizable" && typeName !== "Taggable") continue;
      const args = ownDenseArray(ownDataValue(instance, "args", context), `${context}.args`);
      if (args.length !== 1 || typeof args[0] !== "string" || args[0].length === 0) {
        throw new TypeError(`${context}.args must contain exactly one non-empty string identity`);
      }
      const fnId = args[0];
      const methods = expectHostRecord(ownDataValue(instance, "methods", context), `${context}.methods`);
      if (typeName === "Categorizable") {
        const category = ownRequiredString(methods, "category", `${context}.methods`);
        const prior = categoryById.get(fnId);
        if (prior !== undefined && prior !== category) {
          throw new TypeError(`divergent Categorizable duplicate for ${fnId}`);
        }
        categoryById.set(fnId, category);
        out.push(Object.freeze({
          typeName,
          fnId,
          valueString: category,
          valueStrings: Object.freeze([]),
        }));
        continue;
      }
      const tags = ownStringList(
        ownDataValue(methods, "tags", `${context}.methods`),
        `${context}.methods.tags`,
      );
      const prior = tagsById.get(fnId);
      if (prior !== undefined && !equalStrings(prior, tags)) {
        throw new TypeError(`divergent Taggable duplicate for ${fnId}`);
      }
      tagsById.set(fnId, tags);
      out.push(Object.freeze({
        typeName,
        fnId,
        valueString: "",
        valueStrings: tags,
      }));
    }
  }
  return Object.freeze(out);
}

function projectBodyPresence(definition: unknown, context: string): Readonly<{ fnId: string; bodyPresent: boolean }> {
  const record = expectHostRecord(definition, context);
  const fnId = ownRequiredString(record, "id", context);
  if (fnId.length === 0) throw new TypeError(`${context}.id must be non-empty`);
  const bodyDescriptor = Object.getOwnPropertyDescriptor(record, "body");
  if (bodyDescriptor === undefined) return Object.freeze({ fnId, bodyPresent: false });
  if (!("value" in bodyDescriptor)) {
    throw new TypeError(`${context}.body accessor properties are forbidden`);
  }
  if (typeof bodyDescriptor.value === "function") {
    throw new TypeError(`${context}.body callable values are forbidden`);
  }
  return Object.freeze({ fnId, bodyPresent: bodyDescriptor.value !== undefined });
}

type AcquiredRoster = Readonly<{
  modules: readonly FenelModule[];
  byKey: ReadonlyMap<string, FenelModule>;
}>;

async function acquireFenelRoster(keys: readonly string[], progress: boolean): Promise<AcquiredRoster> {
  validateMatrixAcquisitionRoster(keys);
  const used = new Map<string, number>();
  const modules: FenelModule[] = [];
  const byKey = new Map<string, FenelModule>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const loader = MATRIX_ACQUISITION_LOADERS[key];
    if (loader === undefined) throw new TypeError(`missing matrix acquisition entry ${key}`);
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    if (count !== 1) throw new TypeError(`matrix acquisition entry ${key} was requested twice`);
    if (progress) console.error(`[matrix:progress] acquire ${index + 1}/${keys.length} ${key}`);
    const acquiredModule = await loader();
    modules.push(acquiredModule);
    byKey.set(key, acquiredModule);
  }
  for (const key of MATRIX_ACQUISITION_KEYS) {
    if (used.get(key) !== 1) throw new TypeError(`matrix acquisition entry ${key} was not used once`);
  }
  return Object.freeze({ modules: Object.freeze(modules), byKey });
}

function sampleCount(
  samples: Readonly<Record<string, ReadonlyArray<ReadonlyArray<unknown>>>>,
  fnId: string,
): number {
  return samples[fnId]?.length ?? 0;
}

function expectedGap(gaps: Readonly<Record<string, string>>, fnId: string): string | undefined {
  return gaps[fnId];
}

function targetProjection(
  samples: number,
  gap: string | undefined,
  result: ClassifierResult,
): MatrixTargetProjection {
  switch (result.status) {
    case "OK":
      return Object.freeze({
        samples,
        gapPresent: gap !== undefined,
        gap: gap ?? "",
        status: "OK",
        samplesCompared: result.samplesCompared,
        reason: "",
      });
    case "SKIP":
      return Object.freeze({
        samples,
        gapPresent: gap !== undefined,
        gap: gap ?? "",
        status: "SKIP",
        samplesCompared: 0,
        reason: result.reason,
      });
    case "FAIL":
      return Object.freeze({
        samples,
        gapPresent: gap !== undefined,
        gap: gap ?? "",
        status: "FAIL",
        samplesCompared: 0,
        reason: result.reason,
      });
    case "NO_SAMPLES":
      return Object.freeze({
        samples,
        gapPresent: gap !== undefined,
        gap: gap ?? "",
        status: "NO_SAMPLES",
        samplesCompared: 0,
        reason: "",
      });
  }
}

function progressStart(progress: boolean, target: string, index: number, total: number, fnId: string): void {
  if (progress) console.error(`[matrix:progress] ${target} START ${index + 1}/${total} ${fnId}`);
}

function progressComplete(
  progress: boolean,
  target: string,
  index: number,
  total: number,
  fnId: string,
  result: ClassifierResult,
  elapsedMs: number,
): void {
  if (progress) {
    console.error(
      `[matrix:progress] ${target} COMPLETE ${index + 1}/${total} ${fnId}`
        + ` ${Math.round(elapsedMs)}ms status=${result.status}`,
    );
  }
}

async function buildFunctionProjections(
  modules: readonly FenelModule[],
  progress: boolean,
): Promise<readonly MatrixFunctionProjection[]> {
  const {
    buildSelfHostCandidateIndex,
    classifyFnIdsOnce,
    classifyFnIdsOnceAsync,
    projectSelfHostRosterModule,
  } = await import("../src/self-host-classification-cache");
  const { withEngineDispatchEvaluationSnapshot } = await import("../src/engine-bodies-dispatch");
  const roster = buildSelfHostCandidateIndex<FenelFunction>(
    modules.map(projectSelfHostRosterModule),
  );
  const bodies = roster.definitions.map((definition, index) =>
    projectBodyPresence(definition, `matrix function[${index}]`)
  );
  const fnIds = bodies.map((row) => row.fnId);
  const [{ JS_EXPECTED_GAPS, WASM_EXPECTED_GAPS, LLVM_EXPECTED_GAPS }, js, wasm, llvm] =
    await Promise.all([
      import("@fenel/engine/self-host-samples"),
      import("../src/compile-js-self-host-classifier"),
      import("../src/compile-wasm-self-host-classifier"),
      import("../src/compile-llvm-self-host-classifier"),
    ]);
  const jsIds = fnIds.filter((fnId) => sampleCount(js.FN_SAMPLES, fnId) > 0);
  const wasmIds = fnIds.filter((fnId) => sampleCount(wasm.FN_SAMPLES, fnId) > 0);
  const llvmIds = fnIds.filter((fnId) => sampleCount(llvm.FN_SAMPLES, fnId) > 0);
  const progressOptions = (target: string) => progress
    ? {
        onProgress: (event: {
          phase: "start" | "complete";
          fnId: string;
          index: number;
          total: number;
          elapsedMs?: number;
          result?: ClassifierResult;
        }): void => {
          if (event.phase === "start") {
            progressStart(true, target, event.index, event.total, event.fnId);
          } else if (event.result !== undefined && event.elapsedMs !== undefined) {
            progressComplete(
              true,
              target,
              event.index,
              event.total,
              event.fnId,
              event.result,
              event.elapsedMs,
            );
          }
        },
      }
    : undefined;
  const jsResults = withEngineDispatchEvaluationSnapshot(() => {
    return classifyFnIdsOnce(jsIds, js.classifyFnId, progressOptions("js"));
  });
  const wasmResults = await classifyFnIdsOnceAsync(
    wasmIds,
    wasm.classifyFnId,
    progressOptions("wasm"),
  );
  const llvmResults = await classifyFnIdsOnceAsync(
    llvmIds,
    llvm.classifyFnId,
    progressOptions("llvm"),
  );
  return Object.freeze(bodies.map((body) => {
    const jsSamples = sampleCount(js.FN_SAMPLES, body.fnId);
    const wasmSamples = sampleCount(wasm.FN_SAMPLES, body.fnId);
    const llvmSamples = sampleCount(llvm.FN_SAMPLES, body.fnId);
    return Object.freeze({
      fnId: body.fnId,
      bodyPresent: body.bodyPresent,
      js: targetProjection(
        jsSamples,
        expectedGap(JS_EXPECTED_GAPS, body.fnId),
        jsResults.get(body.fnId) ?? { status: "NO_SAMPLES" },
      ),
      wasm: targetProjection(
        wasmSamples,
        expectedGap(WASM_EXPECTED_GAPS, body.fnId),
        wasmResults.get(body.fnId) ?? { status: "NO_SAMPLES" },
      ),
      llvm: targetProjection(
        llvmSamples,
        expectedGap(LLVM_EXPECTED_GAPS, body.fnId),
        llvmResults.get(body.fnId) ?? { status: "NO_SAMPLES" },
      ),
    });
  }));
}

function decodeStringArray(value: unknown, path: string): readonly string[] {
  const input = expectWireArray(value, path);
  const out = input.map((item, index) => expectWireString(item, `${path}[${index}]`));
  return Object.freeze(out);
}

type RawFacetRow = Readonly<{
  fnId: string;
  categoryPresent: boolean;
  category: string;
  tagsPresent: boolean;
  tags: readonly string[];
}>;

function decodeRawFacetRows(value: unknown): readonly RawFacetRow[] {
  const rows = expectWireArray(value, "matrixReport.rawRows");
  return Object.freeze(rows.map((item, index) => {
    const path = `matrixReport.rawRows[${index}]`;
    const record = expectWireRecord(item, path);
    expectClosedKeys(
      record,
      ["fnId", "categoryPresent", "category", "tagsPresent", "tags"],
      [],
      path,
    );
    const categoryPresent = expectWireBoolean(record.categoryPresent, `${path}.categoryPresent`);
    const category = expectWireString(record.category, `${path}.category`);
    const tagsPresent = expectWireBoolean(record.tagsPresent, `${path}.tagsPresent`);
    const tags = decodeStringArray(record.tags, `${path}.tags`);
    if (!categoryPresent && category.length !== 0) {
      throw new ArtifactWireContractError(path, "absent category must use an empty string");
    }
    if (!tagsPresent && tags.length !== 0) {
      throw new ArtifactWireContractError(path, "absent tags must use an empty list");
    }
    return Object.freeze({
      fnId: expectNonEmptyWireString(record.fnId, `${path}.fnId`),
      categoryPresent,
      category,
      tagsPresent,
      tags,
    });
  }));
}

type GroupingFact = Readonly<{ fnId: string; area: string }>;

type DeclaredObservedAsymmetry = Readonly<{
  fnId: string;
  target: "js" | "wasm" | "llvm";
  className: "stale-gap" | "silent-skip" | "escaped-fail";
  declared: string;
  observed: string;
}>;

function decodeDeclaredObservedAsymmetries(value: unknown): readonly DeclaredObservedAsymmetry[] {
  const entries = expectWireArray(value, "matrixReport.audit.declaredObservedAsymmetries");
  return Object.freeze(entries.map((item, index) => {
    const path = `matrixReport.audit.declaredObservedAsymmetries[${index}]`;
    const record = expectWireRecord(item, path);
    expectClosedKeys(record, ["fnId", "target", "className", "declared", "observed"], [], path);
    return Object.freeze({
      fnId: expectNonEmptyWireString(record.fnId, `${path}.fnId`),
      target: expectWireLiteral(record.target, ["js", "wasm", "llvm"] as const, `${path}.target`),
      className: expectWireLiteral(record.className, ["stale-gap", "silent-skip", "escaped-fail"] as const, `${path}.className`),
      declared: expectNonEmptyWireString(record.declared, `${path}.declared`),
      observed: expectNonEmptyWireString(record.observed, `${path}.observed`),
    });
  }));
}

function decodeGroupingFacts(value: unknown): readonly GroupingFact[] {
  const facts = expectWireArray(value, "matrixReport.audit.groupingFacts");
  return Object.freeze(facts.map((item, index) => {
    const path = `matrixReport.audit.groupingFacts[${index}]`;
    const record = expectWireRecord(item, path);
    expectClosedKeys(record, ["fnId", "area"], [], path);
    return Object.freeze({
      fnId: expectNonEmptyWireString(record.fnId, `${path}.fnId`),
      area: expectNonEmptyWireString(record.area, `${path}.area`),
    });
  }));
}

type FenelAuditCore = Readonly<{
  categoryCount: number;
  categoryPreimage: string;
  tagCount: number;
  tagPreimage: string;
  categorizableRepresentativeIds: readonly string[];
  taggableRepresentativeIds: readonly string[];
  rosterCount: number;
  rosterKeys: readonly string[];
  rowCount: number;
  declaredObservedAsymmetryCount: number;
  declaredObservedAsymmetries: readonly DeclaredObservedAsymmetry[];
  groupingFacts: readonly GroupingFact[];
  reportSourceDigest: string;
}>;

function decodeFenelAudit(value: unknown): FenelAuditCore {
  const record = expectWireRecord(value, "matrixReport.audit");
  expectClosedKeys(
    record,
    [
      "categoryCount",
      "categoryPreimage",
      "tagCount",
      "tagPreimage",
      "categorizableRepresentativeIds",
      "taggableRepresentativeIds",
      "rosterCount",
      "rosterKeys",
      "rowCount",
      "declaredObservedAsymmetryCount",
      "declaredObservedAsymmetries",
      "groupingFacts",
      "reportSourceDigest",
    ],
    [],
    "matrixReport.audit",
  );
  const declaredObservedAsymmetryCount = expectSafeUint(record.declaredObservedAsymmetryCount, "matrixReport.audit.declaredObservedAsymmetryCount");
  const declaredObservedAsymmetries = decodeDeclaredObservedAsymmetries(record.declaredObservedAsymmetries);
  if (declaredObservedAsymmetryCount !== declaredObservedAsymmetries.length) {
    throw new ArtifactWireContractError("matrixReport.audit.declaredObservedAsymmetryCount", "count differs from its source entries");
  }
  return Object.freeze({
    categoryCount: expectSafeUint(record.categoryCount, "matrixReport.audit.categoryCount"),
    categoryPreimage: expectWireString(
      record.categoryPreimage,
      "matrixReport.audit.categoryPreimage",
    ),
    tagCount: expectSafeUint(record.tagCount, "matrixReport.audit.tagCount"),
    tagPreimage: expectWireString(record.tagPreimage, "matrixReport.audit.tagPreimage"),
    categorizableRepresentativeIds: decodeStringArray(
      record.categorizableRepresentativeIds,
      "matrixReport.audit.categorizableRepresentativeIds",
    ),
    taggableRepresentativeIds: decodeStringArray(
      record.taggableRepresentativeIds,
      "matrixReport.audit.taggableRepresentativeIds",
    ),
    rosterCount: expectSafeUint(record.rosterCount, "matrixReport.audit.rosterCount"),
    rosterKeys: decodeStringArray(record.rosterKeys, "matrixReport.audit.rosterKeys"),
    rowCount: expectSafeUint(record.rowCount, "matrixReport.audit.rowCount"),
    declaredObservedAsymmetryCount,
    declaredObservedAsymmetries,
    groupingFacts: decodeGroupingFacts(record.groupingFacts),
    reportSourceDigest: expectSha256(
      record.reportSourceDigest,
      "matrixReport.audit.reportSourceDigest",
    ),
  });
}

type RenderArtifacts = Readonly<{
  candidate: string;
  rawFacets: Readonly<{
    schema: typeof MATRIX_REPORT_RAW_FACETS_SCHEMA;
    rows: readonly RawFacetRow[];
  }>;
  audit: Readonly<{
    schema: typeof MATRIX_REPORT_AUDIT_SCHEMA;
    categoryCount: number;
    categoryPreimage: string;
    categoryDigest: string;
    tagCount: number;
    tagPreimage: string;
    tagDigest: string;
    categorizableRepresentativeIds: readonly string[];
    taggableRepresentativeIds: readonly string[];
    rosterCount: number;
    rosterKeys: readonly string[];
    acquisitionKeys: readonly string[];
    rowCount: number;
    declaredObservedAsymmetryCount: number;
    declaredObservedAsymmetries: readonly DeclaredObservedAsymmetry[];
    groupingFacts: readonly GroupingFact[];
    reportSourceDigest: string;
  }>;
}>;

/** Decode the closed Fenel report result and mechanically hash its preimages. */
export function decodeMatrixReportResult(
  value: unknown,
  sourceDigest: string,
): RenderArtifacts {
  const record = expectWireRecord(value, "matrixReport");
  const ok = expectWireBoolean(record.ok, "matrixReport.ok");
  expectClosedKeys(
    record,
    ["ok", "error", "candidate", "rawRows", "audit"],
    [],
    "matrixReport",
  );
  const error = expectWireString(record.error, "matrixReport.error");
  if (!ok) {
    throw new TypeError(`Fenel matrix report rejected its input: ${error}`);
  }
  if (error !== "") {
    throw new ArtifactWireContractError(
      "matrixReport.error",
      "must be empty when matrixReport.ok is true",
    );
  }
  const candidate = expectWireString(record.candidate, "matrixReport.candidate");
  if (!candidate.endsWith("\n") || candidate.includes("\r")) {
    throw new ArtifactWireContractError(
      "matrixReport.candidate",
      "must be LF-only text with one or more bytes and a final LF",
    );
  }
  const rows = decodeRawFacetRows(record.rawRows);
  const core = decodeFenelAudit(record.audit);
  if (core.reportSourceDigest !== sourceDigest) {
    throw new ArtifactWireContractError(
      "matrixReport.audit.reportSourceDigest",
      "does not echo the captured report source digest",
    );
  }
  const categoryDigest = sha256Raw(new TextEncoder().encode(core.categoryPreimage));
  const tagDigest = sha256Raw(new TextEncoder().encode(core.tagPreimage));
  return Object.freeze({
    candidate,
    rawFacets: Object.freeze({ schema: MATRIX_REPORT_RAW_FACETS_SCHEMA, rows }),
    audit: Object.freeze({
      schema: MATRIX_REPORT_AUDIT_SCHEMA,
      categoryCount: core.categoryCount,
      categoryPreimage: core.categoryPreimage,
      categoryDigest,
      tagCount: core.tagCount,
      tagPreimage: core.tagPreimage,
      tagDigest,
      categorizableRepresentativeIds: core.categorizableRepresentativeIds,
      taggableRepresentativeIds: core.taggableRepresentativeIds,
      rosterCount: core.rosterCount,
      rosterKeys: core.rosterKeys,
      acquisitionKeys: MATRIX_ACQUISITION_KEYS,
      rowCount: core.rowCount,
      declaredObservedAsymmetryCount: core.declaredObservedAsymmetryCount,
      declaredObservedAsymmetries: core.declaredObservedAsymmetries,
      groupingFacts: core.groupingFacts,
      reportSourceDigest: core.reportSourceDigest,
    }),
  });
}

async function invokeFenelMatrixReport(
  request: MatrixRenderRequest,
  loaded: LoadedReport,
): Promise<RenderArtifacts> {
  const sourceDigest = sha256Raw(new TextEncoder().encode(loaded.source));
  if (sourceDigest !== request.reportSourceDigest) {
    throw new TypeError("captured matrix report source digest does not match its raw bytes");
  }
  const { createRegistry } = await import("../src/registry");
  const { evaluate } = await import("../src/json-logic");
  const rosterModule = isolatedReportFunctionModule(
    loaded,
    "matrixreport:matrixReportRoster",
  );
  const reportOnlyRegistry = createRegistry([rosterModule]);
  const rosterValue = evaluate(
    { call: ["matrixreport:matrixReportRoster", null] },
    {},
    reportOnlyRegistry.evaluateContext(),
  );
  const rosterKeys = ownStringList(rosterValue, "matrixReportRoster result");
  const acquired = await acquireFenelRoster(rosterKeys, request.progress);
  const instanceFacets = projectMatrixInstanceFacets(acquired.modules);
  const functions = await buildFunctionProjections(acquired.modules, request.progress);
  const stdModule = acquired.byKey.get("std");
  if (stdModule === undefined) throw new TypeError("Fenel roster did not acquire std");
  const reportRegistry = createRegistry([stdModule, loaded.module]);
  const result = evaluate(
    {
      call: [
        "matrixreport:matrixReport",
        {
          presentation: request.presentation,
          rosterKeys,
          functions,
          instanceFacets,
          reportSourceDigest: sourceDigest,
        },
      ],
    },
    {},
    reportRegistry.evaluateContext(),
  );
  return decodeMatrixReportResult(result, sourceDigest);
}

/** Execute one closed controller-issued worker task. */
export async function runMatrixWorker(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const requestPath = matrixWorkerRequestPath(argv);
  const authorization = readMatrixWorkerAuthorization(requestPath);
  const { readFileSync, writeFileSync } = require("node:fs");
  const requestBytes = new Uint8Array(readFileSync(requestPath));
  if (sha256Raw(requestBytes) !== authorization.requestDigest) {
    throw new TypeError("matrix worker request bytes do not match the preload authorization digest");
  }
  const request = decodeMatrixWorkerRequest(requestBytes);
  if (request.task !== authorization.task) {
    throw new TypeError("matrix worker request task does not match the preload authorization");
  }
  const loaded = await loadMatrixReport();
  if (request.task === "report-smoke") {
    const smoke = await invokeFenelMatrixReportSmoke(loaded);
    const outputPath = resolve(dirname(requestPath), request.outputs.smoke);
    writeFileSync(
      outputPath,
      encodeCanonicalJson({ schema: MATRIX_REPORT_SMOKE_SCHEMA, ...smoke }),
      { flag: "wx" },
    );
    return;
  }
  const rendered = await invokeFenelMatrixReport(request, loaded);
  const base = dirname(requestPath);
  writeFileSync(
    resolve(base, request.outputs.candidate),
    new TextEncoder().encode(rendered.candidate),
    { flag: "wx" },
  );
  writeFileSync(
    resolve(base, request.outputs.rawFacets),
    encodeCanonicalJson(rendered.rawFacets),
    { flag: "wx" },
  );
  writeFileSync(
    resolve(base, request.outputs.audit),
    encodeCanonicalJson(rendered.audit),
    { flag: "wx" },
  );
}

async function main(argv: readonly string[]): Promise<void> {
  await runMatrixWorker(argv);
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
