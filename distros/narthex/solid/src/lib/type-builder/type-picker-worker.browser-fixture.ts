// Explicit test-only transport port for the actual component capsule.
// The actual worker module remains in the bundle and owns every other reader.
import * as actual from "../expression-runner/authoring-catalog-worker";
export * from "../expression-runner/authoring-catalog-worker";
import { phonePickerVisualTransport } from "./type-picker-owner.browser-fixture";
import type { AuthoringSession } from "../expression-runner/account-authoring-session";

export function authoringWorkerSnapshot(session: AuthoringSession) {
  return phonePickerVisualTransport.owns(session) ? phonePickerVisualTransport.snapshot() : actual.authoringWorkerSnapshot(session);
}
export function authoringWorkerReplacementPending(session: AuthoringSession) {
  return phonePickerVisualTransport.owns(session) ? false : actual.authoringWorkerReplacementPending(session);
}
export function preparedReaderWorkerForSession(session: AuthoringSession) {
  return phonePickerVisualTransport.owns(session)
    ? phonePickerVisualTransport.snapshot() as actual.PreparedReaderWorker : actual.preparedReaderWorkerForSession(session);
}
export function runAuthoringWorker(...args: Parameters<typeof actual.runAuthoringWorker>): ReturnType<typeof actual.runAuthoringWorker> {
  return phonePickerVisualTransport.owns(args[0])
    ? phonePickerVisualTransport.request(args[1], args[2]) as ReturnType<typeof actual.runAuthoringWorker>
    : actual.runAuthoringWorker(...args);
}
