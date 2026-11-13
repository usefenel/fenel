import { invokeCallable } from "@fenel/engine";
import { Ref, refHandle } from "@fenel/engine/type-foundation";
import type { AuthoringSession } from "~/lib/expression-runner/authoring-session";
import type { NumberTextCodec, NumberTextResult } from "~/lib/number-input";
import type { ReaderNumericCodec } from "~/lib/expression-runner/authoring-worker-protocol";
import { fieldNumericTextCodecPlan } from "@fenel/engine/authoring/field-render";

/** Existing scoped invocation, shared by the synchronous browser backend and
 * the worker receiver. This function never routes another worker request. */
export function runNumericTextCodec(session: AuthoringSession, codec: ReaderNumericCodec,
  direction: "decode" | "encode", value: unknown): NumberTextResult<unknown> {
  try {
    const methods = "methods" in codec ? codec.methods : fieldNumericTextCodecPlan(codec.typeName, session.evaluateContext);
    if (!methods) return { ok: false, error: "This number's text representation is unavailable." };
    const method = methods[direction];
    const handle = refHandle(method);
    const fn = handle ? session.registry.getFunction(handle) : undefined;
    if (handle && !fn) return { ok: false, error: "This number's text representation is unavailable." };
    const callable = fn ? Ref(session.registry.getUuid(fn.id) ?? fn.id) : method;
    const result = invokeCallable(callable, [value], session.evaluateContext);
    if (result && typeof result === "object" && "$tag" in result && "_0" in result) {
      if (result.$tag === "Ok") return direction !== "encode" || typeof result._0 === "string"
        ? { ok: true, value: result._0 } : { ok: false, error: "This number's text representation could not be read." };
      if (result.$tag === "Err" && typeof result._0 === "string") return { ok: false, error: result._0 };
    }
    return { ok: false, error: "This number's text representation could not be read." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "This number's text representation could not be read." };
  }
}

/** Solid/browser invocation boundary. Numeric source functions own decoding,
 * validation and exact text; this adapter forwards their Result unchanged. */
type NumericCodecInput = ReaderNumericCodec | { decode: unknown; encode: unknown };
type SynchronousNumberTextCodec = {
  decode: (text: string, signal?: AbortSignal) => NumberTextResult<unknown>;
  encode: (value: unknown, signal?: AbortSignal) => NumberTextResult<string>;
};
export function numericTextCodec(session: AuthoringSession, codec: NumericCodecInput,
  options?: { remote?: false }): SynchronousNumberTextCodec;
export function numericTextCodec(session: AuthoringSession, codec: NumericCodecInput,
  options: { remote?: boolean }): NumberTextCodec;
export function numericTextCodec(session: AuthoringSession, supplied: NumericCodecInput,
  options: { remote?: boolean } = {}): NumberTextCodec {
  const codec: ReaderNumericCodec = "decode" in supplied ? { methods: supplied } : supplied;
  // The Local adapter captures this exact session/handle once. Replacement
  // requires a new adapter; a missing or retired service never runs semantics
  // on the page. Other backends retain their synchronous invocation path.
  const prepared = options.remote ? import("./expression-runner/authoring-catalog-worker").then(workers => {
    const worker = workers.preparedReaderWorkerForSession(session);
    if (!worker) throw new Error("This number's editing tools are not ready.");
    return { binding: { workers, worker } };
  }).catch(error => ({ error })) : undefined;
  const invoke = (direction: "decode" | "encode", value: unknown, signal?: AbortSignal) => {
    if (!prepared) return runNumericTextCodec(session, codec, direction, value);
    return prepared.then(async selected => {
      if ("error" in selected) throw selected.error;
      const { workers, worker } = selected.binding;
      signal?.throwIfAborted();
      if (workers.preparedReaderWorkerForSession(session) !== worker)
        throw new Error("This number's reader was replaced. Try again.");
      const result = await workers.runPreparedReaderWorker(worker,
        { method: direction === "decode" ? "decode-reader-numeric-text" : "encode-reader-numeric-text", codec, value }, signal);
      signal?.throwIfAborted();
      if (workers.preparedReaderWorkerForSession(session) !== worker)
        throw new Error("This number's reader was replaced. Try again.");
      const key = direction === "decode" ? "decoded" : "encoded";
      if (!result || typeof result !== "object" || Array.isArray(result) || !Object.hasOwn(result, key))
        throw new Error("This number's text representation could not be read.");
      const answer = (result as Record<string, unknown>)[key] as NumberTextResult<unknown> | undefined;
      if (!answer || typeof answer !== "object" || typeof answer.ok !== "boolean"
        || (answer.ok ? !Object.hasOwn(answer, "value") || direction === "encode" && typeof answer.value !== "string"
          : typeof answer.error !== "string"))
        throw new Error("This number's text representation could not be read.");
      return answer;
    });
  };
  return {
    decode: (text, signal) => invoke("decode", text, signal),
    encode: (value, signal) => invoke("encode", value, signal) as NumberTextResult<string> | Promise<NumberTextResult<string>>,
  };
}
