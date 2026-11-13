import { createSignal, snapshot } from "solid-js";
import { render } from "@solidjs/web";
import {
  ExpressionEditor, ExpressionTrace, LambdaParamsContext,
  logicToExprNode, toLogic, type ExprNode, type LambdaParam,
} from "./index";
import { ExpressionPicker } from "../expression-builder/ExpressionPicker";
import { fixtureSession } from "../expression-builder/predicate-workbench.browser-fixture";
import { AuthoringSessionContext } from "./authoring-session";
import { LocaleStringEditor } from "../representations/LocaleStringEditor";
import { LayoutDefEditor, ListDisplayEditor, SelectOptionsEditor } from "../view-editor";
import { normalizeTypeViewDraft, type TypeViewDraft } from "@fenel/engine/authoring/surface";
import { FunctionSpecEditor } from "../function-spec-editor/FunctionSpecEditor";
import type { FenelFunction } from "@fenel/engine/types";

let dispose: (() => void) | undefined;
let read: () => unknown = () => undefined;
let readNode: () => ExprNode = () => ({ kind: "literal", value: null });
let setParams: (params: LambdaParam[]) => void = () => {};
let emitted: unknown[] = [];
let readPresentation: () => TypeViewDraft = () => ({ name: "fixture" });
let readFunction: () => FenelFunction | undefined = () => undefined;

const api = {
  mount(value: unknown, params: LambdaParam[] = [], adapter = false) {
    dispose?.();
    emitted = [];
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => {
      const session = fixtureSession();
      const [scope, updateScope] = createSignal(params);
      const [node, setNode] = createSignal(logicToExprNode(value, params.map((param) => param.name), session));
      const [raw, setRaw] = createSignal(value);
      read = raw;
      readNode = node;
      setParams = updateScope;
      const change = (next: ExprNode) => {
        const logic = toLogic(next, undefined, session);
        setNode(next);
        setRaw(() => logic);
        emitted.push(logic);
      };
      return <AuthoringSessionContext value={session}>
        <LambdaParamsContext value={scope}>
          {adapter
            ? <ExpressionPicker value={raw()} onChange={(next) => { setRaw(() => next); emitted.push(next); }} />
            : <ExpressionEditor expr={node()} onChange={change} authoringSession={session} />}
        </LambdaParamsContext>
      </AuthoringSessionContext>;
    }, host);
  },
  state: () => ({ value: read(), emitted, serialized: toLogic(readNode(), undefined, fixtureSession()) }),
  replaceParams: (params: LambdaParam[]) => setParams(params),
  mountPresentation(value: TypeViewDraft) {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => {
      const [draft, setDraft] = createSignal(value);
      readPresentation = draft;
      return <AuthoringSessionContext value={fixtureSession()}>
        <LocaleStringEditor value={draft().description} methodName="Description"
          onChange={(description) => setDraft({ ...draft(), description })} />
        <SelectOptionsEditor value={draft().editDisplay?.options ?? []}
          onChange={(options) => setDraft({ ...draft(), editDisplay: { ...draft().editDisplay, options } })} />
        <LayoutDefEditor value={draft().layout} onChange={(layout) => setDraft({ ...draft(), layout })} />
        <ListDisplayEditor value={draft().listDisplay} onChange={(listDisplay) => setDraft({ ...draft(), listDisplay })} />
      </AuthoringSessionContext>;
    }, host);
  },
  presentation: () => normalizeTypeViewDraft(readPresentation()),
  mountFunction(value: FenelFunction) {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => {
      const [definition, setDefinition] = createSignal(value);
      readFunction = definition;
      return <AuthoringSessionContext value={fixtureSession()}>
        <FunctionSpecEditor value={definition()} onChange={setDefinition} authoringMode="draft-only" />
      </AuthoringSessionContext>;
    }, host);
  },
  functionValue: () => readFunction(),
  traceError() {
    dispose?.();
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => <ExpressionTrace snapshot={{ result: undefined, trace: [], error: "Fixture evaluation failed" }} />, host);
  },
};

declare global { var expressionWorkbench: typeof api; }
globalThis.expressionWorkbench = api;
