// ---------------------------------------------------------------------------
// module-migrate-auth.test.ts — module-substrate Phase 3m parity + the NEW
// cross-file-header-UNION mechanism (OQ3, the last unproven load-time SUBSTRATE
// axis).
//
// `auth` is the UNION representative: `session.fenel` + `cookies.fenel` BOTH
// carry `module auth where`, so they union into one `auth` namespace, while
// `subject.fenel` (`module subject where`) stays its OWN module — header is
// identity, not the directory (OQ3). The ~370-LOC hand-merge in the retired
// `engine/src/modules/auth.ts` (load-each-under-a-throwaway-name + hand-extract
// bodies + re-wrap `defineFunction` + a private-helper re-registration loop) is
// replaced by `loadFenelModuleUnion` + @directive identity facets in the
// `.fenel` files + a thin seam that folds the `subject` group into the single
// `authModule` export (preserving the header-driven `subject:*` ids).
//
// Three blocks of assertions:
//   1. PARITY — all 27 fns under the SAME ids + codeNames; identity facets
//      byte-identical (NO Categorizable, per 3j); entities ride along;
//      HasStateIO inferred on the 7 orchestrators.
//   2. THE UNION MECHANISM — `loadFenelModuleUnion` groups 3 files → 2 modules;
//      session ∪ cookies → `auth`; subject does NOT fold in; dup-name across
//      same-header files = a precise load-time error.
//   3. IMPORT RESOLUTION — a selective `import Subject (accountId)` resolves the
//      accessor through the Phase-2b frame; the REAL auth bodies ride the kept
//      flat-global fallback for the `User` constructor (OQ4).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { authModule } from "./modules/auth";
import { stdModule } from "./modules/std";
import { stateModule } from "./modules/state";
import { createRegistry } from "./registry";
import { loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { evaluate, withImports } from "./json-logic";
import { parse } from "./fenel-parser";
import type { Instance } from "./types";

import SUBJECT_FENEL from "../../../../fenel/modules/auth/subject.fenel?raw";
import SESSION_FENEL from "../../../../fenel/modules/auth/session.fenel?raw";
import COOKIES_FENEL from "../../../../fenel/modules/auth/cookies.fenel?raw";

// The 37 functions the union assembles: 4 subject accessors + 11 auth
// orchestrators + 3 cookie helpers + 19 private helpers (Phase 3 added devLogin
// + parseCookieHeader + parseCookieHeader's 4 split helpers; durable-effects-anf
// Phase 1 added checkAndIssue; rights R2b added membership.fenel as the THIRD
// file of the union — 4 member-management orchestrators + 3 last-owner helpers
// — plus `createMembershipWithRole`, the String-role half of
// `createMembershipForRole`).
const SUBJECT_IDS = [
  "subject:accountId",
  "subject:requireAccountId",
  "subject:actorId",
  "subject:isAuthenticated",
  // ⚠ `subject:isSystem` IS GONE, and this census did not follow it. rights R2a
  // (`7956cf89`) deleted the `System` Subject variant and its predicate with the
  // second policy engine; this file kept asserting both, so it has been RED at
  // HEAD ever since — a pre-existing red R2a's completion note does not record.
  // rights R2b repairs the census rather than leaving a red no one reads.
];
const ORCHESTRATOR_IDS = [
  "auth:issueSession",
  "auth:resolveToken",
  "auth:revokeToken",
  "auth:setPassword",
  "auth:loginWithPassword",
  "auth:bootstrapAdmin",
  // ts-elimination-completion Phase 3 — devLogin ported (7th orchestrator).
  "auth:devLogin",
  // rights R2b — member management, the first grant's product surface.
  "auth:inviteMember",
  "auth:changeMemberRole",
  "auth:removeMember",
  "auth:listMembers",
  // 2026-09-23 — account selection (accounts.fenel), the fourth file of the
  // union: two privileged-door orchestrators.
  "auth:listAccounts",
  "auth:switchAccount",
];
const COOKIE_IDS = [
  "auth:sessionCookieHeader",
  "auth:clearSessionCookieHeader",
  // ts-elimination-completion Phase 3 — parseCookieHeader ported (no @ioAction).
  "auth:parseCookieHeader",
];
const PRIVATE_HELPER_IDS = [
  "auth:resolveFromRow",
  "auth:setHashJust",
  "auth:verifyAndIssue",
  // durable-effects-anf Phase 1 — checkAndIssue split out of verifyAndIssue so
  // the effectful branch rides the STRUCTURAL `if` (yields IO) instead of the
  // eager `ifElse` (whose branch args the pure evaluator would drop). Private
  // helper, directive-free → Codeable-only, like the others.
  "auth:checkAndIssue",
  "auth:issueAndWrap",
  "auth:ensureUser",
  "auth:createNewUser",
  "auth:ensureMembership",
  "auth:createMembershipForRole",
  // ts-elimination-completion Phase 3 — parseCookieHeader's split helpers
  // (Codeable-only, like every directive-free def; the parseApp single-line
  // constraint forces the decomposition, the imports.fenel precedent).
  "auth:addCookiePart",
  "auth:withCookieKey",
  "auth:withCookieTail",
  "auth:insertCookie",
  // rights R2b — the String-role half of createMembershipForRole (the leaf's
  // `role` is a String so a FieldAxis can judge it), plus membership.fenel's
  // last-owner helpers.
  "auth:createMembershipWithRole",
  "auth:authChangeMemberRoleNow",
  "auth:authRemoveMemberNow",
  "auth:authLastOwnerBlocksRole",
  "auth:authSoleOwnerIs",
  "auth:authFirstOwnerIs",
  // 2026-09-23 — accounts.fenel's helpers.
  "auth:authAccountChoice",
  "auth:authSwitchFromSession",
  "auth:authSwitchIfMember",
  "auth:authSwitchIssue",
  "auth:authSecondsLeft",
  "auth:authSecondsUntil",
  "auth:resolveReaderAccount",
  "auth:readerAccountFromSession",
  "auth:personalAccountForToken",
  "auth:personalAccountForUser",
  "auth:planPersonalAccount",
  "auth:personalAccountPlanForUser",
  "auth:personalMembershipIntact",
  "auth:personalMembershipDecision",
  "auth:personalMembershipMutation",
];
const ALL_IDS = [...SUBJECT_IDS, ...ORCHESTRATOR_IDS, ...COOKIE_IDS, ...PRIVATE_HELPER_IDS];
const ENTITY_IDS = ["Subject", "IssuedSession", "ResolvedSession", "UserProfile", "AccountChoice", "AccountChoices", "SwitchOutcome",
  "ReaderAccountResult", "PersonalAccountResult", "PersonalIdentityUser", "PersonalMembership", "PersonalAccountSnapshot",
  "PersonalAccountCreation", "PersonalAccountPlan", "MembershipMutation", "PersonalMembershipSnapshot"];

// codeName ≠ id-suffix on two accessors — the retired specs disambiguated the
// GLOBAL codeName (`subjectAccountId` / `subjectActorId`) from the short
// `subject:accountId` / `subject:actorId` id. Reproduced via def-rename +
// @codeName (Phase 3c). All other fns: codeName === id-suffix.
const EXPECTED_CODENAMES: Record<string, string> = {
  "subject:accountId": "subjectAccountId",
  "subject:requireAccountId": "requireAccountId",
  "subject:actorId": "subjectActorId",
  "subject:isAuthenticated": "isAuthenticated",
  "auth:issueSession": "issueSession",
  "auth:resolveToken": "resolveToken",
  "auth:revokeToken": "revokeToken",
  "auth:setPassword": "setPassword",
  "auth:loginWithPassword": "loginWithPassword",
  "auth:bootstrapAdmin": "bootstrapAdmin",
  "auth:devLogin": "devLogin",
  "auth:sessionCookieHeader": "sessionCookieHeader",
  "auth:clearSessionCookieHeader": "clearSessionCookieHeader",
  "auth:parseCookieHeader": "parseCookieHeader",
  "auth:resolveFromRow": "resolveFromRow",
  "auth:setHashJust": "setHashJust",
  "auth:verifyAndIssue": "verifyAndIssue",
  "auth:checkAndIssue": "checkAndIssue",
  "auth:issueAndWrap": "issueAndWrap",
  "auth:ensureUser": "ensureUser",
  "auth:createNewUser": "createNewUser",
  "auth:ensureMembership": "ensureMembership",
  "auth:createMembershipForRole": "createMembershipForRole",
  "auth:addCookiePart": "addCookiePart",
  "auth:withCookieKey": "withCookieKey",
  "auth:withCookieTail": "withCookieTail",
  "auth:insertCookie": "insertCookie",
  "auth:inviteMember": "inviteMember",
  "auth:changeMemberRole": "changeMemberRole",
  "auth:removeMember": "removeMember",
  "auth:listMembers": "listMembers",
  "auth:createMembershipWithRole": "createMembershipWithRole",
  "auth:authChangeMemberRoleNow": "authChangeMemberRoleNow",
  "auth:authRemoveMemberNow": "authRemoveMemberNow",
  "auth:authLastOwnerBlocksRole": "authLastOwnerBlocksRole",
  "auth:authSoleOwnerIs": "authSoleOwnerIs",
  "auth:authFirstOwnerIs": "authFirstOwnerIs",
  "auth:listAccounts": "listAccounts",
  "auth:switchAccount": "switchAccount",
  "auth:authAccountChoice": "authAccountChoice",
  "auth:authSwitchFromSession": "authSwitchFromSession",
  "auth:authSwitchIfMember": "authSwitchIfMember",
  "auth:authSwitchIssue": "authSwitchIssue",
  "auth:authSecondsLeft": "authSecondsLeft",
  "auth:authSecondsUntil": "authSecondsUntil",
  "auth:resolveReaderAccount": "resolveReaderAccount",
  "auth:readerAccountFromSession": "readerAccountFromSession",
  "auth:personalAccountForToken": "personalAccountForToken",
  "auth:personalAccountForUser": "personalAccountForUser",
  "auth:planPersonalAccount": "planPersonalAccount",
  "auth:personalAccountPlanForUser": "personalAccountPlanForUser",
  "auth:personalMembershipIntact": "personalMembershipIntact",
  "auth:personalMembershipDecision": "personalMembershipDecision",
  "auth:personalMembershipMutation": "personalMembershipMutation",
};

// The 7 orchestrators carry the public IOInvokable dot-form action name.
const EXPECTED_IO_ACTIONS: Record<string, string> = {
  "auth:issueSession": "auth.issue_session",
  "auth:resolveToken": "auth.resolve_token",
  "auth:revokeToken": "auth.revoke_token",
  "auth:setPassword": "auth.set_password",
  "auth:loginWithPassword": "auth.login_with_password",
  "auth:bootstrapAdmin": "auth.bootstrap_admin",
  "auth:devLogin": "auth.dev_login",
  // rights R2b — member management.
  "auth:inviteMember": "auth.invite_member",
  "auth:changeMemberRole": "auth.change_member_role",
  "auth:removeMember": "auth.remove_member",
  "auth:listMembers": "auth.list_members",
  "auth:listAccounts": "auth.list_accounts",
  "auth:switchAccount": "auth.switch_account",
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

// ===========================================================================
// 1. PARITY
// ===========================================================================

describe("auth migration — header-driven identity + consolidation", () => {
  test("the `module auth where` header is authoritative (lowercase prefix preserved)", () => {
    expect(authModule.name).toBe("auth");
  });

  test("module label preserved", () => {
    expect(JSON.stringify(authModule.label)).toContain("Auth");
  });

  test("all auth functions register under their source-owned ids", () => {
    expect((authModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ALL_IDS].sort());
  });

  test("the auth entities include the sign-in profile and account selection values", () => {
    expect((authModule.entities ?? []).map((e) => e.id).sort()).toEqual([...ENTITY_IDS].sort());
  });
});

describe("auth migration — every fn resolves by id + codeName", () => {
  const reg = createRegistry([stdModule, stateModule, authModule]);

  test("each id resolves to a function", () => {
    for (const id of ALL_IDS) {
      expect(reg.getFunction(id)?.id).toBe(id);
    }
  });

  test("each codeName resolves to its function (incl. the 2 divergent ones)", () => {
    for (const [id, codeName] of Object.entries(EXPECTED_CODENAMES)) {
      expect(reg.getFunction(codeName)?.id).toBe(id);
    }
  });
});

describe("auth migration — private helper signature boundary", () => {
  test("the auth module remains registrable without its state/crypto runtime providers", () => {
    const reg = createRegistry([stdModule, authModule]);
    const helperIds = [
      "auth:resolveFromRow",
      "auth:setHashJust",
      "auth:verifyAndIssue",
      "auth:checkAndIssue",
      "auth:issueAndWrap",
      "auth:ensureUser",
      "auth:createNewUser",
      "auth:ensureMembership",
      "auth:createMembershipForRole",
    ];

    for (const id of helperIds) {
      const info = reg.getFunctionSignatureInfo(id);
      expect(info?.scheme).toBeDefined();
      expect(info?.params.every((slot) => slot.$tag === "Authored")).toBe(true);
      expect(info?.returns.$tag).toBe("Authored");
    }
  }, 60_000);
});

describe("auth migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = authModule.instances ?? [];

  test("Codeable: every fn has one; codeName byte-identical (incl. divergent)", () => {
    for (const [id, codeName] of Object.entries(EXPECTED_CODENAMES)) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName });
    }
  });

  // Phase 3j: NO @category authored anywhere → NONE carry a stored
  // Categorizable. `auth:*` derive "auth", `subject:*` derive "subject" at read
  // time from their id prefix (Categorizable is law-neutral — the count holds).
  test("Categorizable: NONE stored (read-time derivation, Phase 3j)", () => {
    expect(insts.some((i) => i.typeName === "Categorizable")).toBe(false);
  });

  test("Labelable/Describable/Taggable on the 18 named fns; helpers carry NONE", () => {
    const named = [...SUBJECT_IDS, ...ORCHESTRATOR_IDS, ...COOKIE_IDS];
    for (const id of named) {
      expect(methodOf(insts, "Labelable", id)).toBeDefined();
      expect(methodOf(insts, "Describable", id)).toBeDefined();
      expect(methodOf(insts, "Taggable", id)).toBeDefined();
    }
    // The 13 private helpers are Codeable-ONLY (the directive-free 3j default —
    // matching the retired Codeable-only re-registration loop).
    for (const id of PRIVATE_HELPER_IDS) {
      expect(methodOf(insts, "Codeable", id)).toBeDefined();
      expect(methodOf(insts, "Labelable", id)).toBeUndefined();
      expect(methodOf(insts, "Describable", id)).toBeUndefined();
      expect(methodOf(insts, "Taggable", id)).toBeUndefined();
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });

  test("representative facets byte-identical to the retired specs", () => {
    expect(methodOf(insts, "Labelable", "subject:accountId")).toEqual({ label: "Subject account id" });
    expect(methodOf(insts, "Describable", "subject:accountId")).toEqual({
      description:
        "Phase 12c-core sub-step 1 — accessor. Extract the account partition key from a Subject. User / Bot → Just accountId; Anonymous → Nothing.",
    });
    expect(methodOf(insts, "Taggable", "subject:accountId")).toEqual({
      tags: ["auth", "subject", "pure", "phase-12c"],
    });

    expect(methodOf(insts, "Labelable", "auth:issueSession")).toEqual({ label: "Issue session" });
    expect(methodOf(insts, "Describable", "auth:issueSession")).toEqual({
      description:
        "Phase 12c-core sub-step 3 — random token + hash + persist session row. Returns IssuedSession; the raw token is shown to the caller ONCE. Composes crypto:randomTokenHex + crypto:sha256Hex + state:createSession.",
    });
    expect(methodOf(insts, "Taggable", "auth:issueSession")).toEqual({
      tags: ["auth", "session", "io", "phase-12c"],
    });

    expect(methodOf(insts, "Labelable", "auth:sessionCookieHeader")).toEqual({
      label: "Session cookie header",
    });
    expect(methodOf(insts, "Taggable", "auth:sessionCookieHeader")).toEqual({
      tags: ["auth", "cookie", "pure", "phase-12c"],
    });
  });

  test("IOInvokable: ONLY the 13 orchestrators, with the dot-form action names", () => {
    const ioInsts = insts.filter((i) => i.typeName === "IOInvokable");
    expect(ioInsts.length).toBe(13);
    for (const [id, ioAction] of Object.entries(EXPECTED_IO_ACTIONS)) {
      expect(methodOf(insts, "IOInvokable", id)).toEqual({ ioAction });
    }
    // No cookie / subject / helper fn is IOInvokable.
    for (const id of [...SUBJECT_IDS, ...COOKIE_IDS, ...PRIVATE_HELPER_IDS]) {
      expect(methodOf(insts, "IOInvokable", id)).toBeUndefined();
    }
  });

  // Instance-count parity check (Surprise #11): each fn contributes a Codeable
  // + (where labelled) a Labelable instance. (Codeable's codeNameNonEmpty law
  // was dropped 2026-06-05; the labelNonEmpty law on Labelable remains.) ts-elimination-
  // completion Phase 3 added devLogin (+Codeable +Labelable) + parseCookieHeader
  // (+Codeable +Labelable) + parseCookieHeader's 4 split helpers (+Codeable
  // each, Codeable-only) → +8 module laws (6 Codeable + 2 Labelable).
  // durable-effects-anf Phase 1 added checkAndIssue (+Codeable, Codeable-only).
  // 37 Codeable + 18 Labelable (rights R2b: +4 named member-management
  // orchestrators, +6 directive-free helpers; -1 for the `subject:isSystem`
  // R2a deleted and this census kept asserting).
  // 2026-09-23 — accounts.fenel: +2 named orchestrators and +6 directive-free
  // helpers, so 45 Codeable + 20 Labelable.
  test("new auth helpers remain Codeable-only and existing labels are unchanged", () => {
    expect(insts.filter((i) => i.typeName === "Codeable").length).toBe(54);
    expect(insts.filter((i) => i.typeName === "Labelable").length).toBe(20);
    expect(insts.filter((i) => i.typeName === "Iconable").length).toBe(0);
  });
});

describe("auth migration — typed signatures + inferred HasStateIO requires", () => {
  const reg = createRegistry([stdModule, stateModule, authModule]);
  const HAS_STATE_IO = [{ class: { $tag: "Id" as const, entityId: "HasStateIO" }, args: [{ $var: "scope" }] }];

  test("the 7 orchestrators carry HasStateIO (INFERRED from their state:* calls)", () => {
    for (const id of ORCHESTRATOR_IDS) {
      expect(reg.getFunction(id)?.requires).toEqual(HAS_STATE_IO);
    }
  });

  test("loginWithPassword infers HasStateIO transitively (via issueSession)", () => {
    expect(reg.getFunction("auth:loginWithPassword")?.requires).toEqual(HAS_STATE_IO);
  });

  test("the pure cookie + subject fns carry NO requires", () => {
    for (const id of [...COOKIE_IDS, ...SUBJECT_IDS]) {
      expect(reg.getFunction(id)?.requires).toBeUndefined();
    }
  });

  test("typed params survive (issueSession : {} -> IssuedSession; accountId : Subject -> Maybe)", () => {
    const iss = reg.getFunction("auth:issueSession");
    expect(iss?.params?.[0]?.type).toEqual({ $record: { fields: [] } });
    // 7g-parser: user-written type-name refs parse to {$ref} (was {$ref}).
    // ({$ref} is not yet a FenelType-union member until 7g-retire → cast.)
    expect(iss?.returns).toEqual({ $ref: "IssuedSession" } as never);
    const acc = reg.getFunction("subject:accountId");
    expect(acc?.params?.[0]?.type).toEqual({ $ref: "Subject" } as never);
  });
});

describe("auth migration — bodies dispatch end-to-end (the pure subset)", () => {
  const reg = createRegistry([stdModule, stateModule, authModule]);
  const ctx = reg.evaluateContext();

  test("sessionCookieHeader builds the Set-Cookie string (Secure off when !isProd)", () => {
    const body = reg.getFunction("auth:sessionCookieHeader")!.body;
    expect(evaluate(body, { token: "tok", maxAgeSeconds: 100, isProd: false }, ctx)).toBe(
      "fenel_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=100",
    );
  });

  test("clearSessionCookieHeader appends '; Secure' when isProd", () => {
    const body = reg.getFunction("auth:clearSessionCookieHeader")!.body;
    expect(evaluate(body, { isProd: true }, ctx)).toBe(
      "fenel_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });

  // ts-elimination-completion Phase 3 — parseCookieHeader body parity. Matches
  // the pre-port TS byte-for-byte: split on ';', first '=' per part, trim k+v,
  // skip parts with no '=' + empty keys, decodeURIComponent the value.
  test("parseCookieHeader parses '; '-separated pairs, trimming + skipping bad parts", () => {
    const body = reg.getFunction("auth:parseCookieHeader")!.body;
    expect(
      evaluate(body, { header: "fenel_session=abc123; x=1" }, ctx),
    ).toEqual({ fenel_session: "abc123", x: "1" });
    // No '=' → skipped; empty key → skipped; value with '=' keeps the tail.
    expect(evaluate(body, { header: "novalue; =orphan; a=b=c" }, ctx)).toEqual({
      a: "b=c",
    });
    // Percent-encoded value is decoded (std:decodeUriComponent).
    expect(evaluate(body, { header: "q=a%20b" }, ctx)).toEqual({ q: "a b" });
  });

  // ⚠ WAS `Nothing for System`, and rights R2a deleted the `System` variant with
  // the second policy engine without updating this. `Anonymous` is the arm that
  // survives and denotes the same thing here: a Subject with no partition.
  test("subject:accountId returns Just<accountId> for a User, Nothing for Anonymous", () => {
    const body = reg.getFunction("subject:accountId")!.body;
    expect(evaluate(body, { s: { $tag: "User", accountId: "acct-9", userId: "u-1" } }, ctx)).toEqual({
      $tag: "Just",
      _0: "acct-9",
    });
    expect(evaluate(body, { s: { $tag: "Anonymous" } }, ctx)).toEqual({ $tag: "Nothing" });
  });

  test("requireAccountId delegates to accountId via its codeName (subjectAccountId)", () => {
    const body = reg.getFunction("subject:requireAccountId")!.body;
    expect(evaluate(body, { s: { $tag: "Bot", accountId: "acct-bot", botId: "b-1" } }, ctx)).toEqual({
      $tag: "Just",
      _0: "acct-bot",
    });
  });
});

// ===========================================================================
// 2. THE UNION MECHANISM (loadFenelModuleUnion + dup-name load error)
// ===========================================================================

describe("the cross-file header UNION — session ∪ cookies → `auth`", () => {
  const groups = loadFenelModuleUnion([
    { src: SUBJECT_FENEL, name: "subject-fallback" },
    { src: SESSION_FENEL, name: "session-fallback" },
    { src: COOKIES_FENEL, name: "cookies-fallback" },
  ]);
  const auth = groups.find((m) => m.name === "auth")!;
  const subject = groups.find((m) => m.name === "subject")!;

  test("3 files group into 2 modules by header (NOT by the `name` arg)", () => {
    expect(groups.map((m) => m.name).sort()).toEqual(["auth", "subject"]);
  });

  test("session.fenel + cookies.fenel UNION: the `auth` group carries members from BOTH files", () => {
    const ids = (auth.functions ?? []).map((f) => f.id);
    // session.fenel member …
    expect(ids).toContain("auth:issueSession");
    // … AND cookies.fenel member, in ONE module (the union).
    expect(ids).toContain("auth:sessionCookieHeader");
    // 7 orchestrators + 3 cookies + 14 helpers = 24 (Phase 3: +devLogin in
    // session.fenel, +parseCookieHeader + its 4 split helpers in cookies.fenel;
    // durable-effects-anf Phase 1: +checkAndIssue; rights R2b:
    // +createMembershipWithRole, both in session.fenel). ⚠ This block unions
    // only session ∪ cookies — `membership.fenel` is the union's THIRD file and
    // is deliberately absent here, so this count is not the module's.
    expect(ids.length).toBe(24);
    expect((auth.functions ?? []).every((f) => f.id.startsWith("auth:"))).toBe(true);
  });

  test("HEADER IS IDENTITY: subject.fenel does NOT fold into auth", () => {
    // The `subject` group is distinct — its 5 accessors keep `subject:*` ids,
    // sourced from `module subject where`, NOT the auth union.
    expect((subject.functions ?? []).map((f) => f.id).sort()).toEqual([...SUBJECT_IDS].sort());
    expect((subject.functions ?? []).every((f) => f.id.startsWith("subject:"))).toBe(true);
    // No subject member leaked into the auth group.
    expect((auth.functions ?? []).some((f) => f.id.startsWith("subject:"))).toBe(false);
    // The Subject entity rides the subject group; IssuedSession/ResolvedSession
    // ride the auth group.
    expect((subject.entities ?? []).map((e) => e.id)).toEqual(["Subject"]);
    expect((auth.entities ?? []).map((e) => e.id).sort()).toEqual(["IssuedSession", "ResolvedSession", "UserProfile"]);
  });

  test("the REAL union does NOT false-positive on the within-file sig+def pairing", () => {
    // Every orchestrator/cookie has a `name : Type` sig AND a `name … = body`
    // def in the same file — the loader collates those to ONE function, so the
    // union sees no duplicate. (A single-file dup would have thrown above.)
    expect(() =>
      loadFenelModuleUnion([
        { src: SESSION_FENEL, name: "s" },
        { src: COOKIES_FENEL, name: "c" },
      ]),
    ).not.toThrow();
  });
});

describe("dup-name within one module = a LOAD-TIME error (OQ3, Haskell semantics)", () => {
  test("two same-header files defining the same FUNCTION throws a precise error", () => {
    const a = "module dup where\nfoo x = 1\n";
    const b = "module dup where\nfoo x = 2\n";
    expect(() =>
      loadFenelModuleUnion([{ src: a, name: "a.fenel" }, { src: b, name: "b.fenel" }]),
    ).toThrow('module dup: duplicate definition "foo" in a.fenel and b.fenel');
  }, 120_000);

  test("two same-header files defining the same TYPE throws", () => {
    const a = "module dup where\nFoo = Bar | Baz\n";
    const b = "module dup where\nFoo = Qux\n";
    expect(() =>
      loadFenelModuleUnion([{ src: a, name: "a.fenel" }, { src: b, name: "b.fenel" }]),
    ).toThrow('module dup: duplicate definition "Foo" in a.fenel and b.fenel');
  }, 120_000);

  test("NOT last-wins, NOT silent-merge — the dup is REJECTED, not absorbed", () => {
    const a = "module dup where\nfoo x = 1\n";
    const b = "module dup where\nfoo x = 2\n";
    let threw = false;
    try {
      loadFenelModuleUnion([{ src: a, name: "a.fenel" }, { src: b, name: "b.fenel" }]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  }, 120_000);

  test("the SAME name in DIFFERENT module-groups is fine (no false dup)", () => {
    // `helper` in module Foo and `helper` in module Bar are distinct names —
    // different namespaces, no collision.
    const foo = "module Foo where\nhelper x = 1\n";
    const bar = "module Bar where\nhelper x = 2\n";
    expect(() =>
      loadFenelModuleUnion([{ src: foo, name: "a" }, { src: bar, name: "b" }]),
    ).not.toThrow();
  }, 120_000);

  test("a function and a type may share a name (separate namespaces)", () => {
    // `Thing` the type and `thing` the function differ by case → no clash; and
    // even a type `Foo` alongside a function `foo` across files is fine.
    const a = "module ns where\nFoo = A | B\n";
    const b = "module ns where\nfoo x = 1\n";
    expect(() =>
      loadFenelModuleUnion([{ src: a, name: "a" }, { src: b, name: "b" }]),
    ).not.toThrow();
  }, 120_000);
});

// ===========================================================================
// 3. IMPORT RESOLUTION (Phase-2b frame) + the kept flat-global fallback (OQ4)
// ===========================================================================

describe("import resolution — `auth` reaching a `subject` accessor", () => {
  // A synthetic uppercase-named pair (lowercase `import subject` parses as
  // application, not a decl — Surprise #12/#25 — so the REAL `.fenel` files
  // can't yet author the import; the mechanism is proven on uppercase modules).
  const subjectModSrc = `module Subject where
accountId s = "from-subject"
`;
  const authModSrc = `module Auth where
helper x = "from-auth"
`;
  const reg = createRegistry([loadFenelModule(subjectModSrc, "x"), loadFenelModule(authModSrc, "x")]);
  const ctx = reg.evaluateContext();

  test("a selective `import Subject (accountId)` binds accountId → Subject:accountId (2b resolver)", () => {
    const frame = reg.buildImportFrame([{ module: "Subject", names: ["accountId"] }]);
    expect(frame).toEqual({ names: { accountId: "Subject:accountId" }, aliases: {} });
    const out = withImports(ctx, frame, (c) => evaluate(parse("accountId 0"), {}, c));
    expect(out).toBe("from-subject");
  });

  test("qualified `Subject.accountId` resolves the member by id (no frame needed)", () => {
    expect(reg.getFunction("Subject.accountId")?.id).toBe("Subject:accountId");
    expect(evaluate(parse("Subject.accountId 0"), {}, ctx)).toBe("from-subject");
  });

  // OQ4: the REAL auth bodies do NOT call a subject accessor — they construct
  // the Subject `User` CONSTRUCTOR (resolveFromRow), which resolves via the kept
  // flat-global fallback (the Subject entity rides authModule.entities, so its
  // constructor is registered globally). Prove that constructor resolves with NO
  // import frame in scope.
  test("the REAL auth→subject edge is the Subject `User` constructor — flat-global (OQ4)", () => {
    const reg2 = createRegistry([stdModule, stateModule, authModule]);
    const ctx2 = reg2.evaluateContext();
    const out = evaluate(
      parse('User { accountId = "acct-1", userId = "u-1" }'),
      {},
      ctx2,
    ) as { $tag: string; accountId: string; userId: string };
    expect(out.$tag).toBe("User");
    expect(out.accountId).toBe("acct-1");
    expect(out.userId).toBe("u-1");
    // ⚠ EXPLICIT TIMEOUT, like the other registry-building tests in this file.
    // It builds a THIRD registry and parses an inline source (a deliberate
    // cache MISS), which on a slow host exceeds bun's 5 s default. Not a
    // correctness change: the assertions are untouched.
  }, 120_000);
});
