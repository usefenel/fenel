// The whole value's actions beside its name in the lens summary (owner review,
// Nov 11): Save and Discard for a value with unsaved changes, and Edit in Local
// for a public example that offers a Local copy, in the same place and style,
// never together (a public datum is not dirty). Pure; the lens renders them.

export type DataChangesState = { readOnly: boolean; dirty: boolean; saving: boolean };

/** Save and Discard show for a writable value with unsaved or saving changes. */
export function dataChangesShown(state: DataChangesState | undefined): boolean {
  return !!state && !state.readOnly && (state.dirty || state.saving);
}

/** Edit in Local shows when the datum offers a Local copy and Save/Discard do not show. */
export function editInLocalShown(offered: boolean, state: DataChangesState | undefined): boolean {
  return offered && !dataChangesShown(state);
}
