// ---------------------------------------------------------------------------
// AddToLocusButton — put this value in the data set you are in.
//
// This used to be "pin to home", and the concept was wrong. Pinning presumes
// your values are hidden and become visible by being pinned to a board. They
// are not: the locus IS the explorer of your data, so everything you have is
// already there, and Browse lists all of it. There is nothing to reveal.
//
// What is real is ADDING — putting a value in a list, which is what a data set
// is. Organising a thousand images into a shortlist of ten is not pinning ten
// of them; it is building a list that holds ten REFERENCES, and a reference is
// ordinary Fenel rather than a property of the UI. So this button keeps its
// mechanism (append an item to the list in scope) and loses the metaphor.
//
// Two modes, unchanged:
//   - `getExpr` only        → adds the value inline (frozen at add time)
//   - `getSavedExprId` set  → adds a REFERENCE; edits to the saved value reach
//                              every place that holds one
// When both are given, the reference wins — the caller may pass both so the
// inline form is a fallback.
// ---------------------------------------------------------------------------

import { Show, createSignal } from "solid-js";
import type { ExprNode } from "~/lib/expression-runner";
import { useApiClient } from "~/lib/api";
import { assertCurrentSession, sessionEpoch } from "~/lib/browser-session";

export function AddToLocusButton(props: {
  /** Returns the expression to add. Used when no savedExprId is present. */
  getExpr?: () => ExprNode;
  /** Returns the saved-value id to add by reference. */
  getSavedExprId?: () => string | null | undefined;
  /** Optional caption shown on the card's header. */
  getCaption?: () => string | undefined;
  /** Optional label override (defaults to "Add to locus"). */
  label?: string;
  /** Optional compact variant — smaller padding for dense rows. */
  compact?: boolean;
}) {
  const client = useApiClient();
  const [added, setAdded] = createSignal(false);

  async function onClick() {
    const epoch = client.epoch ?? sessionEpoch();
    const refId = props.getSavedExprId?.();
    const caption = props.getCaption?.() ?? undefined;
    const expr = typeof refId === "string" && refId.length > 0 ? undefined : props.getExpr?.();
    let ok = false;
    try {
      // A reusable value display must not load the entire home route/catalog
      // during editor initialization. Load the destination on activation.
      const { addToLocus } = await import("~/routes/app/home");
      assertCurrentSession(epoch);
      if (typeof refId === "string" && refId.length > 0) {
        ok = await addToLocus({ savedExprId: refId }, caption, undefined, client);
      } else if (expr) {
        ok = await addToLocus({ expr }, caption, undefined, client);
      }
    } catch (error) {
      console.error("Could not load the destination", error);
    }
    if (ok) {
      setAdded(true);
      setTimeout(() => setAdded(false), 1800);
    } else {
      // addToLocus swallows errors and returns false. Surface a hint so the
      // user sees something happened — open devtools for the underlying
      // exception (logged via console.error in addToLocus).
      alert("Could not add this data — check the browser console for details.");
    }
  }

  const cls = () => {
    const base = "btn-pin";
    return [base, added() ? "btn-pin--ok" : "", props.compact ? "btn-pin--compact" : ""].filter(Boolean).join(" ");
  };

  return (
    <button
      type="button"
      class={cls()}
      onClick={(e) => { e.stopPropagation(); void onClick(); }}
      data-tooltip="Add this to the data set you are in"
    >
      <Show when={added()} fallback={<span>{props.label ?? "Add to locus"}</span>}>
        <span>✓ Added</span>
      </Show>
    </button>
  );
}
