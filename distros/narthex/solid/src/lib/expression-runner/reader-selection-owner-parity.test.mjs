import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { fieldChoiceSelectionPlan, fieldListChipsSelectionPlan, fieldListChipsEditPlan } from "@fenel/engine/authoring/field-render";
import { withInterpretedCompiledArtifacts } from "@fenel/engine/engine-bodies-dispatch";
// The receiver forwards reader-extension methods first (129cce4c); bind the real router.
import { isReaderExtensionMethod, runReaderExtension } from "./authoring-worker-reader-extensions";

// Real receiver and unchanged Fenel selection owners; only reader preparation
// and browser delivery are controlled. This is separate from the actual DOM
// gesture fixtures and does not establish full Local startup acceptance.
const source = readFileSync(new URL("./authoring-catalog-worker-main.ts", import.meta.url), "utf8");
const start = source.indexOf("const scope =");
if (start < 0) throw new Error("Worker receiver source boundary moved");
const receiver = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start))
  .replaceAll("import.meta.env.BASE_URL", '"/"');
function worker() {
  const replies = [], frame = {};
  const imports = {
    globalThis: { postMessage: reply => replies.push(structuredClone(reply)) }, registryTransportSnapshot,
    fieldChoiceSelectionPlan, fieldListChipsSelectionPlan, fieldListChipsEditPlan, frame,
    isReaderExtensionMethod, runReaderExtension,
  };
  const api = new Function(...Object.keys(imports), `${receiver};
    base = { registry: {}, environment: {}, evaluateContext: frame };
    localFieldSource = { sourceId: 'selection-owner-parity', snapshot: {} };
    return { run };`)(...Object.values(imports));
  return { replies, frame, async run(payload) {
    const request = structuredClone(registryTransportSnapshot({ ...payload, id: replies.length + 1, contextId: 0 },
      "selection owner request", "equality"));
    await api.run(request);
    const answer = replies.filter(reply => "ok" in reply).at(-1);
    expect(answer.ok).toBe(true);
    return answer.result;
  } };
}

test("transported choice selection retains the actual source owner's typed equality", async () => {
  const h = worker(), values = [1, "1", false, "false", "", [1, 2], { b: 2, a: 1 }];
  const options = values.map(value => ({ value, label: "Same visible label" }));
  for (let index = 0; index < values.length; index++) {
    const value = structuredClone(values[index]);
    const expected = withInterpretedCompiledArtifacts(() => fieldChoiceSelectionPlan(options, value, h.frame));
    const reply = await h.run({ method: "project-reader-choice-selection", options, value });
    expect(reply.selection).toEqual(expected);
    expect(reply.selection.selectedIndex).toEqual({ $tag: "Just", _0: index });
  }
  const hidden = Object.defineProperty({}, "secret", { value: 1 });
  const unreadable = withInterpretedCompiledArtifacts(() => fieldChoiceSelectionPlan([{ value: {}, label: "Empty" }], hidden, h.frame));
  expect(unreadable.selectedIndex).toEqual({ $tag: "Nothing" });
  expect(() => registryTransportSnapshot({ options: [{ value: {}, label: "Empty" }], value: hidden },
    "selection owner request", "equality")).toThrow();
}, 60_000);

test("transported list selection retains source duplicate occurrence positions", async () => {
  const h = worker(), options = [{ value: false, label: "False" }, { value: "false", label: "Text" }];
  const value = [false, "false", false];
  const expected = withInterpretedCompiledArtifacts(() => fieldListChipsSelectionPlan(options, value, h.frame));
  const reply = await h.run({ method: "project-reader-list-selection", options, value });
  expect(reply.selection).toEqual(expected);
  expect(reply.selection.occurrences).toEqual([0, 1, 0].map(_0 => ({ $tag: "Just", _0 })));
  expect(reply.selection.selected).toEqual([true, true]);
}, 60_000);
