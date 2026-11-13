import { getIOAction, isSubtype, peelMaybe, peelResult, validate } from "@fenel/engine";
import { dispatchEngineBody, marshalTraversalType } from "@fenel/engine/engine-bodies-dispatch";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelType } from "@fenel/engine/types";

export class IOStopContractError extends Error {}

/** The Stop view supports a single deployment handle and the standard typed
 * Result / Maybe-error completion contracts. IOInvokable chooses the callable;
 * its declaration owns parameter names and types, never the Run declaration. */
export function prepareIOStop(
  registry: ModuleRegistry,
  runFnId: string,
  action: string,
  args: unknown[],
) {
  const run = registry.getFunction(runFnId);
  if (!run) throw new IOStopContractError(`Function not found: ${runFnId}`);
  const candidates = registry.listFunctions().filter((fn) => getIOAction(fn.id) === action);
  if (candidates.length !== 1) {
    throw new IOStopContractError(`Stop action ${action} must identify exactly one declared IO function.`);
  }
  const stop = candidates[0]!;
  if (stop.params.length !== 1 || args.length !== 1) {
    throw new IOStopContractError(`Stop function ${stop.id} requires a supported single-handle contract.`);
  }
  const resolve = (ref: { $ref: string }): FenelType => registry.getEntity(ref.$ref)?.type ?? { $void: true };
  // rights R3a — an EXPLICIT `null`. This is a STRUCTURAL contract check over a
  // declared stop function's signature (does the outcome inhabit the declared
  // Result/Maybe shape), not a validation of account data, and this boundary
  // holds no account handle. Global named sets only, declared (§8.1a).
  const valid = (type: FenelType, value: unknown) => validate(type, value, null, {
    registry, coerce: false, strict: { rejectOmitted: true, rejectAdded: true, primitiveTypes: true },
  }).valid;

  // Check the outcome contract before executing an effect. Guessing that an
  // arbitrary return value means success can lose the only retry handle.
  const result = peelResult(stop.returns, resolve);
  const maybeError = peelMaybe(stop.returns, resolve);
  if (!result && (!maybeError || !isSubtype(maybeError.value, { $ref: "String" }))) {
    throw new IOStopContractError(`Stop function ${stop.id} must return Result or Maybe String.`);
  }
  // Result/Maybe shape recognition does not establish that the current
  // validator implements every payload type (Unit, for example, is outside
  // its supported fragment). Ask the existing Fenel readiness authority
  // before an effect can run; do not substitute best-effort shape matching.
  // This gate is conservative for nominal payload aliases. It governs only
  // completion payloads, not deployment-handle parameter adaptation below.
  const payloadTypes = result ? [result.err, result.ok] : [maybeError!.value];
  if (payloadTypes.some((type) => dispatchEngineBody(
    "engine:ttValidationPlanReady", [marshalTraversalType(type)],
  ) !== true)) {
    throw new IOStopContractError(`Stop function ${stop.id} has a result payload type that this view cannot validate.`);
  }

  const previous = args[0];
  if (!valid(run.returns, previous)) {
    throw new IOStopContractError("The retained run result does not match its declared type.");
  }
  const runResult = peelResult(run.returns, resolve);
  const tagged = previous as { $tag?: string; _0?: unknown } | null;
  if (runResult && tagged?.$tag === "Err") {
    throw new IOStopContractError(`The run failed: ${describeError(tagged._0)}`);
  }
  const param = stop.params[0]!;
  let handle = previous;
  if (!valid(param.type, handle)) {
    if (!runResult || tagged?.$tag !== "Ok" || !valid(param.type, tagged._0)) {
      throw new IOStopContractError(`The run result cannot supply Stop parameter ${param.name}.`);
    }
    handle = tagged._0;
  }

  return {
    params: { [param.name]: handle },
    complete(value: unknown): { stopped: boolean; error?: string } {
      if (!valid(stop.returns, value)) {
        return { stopped: false, error: "Stop returned a value outside its declared type." };
      }
      const outcome = value as { $tag?: string; _0?: unknown };
      if (result) {
        return outcome.$tag === "Ok"
          ? { stopped: true }
          : { stopped: false, error: describeError(outcome._0) };
      }
      // This interpretation belongs only to the Stop lifecycle view. Ordinary
      // Maybe/Result-valued calls keep their complete typed display unchanged.
      if (outcome.$tag === "Nothing") return { stopped: true };
      if (typeof outcome._0 !== "string") {
        return { stopped: false, error: "Stop's Maybe error payload must be a String." };
      }
      return { stopped: false, error: outcome._0 || "Stop failed." };
    },
  };
}

function describeError(value: unknown): string {
  return typeof value === "string" ? value || "Stop failed." : JSON.stringify(value) ?? "Stop failed.";
}
