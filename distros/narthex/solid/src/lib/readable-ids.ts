// Messages from the type checker name a type by its public name, which for a
// type created in this data is its identity (a UUID): "String is not
// f582abdc-…" (polish lane 2, Nov 9, rehearsal 015-t3-02). Shown text names
// each identity by the reader's own label for it; an identity the reader
// cannot name stays as it is (never a guessed name).

const IDENTITY = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Whether a whole name is an identity (a UUID): never shown as a heading. */
export function isIdentityText(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text.trim());
}

export function readableIdentities(message: string, labelOf: (id: string) => string | undefined): string {
  return message.replace(IDENTITY, (id) => {
    let label: string | undefined;
    try { label = labelOf(id)?.trim(); } catch { label = undefined; }
    return label || id;
  });
}
