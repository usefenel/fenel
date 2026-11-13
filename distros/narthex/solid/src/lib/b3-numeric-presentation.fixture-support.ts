// Browser harness ports for the actual VariantValueRenderer. No rendering is
// reproduced here: only captured reader, reflection and numeric worker replies.
import { createContext, useContext } from "solid-js";

type NumericFixtureSession = {
  registry: object;
  evaluateContext: { fixtureContext: string };
  mode: "detached" | "module";
};
type NumericFixtureWorker = { caseId: string; context: string };
type NumericFixtureReader = {
  kind: "local";
  session: () => NumericFixtureSession;
  readerWorker: () => NumericFixtureWorker;
  valueState: (value: unknown) => unknown;
};
type NumericFixtureScope = { reader: NumericFixtureReader; authoring: NumericFixtureSession };
type NumericFixtureRequest = { caseId: string; context: string; method: string; value: unknown };

export const NumericFixtureContext = createContext<NumericFixtureScope>();
const workers = new WeakMap<NumericFixtureSession, NumericFixtureWorker>();
const requests: NumericFixtureRequest[] = [];
let pending = 0;
let recovered = false;

function scope() {
  const current = useContext(NumericFixtureContext);
  if (!current) throw new Error("The numeric fixture is missing its reader context.");
  return current;
}
export const useReaderRuntime = () => scope().reader;
export const useAuthoringSession = () => scope().authoring;

export function numericFixtureScope(caseId: string, context: "committed" | "draft" | "module" = "committed"): NumericFixtureScope {
  const registry = {};
  const base: NumericFixtureSession = { registry, evaluateContext: { fixtureContext: "committed" }, mode: "detached" };
  const committedWorker = { caseId, context: "committed" };
  workers.set(base, committedWorker);
  const authoring: NumericFixtureSession = context === "committed" ? base : {
    registry, evaluateContext: { fixtureContext: context }, mode: context === "module" ? "module" : "detached",
  };
  if (authoring !== base) workers.set(authoring, { caseId, context });
  return {
    authoring,
    reader: {
      kind: "local",
      session: () => base,
      readerWorker: () => committedWorker,
      valueState: value => ({ kind: "known", value: reflectionPacket(value) }),
    },
  };
}

export function preparedReaderWorkerForSession(session: NumericFixtureSession) {
  return workers.get(session);
}

const rational = (value: unknown) => value !== null && typeof value === "object"
  && (value as { $tag?: unknown }).$tag === "Rational";
function reflectionPacket(value: unknown) {
  // Inert fixture facts: no engine startup, inference or source execution.
  const valueType = rational(value) ? { $ref: "Rational" }
    : typeof value === "number" ? { $ref: "Number" }
    : typeof value === "string" ? { $ref: "String" } : undefined;
  return { root: { valueType, glyph: {} }, children: [] };
}

export async function runPreparedReaderWorker(worker: NumericFixtureWorker, payload: {
  method: string;
  value?: unknown;
  inputs?: readonly { value: unknown }[];
  codec?: { typeName: string };
}, signal?: AbortSignal) {
  if (!worker || !["committed", "draft", "module"].includes(worker.context))
    throw new Error("The numeric fixture received an unknown worker context.");
  const value = payload.method === "project-reader-values" ? payload.inputs?.[0]?.value : payload.value;
  requests.push({ ...worker, method: payload.method, value: structuredClone(value) });
  pending++;
  try {
    await Promise.resolve();
    signal?.throwIfAborted();
    if (payload.method === "project-reader-values") {
      if (payload.inputs?.length !== 1) throw new Error("Expected exactly one recursive value read.");
      return { valueReads: [reflectionPacket(value)] };
    }
    if (payload.method !== "encode-reader-numeric-text") throw new Error(`Unexpected numeric fixture method: ${payload.method}`);
    if (worker.caseId === "failed" && !recovered) throw new Error("Controlled numeric worker failure");
    if (payload.codec?.typeName === "Rational" && rational(value)) {
      // Identical data; the inherited frame's codec supplies a different text.
      return { encoded: { ok: true, value: worker.context === "committed" ? "1/2" : "2/3" } };
    }
    if (payload.codec?.typeName === "Number" && (value === 1 || value === 2))
      return { encoded: { ok: true, value: value === 1 ? "1" : "2" } };
    throw new Error("Unexpected numeric codec input in the controlled fixture.");
  } finally {
    pending--;
  }
}

export const nativeValueTypeName = (type: { $ref?: string }) =>
  ["Rational", "Number", "String"].includes(type.$ref ?? "") ? type.$ref : undefined;
export const resolveValueType = <T,>(type: T) => type;
export const peelListForAuthoring = () => undefined;
export const fieldNumericTextCodecPlan = (name: string) =>
  name === "Rational" || name === "Number" ? { decode: "fixture-decode", encode: "fixture-encode" } : undefined;
export const typeConstructorOf = () => { throw new Error("Local data attempted page-side reflection."); };
export const numericTextCodec = () => { throw new Error("Local data attempted a page-side numeric codec."); };
export const isVariantValue = (value: unknown) => value !== null && typeof value === "object"
  && typeof (value as { $tag?: unknown }).$tag === "string";
export const caseTag = (value: { $tag?: string }) => value.$tag;
export const structuralView = (type: { $ref?: string }) => type.$ref === "Rational" ? {
  cases: [{ name: "Rational", fields: [
    { name: "num", type: { $ref: "Number" }, isRecursive: false },
    { name: "den", type: { $ref: "Number" }, isRecursive: false },
  ] }],
} : undefined;

export const numericFixtureApi = {
  ready: true,
  requests: () => structuredClone(requests),
  succeed: () => { recovered = true; },
  state: () => ({ pending, requests: requests.length }),
};
