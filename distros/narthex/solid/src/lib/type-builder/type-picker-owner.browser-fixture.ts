// One controlled owner for the matched actual-component visual capsules.
// This is test IO data, not a normal Local reader or semantic acceptance.
// PhoneStr's name/handle/declaration are retained source/C2 observations.
// All non-Phone reads use the existing thin registry; no membership,
// inference, Save, or new alias verdict is supplied by this fixture.
import { createRegistry } from "@fenel/engine/registry";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { Str, Bool, Rational } from "@fenel/engine/type-foundation";
import type { FenelType } from "@fenel/engine/types";
import { concreteAuthoringSession, inertAuthoringSession, publishAuthoringEnvironment, type AuthoringSession } from "../expression-runner/account-authoring-session";
import { projectReaderReferences } from "../expression-runner/authoring-worker-reader-extensions";
import { LOCAL_ACTION_TOOLS_PENDING } from "../expression-runner/local-reader-actions";
import { createDetachedAuthoringEnvironment } from "../expression-runner/detached-authoring-environment";
import type { ReaderRuntime } from "../reader-runtime";
import { readerTypePresentationInSession } from "../reader-presentation";

const phoneId = "PhoneStr";
export const phonePickerVisualHandle = "f582abdc-9959-43fd-be5a-10049b855d8c";
const phoneType: FenelType = { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:phone" } } };
export const phonePickerVisualRow = { id: "entity:PhoneStr", name: "Phone", description: "String constrained to a valid phone number (format:phone)",
  category: "entity", entityId: phoneId, type: phoneType };
const types = Object.entries({ String: Str, Boolean: Bool, Number: Rational })
  .map(([name, type]) => ({ id: name, name, type, description: "", category: "fixture" }));
const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({
  types: [...types, phonePickerVisualRow], capabilities: [], catalogTypes: [...types.map(entry => entry.type), phoneType],
  functions: [], operatorCodeNameByNotation: new Map(),
}));
const phoneEntity = { id: phoneId, module: "system", type: phoneType };
const phoneOwner = { identity: phonePickerVisualHandle, type: phoneType };
const isPhone = (target: string) => target === phoneId || target === phonePickerVisualHandle;
let base: ModuleRegistry | undefined;
const baseRegistry = () => base ??= createRegistry([]);
const registry = new Proxy({} as ModuleRegistry, { get(_target, key) {
  if (key === "getIdentifiedEntity") return (target: string) => isPhone(target) ? phoneEntity : baseRegistry().getIdentifiedEntity(target);
  if (key === "getEntityNominalIdentity") return (target: string) => isPhone(target) ? '["system","PhoneStr"]' : baseRegistry().getEntityNominalIdentity(target);
  if (key === "getIdentifiedFunction") return (target: string) => isPhone(target) ? undefined : baseRegistry().getIdentifiedFunction(target);
  if (key === "getUuid") return (target: string) => isPhone(target) ? phonePickerVisualHandle : baseRegistry().getUuid(target);
  const value = Reflect.get(baseRegistry(), key);
  return typeof value === "function" ? value.bind(baseRegistry()) : value;
} });
let originalFrame: AuthoringSession["evaluateContext"] | undefined;
const frame = () => originalFrame ??= baseRegistry().evaluateContext();
const evaluateContext = new Proxy({} as AuthoringSession["evaluateContext"], { get(_target, key) {
  if (key === "getFunction") return (target: string) => isPhone(target) ? undefined : frame().getFunction?.(target);
  if (key === "_typeFamilyOwner") return (target: string) => isPhone(target) ? phoneOwner : frame()._typeFamilyOwner?.(target);
  const value = Reflect.get(frame(), key);
  return typeof value === "function" ? value.bind(frame()) : value;
} });
export const phonePickerVisualSession: AuthoringSession = {
  mode: "detached", catalog: environment.catalog, environment, registry, evaluateContext,
};
export const phonePickerVisualReader = { kind: "public", epoch: 0, revision: () => 0,
  session: () => phonePickerVisualSession, registry: () => registry,
  presentation: (target: string) => isPhone(target) ? { label: phonePickerVisualRow.name, codeName: phoneId } : undefined,
  representation: (name: string, target: string) => isPhone(target)
    ? name === "Labelable" ? { label: phonePickerVisualRow.name } : name === "Codeable" ? { codeName: phoneId } : undefined : undefined,
  typePresentation: (type: FenelType) => readerTypePresentationInSession(type, phonePickerVisualSession, phonePickerVisualReader),
} as unknown as ReaderRuntime;

// Only the isolated build plugin routes this fixture's Local worker IO here.
// Completion calls the existing projection over the visual session above;
// no type/owner verdict is recomputed in a test shim. All other readers keep
// the actual worker module. There is no hook in a product file.
export const phonePickerVisualLocalSession = inertAuthoringSession({
  mode: "detached", catalog: environment.catalog, environment, registry,
});
publishAuthoringEnvironment(phonePickerVisualLocalSession, environment);
type HeldRequest = { targets: readonly string[]; definitions?: true; signal?: AbortSignal;
  resolve: (value: unknown) => void; reject: (error: Error) => void };
let transportMode: "ready" | "hold" | "refuse" = "ready";
let workerSnapshot: object = {};
let revision = 0;
let requests = 0;
let held: HeldRequest[] = [];
function finish(request: HeldRequest) {
  if (request.signal?.aborted) { request.reject(new DOMException("Aborted", "AbortError")); return; }
  if (transportMode === "refuse") { request.reject(new Error(LOCAL_ACTION_TOOLS_PENDING)); return; }
  try { request.resolve(projectReaderReferences(request.targets, phonePickerVisualSession, request.definitions === true)); }
  catch (error) { request.reject(error instanceof Error ? error : new Error(String(error))); }
}
export const phonePickerVisualTransport = {
  owns: (session: AuthoringSession) => concreteAuthoringSession(session) === phonePickerVisualLocalSession,
  snapshot: () => workerSnapshot,
  reset(mode: "ready" | "hold" | "refuse") {
    for (const request of held) request.reject(new DOMException("Retired fixture", "AbortError"));
    held = []; revision++; requests = 0; workerSnapshot = {}; transportMode = mode;
  },
  mode(mode: "ready" | "hold" | "refuse") { transportMode = mode; },
  release() { const pending = held; held = []; for (const request of pending) finish(request); },
  state: () => ({ requests, held: held.length, mode: transportMode }),
  request(payload: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!payload || typeof payload !== "object" || !("method" in payload) || payload.method !== "project-reader-references"
      || !("targets" in payload) || !Array.isArray(payload.targets)) {
      return Promise.reject(new Error("This visual fixture supplies only reader-reference IO, not semantic operations."));
    }
    requests++;
    return new Promise((resolve, reject) => {
      const request: HeldRequest = { targets: payload.targets as readonly string[], signal, resolve, reject,
        ...("definitions" in payload && payload.definitions === true ? { definitions: true } : {}) };
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      if (transportMode === "hold") held.push(request); else finish(request);
    });
  },
};
export const phonePickerVisualLocalReader = { ...phonePickerVisualReader, kind: "local",
  revision: () => revision, session: () => phonePickerVisualLocalSession,
} as ReaderRuntime;
