// C1/C2: control worker transport around the production card result owner.
// This fixture performs no evaluation; the actual-session test checks results.
export const jobs: Array<{ session: any; node: any; resolve(value: unknown): void; reject(error: unknown): void }> = [];
export const concreteAuthoringSession = (session: unknown) => session;
export const authoringSessionAccountScope = () => undefined;
export const authoringWorkerSnapshot = (session: any) => session.worker;
export function evaluateExpressionInWorker(session: unknown, node: unknown) {
  return new Promise((resolve, reject) => { jobs.push({ session, node, resolve, reject }); });
}
export function evaluateAuthoringExpressionInSession(): never { throw new Error("The controlled reader must use its worker."); }
export const evaluateImagePipeline = () => undefined;
export const readImagePipelinePreview = () => undefined;
export const beforePictureEvaluation = () => Promise.resolve();
export function collectReferencedSavedExpressions(node: unknown): string[] {
  // These unchanged three source examples contain no saved references. Keep
  // the production expression-key function; reject a fixture that widens this.
  if (JSON.stringify(node).includes('"savedExprId"')) throw new Error("Use the real reference codec for a reference scenario.");
  return [];
}
