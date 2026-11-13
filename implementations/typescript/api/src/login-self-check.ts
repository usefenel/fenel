#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// rights R1 §7 — the login round-trip, on demand.
//
//   bun implementations/typescript/api/src/login-self-check.ts
//
// Exactly the check `server.ts` runs at boot, against the same in-process HTTP
// surface, with no listener and no side effect but the session it revokes.
// Exit 0 = login works (or is unconfigured and said so); exit 1 = login is
// broken. Use it to answer "is login up?" without restarting the API, and as
// the manual counterpart to the boot gate.
//
// It deliberately does NOT seed, bootstrap the admin, or load user registries:
// the privileged auth door resolves the BASE registry, so login needs none of
// them. If this passes while a booted server's login fails, the difference is
// in that boot wiring, which is itself a useful bisection.
// ---------------------------------------------------------------------------

import { reportLoginSelfCheck } from "./boot-login-sentinel";

const ok = await reportLoginSelfCheck();
process.exit(ok ? 0 : 1);
