/** A public section's presentation (its description and mark) is carried in
 * the root's existing presentation table, keyed by the section's address: its
 * root item and field path. An address is never a repository identity. */
export function publicSectionTarget(itemId: string, path: readonly (string | number)[]): string {
  return `section:${JSON.stringify([itemId, ...path])}`;
}

/** A description shown under a name is its first sentence: the text up to the
 * first period followed by a space or the end. The full text stays in the data. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const end = /\.(?=\s|$)/.exec(trimmed);
  return end ? trimmed.slice(0, end.index + 1) : trimmed;
}
