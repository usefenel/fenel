// Test-only DOM boundary: the set fixture supplies its detached catalog.
import "../expression-builder/predicate-workbench.browser-fixture";
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import type { FenelType } from "@fenel/engine/types";
import { TypeBuilder } from "./TypeBuilder";
import { createRouter, memoryHistory } from "@solidjs/router";
import CreateTypePage from "~/routes/app/types/create";
import { UserDefinedTypeDetail } from "~/routes/app/types/[id]/index";

let dispose: (() => void) | undefined;
let read = (): FenelType | undefined => undefined;
let changes: FenelType[] = [];
Object.assign(globalThis, { typeSetWorkbench: {
  mountTypeDetail(definition: { id: string; name: string; label: string; type: FenelType }) {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    (Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 10000;
    try {
      const FixtureRouter = createRouter({
        history: memoryHistory("/"),
        routes: [{ path: "/", component: () => <UserDefinedTypeDetail name={definition.name} id={definition.id} data={{ definition }} onReload={async () => {}} /> }],
      });
      dispose = render(() => <FixtureRouter />, host);
    } catch (cause) {
      const tail = cause instanceof Error ? cause.stack?.split("\n").filter((line) => !line.includes("/node_modules/") && !line.includes("/json-logic.ts:")).slice(-65).join("\n") : String(cause);
      throw new Error(tail);
    }
  },
  mountCreateType() {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    const FixtureRouter = createRouter({
      history: memoryHistory("/"),
      routes: [
        { path: "/", component: CreateTypePage },
        { path: "/app/types/*", component: () => <div>Created type</div> },
      ],
    });
    dispose = render(() => <FixtureRouter />, host);
  },
  mountType(value: FenelType) {
    dispose?.();
    changes = [];
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => {
      const [current, setCurrent] = createSignal(value);
      read = current;
      return <TypeBuilder value={current()} onChange={(next) => { changes.push(next); setCurrent(next); }} />;
    }, host);
  },
  state: () => ({ value: read(), changes }),
} });
