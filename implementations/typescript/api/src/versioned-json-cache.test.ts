import { expect, test } from "bun:test";
import { createVersionedJsonCache } from "./versioned-json-cache";

test("private catalog validation reuses bytes and invalidates edits, accounts and code generations", async () => {
  const cached = createVersionedJsonCache({ generation: "code-v1" });
  let version = "snapshot-v1";
  let calls = 0;
  const body = { functions: ["original"] };
  const input = { accountId: "account-a", resource: "functions", revision: async () => version,
    load: async () => { calls++; return body; },
  };
  const first = await cached(input);
  const tag = first.headers.get("etag")!;
  expect(first.headers.get("cache-control")).toBe("private, no-cache");
  expect(first.headers.get("vary")).toBe("Cookie, Authorization");
  body.functions[0] = "mutated caller object";
  expect(await (await cached(input)).json()).toEqual({ functions: ["original"] });
  const validated = await cached({ ...input, ifNoneMatch: `"unrelated", W/${tag}` });
  expect(validated.status).toBe(304);
  expect(await validated.text()).toBe("");
  expect(calls).toBe(1);
  version = "snapshot-v2";
  expect((await cached({ ...input, ifNoneMatch: tag })).status).toBe(200);
  expect(calls).toBe(2);
  expect((await cached({ ...input, accountId: "account-b", ifNoneMatch: tag })).status).toBe(200);
  expect(calls).toBe(3);
  const restarted = createVersionedJsonCache({ generation: "code-v2" });
  expect((await restarted({ ...input, ifNoneMatch: tag })).status).toBe(200);
  expect(calls).toBe(4);
});

test("a revision change during loading cannot label or retain the mixed read", async () => {
  const cached = createVersionedJsonCache();
  let version = "before";
  let calls = 0;
  const input = { accountId: "account", resource: "types", revision: async () => version,
    load: async () => { calls++; version = "after"; return { types: [calls] }; },
  };
  const first = await cached(input);
  expect(first.headers.get("etag")).toBeNull();
  expect(first.headers.get("cache-control")).toBe("no-store");
  const next = await cached(input);
  expect(next.headers.get("etag")).not.toBeNull();
  expect(await next.json()).toEqual({ types: [2] });
});

test("concurrent identical reads share work and failures remain retryable", async () => {
  const cached = createVersionedJsonCache();
  let calls = 0;
  let finish!: (value: unknown) => void;
  const input = { accountId: "account", resource: "functions", revision: async () => "v1",
    load: () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
  };
  const first = cached(input);
  const second = cached(input);
  await Promise.resolve();
  expect(calls).toBe(1);
  finish({ functions: [] });
  expect(await (await first).json()).toEqual(await (await second).json());
  let fail = true;
  const retry = { ...input, resource: "types", load: async () => {
    if (fail) throw new Error("temporary read failure");
    return { types: [] };
  } };
  await expect(cached(retry)).rejects.toThrow("temporary read failure");
  fail = false;
  expect((await cached(retry)).status).toBe(200);
});

test("revision failures never use cached bytes and eviction stays bounded", async () => {
  const cached = createVersionedJsonCache({ maxEntries: 1, maxBytes: 64 });
  let fail = false;
  let calls = 0;
  const input = { accountId: "account-a", resource: "types",
    revision: async () => { if (fail) throw new Error("database unavailable"); return "v1"; },
    load: async () => ({ call: ++calls }),
  };
  const first = await cached(input);
  fail = true;
  const uncached = await cached({ ...input, ifNoneMatch: first.headers.get("etag")! });
  expect(uncached.status).toBe(200);
  expect(uncached.headers.get("etag")).toBeNull();
  expect(calls).toBe(2);
  fail = false;
  await cached({ ...input, accountId: "account-b" });
  await cached(input);
  expect(calls).toBe(4);
  const oversized = { ...input, resource: "large", load: async () => { calls++; return "x".repeat(100); } };
  await cached(oversized);
  await cached(oversized);
  expect(calls).toBe(6);
});
