// ---------------------------------------------------------------------------
// The field's publish gate (launch night, Nov 13): what a person typed into a
// field is what its draft holds. A field publishes through the binding of the
// plan it was typed under. That binding may be superseded (a newer plan input
// of the SAME field) or not ready (its plan re-preparing in the reader's
// worker) by the time an asynchronous control (a number's worker codec)
// answers. Such a value is never thrown away: it goes to the newest binding of
// the same field and owner, at once when that binding can publish, otherwise
// it is held and delivered when it can. Only one value is held (the latest
// wins), and a direct publication discards an older held value, so nothing is
// published out of order. A value whose field or owner (session, registry,
// worker) differs from the newest binding's is dropped, as before.
// Pure: the caller supplies the bindings' facts.
// ---------------------------------------------------------------------------

export type FieldPublishGateDeps<B> = {
  /** The newest binding of this field renderer, if any. */
  current: () => B | undefined;
  /** This binding is the current plan input and that plan is ready. */
  canPublish: (binding: B) => boolean;
  /** Two bindings belong to the same field occurrence and the same owner. */
  sameField: (left: B, right: B) => boolean;
  publish: (binding: B, value: unknown) => void;
};

export type FieldPublishOutcome = "published" | "held" | "dropped";

export function createFieldPublishGate<B>(deps: FieldPublishGateDeps<B>) {
  let held: { binding: B; value: unknown } | undefined;
  const target = (from: B): B | undefined => {
    const newest = deps.current();
    return newest !== undefined && (newest === from || deps.sameField(from, newest)) ? newest : undefined;
  };
  return {
    /** `mayHold`: the value was typed into an editor shown for this field;
     * a value sent before any editor was shown is not held. */
    send(from: B, value: unknown, mayHold = true): FieldPublishOutcome {
      const to = target(from);
      if (to === undefined) return "dropped";
      if (deps.canPublish(to)) { held = undefined; deps.publish(to, value); return "published"; }
      if (!mayHold) return "dropped";
      held = { binding: from, value };
      return "held";
    },
    /** Deliver a held value once the newest binding of its field can publish. */
    flush(): "empty" | "waiting" | FieldPublishOutcome {
      if (!held) return "empty";
      const to = target(held.binding);
      if (to === undefined) { held = undefined; return "dropped"; }
      if (!deps.canPublish(to)) return "waiting";
      const { value } = held;
      held = undefined;
      deps.publish(to, value);
      return "published";
    },
    /** A value is waiting for its field's plan. */
    holding: (): boolean => held !== undefined,
  };
}
