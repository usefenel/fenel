// ---------------------------------------------------------------------------
// module-migrate-profiles.test.ts — module-substrate Phase 3c parity proof.
//
// Tier-1 pure Shape-B migration (mechanical repeat of Phase 3a's `inventory`).
// `profiles` was a Shape-B module: 31 `defineFunction` specs in
// `engine/src/modules/profiles.ts` (signatures + identity), bodies pulled from
// `fenel/modules/profiles/manage.fenel`. Phase 3c retired the TS spec wrapper —
// the `.fenel` file (renamed `profiles.fenel`) grew the `module profiles where`
// header, the per-function `name : Type` sigs, and the `@label`/`@description`/
// `@tags`/`@ioAction` facet directives — and the TS file shrank to a thin
// `loadFenelModule` seam (`profilesModule`).
//
// This test is the proof the migration dropped NOTHING: every one of the 31
// functions still resolves by id + codeName, with the SAME label / category /
// description / tags / ioAction the defineFunction specs emitted.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { profilesModule } from "./modules/profiles";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

type Expected = { label: string; tags: string[]; ioAction?: string; codeName?: string };
const EXPECTED: Record<string, Expected> = {
  mergedCount: { label: "Merged count", tags: ["profile", "pure", "phase-12d"] },
  findById: { label: "Find by id", tags: ["profile", "lookup", "pure", "phase-12d"] },
  maybeOr: { label: "Maybe or default", tags: ["profile", "pure", "phase-12d"] },
  buildHandleList: { label: "Build handle list", tags: ["profile", "handle", "pure", "phase-13a"] },
  emailEntryList: { label: "Email entry list", tags: ["profile", "handle", "pure", "phase-13a"] },
  handleEntryIsNonEmpty: { label: "Handle entry is non-empty", tags: ["profile", "handle", "pure", "phase-13a"] },
  handleEntryToRecord: { label: "Handle entry → record", tags: ["profile", "handle", "pure", "phase-13a"] },
  computeFirstPatch: { label: "Compute firstName patch", tags: ["profile", "pure", "phase-12d"] },
  liftFirstNamePatchIfBlank: { label: "Lift firstName patch (if blank)", tags: ["profile", "pure", "phase-12d"] },
  computeLastPatch: { label: "Compute lastName patch", tags: ["profile", "pure", "phase-12d"] },
  liftLastNamePatchIfBlank: { label: "Lift lastName patch (if blank)", tags: ["profile", "pure", "phase-12d"] },
  combinePatches: { label: "Combine patch Maybes", tags: ["profile", "pure", "phase-12d"] },
  combinePatchesWithFirst: { label: "Combine patches (first known)", tags: ["profile", "pure", "phase-12d"] },
  mergeProfiles: { label: "Merge profiles", tags: ["profile", "merge", "phase-13a"], ioAction: "profiles.merge_profiles" },
  // ts-elimination-completion Phase 5 (5a-1) — mergeProfiles same-id guard +
  // archivedAt time-stamp folded into the body; the else-arm extraction.
  mergeProfilesProceed: { label: "Merge profiles (proceed)", tags: ["profile", "merge", "ts-elimination"] },
  mergeProfilesInner: { label: "Merge profiles (inner — Result)", tags: ["profile", "merge", "phase-13a"] },
  createOrMergeProfile: { label: "Create or merge profile", tags: ["profile", "merge", "identity", "phase-13a"], ioAction: "profiles.create_or_merge_profile" },
  createOrMergeProfileInner: { label: "Create or merge profile (inner — Result)", tags: ["profile", "merge", "identity", "phase-13a"] },
  createOrMergeNew: { label: "Create or merge (new)", tags: ["profile", "create", "phase-12d"] },
  makeCreateProfileParams: { label: "Make create_profile params", tags: ["profile", "create", "pure", "phase-12d"] },
  resolveExistingProfile: { label: "Resolve existing profile", tags: ["profile", "merge", "phase-12d"] },
  mergeAllSources: { label: "Merge all source profiles", tags: ["profile", "merge", "phase-12d"] },
  mergeEach: { label: "Merge each (recursive)", tags: ["profile", "merge", "phase-12d"] },
  mergeOneAndContinue: { label: "Merge one and continue", tags: ["profile", "merge", "phase-12d"] },
  mergeOneSource: { label: "Merge one source", tags: ["profile", "merge", "dispatch", "phase-12d"] },
  appendNewHandles: { label: "Append new handles", tags: ["profile", "handle", "phase-12d"] },
  appendOneAndContinue: { label: "Append one handle and continue", tags: ["profile", "handle", "phase-12d"] },
  appendOneNewHandle: { label: "Append one new handle", tags: ["profile", "handle", "phase-12d"] },
  dispatchAppendHandle: { label: "Dispatch append_handle", tags: ["profile", "handle", "dispatch", "phase-12d"] },
  patchNamesIfBlank: { label: "Patch names if blank", tags: ["profile", "patch", "phase-12d"] },
  applyNamePatch: { label: "Apply name patch (if Just)", tags: ["profile", "patch", "phase-12d"] },
  doApplyNamePatch: { label: "Apply name patch", tags: ["profile", "patch", "phase-12d"] },
  // ts-elimination-completion Phase 2 (profiles residual) — create_profile +
  // append_handle + archive_profile ported from core/actions/profiles.ts.
  // `createProfile` carries @codeName "createProfileAction" (global-codeName
  // clash with dashboard:createProfile, a distinct route surface).
  canonIso: { label: "Canonicalise ISO timestamp", tags: ["profile","handle","time","pure","ts-elimination"] },
  addProfileEmail: { label: "Add profile email (if Just)", tags: ["profile","pure","ts-elimination"] },
  addProfilePhone: { label: "Add profile phone (if Just)", tags: ["profile","pure","ts-elimination"] },
  addProfileGender: { label: "Add profile gender (if Just)", tags: ["profile","pure","ts-elimination"] },
  addProfileFirstName: { label: "Add profile firstName (if truthy)", tags: ["profile","pure","ts-elimination"] },
  mergeFirstNameIfTruthy: { label: "Merge firstName (if truthy)", tags: ["profile","pure","ts-elimination"] },
  addProfileLastName: { label: "Add profile lastName (if truthy)", tags: ["profile","pure","ts-elimination"] },
  mergeLastNameIfTruthy: { label: "Merge lastName (if truthy)", tags: ["profile","pure","ts-elimination"] },
  buildProfileData: { label: "Build profile data", tags: ["profile","pure","ts-elimination"] },
  emailHandleMatches: { label: "Email handle matches", tags: ["profile","handle","pure","ts-elimination"] },
  hasEmailHandle: { label: "Has email handle", tags: ["profile","handle","pure","ts-elimination"] },
  appendEmailHandle: { label: "Append email handle", tags: ["profile","handle","pure","ts-elimination"] },
  appendEmailIfMissing: { label: "Append email if missing", tags: ["profile","handle","pure","ts-elimination"] },
  handleSuspected: { label: "Handle suspected", tags: ["profile","handle","pure","ts-elimination"] },
  addRawValidFrom: { label: "Add raw validFrom (if truthy)", tags: ["profile","handle","pure","ts-elimination"] },
  addRawValidTo: { label: "Add raw validTo (if truthy)", tags: ["profile","handle","pure","ts-elimination"] },
  buildHandleData: { label: "Build handle data", tags: ["profile","handle","pure","ts-elimination"] },
  writeHandles: { label: "Write handles", tags: ["profile","handle","ts-elimination"] },
  writeOneAndContinue: { label: "Write one handle and continue", tags: ["profile","handle","ts-elimination"] },
  writeOneHandle: { label: "Write one handle", tags: ["profile","handle","ts-elimination"] },
  buildProfileCreatedPayload: { label: "Build profile_created payload", tags: ["profile","pure","ts-elimination"] },
  createProfile: { label: "Create profile", tags: ["profile","create","ts-elimination"], ioAction: "profiles.create_profile", codeName: "createProfileAction" },
  createProfileProceed: { label: "Create profile (proceed)", tags: ["profile","create","ts-elimination"] },
  maybeBool: { label: "Maybe bool (False default)", tags: ["profile","pure","ts-elimination"] },
  addValidFromM: { label: "Add validFrom (if Just)", tags: ["profile","handle","pure","ts-elimination"] },
  addValidToM: { label: "Add validTo (if Just)", tags: ["profile","handle","pure","ts-elimination"] },
  buildAppendHandleData: { label: "Build append-handle data", tags: ["profile","handle","pure","ts-elimination"] },
  appendHandle: { label: "Append handle", tags: ["profile","handle","ts-elimination"], ioAction: "profiles.append_handle" },
  doArchive: { label: "Do archive", tags: ["profile","archive","ts-elimination"] },
  archiveIfExists: { label: "Archive if exists", tags: ["profile","archive","ts-elimination"] },
  archiveProfile: { label: "Archive profile", tags: ["profile","archive","ts-elimination"], ioAction: "profiles.archive_profile" },
};
const NAMES = Object.keys(EXPECTED);
const ids = NAMES.map((n) => `profiles:${n}`);

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("profiles migration — header-driven identity", () => {
  test("the `module profiles where` header is authoritative (lowercase prefix preserved)", () => {
    expect(profilesModule.name).toBe("profiles");
  });

  test("all 63 functions registered under the legacy `profiles:` id-prefix", () => {
    expect((profilesModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("every function carries its `.fenel` body (bodies were always Fenel)", () => {
    for (const f of profilesModule.functions ?? []) {
      expect(f.body, `${f.id} should have a body`).toBeDefined();
    }
  });

  test("no entity contributed (profiles declared none — Decision E)", () => {
    expect(profilesModule.entities ?? []).toEqual([]);
  });
});

describe("profiles migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = profilesModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name (or the @codeName override), keyed by the fnId", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Codeable", `profiles:${n}`)).toEqual({ codeName: EXPECTED[n]!.codeName ?? n });
    }
  });

  test("Labelable: explicit @label preserved (NOT the humanized default)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Labelable", `profiles:${n}`)).toEqual({ label: EXPECTED[n]!.label });
    }
  });

  // Phase 3j (identity-as-fallback): profiles declares no @category, so NONE
  // carry a stored Categorizable — the `profiles` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — profiles declares no @category (category derives at read time)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Categorizable", `profiles:${n}`)).toBeUndefined();
    }
  });

  test("Taggable: tags preserved verbatim", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Taggable", `profiles:${n}`)).toEqual({ tags: EXPECTED[n]!.tags });
    }
  });

  test("Describable: a description is present for every function", () => {
    for (const n of NAMES) {
      const m = methodOf(insts, "Describable", `profiles:${n}`);
      expect(m, `${n} should have a Describable`).toBeDefined();
      expect(typeof m!.description).toBe("string");
      expect((m!.description as string).length).toBeGreaterThan(0);
    }
  });

  test("Describable: embedded escaped quotes survive the round-trip", () => {
    const m = methodOf(insts, "Describable", "profiles:buildHandleList");
    expect(m!.description as string).toContain('{platform="email", handle=e}');
  });

  test("IOInvokable: present for exactly the 5 io-tagged entry-points", () => {
    // ts-elimination-completion Phase 2 added create_profile / append_handle /
    // archive_profile alongside the original merge / create_or_merge entries.
    const ioIds = insts.filter((i) => i.typeName === "IOInvokable").map((i) => i.args[0]).sort();
    expect(ioIds).toEqual([
      "profiles:appendHandle",
      "profiles:archiveProfile",
      "profiles:createOrMergeProfile",
      "profiles:createProfile",
      "profiles:mergeProfiles",
    ]);
    expect(methodOf(insts, "IOInvokable", "profiles:mergeProfiles")).toEqual({ ioAction: "profiles.merge_profiles" });
    expect(methodOf(insts, "IOInvokable", "profiles:createOrMergeProfile")).toEqual({ ioAction: "profiles.create_or_merge_profile" });
    expect(methodOf(insts, "IOInvokable", "profiles:createProfile")).toEqual({ ioAction: "profiles.create_profile" });
    expect(methodOf(insts, "IOInvokable", "profiles:appendHandle")).toEqual({ ioAction: "profiles.append_handle" });
    expect(methodOf(insts, "IOInvokable", "profiles:archiveProfile")).toEqual({ ioAction: "profiles.archive_profile" });
  });

  test("no stray identity instances (only the expected facet set)", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    // Phase 3j: no Categorizable (profiles declares no @category — category
    // derives at read time via displayCategory). ts-elimination-completion
    // Phase 2 grew the surface 31 → 62 fns + 2 → 5 io-tagged entry-points;
    // Phase 5 (5a-1) +1 (mergeProfilesProceed) → 63.
    expect(counts).toEqual({
      Codeable: 63,
      Labelable: 63,
      Describable: 63,
      Taggable: 63,
      IOInvokable: 5,
    });
  });
});

describe("profiles migration — resolution through createRegistry", () => {
  const reg = createRegistry([profilesModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of NAMES) {
      const id = `profiles:${n}`;
      const codeName = EXPECTED[n]!.codeName ?? n;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(codeName)?.id, `by codeName: ${codeName}`).toBe(id);
    }
  });

  test("listModuleMembers sees profiles as a Module (view over the id namespace)", () => {
    expect(reg.listModuleMembers("profiles").sort()).toEqual([...NAMES].sort());
  });
});
