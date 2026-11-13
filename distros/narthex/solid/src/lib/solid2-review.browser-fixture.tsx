// Real components under Solid 2's browser runtime; only network IO is mocked.
import "@fenel/engine";
import { Errored, Loading, useContext } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory } from "@solidjs/router";
import { Nothing } from "@fenel/engine/type-foundation";
import { FieldRenderer, ExprFieldContext } from "./field-renderer/FieldRenderer";
import { useParams } from "./field-renderer/params-context";
import { useRefCreator, useRefResolver } from "./field-renderer/ref-context";
import { useEntityComponent } from "./field-renderer/entity-components";
import { useFieldAuthoringContext } from "./field-occurrence/context";
import { ActivePickerContext, ExpressionEditor, ExpressionTrace, SavedValuesContext } from "./expression-runner";
import { AuthoringSessionContext } from "./expression-runner/authoring-session";
import { fixtureSession } from "./expression-builder/predicate-workbench.browser-fixture";
import { FenelForm } from "./widget/FenelForm";
import { FunctionInstancesSection } from "../routes/app/types/[id]/usages";
import { setBrowserAccountScope } from "./browser-session";

let dispose: (() => void) | undefined;
const originalFetch = globalThis.fetch.bind(globalThis);
const errors: string[] = [];

function ContextReaders() {
  const absent = [useRefResolver(), useRefCreator(), useEntityComponent(), useFieldAuthoringContext(),
    useContext(ExprFieldContext), useContext(SavedValuesContext), useContext(ActivePickerContext)];
  if (!absent.every(value => value === null) || useParams().length !== 0) throw new Error("Optional context defaults changed");
  return <p data-context-readers>Optional contexts available</p>;
}

function Contexts() {
  return <AuthoringSessionContext value={fixtureSession()}>
    <ContextReaders />
    <ExpressionEditor expr={{ kind: "literal", value: 42 }} onChange={() => {}} />
    <ExpressionTrace snapshot={{ result: 42, trace: [] }} />
    <FieldRenderer identityMode="transient" field={{ name: "name", type: { $ref: "String" }, label: Nothing, meta: {}, ui: Nothing }} value="editable" onChange={() => {}} />
  </AuthoringSessionContext>;
}

const reviewFixture = {
  mount(scenario: "contexts" | "widget-network" | "widget-json" | "links") {
    dispose?.();
    errors.length = 0;
    Object.assign(globalThis, { fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname.includes("/embed/forms/")) {
        if (scenario === "widget-network") throw new Error("fixture network unavailable");
        return new Response("not JSON", { headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/api/functions/fixture-function/instances") {
        return Response.json({ instances: [{ instanceId: "fixture-instance", profileId: "fixture-profile", status: "completed" }] });
      }
      return originalFetch(input, init);
    } });
    setBrowserAccountScope("solid2-review", true);
    const Router = createRouter({ history: memoryHistory("/"), routes: [
      { path: "/", component: () => <FunctionInstancesSection fnId="fixture-function" fnName="fixture-function" /> },
      { path: "/app/types/entity:profile/:id", component: () => <p data-destination>Profile destination</p> },
      { path: "/app/functions/:name/instances/:id", component: () => <p data-destination>Instance destination</p> },
    ] });
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => <Errored fallback={error => {
      const message = String(error());
      errors.push(message);
      return <pre data-fixture-error>{message}</pre>;
    }}><Loading fallback={<p>Loading fixture…</p>}>
      {scenario === "contexts" ? <Contexts /> : scenario === "links" ? <Router /> :
        <FenelForm apiUrl="/api" accountId="fixture-account" formSlug="fixture-form" />}
    </Loading></Errored>, host);
  },
  errors: () => [...errors],
  dispose() { dispose?.(); dispose = undefined; globalThis.fetch = originalFetch; },
};

declare global { var solid2Review: typeof reviewFixture; }
globalThis.solid2Review = reviewFixture;
