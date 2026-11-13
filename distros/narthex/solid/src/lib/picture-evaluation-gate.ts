let waitForEarlierCards: () => Promise<void> = () => Promise.resolve();

/** Picture renders wait here so photo cards posted in the same turn start first. */
export function beforePictureEvaluation(): Promise<void> {
  return waitForEarlierCards();
}

export function holdPictureEvaluations(wait: () => Promise<void>): void {
  waitForEarlierCards = wait;
}
