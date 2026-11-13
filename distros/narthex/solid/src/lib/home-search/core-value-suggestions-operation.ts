import "@fenel/engine/engine-modules";
import { repositoryTypeIdentity } from "@fenel/engine/repository-identity-manifest";
import { buildValueCandidates, suggestValues, type ValueSuggestion } from "./value-suggestions";

// The existing parser and strict validator own every verdict. This worker has
// only repository scalar candidates, no account definitions or reader frame.
// They are system declarations: each identity is the type row of the owner
// `system` (rows are keyed by owner; the bare name is no lock key).
const typeIdentity = (name: string): string | undefined => repositoryTypeIdentity("system", name);
// Only exact repository identities cross into the account editor. Date has no
// such identity today; its existing full-reader choices keep their normal path.
const candidates = buildValueCandidates([]).filter((candidate) =>
  "$ref" in candidate.type && typeIdentity(candidate.type.$ref) !== undefined);

// Neutral candidate policy and owner-keyed output projection, moved intact.
// No registry, session, account, tag or authority is accepted here.
export function coreValueSuggestions(input: string): { input: string; suggestions: ValueSuggestion[] } {
  try {
    const suggestions = suggestValues(input, candidates).flatMap((suggestion) => {
      const handle = "$ref" in suggestion.type ? typeIdentity(suggestion.type.$ref) : undefined;
      // Unknown/no-ID choices are withheld at transport, never given an
      // unchecked name fallback that an account definition could replace.
      return handle ? [{ ...suggestion, type: { $ref: handle } }] : [];
    });
    return { input, suggestions };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Typed choices could not be checked.");
  }
}
