// A21 (Nov 12, Rom: "When there is a labelable instance, you show it. But when there is no labelable instance, you
// show the codeable instance in monospace codeface ... when we input something in the demo as a user, it creates a
// labelable instance"). A type a person names "Transaction" stores the label "Transaction" and the derived code
// name "Transaction"; the reader collapsed a label equal to the code name into the code name, so it read as code.
// A label taken from a Labelable instance (the engine emits one only when a label was authored) is a label even when
// it equals the code name; with no Labelable instance the code name keeps the code face. No registry.
//   bun test ./distros/narthex/solid/src/lib/presented-name.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { presentedDisplayName } from "./display-name";

const source = async (path: string) => (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll("\r\n", "\n");

describe("a presented name", () => {
  test("an authored label reads as a label, also when it equals the code name", () => {
    expect(presentedDisplayName({ label: "Transaction", codeName: "Transaction", labelAuthored: true })).toEqual({ text: "Transaction", code: false });
    expect(presentedDisplayName({ label: { en: "Person" }, codeName: "Person", labelAuthored: true })).toEqual({ text: "Person", code: false });
    expect(presentedDisplayName({ label: "Bank transaction", codeName: "BankTransaction", labelAuthored: true })).toEqual({ text: "Bank transaction", code: false });
  });

  test("without a Labelable instance the code name keeps the code face (the rule as before)", () => {
    expect(presentedDisplayName({ codeName: "Transaction" })).toEqual({ text: "Transaction", code: true });
    // A projected label equal to the code name is that code name.
    expect(presentedDisplayName({ label: "Transaction", codeName: "Transaction" })).toEqual({ text: "Transaction", code: true });
    expect(presentedDisplayName({ label: "Solve", codeName: "solve" })).toEqual({ text: "Solve", code: false });
    expect(presentedDisplayName({ label: " ", codeName: "x", labelAuthored: true })).toEqual({ text: "x", code: true });
    expect(presentedDisplayName(undefined)).toBeUndefined();
  });
});

describe("the reader paths carry the provenance", () => {
  test("a Labelable instance's label is marked authored in the reader presentation, and the caption honours it", async () => {
    const reader = await source("./reader-presentation.ts");
    expect(reader).toContain("labelAuthored?: boolean;");
    expect(reader).toContain('const authored = valueCardLabel(methods.get("Labelable")?.label)?.trim();');
    expect(reader).toContain("const caption = authored ? { text: valueCardLabel(own!.label)!, code: false }");
  });

  test("the typed reader's callables, references and captions use it", async () => {
    const read = await source("./layout-renderer/TypedReadValue.tsx");
    expect(read).toContain("name: presentedDisplayName(metadata) ?? (entry ? functionDisplayName(entry) : undefined),");
    expect(read).toContain("return metadata ? { name: presentedDisplayName(metadata), icon: metadata.icon,");
    expect(read).toContain("return presentedDisplayName(presentation || undefined);");
  });

  test("Home's card caption asks for the authored Labelable first", async () => {
    const home = await source("../routes/app/home.tsx");
    expect(home).toContain('const authored = locale(reader ? reader.representation("Labelable", id)?.label : getLabel(id));\n      if (authored?.trim()) return humanName(authored);');
    expect(home).toContain("|| (target ? presentedName(target.id) : undefined);");
  });

  test("display is otherwise unchanged: no code name is humanised on a reading surface", async () => {
    expect(await source("./display-name.ts")).not.toContain("humanizedCodeName");
    expect(await source("./value-card.tsx")).toContain("<DisplayNameText name={props.caption} />");
  });
});
