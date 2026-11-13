// Demo 1 blocker 4 (2026-11-07): a Local type's "Edit…" dialog was replaced by
// "getEntityInstances is unavailable in This tab". The Local client refuses the
// endpoint by throwing synchronously, so `client.getEntityInstances(name).catch`
// never ran and the throw reached the dialog's Errored boundary.
// Run: bun test ./src/lib/instance-detail/entity-instances-panel.test.ts (distro dir).
import { describe, expect, test } from "bun:test";

const panelPath = process.env.ENTITY_PANEL_SOURCE ?? new URL("./EntityInstancesPanel.tsx", import.meta.url);
const homePath = process.env.HOME_SOURCE ?? new URL("../../routes/app/home.tsx", import.meta.url);
const panel = (await Bun.file(panelPath).text()).replaceAll("\r\n", "\n");
const home = (await Bun.file(homePath).text()).replaceAll("\r\n", "\n");

describe("EntityInstancesPanel under a client without the endpoint", () => {
  test("a synchronously refusing client yields no rows, never a thrown error", async () => {
    const line = panel.split("\n").find(row => row.includes("const resp = createMemo("));
    if (!line) throw new Error("EntityInstancesPanel's instance read changed");
    const body = line.slice(line.indexOf("createMemo(") + "createMemo(".length, line.lastIndexOf(");"));
    const read = new Function("client", "props", `return (${body});`);
    const refusing = { getEntityInstances: (name: string) => { throw new Error(`getEntityInstances is unavailable in This tab (${name})`); } };
    let result: unknown;
    expect(() => { result = read(refusing, { name: "Person" })(); }).not.toThrow();
    expect(await result).toBeNull();
    const answering = { getEntityInstances: async () => ({ instances: [{ id: "a", data: {} }] }) };
    expect(await read(answering, { name: "Person" })()).toEqual({ instances: [{ id: "a", data: {} }] });
  });

  test("an empty list says nothing (no empty-state claim about the data)", () => {
    expect(panel).not.toContain("No instances yet");
  });

  test("the type inspector lists a Local tab's own data of the type, as the type card does", () => {
    const start = home.indexOf("<EntityInstancesPanel");
    const inspector = home.slice(Math.max(0, start - 200), start + 600);
    expect(inspector).toContain('reader?.kind === "local"');
    expect(inspector).toContain("<LocalTypeInstances");
    const card = home.slice(home.indexOf("function TypePinCard("), home.indexOf("function entityNameFromTaggedId("));
    expect(card).toContain("<LocalTypeInstances");
  });
});
