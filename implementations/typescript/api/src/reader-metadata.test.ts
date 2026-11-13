import { describe, expect, test } from "bun:test";
import { createDispatchRegistry, resolveEffect, type FenelFunction } from "@fenel/engine";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { dispatchTestKernel, mintTestAuthorityForAccount, testDescriptorEnvelope } from "../../engine/src/authority-test-support";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { Hono } from "hono";
import { createReaderMetadataTargetsRoutes, projectReaderMetadata } from "./reader-metadata";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TARGET = "reader-metadata-fixture:effect";
const LONG = 600_000;

describe("reader metadata target HTTP projection", () => {
  test("a refused reader receives no account rows or cached target list", async () => {
    let reads = 0;
    const routes = createReaderMetadataTargetsRoutes({
      canRead: async () => false,
      readRows: async () => { reads++; return [{ args: ["private-target"] }]; },
    });
    const response = await routes.request("/reader-metadata/targets");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("private-target");
    expect(reads).toBe(0);
  });

  test("target reads stay under the selected reader and never project methods", async () => {
    const events: string[] = [];
    const rows = {
      A: [{ args: ["target-a"], get instance() { throw new Error("Methods must not be encoded"); } },
        { args: ["target-a"] }, { args: [] }, { args: [""] }, { args: [12] }],
      B: [{ args: ["target-b"] }],
    };
    const app = new Hono();
    app.use("*", async (context, next) => {
      context.set("reader" as never, (context.req.header("fixture-reader") ?? "A") as never);
      await next();
    });
    app.route("/", createReaderMetadataTargetsRoutes({
      canRead: async context => { events.push(`permit:${context.get("reader" as never)}`); return true; },
      readRows: async context => {
        const reader = context.get("reader" as never) as "A" | "B";
        events.push(`read:${reader}`); return rows[reader];
      },
    }));
    expect(await (await app.request("/reader-metadata/targets", { headers: { "fixture-reader": "B" } })).json())
      .toEqual({ targets: ["target-b"] });
    expect(await (await app.request("/reader-metadata/targets")).json()).toEqual({ targets: ["target-a"] });
    rows.A.splice(0);
    expect(await (await app.request("/reader-metadata/targets")).json()).toEqual({ targets: [] });
    expect(events).toEqual(["permit:B", "read:B", "permit:A", "read:A", "permit:A", "read:A"]);
  });
});

function fixture() {
  // The metadata projection really performs the two authorized registry reads;
  // use their existing native owner, rather than the judge-only mint fixture.
  const kernel = dispatchTestKernel();
  const instances = createDispatchRegistry();
  for (const type of dispatchRegistry.listClasses()) instances.defineClass(type);
  for (const instance of dispatchRegistry.listInstances()) instances.addInstance(instance);
  instances.addInstance({ typeName: "Taggable", args: [TARGET], methods: { tags: ["global"] }, scope: "global", priority: 1 });
  instances.addInstance({ typeName: "Taggable", args: [TARGET], methods: { tags: ["account-a"] }, scope: { kind: "account", accountId: A }, priority: 10 });
  instances.addInstance({ typeName: "Taggable", args: [TARGET], methods: { tags: ["io", "account-b"] }, scope: { kind: "account", accountId: B }, priority: 20 });
  instances.addInstance({ typeName: "Labelable", args: [TARGET], methods: { label: "Global winner" }, scope: "global", priority: 50 });
  instances.addInstance({ typeName: "Labelable", args: [TARGET], methods: { label: "Lower account label" }, scope: { kind: "account", accountId: B }, priority: 20 });
  instances.addInstance({ typeName: "Viewable", args: [TARGET], methods: { defaultView: Just("reader-b-view"), defaultInlineView: Nothing }, scope: { kind: "account", accountId: B }, priority: 20 });
  instances.addInstance({ typeName: "IOInvokable", args: [TARGET], methods: { ioAction: "reader-b.action", stopAction: Nothing, listInstancesAction: Nothing }, scope: { kind: "account", accountId: B }, priority: 20 });
  instances.addInstance({ typeName: "PrivateCredentialHandler", args: [TARGET], methods: { secret: "credential-must-not-be-projected" }, scope: { kind: "account", accountId: B }, priority: 20 });
  const envelope = testDescriptorEnvelope(["dispatch:listAllInstances", "dispatch:lookupOne"], kernel);
  const frame = (account: string) => ({ ...kernel.evaluateContext(), _specRegistry: instances,
    _authority: mintTestAuthorityForAccount(account, envelope, kernel) });
  const fresh = (account: string) => instances.listInstances().filter(instance =>
    typeof instance.scope === "object" && instance.scope?.kind === "account" && instance.scope.accountId === account);
  return { instances, frame, fresh };
}

describe("authenticated reader UI metadata projection", () => {
  test("own function icon provenance survives account HTTP projection while full structural Iconable stays available", () => {
    const { frame, instances, fresh } = fixture();
    const callable: FenelFunction = { id: TARGET, params: [], returns: { $ref: "String" } };
    const forAccount = (account: string) => {
      const base = frame(account);
      return { ...base, getFunction: (id: string) => id === TARGET ? callable : base.getFunction?.(id) };
    };
    const reader = forAccount(B);
    const selected = resolveEffect(reader, instances, "Iconable", TARGET);
    expect(selected?.methods.icon).toBe("function");
    if (selected?.source.kind !== "instance") throw new Error("Expected the authored structural callable icon.");
    expect(selected.source.instance.args as unknown).toEqual([{ $pattern: "engine.isArrowType" }]);
    const generic = projectReaderMetadata(reader, [TARGET], fresh(B)).entries[0]!;
    expect(generic.representations.find(row => row.typeName === "Iconable")?.methods.icon).toBe("function");
    expect(generic.ownPresentation.icon).toBeUndefined();
    instances.addInstance({ typeName: "Iconable", args: [TARGET], methods: { icon: "book-open" },
      scope: { kind: "account", accountId: B }, priority: 100 });
    const own = projectReaderMetadata(reader, [TARGET], fresh(B)).entries[0]!;
    expect(own.ownPresentation.icon).toBe("book-open");
    expect(projectReaderMetadata(forAccount(A), [TARGET], fresh(A)).entries[0]!.ownPresentation.icon).toBeUndefined();
    const lexical = { ...reader, _dictStack: [{ typeName: "Iconable", args: [TARGET], methods: { icon: "star" } }] };
    expect(projectReaderMetadata(lexical, [TARGET], fresh(B)).entries[0]!.ownPresentation.icon).toBe("star");
    instances.removeInstancesOwnedBy(B);
    expect(projectReaderMetadata(reader, [TARGET], fresh(B)).entries[0]!.ownPresentation.icon).toBeUndefined();
  }, LONG);

  test("B sees its IO classification and view while A cannot borrow them", () => {
    const { frame, fresh } = fixture();
    const b = projectReaderMetadata(frame(B), [TARGET], fresh(B)).entries[0]!;
    const a = projectReaderMetadata(frame(A), [TARGET], fresh(A)).entries[0]!;
    const methods = (entry: typeof b, typeName: string) => entry.representations.find((value) => value.typeName === typeName)?.methods;
    expect(methods(b, "Taggable")?.tags).toEqual(["io", "account-b"]);
    expect(b.ioInvokable?.ioAction).toBe("reader-b.action");
    expect(methods(b, "Viewable")?.defaultView).toEqual(Just("reader-b-view"));
    expect(methods(a, "Taggable")?.tags).toEqual(["account-a"]);
    expect(a.ioInvokable).toBeUndefined();
    expect(methods(a, "Viewable")).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain("credential-must-not-be-projected");
  }, LONG);

  test("the canonical global priority and inner lexical override survive projection", () => {
    const { frame, fresh } = fixture();
    const scoped = { ...frame(B), _dictStack: [{ typeName: "Taggable", args: [TARGET], methods: { tags: ["lexical"] } }] };
    const entry = projectReaderMetadata(scoped, [TARGET], fresh(B)).entries[0]!;
    expect(entry.representations.find((value) => value.typeName === "Labelable")?.methods.label).toBe("Global winner");
    expect(entry.representations.find((value) => value.typeName === "Taggable")?.methods.tags).toEqual(["lexical"]);
  }, LONG);

  test("a fresh projection removes deleted overrides and rejects a forged frame", () => {
    const { frame, instances, fresh } = fixture();
    const reader = frame(B);
    expect(projectReaderMetadata(reader, [TARGET], fresh(B)).entries[0]!.ioInvokable).toBeDefined();
    instances.removeInstancesOwnedBy(B);
    const next = projectReaderMetadata(reader, [TARGET], fresh(B)).entries[0]!;
    expect(next.ioInvokable).toBeUndefined();
    expect(next.representations.find((value) => value.typeName === "Taggable")?.methods.tags).toEqual(["global"]);
    expect(() => projectReaderMetadata({ ...reader, _authority: undefined }, [TARGET], [])).toThrow("authenticated account frame");
  }, LONG);

  test("fresh account rows preserve source, tag and lexical instances without changing either shared registry", () => {
    const { frame, instances, fresh } = fixture();
    // A source-local row exists in this frame, not in the process registry.
    instances.addInstance({ typeName: "Describable", args: [TARGET], methods: { description: "Source-local description" }, scope: "global", priority: 10 });
    instances.addInstance({ typeName: "Taggable", args: [TARGET], methods: { tags: ["tag"] }, scope: { kind: "tag", tag: "experiment" }, priority: 40 });
    const version = instances.version();
    const globalVersion = dispatchRegistry.version();
    const original = instances.listInstances();
    // The incoming scope claims global ownership; refresh must derive B from
    // the authority instead. The omitted Viewable/IOInvokable rows are deleted.
    const rows = [{ typeName: "Taggable", args: [TARGET], methods: { tags: ["fresh-b"] }, scope: "global" as const, priority: 25 }];
    const reader = frame(B);
    const entry = projectReaderMetadata(reader, [TARGET], rows).entries[0]!;
    const methods = (value: typeof entry, name: string) => value.representations.find(instance => instance.typeName === name)?.methods;
    expect(methods(entry, "Taggable")?.tags).toEqual(["fresh-b"]);
    expect(methods(entry, "Describable")?.description).toBe("Source-local description");
    expect(methods(entry, "Labelable")?.label).toBe("Global winner");
    expect(methods(entry, "Viewable")).toBeUndefined();
    expect(entry.ioInvokable).toBeUndefined();
    expect(methods(projectReaderMetadata({ ...reader, _activeTags: ["experiment"] }, [TARGET], rows).entries[0]!, "Taggable")?.tags).toEqual(["tag"]);
    expect(methods(projectReaderMetadata({ ...reader, _activeTags: ["experiment"],
      _dictStack: [{ typeName: "Taggable", args: [TARGET], methods: { tags: ["lexical"] } }] }, [TARGET], rows).entries[0]!, "Taggable")?.tags).toEqual(["lexical"]);
    expect(methods(projectReaderMetadata(frame(A), [TARGET], fresh(A)).entries[0]!, "Taggable")?.tags).toEqual(["account-a"]);
    expect(projectReaderMetadata(reader, [], rows).entries).toEqual([]);
    expect(() => projectReaderMetadata({ ...reader, _authority: undefined }, [], rows)).toThrow("authenticated account frame");
    expect(instances.version()).toBe(version);
    expect(dispatchRegistry.version()).toBe(globalVersion);
    expect(instances.listInstances()).toEqual(original);
  }, LONG);
});
