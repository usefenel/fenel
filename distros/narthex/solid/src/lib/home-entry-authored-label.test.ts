// Lane D (2026-11-08): a type card titled by the label the person typed
// ("Person", a Labelable instance equal to its code name) reads in the label
// face, not the code face. A projected label that only fell back to the code
// name stays a code name. Runs the actual `home-entry.tsx` region with stub
// projections; no registry, worker or DOM.
//   bun test --timeout 60000 ./distros/narthex/solid/src/lib/home-entry-authored-label.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { codeName, humanName, pickDisplayName, valueCardLabel } from "./display-name";

const source = (await readFile(new URL("./home-entry.tsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
function region(start: string, end: string): string {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  if (first < 0 || last <= first) throw new Error(`The home-entry source region moved: ${start}`);
  return source.slice(first, last);
}
type Instances = Record<string, Record<string, Record<string, unknown>>>;
function names(state: { own?: Record<string, unknown>; projected?: Instances; runtime?: Instances }) {
  const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(
    `function fixture() {\n${region("  function previewDisplayName(", "  function previewLabel(")}\nreturn previewDisplayName;\n}`);
  return new Function("readLocusCatalogReference", "projectedOwnPresentation", "projectedPreviewRepresentation", "valueCardLabel",
    "pickDisplayName", "humanName", "props", "sessionEpoch", "workspace", `${code}\nreturn fixture();`)(
    (value: { id?: string }) => value?.id ? { id: value.id } : undefined,
    () => state.own,
    (target: string, typeName: string) => state.projected?.[target]?.[typeName],
    valueCardLabel, pickDisplayName, humanName,
    { readRuntime: state.runtime ? { epoch: 1, client: { signal: { aborted: false } },
      representation: (typeName: string, target: string) => state.runtime?.[target]?.[typeName] } : undefined },
    () => 1, { ready: () => true },
  ) as (value: unknown, representations: unknown, fallback: unknown, caption?: string) => unknown;
}

describe("a card title equal to its code name", () => {
  test("an authored Labelable label reads as a label", () => {
    // Local reader: the projection says "Person", the worker has its Labelable instance.
    const local = names({ own: { label: "Person", codeName: "Person" }, runtime: { t1: { Labelable: { label: "Person" } } } });
    expect(local({ id: "t1" }, undefined, "Data")).toEqual(humanName("Person"));
    // The occurrence's own representations, or the projected instances.
    expect(names({})({ id: "t2" }, { Labelable: { label: "Transaction" }, Codeable: { codeName: "Transaction" } }, "Data"))
      .toEqual(humanName("Transaction"));
    expect(names({ projected: { t3: { Labelable: { label: "Person" }, Codeable: { codeName: "Person" } } } })({ id: "t3" }, undefined, "Data"))
      .toEqual(humanName("Person"));
  });

  test("a projected label that only fell back to the code name stays a code name", () => {
    expect(names({ own: { label: "person", codeName: "person" } })({ id: "t4" }, undefined, "Data")).toEqual(codeName("person"));
    expect(names({ own: { label: "Person", codeName: "Person" }, runtime: {} })({ id: "t5" }, undefined, "Data")).toEqual(codeName("Person"));
  });

  test("a distinct label stays a label and no name keeps the fallback", () => {
    expect(names({ own: { label: "A person", codeName: "Person" } })({ id: "t6" }, undefined, "Data")).toEqual(humanName("A person"));
    expect(names({})({}, undefined, "Data")).toBe("Data");
  });
});
