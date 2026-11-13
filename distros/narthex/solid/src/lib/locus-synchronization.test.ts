import { describe, expect, test } from "bun:test";
import { flush } from "solid-js";
import { createLocusSynchronization, locusSynchronizationForSession, type LocusSynchronizationParticipant } from "./locus-synchronization";
import { expireBrowserSession, sessionEpoch } from "./browser-session";

function participant(label: string, calls: string[]): LocusSynchronizationParticipant & { fail: boolean; dirty: boolean } {
  const source = {
    dirty: true, fail: false,
    pending: () => source.dirty,
    saving: () => false,
    error: () => source.fail ? `${label} could not save` : undefined,
    async save() { calls.push(`save:${label}`); if (source.fail) return false; source.dirty = false; return true; },
    async discard() { calls.push(`discard:${label}`); source.dirty = false; return true; },
  };
  return source;
}

describe("one tab synchronization switch", () => {
  test("a fresh document starts with synchronization on and an explicit off seed stays off", () => {
    const fresh = createLocusSynchronization();
    expect(fresh.enabled()).toBe(true);
    expect(fresh.enabledNow()).toBe(true);
    expect(fresh.enabledPreferenceNow()).toBe(true);
    const paused = createLocusSynchronization(sessionEpoch(), false);
    expect(paused.enabled()).toBe(false);
    expect(paused.enabledNow()).toBe(false);
    expect(paused.enabledPreferenceNow()).toBe(false);
  });

  test("pausing issues no writes and resuming saves data and lens preferences together", async () => {
    const synchronization = createLocusSynchronization();
    const calls: string[] = [];
    synchronization.register("account:a", participant("data", calls));
    synchronization.register("preferences:a", participant("lenses", calls));
    const paused = synchronization.setEnabled(false);
    expect(synchronization.enabledNow()).toBe(false);
    expect(synchronization.enabledPreferenceNow()).toBe(false);
    expect(await paused).toBe(true);
    expect(synchronization.pending()).toBe(2);
    expect(calls).toEqual([]);
    expect(await synchronization.setEnabled(true)).toBe(true);
    flush();
    expect(synchronization.enabled()).toBe(true);
    expect(synchronization.pending()).toBe(0);
    expect(calls).toEqual(["save:data", "save:lenses"]);
  });

  test("a failed resume preserves pending changes and explicit Save keeps the switch off", async () => {
    const synchronization = createLocusSynchronization();
    const calls: string[] = [];
    const data = participant("data", calls);
    synchronization.register("account:a", data);
    await synchronization.setEnabled(false);
    data.fail = true;
    expect(await synchronization.setEnabled(true)).toBe(false);
    flush();
    expect(synchronization.enabledNow()).toBe(false);
    expect(synchronization.enabledPreferenceNow()).toBe(false);
    expect(synchronization.pending()).toBe(1);
    expect(synchronization.error()).toBe("data could not save");
    data.fail = false;
    expect(await synchronization.saveAll()).toBe(true);
    expect(synchronization.enabledNow()).toBe(false);
    expect(synchronization.pending()).toBe(0);
  });

  test("duplicate lenses save one source and stale registration cleanup cannot remove its replacement", async () => {
    const synchronization = createLocusSynchronization();
    const calls: string[] = [];
    const retireOld = synchronization.register("account:a", participant("old", calls));
    synchronization.register("account:a", participant("current", calls));
    retireOld();
    expect(synchronization.pending()).toBe(1);
    expect(await synchronization.saveAll()).toBe(true);
    expect(calls).toEqual(["save:current"]);
  });

  test("Save includes a pane queue staged after its source's first save pass", async () => {
    const synchronization = createLocusSynchronization();
    const calls: string[] = [];
    const source = participant("source", calls);
    source.dirty = false;
    const pane = participant("pane", calls);
    pane.stageBeforeSave = true;
    pane.save = async () => { calls.push("stage:pane"); pane.dirty = false; source.dirty = true; return true; };
    synchronization.register("account:a", source);
    synchronization.register("pane:a", pane);
    await synchronization.setEnabled(false);
    expect(await synchronization.saveAll()).toBe(true);
    expect(calls).toEqual(["stage:pane", "save:source"]);
    expect(synchronization.pending()).toBe(0);
    expect(synchronization.enabledNow()).toBe(false);
  });

  test("resuming stages deferred pane queues while automatic writes are still off", async () => {
    const synchronization = createLocusSynchronization();
    const calls: string[] = [];
    const source = participant("source", calls);
    const pane = participant("pane", calls);
    pane.stageBeforeSave = true;
    pane.save = async () => {
      expect(synchronization.enabledNow()).toBe(false);
      expect(synchronization.enabledPreferenceNow()).toBe(true);
      calls.push("stage:pane"); pane.dirty = false; return true;
    };
    synchronization.register("account:a", source);
    synchronization.register("pane:a", pane);
    await synchronization.setEnabled(false);
    expect(await synchronization.setEnabled(true)).toBe(true);
    expect(calls).toEqual(["stage:pane", "save:source"]);
    expect(synchronization.enabledNow()).toBe(true);
  });

  test("cancelling resume during deferred staging keeps pending source writes paused", async () => {
    const synchronization = createLocusSynchronization();
    const calls: string[] = [];
    let finish!: () => void;
    const pane = participant("pane", calls);
    pane.stageBeforeSave = true;
    pane.save = async () => { await new Promise<void>(resolve => { finish = resolve; }); pane.dirty = false; return true; };
    synchronization.register("account:a", participant("source", calls));
    synchronization.register("pane:a", pane);
    await synchronization.setEnabled(false);
    const resuming = synchronization.setEnabled(true);
    await Promise.resolve();
    await synchronization.setEnabled(false);
    finish();
    expect(await resuming).toBe(true);
    expect(calls).toEqual([]);
    expect(synchronization.pending()).toBe(1);
    expect(synchronization.enabledNow()).toBe(false);
  });

  test("Discard never joins an in-flight Save and a later discard restores every remaining source", async () => {
    const synchronization = createLocusSynchronization();
    const calls: string[] = [];
    let finish!: () => void;
    const held = participant("held", calls);
    held.save = async () => { await new Promise<void>(resolve => { finish = resolve; }); held.dirty = false; return true; };
    synchronization.register("account:a", held);
    const saving = synchronization.saveAll();
    await Promise.resolve();
    expect(await synchronization.discardAll()).toBe(false);
    finish();
    expect(await saving).toBe(true);
    synchronization.register("account:b", participant("other", calls));
    expect(await synchronization.discardAll()).toBe(true);
    expect(calls).toEqual(["discard:other"]);
    expect(synchronization.pending()).toBe(0);
  });

  test("turning synchronization off during resume does not start another source save", async () => {
    const synchronization = createLocusSynchronization();
    const calls: string[] = [];
    let finish!: () => void;
    const held = participant("held", calls);
    held.save = async () => { await new Promise<void>(resolve => { finish = resolve; }); held.dirty = false; return true; };
    synchronization.register("preferences:a", held);
    synchronization.register("account:a", participant("data", calls));
    await synchronization.setEnabled(false);
    const resuming = synchronization.setEnabled(true);
    await Promise.resolve();
    await synchronization.setEnabled(false);
    finish();
    expect(await resuming).toBe(true);
    expect(calls).toEqual([]);
    expect(synchronization.pending()).toBe(1);
    expect(synchronization.enabledNow()).toBe(false);
  });

  test("remount and a new session keep synchronization off while retiring the old participants", async () => {
    const epoch = sessionEpoch();
    const synchronization = locusSynchronizationForSession(epoch);
    await synchronization.setEnabled(false);
    expect(locusSynchronizationForSession(epoch)).toBe(synchronization);
    expect(locusSynchronizationForSession(epoch).enabledNow()).toBe(false);
    const calls: string[] = [];
    synchronization.register("account:a", participant("old session", calls));
    expireBrowserSession(epoch);
    expect(await synchronization.saveAll()).toBe(false);
    expect(calls).toEqual([]);
    const replacement = locusSynchronizationForSession(sessionEpoch());
    expect(replacement).not.toBe(synchronization);
    expect(replacement.enabledNow()).toBe(false);
    expect(replacement.enabledPreferenceNow()).toBe(false);
    expect(replacement.pending()).toBe(0);
    expect(replacement.error()).toBeUndefined();
    expect(replacement.saving()).toBe(false);
    expect(await replacement.saveAll()).toBe(true);
    expect(calls).toEqual([]);
  });

  test("a session change during Save staging carries the on preference rather than its temporary off gate", async () => {
    const epoch = sessionEpoch();
    const synchronization = locusSynchronizationForSession(epoch);
    expect(await synchronization.setEnabled(true)).toBe(true);
    const calls: string[] = [];
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const staging = new Promise<void>(resolve => { finish = resolve; });
    const pane = participant("old pane", calls);
    pane.stageBeforeSave = true;
    pane.save = async () => { entered(); await staging; pane.dirty = false; return true; };
    synchronization.register("pane:old", pane);
    synchronization.register("account:old", participant("old source", calls));
    const saving = synchronization.saveAll();
    await started;
    expect(synchronization.enabledNow()).toBe(false);
    expect(synchronization.enabledPreferenceNow()).toBe(true);
    expireBrowserSession(epoch);
    const replacement = locusSynchronizationForSession(sessionEpoch());
    expect(replacement.enabledNow()).toBe(true);
    expect(replacement.enabledPreferenceNow()).toBe(true);
    expect(replacement.pending()).toBe(0);
    finish();
    expect(await saving).toBe(false);
    expect(calls).toEqual([]);
    expect(await replacement.saveAll()).toBe(true);
  });

  test("a failed resume carries the resulting off preference into the next session", async () => {
    const epoch = sessionEpoch();
    const synchronization = locusSynchronizationForSession(epoch);
    await synchronization.setEnabled(false);
    const calls: string[] = [];
    const failing = participant("refused source", calls);
    failing.fail = true;
    synchronization.register("account:refused", failing);
    expect(await synchronization.setEnabled(true)).toBe(false);
    expect(synchronization.enabledPreferenceNow()).toBe(false);
    expireBrowserSession(epoch);
    const replacement = locusSynchronizationForSession(sessionEpoch());
    expect(replacement.enabledNow()).toBe(false);
    expect(replacement.enabledPreferenceNow()).toBe(false);
    expect(replacement.pending()).toBe(0);
    expect(replacement.error()).toBeUndefined();
  });
});
