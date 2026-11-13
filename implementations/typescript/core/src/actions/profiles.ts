import { registerAction } from "./registry";

// ===========================================================================
// Profiles actions — action-subsumption (the public actions ARE typed Fenel
// functions; D1 COLLAPSE).
//
//   create_profile          → profiles:createProfile        (Phase 3, 2026-06-08)
//   append_handle           → profiles:appendHandle         (Phase 3)
//   merge_profiles          → profiles:mergeProfiles        (Phase 3)
//   create_or_merge_profile → profiles:createOrMergeProfile (Phase 3)
//   archive_profile         → profiles:archiveProfile       (Phase 2)
//
// Every TS handler (+ its `toMaybe` marshalling + `?? {}` defaulting +
// `validateActionParams` call) is DELETED. Dispatch resolves each by name →
// fnRef, validates the incoming params against the function's own param-record
// (`paramRecordOf(fnRef)`, D2 — no `*_params` mirror entity), injects `adapter`
// (D4) + `accountId`, invokes the body, and maps the returned `ActionResult` ADT
// at the boundary.
//
// The body residuals stay in the `.fenel` bodies, untouched by the port:
//   - create_profile's auto-email-handle + ISO canon (the handles list passes RAW);
//   - append_handle's ISO canon;
//   - merge_profiles' same-id precheck;
//   - create_or_merge_profile's `handles ?? {}` default (now over the public
//     `handles` Maybe open-record) + open-map identity resolution.
// The intra-Fenel `dispatch:dispatchAction` callers (create_profile / append_handle
// / merge_profiles, fired from createOrMergeProfile + import) route by action NAME
// and pass the public field names already — unaffected by the collapse.
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerProfileActions() {
  registerAction({
    name: "create_profile",
    description: "Create a new profile with optional handles",
    fnRef: "profiles:createProfile",
  });

  registerAction({
    name: "append_handle",
    description: "Add a handle to an existing profile",
    fnRef: "profiles:appendHandle",
  });

  registerAction({
    name: "archive_profile",
    description: "Archive a profile — stops all active flows",
    fnRef: "profiles:archiveProfile",
  });

  registerAction({
    name: "merge_profiles",
    description: "Merge two profiles — all data moves from source to target",
    fnRef: "profiles:mergeProfiles",
  });

  registerAction({
    name: "create_or_merge_profile",
    description:
      "Identity resolution — create a new profile or merge into existing based on handles",
    fnRef: "profiles:createOrMergeProfile",
  });
}
