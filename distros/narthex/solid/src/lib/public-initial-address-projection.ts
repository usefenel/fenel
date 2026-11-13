// Build tool and tests only; the page never loads this module.
//
// The checked public root's own addresses, exactly as the existing resolver
// (locus-address.ts) answers them with the Fenel address owner supplied by the
// caller. Nothing is matched here: each row is one `resolveLocusAddress`
// answer for a name the root itself shows, kept only when it names that very
// member. Identity (`_id`) and position spellings are never proposed, so an
// address spelled that way keeps the reader's own resolution.
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { LocusRootData } from "./locus-root-data";
import type { LocusScope } from "./locus-scope";
import { locusAddressMembers, resolveLocusAddress, type LocusAddressOperate } from "./locus-address";
import { admittedPublicInitialFocus, type PublicInitialAddress } from "./public-initial-addresses";

/** `/demo/<group>/<section>/<member>` is the deepest page the shell draws from
 * authored sections today. */
export const PUBLIC_INITIAL_ADDRESS_DEPTH = 4;
/** A larger namespace (the standard library's members) keeps its reader: the
 * owner is asked once per name, over every sibling. */
export const PUBLIC_INITIAL_ADDRESS_LEVEL_LIMIT = 256;

type Field = { name: string; value: ExprNode };

/** Read a focus as the shell does (home-entry `previewForScope`): the root
 * item's own authored expression, then one explicit record field per step. */
function authoredRecord(root: LocusRootData, focus: LocusScope): readonly Field[] | undefined {
  if (focus.kind !== "value" || focus.rootItem !== true || focus.viewId !== root.id) return undefined;
  const fields = (node: ExprNode | undefined): readonly Field[] | undefined => {
    if (node?.kind !== "literal" || !node.value || typeof node.value !== "object") return undefined;
    const record = (node.value as { __record?: { fields?: unknown } }).__record;
    return record && Array.isArray(record.fields) ? record.fields as Field[] : undefined;
  };
  const item = root.items.find(entry => entry.id === focus.itemId);
  let node: ExprNode | undefined = item?.source?.kind === "expr" ? item.source.expr : undefined;
  for (const step of focus.path) node = typeof step === "string" ? fields(node)?.find(field => field.name === step)?.value : undefined;
  return fields(node);
}

export async function projectPublicInitialAddresses(root: LocusRootData, operate: LocusAddressOperate,
  limits: { depth: number; level: number } = { depth: PUBLIC_INITIAL_ADDRESS_DEPTH, level: PUBLIC_INITIAL_ADDRESS_LEVEL_LIMIT },
): Promise<{ entries: PublicInitialAddress[]; skipped: string[][] }> {
  const entries: PublicInitialAddress[] = [], skipped: string[][] = [];
  const visit = async (focus: LocusScope, prefix: readonly string[]): Promise<void> => {
    const { members, needsValue } = locusAddressMembers(root, focus);
    if (needsValue) return;
    if (members.length > limits.level) { skipped.push([...prefix]); return; }
    for (const member of members) {
      for (const name of new Set([member.name, ...member.aliases])) {
        if (name === "") continue;
        const segments = [...prefix, name];
        const resolved = await resolveLocusAddress(root, segments, operate);
        // Keep only the owner's own answer for this very member, at a place the page admits.
        if (resolved.missing !== undefined || resolved.needsValue
          || JSON.stringify(resolved.focus) !== JSON.stringify(member.focus)
          || !admittedPublicInitialFocus(root, segments, resolved.focus)) continue;
        entries.push({ segments, focus: resolved.focus });
        // Deeper addresses continue under the canonical spelling alone, and
        // only through an authored record: its field names are source text.
        if (name === member.name && resolved.segments.at(-1) === name && segments.length < limits.depth
          && authoredRecord(root, member.focus)) await visit(member.focus, segments);
      }
    }
  };
  await visit({ kind: "root" }, []);
  return { entries, skipped };
}
