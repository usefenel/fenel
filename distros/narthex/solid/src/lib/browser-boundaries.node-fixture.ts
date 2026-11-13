import { after as afterAll, before as beforeAll, describe, test } from "node:test";
import { deepStrictEqual as equal } from "node:assert";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type {} from "./browser-boundaries.fixture";

type BrowserFetch = (url: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
let browser: Browser;
let script: string;
let localReaderStart: string;

beforeAll(async () => {
  script = await readFile(process.argv[2]!, "utf8");
  localReaderStart = await readFile(process.argv[3]!, "utf8");
  browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
}, { timeout: 120_000 });

afterAll(async () => { await browser?.close(); });

test("local reader progress leaves Solid 2 owned setup before signal writes", () => fixture(async page => {
  equal(await page.evaluate(async production => {
    const { createRoot, createMemo, createSignal, flush } = fenelBrowserBoundaries;
    const run = async (source: string) => {
      let dispose!: () => void;
      let stage = () => "";
      let preparing = () => false;
      let sourceStarted = false;
      let closed = false;
      let opening!: { ready: Promise<unknown> };
      const client = { dispose: () => { closed = true; } };
      const bindings = { untrack: (read: () => unknown) => read(), sessionEpoch: () => 0,
        assertCurrentSession: () => {}, onBrowserSessionChange: () => () => {},
        localTabDataSource: () => ({ ready: async () => { sourceStarted = true; } }),
        createLocalApiClient: () => client, loadModule: () => { throw new Error("Semantic builders must stay held."); } };
      const start = new Function(...Object.keys(bindings), `${source}; return startLocalReaderRuntime;`)(...Object.values(bindings));
      createRoot(end => {
        dispose = end;
        const [readStage, setStage] = createSignal("");
        const [readPreparing, setPreparing] = createSignal(false);
        stage = readStage; preparing = readPreparing;
        const created = createMemo(() => createRoot(() => {
          opening = start({ onStage: setStage, prepareAfter: () => {
            setPreparing(true); throw new Error("Stopped after progress callbacks");
          } });
          return true;
        }));
        created();
      });
      let error = "";
      try { await opening.ready; } catch (failure) { error = String((failure as Error).message); }
      flush();
      const result = { error, stage: stage(), preparing: preparing(), sourceStarted, closed };
      dispose();
      return result;
    };
    const before = await run(production.replace("await Promise.resolve();", ""));
    const after = await run(production);
    return { reproducedOwnedWrite: before.error.includes("REACTIVE_WRITE_IN_OWNED_SCOPE"), after };
  }, localReaderStart), { reproducedOwnedWrite: true, after: { error: "Stopped after progress callbacks",
    stage: "Opening local data…", preparing: true, sourceStarted: false, closed: true } });
}));

async function fixture(run: (page: Page) => Promise<void>): Promise<void> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    // No development server or external request. The only real IO is Chromium.
    await page.route("**/*", (route) => route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }));
    await page.goto("https://fenel.test");
    await page.addScriptTag({ content: script, type: "module" });
    // Module insertion can complete before evaluation on a cold browser page.
    await page.waitForFunction(() => typeof globalThis.fenelBrowserBoundaries !== "undefined", undefined, { timeout: 30_000 });
    if (errors.length) throw new Error(errors.join("\n"));
    await run(page);
  } finally { await page.close(); }
}

describe("browser session boundaries", () => {
  test("workspace startup acquires the personal reader before its checked bootstrap without authoring", () => fixture(async (page) => {
    await page.setViewportSize({ width: 393, height: 852 });
    equal(await page.evaluate(async () => {
      const { auth, session } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const epoch = session.sessionEpoch();
      const requests: Array<{ path: string; method: string; account: string | null; reader: string | null; cancellable: boolean }> = [];
      const stages: string[] = [];
      let finishPersonal!: (response: Response) => void;
      let personalStarted!: () => void;
      const personalRequested = new Promise<void>(resolve => { personalStarted = resolve; });
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const address = new URL(String(url), location.origin);
        const path = address.pathname + address.search;
        const headers = new Headers(init?.headers);
        requests.push({ path, method: init?.method ?? "GET", account: headers.get("X-Fenel-Account"),
          reader: headers.get("X-Fenel-Reader-Account"), cancellable: init?.signal instanceof AbortSignal });
        if (path === "/api/auth/personal-account") return new Promise<Response>(resolve => { finishPersonal = resolve; personalStarted(); });
        if (address.pathname === "/api/workspace-bootstrap") return Response.json({
          accountId: "A", personalAccountId: "personal-one",
          root: { id: "personal-root", revision: 3, items: [] },
          accounts: [{ accountId: "A", name: "Account A", slug: "a", role: "admin" }],
          workspace: { status: "deferred" },
        });
        throw new Error(`Unexpected request: ${path}`);
      };
      const pending = auth.loadWorkspaceBootstrap("A", { epoch, signal: new AbortController().signal, onStage: stage => stages.push(stage) });
      await personalRequested;
      const beforePersonal = requests.map(request => request.path);
      finishPersonal(Response.json({ accountId: "personal-one" }));
      const result = await pending;
      return { requests, beforePersonal, stages, account: result.accountId, epochMatches: result.epoch === epoch,
        personal: result.personalAccountId, root: result.root.id, accounts: result.accounts.map(account => account.accountId),
        workspace: result.workspace, subject: auth.subject() };
    }), {
      requests: [
        { path: "/api/auth/personal-account", method: "POST", account: "A", reader: null, cancellable: true },
        { path: "/api/workspace-bootstrap?width=393", method: "GET", account: null, reader: "personal-one", cancellable: true },
      ], beforePersonal: ["/api/auth/personal-account"], stages: ["Loading data…"], account: "A", epochMatches: true,
      personal: "personal-one", root: "personal-root", accounts: ["A"],
      workspace: { status: "deferred" }, subject: { $tag: "User", accountId: "A", userId: "one" },
    });
  }));

  test("leaving startup aborts bootstrap, and a late personal response cannot start another read", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth, session } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const aborted: string[] = [];
      let bootstrapStarted!: () => void;
      const bootstrapRequested = new Promise<void>(resolve => { bootstrapStarted = resolve; });
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = new URL(String(url), location.origin).pathname;
        if (path === "/api/auth/personal-account") return Response.json({ accountId: "personal-one" });
        if (path !== "/api/workspace-bootstrap") throw new Error(`Unexpected request: ${path}`);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => { aborted.push(path); reject(init.signal!.reason); }, { once: true });
          bootstrapStarted();
        });
      };
      const controller = new AbortController();
      const cancelled = auth.loadWorkspaceBootstrap("A", { epoch: session.sessionEpoch(), signal: controller.signal }).then(() => false, () => true);
      await bootstrapRequested;
      controller.abort();
      const cancellation = await cancelled;
      let finishPersonal!: (response: Response) => void;
      const laterRequests: string[] = [];
      (window as unknown as { fetch: BrowserFetch }).fetch = async url => {
        const path = new URL(String(url), location.origin).pathname;
        laterRequests.push(path);
        if (path === "/api/auth/personal-account") return new Promise<Response>(resolve => { finishPersonal = resolve; });
        throw new Error(`Unexpected request after personal acquisition: ${path}`);
      };
      const stale = auth.loadWorkspaceBootstrap("A", { epoch: session.sessionEpoch(), signal: new AbortController().signal }).catch(error => error.name);
      auth._setSubject({ $tag: "User", accountId: "B", userId: "two" });
      finishPersonal(Response.json({ accountId: "personal-one" }));
      return { cancellation, aborted: aborted.sort(), stale: await stale, laterRequests, current: auth.subject() };
    }), { cancellation: true, aborted: ["/api/workspace-bootstrap"], stale: "StaleSessionResponseError",
      laterRequests: ["/api/auth/personal-account"], current: { $tag: "User", accountId: "B", userId: "two" } });
  }));

  for (const coordinate of ["accountId", "personalAccountId"] as const) {
    test(`workspace bootstrap rejects a mismatched ${coordinate} without fallback`, () => fixture(async (page) => {
      equal(await page.evaluate(async (coordinate) => {
        const { auth, session } = fenelBrowserBoundaries;
        auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
        const requests: string[] = [];
        (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => {
          const path = new URL(String(url), location.origin).pathname;
          requests.push(path);
          if (path === "/api/auth/personal-account") return Response.json({ accountId: "personal-one" });
          if (path === "/api/workspace-bootstrap") return Response.json({
            accountId: "A", personalAccountId: "personal-one", [coordinate]: "another-account",
            accounts: [], root: { id: "private-root", revision: 1, items: [] }, workspace: { status: "deferred" },
          });
          throw new Error(`Unexpected fallback request: ${path}`);
        };
        const result = await auth.loadWorkspaceBootstrap("A", { epoch: session.sessionEpoch(), signal: new AbortController().signal })
          .then(() => "accepted", error => error.message);
        return { result, requests, current: auth.subject() };
      }, coordinate), {
        result: "Your account changed while loading your data. Please retry.",
        requests: ["/api/auth/personal-account", "/api/workspace-bootstrap"],
        current: { $tag: "User", accountId: "A", userId: "one" },
      });
    }));
  }

  test("only a missing bootstrap route falls back to the authenticated personal root and account list", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth, session } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const epoch = session.sessionEpoch();
      const requests: Array<{ path: string; account: string | null; reader: string | null }> = [];
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = new URL(String(url), location.origin).pathname;
        const headers = new Headers(init?.headers);
        requests.push({ path, account: headers.get("X-Fenel-Account"), reader: headers.get("X-Fenel-Reader-Account") });
        if (path === "/api/auth/personal-account") return Response.json({ accountId: "personal-one" });
        if (path === "/api/workspace-bootstrap") return Response.json({ error: "Not found" }, { status: 404 });
        if (path === "/api/locus-root") return Response.json({ root: { id: "legacy-root", revision: 7, items: [] } });
        if (path === "/api/auth/accounts") return Response.json({ accounts: [{ accountId: "A", name: "Account A", slug: "a", role: "admin" }] });
        throw new Error(`Unexpected request: ${path}`);
      };
      const result = await auth.loadWorkspaceBootstrap("A", { epoch, signal: new AbortController().signal });
      return { requests: requests.sort((left, right) => left.path.localeCompare(right.path)),
        account: result.accountId, personal: result.personalAccountId, root: result.root.id,
        accounts: result.accounts.map(account => account.accountId), epochMatches: result.epoch === epoch,
        hasWorkspace: Object.hasOwn(result, "workspace") };
    }), {
      requests: [
        { path: "/api/auth/accounts", account: "A", reader: null },
        { path: "/api/auth/personal-account", account: "A", reader: null },
        { path: "/api/locus-root", account: null, reader: "personal-one" },
        { path: "/api/workspace-bootstrap", account: null, reader: "personal-one" },
      ], account: "A", personal: "personal-one", root: "legacy-root", accounts: ["A"], epochMatches: true, hasWorkspace: false,
    });
  }));

  for (const status of [403, 422]) {
    test(`workspace bootstrap refusal ${status} never falls back to older reads`, () => fixture(async (page) => {
      equal(await page.evaluate(async (status) => {
        const { auth, session } = fenelBrowserBoundaries;
        auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
        const requests: string[] = [];
        (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => {
          const path = new URL(String(url), location.origin).pathname;
          requests.push(path);
          if (path === "/api/auth/personal-account") return Response.json({ accountId: "personal-one" });
          if (path === "/api/workspace-bootstrap") return Response.json({ error: "Bootstrap refused" }, { status });
          throw new Error(`Unexpected fallback request: ${path}`);
        };
        const result = await auth.loadWorkspaceBootstrap("A", { epoch: session.sessionEpoch(), signal: new AbortController().signal })
          .then(() => ({ accepted: true, status: 0 }), error => ({ accepted: false, status: error.status }));
        return { result, requests, current: auth.subject() };
      }, status), {
        result: { accepted: false, status }, requests: ["/api/auth/personal-account", "/api/workspace-bootstrap"],
        current: { $tag: "User", accountId: "A", userId: "one" },
      });
    }));
  }

  test("identity transitions publish subject, epoch, and loading together", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth, api, session, createRoot, createEffect, flush } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const initialEpoch = session.sessionEpoch();
      const observations: Array<{ epoch: number; subject: string | undefined; loading: boolean }> = [];
      const dispose = createRoot((dispose) => {
        createEffect(() => {
          const actor = auth.subject();
          return { epoch: session.sessionEpoch() - initialEpoch,
            subject: actor?.$tag === "User" ? actor.accountId : actor?.$tag,
            loading: auth.loading() };
        }, (observation) => { observations.push(observation); });
        return dispose;
      });
      flush();
      auth._setSubject({ $tag: "User", accountId: "B", userId: "two" });
      auth._setSubject(null);
      const immediatePending = auth.loading();
      auth._setSubject({ $tag: "User", accountId: "B", userId: "two" });
      const immediateReady = auth.loading();
      (window as unknown as { fetch: BrowserFetch }).fetch = async () =>
        Response.json({ subject: { $tag: "User", accountId: "C", userId: "three" } });
      await auth.refreshSubject();
      const refreshedReady = auth.loading();
      (window as unknown as { fetch: BrowserFetch }).fetch = async () => new Response("", { status: 401 });
      await api.apiFetch("/account").catch(() => undefined);
      flush();
      dispose();
      return { observations, immediatePending, immediateReady, refreshedReady };
    }), { observations: [
      { epoch: 0, subject: "A", loading: false },
      { epoch: 1, subject: "B", loading: false },
      { epoch: 2, subject: undefined, loading: true },
      { epoch: 3, subject: "B", loading: false },
      { epoch: 3, subject: "B", loading: true },
      { epoch: 4, subject: "C", loading: false },
      { epoch: 6, subject: "Anonymous", loading: false },
    ], immediatePending: true, immediateReady: false, refreshedReady: false });
  }));

  test("boot requests are anonymous by transport, so only they survive the anonymous confirmation", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { api, auth, session } = fenelBrowserBoundaries;
      // A fresh tab: no subject yet. Public and Local preparation start here,
      // before /auth/me answers (2026-10-16 landing race). Another tab's
      // account cookie must not answer into this anonymous frame.
      const boot = session.sessionEpoch();
      const sent: Array<{ path: string; credentials?: string; account: string | null }> = [];
      const held: Array<(value: unknown) => void> = [];
      let reads = 0;
      let me: unknown = { subject: { $tag: "Anonymous" } };
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = String(url);
        sent.push({ path, credentials: init?.credentials, account: new Headers(init?.headers).get("X-Fenel-Account") });
        if (path.endsWith("/auth/me")) return Response.json(me);
        if (path.endsWith("/account")) { reads++; return Response.json({ name: `read ${reads}` }); }
        if (path.endsWith("/needs-cookie")) return new Response("", { status: 401 });
        return ({ ok: true, status: 200, headers: new Headers(), json: () => new Promise((r) => { held.push(r); }) }) as Response;
      };
      const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
      const cachedAtBoot = await api.getAccount();
      // A cookieless 401 says nothing about the session: no expiry, no publish.
      const bootRefusal = await api.apiFetch("/needs-cookie").catch((e) => e.name);
      const afterRefusal = { subject: auth.subject(), epoch: session.sessionEpoch() - boot };
      const bootRead = api.apiFetch("/boot-read").catch((e) => e.name);
      await tick();
      await auth.refreshSubject();
      held[0]!({ value: "anonymous" });
      const kept = await bootRead;
      const cachedAfterAnonymous = await api.getAccount();
      const anonymousRead = api.apiFetch("/session-read").catch((e) => e.name);
      await tick();
      me = { subject: { $tag: "User", accountId: "A", userId: "one" } };
      await auth.refreshSubject();
      held[1]!({ private: "A" });
      const retired = await anonymousRead;
      auth._setSubject(null);
      auth._setSubject({ $tag: "Anonymous" });
      const credentials = Object.fromEntries(sent.filter(request => !request.path.endsWith("/auth/me"))
        .map(request => [request.path, [request.credentials, request.account]]));
      return { cachedAtBoot, bootRefusal, afterRefusal, kept, cachedAfterAnonymous, reads, retired, credentials,
        afterFailedSignIn: session.sessionEpoch() - boot };
    }), { cachedAtBoot: { name: "read 1" }, bootRefusal: "UnauthenticatedError", afterRefusal: { subject: null, epoch: 0 },
      kept: { value: "anonymous" }, cachedAfterAnonymous: { name: "read 1" }, reads: 1, retired: "StaleSessionResponseError",
      credentials: { "/api/account": ["omit", null], "/api/needs-cookie": ["omit", null], "/api/boot-read": ["omit", null],
        "/api/session-read": ["include", null] },
      afterFailedSignIn: 3 });
  }));

  test("a fresh-tab sign-in overlapping the initial /auth/me keeps the signed-in session", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth, session } = fenelBrowserBoundaries;
      const boot = session.sessionEpoch();
      let signedIn = false;
      let initialMe!: (response: Response) => void;
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = String(url);
        if (path.startsWith("/api/readiness")) return Response.json({ status: "ready" });
        if (path === "/api/auth/login" && init?.method === "POST") { signedIn = true; return Response.json({}); }
        if (path === "/api/auth/me" && !signedIn) return new Promise<Response>((resolve) => { initialMe = resolve; });
        return Response.json({ subject: { $tag: "User", accountId: "A", userId: "one" } });
      };
      const initial = auth.refreshSubject();
      for (let i = 0; i < 6; i++) await Promise.resolve();
      const result = await auth.login({ email: "test@example.test", password: "synthetic" });
      const afterLogin = session.sessionEpoch() - boot;
      initialMe(Response.json({ subject: { $tag: "Anonymous" } }));
      await initial;
      return { result, subject: auth.subject(), loading: auth.loading(), afterLogin, afterLateMe: session.sessionEpoch() - boot };
    }), { result: { $tag: "User", accountId: "A", userId: "one" }, subject: { $tag: "User", accountId: "A", userId: "one" },
      loading: false, afterLogin: 2, afterLateMe: 2 });
  }));

  test("router query keys and cached values change across accounts and same-account sessions", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { api, auth } = fenelBrowserBoundaries;
      let name = "A";
      let reads = 0;
      (window as unknown as { fetch: BrowserFetch }).fetch = async () => { reads++; return Response.json({ name }); };
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const firstKey = api.getAccount.keyFor();
      const first = await api.getAccount();
      await api.getAccount(); // same-session hit remains deduplicated
      name = "B";
      auth._setSubject({ $tag: "User", accountId: "B", userId: "two" });
      const second = await api.getAccount();
      auth._setSubject({ $tag: "Anonymous" });
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      name = "A-again";
      const third = await api.getAccount();
      return { first, second, third, reads, changed: firstKey !== api.getAccount.keyFor() };
    }), { first: { name: "A" }, second: { name: "B" }, third: { name: "A-again" }, reads: 3, changed: true });
  }));

  test("late JSON and stale 401 responses cannot cross a session boundary", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { api, auth } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      let json!: (value: unknown) => void;
      (window as unknown as { fetch: BrowserFetch }).fetch = async () => ({ ok: true, status: 200, headers: new Headers(), json: () => new Promise((r) => { json = r; }) }) as Response;
      const pending = api.apiFetch("/account").catch((e) => e.name);
      await Promise.resolve();
      auth._setSubject({ $tag: "User", accountId: "B", userId: "two" });
      json({ private: "A" });
      const staleJson = await pending;
      let finish!: (value: Response) => void;
      (window as unknown as { fetch: BrowserFetch }).fetch = () => new Promise((r) => { finish = r; });
      const old401 = api.apiFetch("/account").catch((e) => e.name);
      auth._setSubject({ $tag: "User", accountId: "C", userId: "three" });
      finish(new Response("", { status: 401 }));
      return { staleJson, stale401: await old401, subject: auth.subject() };
    }), { staleJson: "StaleSessionResponseError", stale401: "StaleSessionResponseError", subject: { $tag: "User", accountId: "C", userId: "three" } });
  }));

  test("disposing a reader aborts its readiness recovery without clearing the login session", () => fixture(async (page) => {
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(60_000);
    const result = await page.evaluate(async () => {
      const { api, auth, session, flush } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const epoch = session.sessionEpoch();
      const reader = api.createAccountApiClient("B", { epoch });
      const requests: string[] = [];
      let readinessSignal: AbortSignal | null | undefined;
      let notifyWaiting!: () => void;
      const waiting = new Promise<void>(resolve => { notifyWaiting = resolve; });
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = String(url);
        requests.push(path);
        if (path === "/api/locus-root") return new Response("Starting", { status: 503 });
        if (path === "/api/readiness") return Response.json({ status: "loading" });
        if (path === "/api/readiness?wait=1") return new Promise<Response>((_resolve, reject) => {
          readinessSignal = init?.signal;
          readinessSignal?.addEventListener("abort", () => reject(readinessSignal!.reason), { once: true });
          notifyWaiting();
        });
        throw new Error(`Unexpected reader request: ${path}`);
      };
      const pending = reader.getLocusRoot.uncached().then(() => "accepted", error => error.message);
      await waiting;
      flush();
      const before = api.apiReadConnectionStatus();
      reader.dispose();
      const immediatelyAborted = readinessSignal?.aborted ?? false;
      const outcome = immediatelyAborted ? await pending : "still polling";
      flush();
      // Keep observing the same request list after advancing the fake clock.
      Object.assign(window, { readerRecoveryRequests: requests });
      return { before, immediatelyAborted, outcome, status: api.apiReadConnectionStatus(),
        subject: auth.subject(), sameEpoch: session.sessionEpoch() === epoch, requests };
    });
    equal(result, { before: "loading", immediatelyAborted: true, outcome: "This reader was closed.", status: null,
      subject: { $tag: "User", accountId: "A", userId: "one" }, sameEpoch: true,
      requests: ["/api/locus-root", "/api/readiness", "/api/readiness?wait=1"] });
    await page.clock.runFor(60_000);
    equal(await page.evaluate(() => (window as unknown as { readerRecoveryRequests: string[] }).readerRecoveryRequests), result.requests);
    equal(await page.evaluate(() => fenelBrowserBoundaries.api.apiReadConnectionStatus()), null);
  }));

  test("editor metadata reads recover after a temporary server failure under the same reader", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { api, auth, session } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const epoch = session.sessionEpoch();
      const reader = api.createAccountApiClient("B", { epoch });
      const requests: Array<{ path: string; account: string | null }> = [];
      let reads = 0;
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = String(url);
        requests.push({ path, account: new Headers(init?.headers).get("X-Fenel-Reader-Account") });
        if (path === "/api/readiness") return Response.json({ status: "ready" });
        if (path === "/api/dispatch-instances") {
          reads++;
          return reads === 1 ? new Response("Restarting", { status: 503 }) : Response.json({ dispatchInstances: [] });
        }
        throw new Error(`Unexpected metadata request: ${path}`);
      };
      const result = await reader.getDispatchInstances.uncached();
      reader.dispose();
      return { result, requests, sameEpoch: session.sessionEpoch() === epoch };
    }), { result: { dispatchInstances: [] }, sameEpoch: true, requests: [
      { path: "/api/dispatch-instances", account: "B" },
      { path: "/api/readiness", account: null },
      { path: "/api/dispatch-instances", account: "B" },
    ] });
  }));

  test("closing a reader discards late bodies and a late 401 without expiring the login", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { api, auth } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const first = api.createAccountApiClient("B");
      let finishBody!: (value: unknown) => void;
      let bodyStarted!: () => void;
      const body = new Promise<unknown>(resolve => { finishBody = resolve; });
      const readingBody = new Promise<void>(resolve => { bodyStarted = resolve; });
      (window as unknown as { fetch: BrowserFetch }).fetch = async () => ({
        ok: true, status: 200, headers: new Headers(), json: () => { bodyStarted(); return body; },
      }) as Response;
      const bodyResult = first.apiFetch("/account").then(() => "accepted", error => error.name);
      await readingBody;
      first.dispose();
      finishBody({ name: "closed reader" });
      const second = api.createAccountApiClient("C");
      let finishResponse!: (value: Response) => void;
      (window as unknown as { fetch: BrowserFetch }).fetch = () => new Promise(resolve => { finishResponse = resolve; });
      const authResult = second.apiFetch("/account").then(() => "accepted", error => error.name);
      second.dispose();
      finishResponse(new Response("", { status: 401 }));
      return { body: await bodyResult, response: await authResult, subject: auth.subject() };
    }), { body: "AbortError", response: "AbortError", subject: { $tag: "User", accountId: "A", userId: "one" } });
  }));

  test("a current 401 expires auth and an older auth/me response cannot restore it", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { api, auth } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      let me!: (value: Response) => void;
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => String(url).endsWith("/auth/me")
        ? new Promise<Response>((r) => { me = r; })
        : new Response("", { status: 401 });
      const refresh = auth.refreshSubject();
      const error = await api.apiFetch("/account").catch((e) => e.name);
      me(Response.json({ subject: { $tag: "User", accountId: "A", userId: "one" },
        profile: { $tag: "UserProfile", email: "old@example.test", name: { $tag: "Nothing" } } }));
      await refresh;
      return { error, subject: auth.subject(), loading: auth.loading(), profile: auth.userProfile() };
    }), { error: "UnauthenticatedError", subject: { $tag: "Anonymous" }, loading: false, profile: undefined });
  }));

  test("an unavailable session endpoint stays unresolved and a successful retry identifies the session", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth, flush } = fenelBrowserBoundaries;
      auth._setSubject(null);
      (window as unknown as { fetch: BrowserFetch }).fetch = async () => new Response("Starting", { status: 503 });
      const failure = await auth.refreshSubject().then(() => "accepted", error => error.message);
      flush();
      const unresolved = { subject: auth.subject(), loading: auth.loading(), error: auth.subjectResolutionError() };
      (window as unknown as { fetch: BrowserFetch }).fetch = async () => Response.json({ subject: { $tag: "User", accountId: "A", userId: "one" } });
      await auth.refreshSubject();
      flush();
      return { failure, unresolved, subject: auth.subject(), loading: auth.loading(), error: auth.subjectResolutionError() };
    }), { failure: "Could not check your sign-in. Please retry.",
      unresolved: { subject: null, loading: false, error: "Could not check your sign-in. Please retry." },
      subject: { $tag: "User", accountId: "A", userId: "one" }, loading: false, error: undefined });
  }));

  test("logout clears local state before its network response, and anonymous login resolution rejects", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      (window as unknown as { fetch: BrowserFetch }).fetch = async () => Response.json({
        subject: { $tag: "User", accountId: "A", userId: "one" },
        profile: { $tag: "UserProfile", email: "person@example.test", name: { $tag: "Just", _0: "Person" } },
      });
      await auth.refreshSubject();
      const profileBefore = auth.userProfile();
      let finish!: (value: Response) => void;
      (window as unknown as { fetch: BrowserFetch }).fetch = () => new Promise((r) => { finish = r; });
      const logout = auth.logout();
      const immediate = auth.subject();
      const profileAfter = auth.userProfile();
      const revoking = auth.loading();
      finish(Response.json({}));
      await logout;
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => Response.json(
        String(url) === "/api/readiness" ? { status: "ready" }
          : String(url).endsWith("/auth/me") ? { subject: { $tag: "Anonymous" } } : {},
      );
      const error = await auth.login({ email: "test@example.test", password: "synthetic" }).then(() => "accepted", (e) => e.message);
      return { immediate, revoking, error, loading: auth.loading(), profileBefore, profileAfter };
    }), { immediate: { $tag: "Anonymous" }, revoking: true, error: "Login succeeded but session resolution failed", loading: false,
      profileBefore: { $tag: "UserProfile", email: "person@example.test", name: { $tag: "Just", _0: "Person" } }, profileAfter: undefined });
  }));

  test("sign-in distinguishes service outages from rejected credentials and allows retry", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth } = fenelBrowserBoundaries;
      const failures = [];
      for (const response of [
        new Response("error code: 502", { status: 502 }),
        new Response("<html>Service Unavailable</html>", { status: 503 }),
        Response.json({ error: "Internal Server Error" }, { status: 500 }),
        new Response("", { status: 401 }),
        new Response("", { status: 429 }),
        Response.json({ error: "email and password required" }, { status: 400 }),
        Response.json({ error: { message: "Malformed response" } }, { status: 400 }),
      ]) {
        const requests: string[] = [];
        (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => {
          requests.push(String(url));
          return String(url) === "/api/readiness" ? Response.json({ status: "ready" }) : response;
        };
        const error = await auth.login({ email: "test@example.test", password: "synthetic" })
          .then(() => "accepted", (e) => e.message);
        failures.push({ error, anonymous: auth.subject()?.$tag === "Anonymous", loading: auth.loading(), requests });
      }
      const requests: string[] = [];
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => {
        requests.push(String(url));
        return Response.json(String(url) === "/api/readiness" ? { status: "ready" }
          : String(url).endsWith("/auth/me") ? { subject: { $tag: "User", accountId: "A", userId: "one" } } : {});
      };
      const retry = await auth.login({ email: "test@example.test", password: "synthetic" });
      return { failures, requests, retry, authenticated: auth.isAuthenticated(), loading: auth.loading() };
    }), {
      failures: [
        "Sign-in is temporarily unavailable. Please try again in a moment.",
        "Sign-in is temporarily unavailable. Please try again in a moment.",
        "Sign-in is temporarily unavailable. Please try again in a moment.",
        "Invalid email or password",
        "Too many sign-in attempts. Please try again later.",
        "email and password required",
        "Sign-in failed. Please try again.",
      ].map((error) => ({ error, anonymous: true, loading: false, requests: ["/api/readiness", "/api/auth/login"] })),
      requests: ["/api/readiness", "/api/auth/login", "/api/auth/me"],
      retry: { $tag: "User", accountId: "A", userId: "one" },
      authenticated: true,
      loading: false,
    });
  }));

  test("sign-in waits for API readiness before sending credentials once", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth } = fenelBrowserBoundaries;
      const requests: string[] = [];
      const statuses: string[] = [];
      const credentialPosts: string[] = [];
      let ready!: (response: Response) => void;
      let notifyWaiting!: () => void;
      const waiting = new Promise<void>((resolve) => { notifyWaiting = resolve; });
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = String(url);
        requests.push(path);
        if (path === "/api/readiness") return Response.json({ status: "loading" });
        if (path === "/api/readiness?wait=1") return new Promise<Response>((resolve) => {
          ready = resolve;
          notifyWaiting();
        });
        if (init?.method === "POST") credentialPosts.push(String(init.body));
        return Response.json(path === "/api/auth/me"
          ? { subject: { $tag: "User", accountId: "A", userId: "one" } } : {});
      };
      const pending = auth.login({ email: "test@example.test", password: "synthetic" }, {
        onStatus: (status) => statuses.push(status),
      });
      await waiting;
      const beforeReady = { requests: [...requests], statuses: [...statuses], credentialPosts: credentialPosts.length, loading: auth.loading() };
      ready(Response.json({ status: "ready" }));
      const result = await pending;
      return { beforeReady, requests, statuses, credentialPosts, result, subject: auth.subject(), loading: auth.loading() };
    }), {
      beforeReady: { requests: ["/api/readiness", "/api/readiness?wait=1"], statuses: ["connecting", "loading"], credentialPosts: 0, loading: true },
      requests: ["/api/readiness", "/api/readiness?wait=1", "/api/auth/login", "/api/auth/me"],
      statuses: ["connecting", "loading", "ready"],
      credentialPosts: [JSON.stringify({ email: "test@example.test", password: "synthetic" })],
      result: { $tag: "User", accountId: "A", userId: "one" },
      subject: { $tag: "User", accountId: "A", userId: "one" },
      loading: false,
    });
  }));

  test("an unavailable API backs off before reconnecting and cancellation clears that retry", async () => {
    for (const cancel of [false, true]) await fixture(async (page) => {
      await page.clock.install({ time: 0 });
      await page.clock.pauseAt(60_000);
      const scenario = await page.evaluateHandle(() => {
        const { auth } = fenelBrowserBoundaries;
        const controller = new AbortController();
        const requests: string[] = [];
        const statuses: string[] = [];
        const credentialPosts: string[] = [];
        let notifyBackoff!: () => void;
        let notifyRetried!: () => void;
        let ready!: (response: Response) => void;
        const backoff = new Promise<void>((resolve) => { notifyBackoff = resolve; });
        const retried = new Promise<void>((resolve) => { notifyRetried = resolve; });
        let probes = 0;
        (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
          const path = String(url);
          requests.push(path);
          if (path === "/api/readiness") {
            if (++probes === 1) return Response.json({ status: "unavailable" });
            return new Promise<Response>((resolve) => {
              ready = resolve;
              notifyRetried();
            });
          }
          if (init?.method === "POST") credentialPosts.push(String(init.body));
          return Response.json(path === "/api/auth/me"
            ? { subject: { $tag: "User", accountId: "A", userId: "one" } } : {});
        };
        const pending = auth.login({ email: "test@example.test", password: "synthetic" }, {
          signal: controller.signal,
          onStatus: (status) => {
            statuses.push(status);
            if (statuses.length === 2 && status === "connecting") notifyBackoff();
          },
        }).then(() => "accepted", (error) => error.name);
        return { controller, requests, statuses, credentialPosts, backoff, retried, pending,
          respondReady: () => ready(Response.json({ status: "ready" })) };
      });
      equal(await scenario.evaluate(async (state) => {
        await state.backoff;
        return { requests: state.requests, statuses: state.statuses, credentialPosts: state.credentialPosts.length };
      }), { requests: ["/api/readiness"], statuses: ["connecting", "connecting"], credentialPosts: 0 });
      await page.clock.runFor(999);
      equal(await scenario.evaluate((state) => state.requests), ["/api/readiness"]);
      if (cancel) {
        await scenario.evaluate((state) => { state.controller.abort(); });
        equal(await scenario.evaluate((state) => state.pending), "AbortError");
        await page.clock.runFor(10_000);
        equal(await scenario.evaluate((state) => ({ requests: state.requests, credentialPosts: state.credentialPosts.length,
          subject: fenelBrowserBoundaries.auth.subject(), loading: fenelBrowserBoundaries.auth.loading() })), {
          requests: ["/api/readiness"], credentialPosts: 0, subject: { $tag: "Anonymous" }, loading: false,
        });
      } else {
        await page.clock.runFor(1);
        equal(await scenario.evaluate(async (state) => {
          await state.retried;
          return { requests: state.requests, credentialPosts: state.credentialPosts.length };
        }), { requests: ["/api/readiness", "/api/readiness"], credentialPosts: 0 });
        equal(await scenario.evaluate(async (state) => {
          state.respondReady();
          const result = await state.pending;
          return { result, requests: state.requests, statuses: state.statuses, credentialPosts: state.credentialPosts.length,
            subject: fenelBrowserBoundaries.auth.subject(), loading: fenelBrowserBoundaries.auth.loading() };
        }), {
          result: "accepted", requests: ["/api/readiness", "/api/readiness", "/api/auth/login", "/api/auth/me"],
          statuses: ["connecting", "connecting", "ready"], credentialPosts: 1,
          subject: { $tag: "User", accountId: "A", userId: "one" }, loading: false,
        });
      }
      await scenario.dispose();
    });
  });

  test("cancelled readiness cannot send credentials when a stale ready response arrives", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth } = fenelBrowserBoundaries;
      const controller = new AbortController();
      const requests: string[] = [];
      let ready!: (response: Response) => void;
      let readinessSignal: AbortSignal | null | undefined;
      let notifyWaiting!: () => void;
      const waiting = new Promise<void>((resolve) => { notifyWaiting = resolve; });
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = String(url);
        requests.push(path);
        if (path === "/api/readiness") return Response.json({ status: "loading" });
        if (path === "/api/readiness?wait=1") return new Promise<Response>((resolve) => {
          // Deliberately ignore cancellation to exercise a late response that
          // has already passed the browser's network boundary.
          readinessSignal = init?.signal;
          ready = resolve;
          notifyWaiting();
        });
        throw new Error(`Unexpected request after cancellation: ${path}`);
      };
      const pending = auth.login({ email: "test@example.test", password: "synthetic" }, { signal: controller.signal })
        .then(() => "accepted", (error) => error.name);
      await waiting;
      controller.abort();
      ready(Response.json({ status: "ready" }));
      return { error: await pending, requests, aborted: readinessSignal?.aborted, subject: auth.subject(), loading: auth.loading() };
    }), {
      error: "AbortError", requests: ["/api/readiness", "/api/readiness?wait=1"], aborted: true,
      subject: { $tag: "Anonymous" }, loading: false,
    });
  }));

  test("cancelling during auth/me JSON never publishes the resolved account", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth, createRoot, createEffect, flush } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "Anonymous" });
      const controller = new AbortController();
      const observations: Array<string | null> = [];
      const dispose = createRoot((dispose) => {
        createEffect(() => auth.subject()?.$tag ?? null, (value) => { observations.push(value); });
        return dispose;
      });
      flush();
      let body!: (value: unknown) => void;
      let notifyReading!: () => void;
      const reading = new Promise<void>((resolve) => { notifyReading = resolve; });
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => {
        const path = String(url);
        if (path === "/api/readiness") return Response.json({ status: "ready" });
        if (path === "/api/auth/login") return Response.json({});
        if (path === "/api/auth/me") return {
          ok: true,
          json: () => new Promise((resolve) => {
            body = resolve;
            notifyReading();
          }),
        } as Response;
        throw new Error(`Unexpected request: ${path}`);
      };
      const pending = auth.login({ email: "test@example.test", password: "synthetic" }, { signal: controller.signal })
        .then(() => "accepted", (error) => error.name);
      await reading;
      controller.abort();
      body({ subject: { $tag: "User", accountId: "A", userId: "one" } });
      const error = await pending;
      flush();
      dispose();
      return { error, observations, subject: auth.subject(), loading: auth.loading() };
    }), { error: "AbortError", observations: ["Anonymous", null, "Anonymous"], subject: { $tag: "Anonymous" }, loading: false });
  }));

  test("an explicit API startup failure stops sign-in without sending credentials", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth } = fenelBrowserBoundaries;
      const requests: string[] = [];
      const statuses: string[] = [];
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => {
        requests.push(String(url));
        return Response.json({ status: "failed" });
      };
      const error = await auth.login({ email: "test@example.test", password: "synthetic" }, {
        onStatus: (status) => statuses.push(status),
      }).then(() => "accepted", (error) => error.message);
      return { error, requests, statuses, subject: auth.subject(), loading: auth.loading() };
    }), {
      error: "The API could not start. Please try again after it restarts.",
      requests: ["/api/readiness"], statuses: ["connecting", "failed"], subject: { $tag: "Anonymous" }, loading: false,
    });
  }));

  test("simultaneous account readers isolate queries and reference labels without an ambient fallback", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { api, auth, refs } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const a = api.createAccountApiClient("A");
      const b = api.createAccountApiClient("B");
      const forbidden = api.createAccountApiClient("forbidden");
      const publicReader = api.createPublicApiClient();
      const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
      const reply = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body }) as Response;
      const requests: string[] = [];
      let finishA!: (value: Response) => void;
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const target = new Headers(init?.headers).get("X-Fenel-Reader-Account") ?? "ambient";
        const path = String(url);
        requests.push(target + ":" + path);
        if (target === "forbidden") return new Response("Reader access denied", { status: 403 });
        if (path === "/api/entity-instances/Profile") {
          if (target === "A") return new Promise<Response>((resolve) => { finishA = resolve; });
          return reply({ instances: [{ id: "same-id", data: { name: "B label" } }] });
        }
        return Response.json({ name: target });
      };
      const firstAccount = await a.getAccount();
      const secondAccount = await b.getAccount();
      await a.getAccount();
      await b.getAccount();
      refs.refLabel("Profile", "same-id", a);
      refs.refLabel("Profile", "same-id", b);
      await tick();
      const whilePending = [refs.refLabel("Profile", "same-id", a), refs.refLabel("Profile", "same-id", b)];
      finishA(reply({ instances: [{ id: "same-id", data: { name: "late A label" } }] }));
      await tick();
      const afterA = [refs.refLabel("Profile", "same-id", a), refs.refLabel("Profile", "same-id", b)];
      const refused = await forbidden.apiFetch("/account").then(() => "allowed", (error) => error.status);
      const beforePublic = requests.length;
      const publicRefused = await publicReader.apiFetch("/account").then(() => false, () => true);
      refs.refLabel("Profile", "same-id", publicReader);
      await tick();
      const publicRequests = requests.length - beforePublic;
      auth._setSubject({ $tag: "Anonymous" });
      const revoked = [refs.refLabel("Profile", "same-id", a), refs.refLabel("Profile", "same-id", b)];
      for (const client of [a, b, forbidden, publicReader]) client.dispose();
      return { firstAccount, secondAccount, differentKeys: a.getAccount.key !== b.getAccount.key,
        whilePending, afterA, refused, publicRefused, publicRequests, revoked, requests };
    }), {
      firstAccount: { name: "A" }, secondAccount: { name: "B" }, differentKeys: true,
      whilePending: [undefined, "B label"], afterA: ["late A label", "B label"],
      refused: 403, publicRefused: true, publicRequests: 0, revoked: [undefined, undefined],
      requests: ["A:/api/account", "B:/api/account", "A:/api/entity-instances/Profile",
        "B:/api/entity-instances/Profile", "forbidden:/api/account"],
    });
  }));

  test("ref labels retry failures, refresh after writes and discard older loads", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { api, auth, refs } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
      const reply = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body }) as Response;
      let reads = 0;
      let label = "first";
      (window as unknown as { fetch: BrowserFetch }).fetch = async (_url, init) => {
        if (init?.method === "PATCH") return reply({});
        reads++;
        if (reads === 1) return { ok: false, status: 503, text: async () => "temporary" } as Response;
        return reply({ instances: [{ id: "shared", data: { name: label } }] });
      };
      refs.refLabel("Profile", "shared"); await tick();
      refs.refLabel("Profile", "shared"); await tick();
      const retried = refs.refLabel("Profile", "shared");
      label = "renamed";
      await api.apiFetch("/profiles/shared", { method: "PATCH" });
      refs.refLabel("Profile", "shared"); await tick();
      const renamed = refs.refLabel("Profile", "shared");
      refs.invalidateRefLabels();
      let old!: (value: Response) => void;
      (window as unknown as { fetch: BrowserFetch }).fetch = () => new Promise((r) => { old = r; });
      refs.refLabel("Profile", "shared");
      auth._setSubject({ $tag: "User", accountId: "B", userId: "two" });
      (window as unknown as { fetch: BrowserFetch }).fetch = async () => reply({ instances: [{ id: "shared", data: { name: "account B" } }] });
      const initially = refs.refLabel("Profile", "shared"); await tick();
      old(reply({ instances: [{ id: "shared", data: { name: "late A" } }] })); await tick();
      return { retried, renamed, initially, final: refs.refLabel("Profile", "shared") };
    }), { retried: "first", renamed: "renamed", initially: undefined, final: "account B" });
  }));

  test("account selection revokes old browser scope before changing the cookie and confirms the target", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth, session } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      const epoch = session.sessionEpoch();
      const requests: string[] = [];
      let atWrite: unknown;
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url, init) => {
        const path = String(url);
        requests.push(path);
        if (path === "/api/readiness") return Response.json({ status: "ready" });
        if (path === "/api/auth/switch-account") {
          atWrite = { body: JSON.parse(String(init?.body)), subject: auth.subject(), loading: auth.loading(),
            revoked: session.sessionEpoch() > epoch };
          return Response.json({});
        }
        if (path === "/api/auth/me") return Response.json({ subject: { $tag: "User", accountId: "B", userId: "one" } });
        throw new Error(`Unexpected request: ${path}`);
      };
      const resolved = await auth.switchAccount("B");
      return { atWrite, requests, resolved, subject: auth.subject(), loading: auth.loading(), error: auth.accountSwitchError() };
    }), {
      atWrite: { body: { accountId: "B" }, subject: null, loading: true, revoked: true },
      requests: ["/api/readiness", "/api/auth/switch-account", "/api/auth/me"],
      resolved: { $tag: "User", accountId: "B", userId: "one" },
      subject: { $tag: "User", accountId: "B", userId: "one" }, loading: false, error: null,
    });
  }));

  test("a denied account change resolves the actual cookie account and keeps one actionable error", () => fixture(async (page) => {
    equal(await page.evaluate(async () => {
      const { auth } = fenelBrowserBoundaries;
      auth._setSubject({ $tag: "User", accountId: "A", userId: "one" });
      let writes = 0;
      (window as unknown as { fetch: BrowserFetch }).fetch = async (url) => {
        const path = String(url);
        if (path === "/api/readiness") return Response.json({ status: "ready" });
        if (path === "/api/auth/switch-account") { writes++; return Response.json({ error: "Access removed" }, { status: 403 }); }
        if (path === "/api/auth/me") return Response.json({ subject: { $tag: "User", accountId: "A", userId: "one" } });
        throw new Error(`Unexpected request: ${path}`);
      };
      const result = await auth.switchAccount("B").then(() => "accepted", (error) => error.message);
      return { result, writes, subject: auth.subject(), loading: auth.loading(), error: auth.accountSwitchError() };
    }), { result: "Access removed", writes: 1, subject: { $tag: "User", accountId: "A", userId: "one" },
      loading: false, error: "Access removed" });
  }));
});

test("sign-in return paths remain local and avoid sign-in loops", () => fixture(async (page) => {
  equal(await page.evaluate(() => {
    const { localReturnPath } = fenelBrowserBoundaries.auth;
    return ["/app/types?filter=active#record", "https://example.test", "//example.test", "/\\example.test", "/login?next=/login", undefined].map(localReturnPath);
  }), ["/app/types?filter=active#record", "/app", "/app", "/app", "/app", "/app"]);
}));

test("stored preview data cannot invoke Solid DOM escape hatches or active HTML", () => fixture(async (page) => {
  equal(await page.evaluate(() => {
    const { browserPreviewElement, Dynamic, render } = fenelBrowserBoundaries;
    const source = [{ key: "innerHTML", value: '<img src=x onerror="window.previewPwned=true">' },
      { key: "onClick", value: "window.previewPwned=true" }, { key: "onclick", value: "window.previewPwned=true" },
      { key: "href", value: "java\nscript:window.previewPwned=true" }, { key: "children", value: "replaced" },
      { key: "ref", value: "bad" }, { key: "srcdoc", value: "<script>alert(1)</script>" }];
    const before = JSON.stringify(source);
    const preview = browserPreviewElement("a", source);
    render(() => Dynamic({ component: preview.tag, ...preview.attrs, children: "safe text" }), document.body);
    const link = document.querySelector("a")!;
    link.click();
    return { text: link.textContent, images: document.querySelectorAll("img").length,
      href: link.getAttribute("href"), onclick: link.getAttribute("onclick"), unchanged: before === JSON.stringify(source),
      tags: ["script", "iframe", "object", "embed", "svg", "math", "base", "style", "custom-element"].map((tag) => browserPreviewElement(tag, []).tag) };
  }), { text: "safe text", images: 0, href: null, onclick: null, unchanged: true, tags: Array(9).fill("div") });
}));

test("preview keeps safe links, media, field attributes and typography", () => fixture(async (page) => {
  equal(await page.evaluate(() => {
    const { browserPreviewElement } = fenelBrowserBoundaries;
    const attrs = (data: Record<string, string>) => Object.entries(data).map(([key, value]) => ({ key, value }));
    const link = browserPreviewElement("a", attrs({ href: "https://example.test/path", target: "_blank" }));
    const media = browserPreviewElement("video", attrs({ src: "/clip.mp4", poster: "/cover.png", controls: "", onerror: "bad" }));
    const input = browserPreviewElement("input", attrs({ type: "email", name: "email", placeholder: "Your email", required: "", "aria-label": "Email", form: "login-form" }));
    const style = browserPreviewElement("div", attrs({ style: "color: red; padding: 4px; position:fixed; background-color:url(https://bad.test)" }));
    return { link, media, input, style };
  }), { link: { tag: "a", attrs: { href: "https://example.test/path", target: "_blank", rel: "noopener noreferrer" } },
    media: { tag: "video", attrs: { src: "/clip.mp4", poster: "/cover.png", controls: true } },
    input: { tag: "input", attrs: { type: "email", name: "email", placeholder: "Your email", required: true, "aria-label": "Email" } },
    style: { tag: "div", attrs: { style: "color: red; padding: 4px" } } });
}));
