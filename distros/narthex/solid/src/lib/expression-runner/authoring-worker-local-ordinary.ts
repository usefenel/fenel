// Existing A2/B3 host transport: one captured ordinary-data operation, using
// the caller's physical worker. No worker, registry or reader is acquired here.
import { captureRegistryTransportRoundTrip } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import { assertLocalOrdinaryOperation, type LocalOrdinaryOperation, type LocalOrdinaryResult } from "../local-ordinary-operations";
import { requestAuthoringTransport, type AuthoringWorkerTransport } from "./authoring-worker-transport";

export type PreparedLocalOrdinaryResult<T> =
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "prepared"; readonly value: T; assertCurrent(): void; release(): void };

function readPairedReply(reply: unknown): { operation: unknown; value: unknown } {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)
    || Reflect.ownKeys(reply).length !== 1 || !Object.hasOwn(reply, "localOrdinary"))
    throw new Error("The Local ordinary response could not be read.");
  const pair = (reply as { localOrdinary: unknown }).localOrdinary;
  if (!pair || typeof pair !== "object" || Array.isArray(pair)
    || Reflect.ownKeys(pair).length !== 2 || !Object.hasOwn(pair, "operation") || !Object.hasOwn(pair, "value"))
    throw new Error("The Local ordinary response has no paired request and result.");
  return pair as { operation: unknown; value: unknown };
}

/** Only unsupported INITIAL carriers may use an existing page compatibility
 * path. A posted operation's failure is a refusal, never permission to replay.
 *
 * `assertCurrent` must check the caller's epoch, source and captured reader/data
 * identities. Call the returned guard again after any awaited reader preparation,
 * immediately before synchronous publication, then release in `finally`.
 * The graph proof preserves references; it never establishes reader authority. */
export async function prepareAuthoringLocalOperation<O extends LocalOrdinaryOperation>(
  transport: AuthoringWorkerTransport, operation: O,
  options: { assertCurrent(): void; signal?: AbortSignal },
): Promise<PreparedLocalOrdinaryResult<LocalOrdinaryResult<O>>> {
  options.signal?.throwIfAborted();
  options.assertCurrent();
  assertLocalOrdinaryOperation(operation);
  const captured = captureRegistryTransportRoundTrip(operation, "Local ordinary operation");
  if (captured.kind === "unsupported") return captured;
  const assertCurrent = () => {
    options.signal?.throwIfAborted();
    options.assertCurrent();
    captured.assertCurrent();
  };
  try {
    assertCurrent();
    const reply = await requestAuthoringTransport(transport,
      { method: "run-local-ordinary", operation: captured.wire }, options.signal);
    assertCurrent();
    const pair = readPairedReply(reply);
    const value = captured.reattach(pair.operation, pair.value) as LocalOrdinaryResult<O>;
    assertCurrent();
    return { kind: "prepared", value, assertCurrent, release: captured.release };
  } catch (error) {
    captured.release();
    throw error;
  }
}
