import { createContext, createSignal, untrack, useContext, type Accessor } from "solid-js";
import { assertCurrentSession, sessionEpoch } from "./browser-session";

/** Browser lifecycle coordinator; each existing source owns its data and CAS. */
export type LocusSynchronizationParticipant = {
  /** Existing pane queues stage into their source before any source saves. */
  stageBeforeSave?: boolean;
  pending: () => boolean;
  saving: () => boolean;
  error: () => string | undefined;
  save: (automaticResume?: boolean) => Promise<boolean>;
  discard: () => Promise<boolean>;
};

export type LocusSynchronization = {
  enabled: () => boolean;
  /** Host writes read the automatic gate before Solid's next microtask.
   * Save staging may close it temporarily without changing the switch choice. */
  enabledNow: () => boolean;
  /** Explicit switch choice, independent of temporary Save staging gates.
   * A failed resume records off; a new session carries only this preference. */
  enabledPreferenceNow: () => boolean;
  pending: () => number;
  saving: () => boolean;
  error: () => string | undefined;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  discardAll: () => Promise<boolean>;
  register: (key: string, participant: LocusSynchronizationParticipant) => () => void;
};

export const LocusSynchronizationContext = createContext<LocusSynchronization | Accessor<LocusSynchronization | null> | null>(null);
export const useLocusSynchronization = () => {
  const current = useContext(LocusSynchronizationContext);
  return (typeof current === "function" ? untrack(current) : current) ?? undefined;
};
let retained: { epoch: number; synchronization: LocusSynchronization } | undefined;
/** Lens, route and authentication changes retain this tab's switch choice.
 * Participants and in-flight operations remain owned by their exact epoch. */
export function locusSynchronizationForSession(epoch = sessionEpoch()): LocusSynchronization {
  if (retained?.epoch !== epoch) retained = { epoch,
    synchronization: createLocusSynchronization(epoch, retained?.synchronization.enabledPreferenceNow() ?? true) };
  return retained.synchronization;
}

export function createLocusSynchronization(epoch = sessionEpoch(), initialEnabled = true): LocusSynchronization {
  const participants = new Map<string, LocusSynchronizationParticipant>();
  const [revision, setRevision] = createSignal(0, { ownedWrite: true });
  const [enabled, setEnabled] = createSignal(initialEnabled, { ownedWrite: true });
  const [working, setWorking] = createSignal(false, { ownedWrite: true });
  const [failure, setFailure] = createSignal<string | undefined>(undefined, { ownedWrite: true });
  let preference = initialEnabled;
  let automatic = initialEnabled;
  let operation: Promise<boolean> | undefined;
  let operationKind: "save" | "discard" | undefined;
  let toggleGeneration = 0;
  const current = () => { revision(); return [...participants.values()]; };
  const pending = () => current().filter(participant => participant.pending()).length;
  const saving = () => working() || current().some(participant => participant.saving());
  const error = () => failure() ?? current().map(participant => participant.error()).find(Boolean);

  function run(kind: "save" | "discard", automaticResume = false, ticket = toggleGeneration): Promise<boolean> {
    if (operation) return operationKind === kind ? operation : Promise.resolve(false);
    try { assertCurrentSession(epoch); } catch { return Promise.resolve(false); }
    if (kind === "discard" && current().some(participant => participant.saving())) return Promise.resolve(false);
    setWorking(true);
    setFailure(undefined);
    const flight = Promise.resolve().then(async () => {
      try {
        // Existing pane queues can stage into a source after that source's
        // creation. Their virtual revision is valid before its first save.
        do {
          if (kind === "save") {
            const previousAutomatic = automatic;
            const previousGeneration = toggleGeneration;
            automatic = false;
            try {
              for (const participant of current().filter(participant => participant.stageBeforeSave)) {
                assertCurrentSession(epoch);
                if (automaticResume && ticket !== toggleGeneration) return true;
                if ((participant.pending() || participant.saving()) && !await participant.save(automaticResume)) return false;
              }
            } finally {
              if (!automaticResume && previousAutomatic && previousGeneration === toggleGeneration) automatic = true;
            }
            if (automaticResume) {
              if (ticket !== toggleGeneration) return true;
              automatic = true; setEnabled(true);
            }
          }
          for (const participant of current().filter(participant => kind !== "save" || !participant.stageBeforeSave)) {
            assertCurrentSession(epoch);
            if (automaticResume && (!automatic || ticket !== toggleGeneration)) return true;
            if (!participant.pending() && !participant.saving()) continue;
            if (!await (kind === "save" ? participant.save(automaticResume) : participant.discard())) return false;
          }
        } while (kind === "save" && (!automaticResume || automatic) && current().some(participant => participant.pending()));
        assertCurrentSession(epoch);
        return true;
      } catch (problem) {
        if (epoch === sessionEpoch()) setFailure(problem instanceof Error ? problem.message : String(problem));
        return false;
      } finally {
        if (operation === flight) { operation = undefined; operationKind = undefined; }
        if (epoch === sessionEpoch()) setWorking(false);
      }
    });
    operation = flight;
    operationKind = kind;
    return flight;
  }

  return {
    enabled, enabledNow: () => automatic, enabledPreferenceNow: () => preference, pending, saving, error,
    saveAll: () => run("save"), discardAll: () => run("discard"),
    async setEnabled(next) {
      try { assertCurrentSession(epoch); } catch { return false; }
      const ticket = ++toggleGeneration;
      preference = next;
      if (!next) { automatic = false; setEnabled(false); return true; }
      if (operation) await operation;
      if (ticket !== toggleGeneration || epoch !== sessionEpoch()) return false;
      const saved = await run("save", true, ticket);
      if (!saved && ticket === toggleGeneration && epoch === sessionEpoch()) { preference = false; automatic = false; setEnabled(false); }
      return saved;
    },
    register(key, participant) {
      participants.set(key, participant);
      setRevision(value => value + 1);
      return () => {
        if (participants.get(key) !== participant) return;
        participants.delete(key);
        setRevision(value => value + 1);
      };
    },
  };
}
