import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { FenelType } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { DisplayNameInput } from "../display-name";
import type { AuthoringSession } from "../expression-runner/authoring-session";
import type { SourceReaderValueReadPacket } from "../reader-presentation";
import { DataPreview, hasDataPreview } from "./DataPreview";
import { assertCurrentSession, sessionEpoch } from "../browser-session";
import { cloneDraftValue } from "../native-draft";
import { DataTransferTarget } from "./DataTransferTarget";
import { classifyData, ingestTransfer, type TransferItem, type TransferSnapshot } from "./index";
import { expressionForTransfer, typeForTransfer, prepareTransferItem } from "./expressions";
import { childValueType } from "./child-type";
import { adaptTransferForSession } from "./session-analysis";
import { useReaderRuntime } from "../reader-runtime";
import { createLocalTransferCopy, localEditorSession } from "../expression-runner/local-editor-reads";

/** `edit` says where the change is, so the host keeps the rest of the
 *  authored expression: a replacement at a path, or items appended to the list
 *  at a path (which keeps that list's references and calls as they are). */
export type ValueEdit =
  | { path: readonly (string | number)[]; expr: ExprNode }
  | { path: readonly (string | number)[]; append: readonly ExprNode[] };
type ValueChange = { value: unknown; expr: ExprNode; type?: FenelType; revision?: number; edit?: ValueEdit };
export type ValueStructureFacts = () => { facts: SourceReaderValueReadPacket | undefined; value: unknown };
export type ValueStructureRender = (facts?: ValueStructureFacts) => JSX.Element;
export type ContainedValueWrapper = (value: ContainedValuePreview, render: (structure?: ValueStructureRender) => JSX.Element) => JSX.Element;
export type ContainedValuePreview = {
  value: unknown;
  /** Contextual navigation label; a list position is not the data's name. */
  label: string;
  /** Optional occurrence/name binding for standalone navigation. A detailed
   * record's parent owns its field label; it is not the data's own name.
   * A code name without a label is marked for the code face. */
  caption?: DisplayNameInput;
  path: readonly (string | number)[];
  getType: () => FenelType | undefined;
  /** Optional current-reader card projections, never type/evaluation evidence. */
  typeLabel?: string;
  typeIcon?: string;
  valueIcon?: string;
  valueEmoji?: string;
  /** Ready paint supplied only by the typed browser owner. */
  readFacts?: SourceReaderValueReadPacket;
  readCurrent?: () => boolean;
};

/** Value display with the same transfer boundary used by expression slots. */
export function DataValueSurface(props: {
  value: unknown;
  type?: FenelType;
  getType?: () => FenelType | undefined;
  label?: string;
  /** A read-only transport preview can inspect structure before tools load. */
  session?: () => AuthoringSession;
  revision?: () => number;
  /** A Local reader's saved value is answered by its worker (a promise, as `ingestTransfer` reads it). */
  resolveSavedValue?: (id: string) => TransferItem | undefined | Promise<TransferItem | undefined>;
  depth?: number;
  path?: readonly (string | number)[];
  /** Optional lens navigation around the existing recursive read surface. */
  renderChild?: (value: ContainedValuePreview, render: (facts?: ValueStructureFacts) => JSX.Element) => JSX.Element;
  /** The typed owner selects one body; missing compound views use this structure. */
  renderValue?: (value: ContainedValuePreview, render: (facts?: ValueStructureFacts) => JSX.Element,
    wrapper?: ContainedValueWrapper) => JSX.Element;
  /** The typed reader supplies source-owned structure facts for this exact
   * value. Descendant typed readers supply their own immediate-child packet. */
  readFacts?: SourceReaderValueReadPacket;
  /** Internal recursive handoff: never classify a Local child before its
   * typed owner has supplied that child's ready source packet. */
  requiresReadFacts?: boolean;
  /** The ready typed child already chose structure; keep this node's Copy and
   * expansion owner without asking the same typed value to choose again. */
  structuralOnly?: boolean;
  /** Internal typed-child handoff; older renderValue callbacks retain their
   * original wrapper/transfer behavior unless they opt into this port. */
  preparedChildren?: boolean;
  renderBody?: (structure: ValueStructureRender) => JSX.Element;
  current?: () => boolean;
  /** A shared typed presentation above the retained structural inspection. */
  presentation?: JSX.Element;
  /** The TOP-LEVEL surface of a card whose bar already carries Copy. Only this
   *  frame stands down — nested fields keep their own, because no bar of theirs
   *  exists to move it to. */
  hideCopy?: boolean;
  /** Omitted for computed/read-only data; Copy and media previews remain. */
  onChange?: (next: ValueChange) => Promise<void> | void;
}) {
  const [visible, setVisible] = createSignal(props.depth ? 8 : 40);
  const [expanded, setExpanded] = createSignal((props.depth ?? 0) === 0);
  const effectiveType = createMemo(() => props.type ?? props.getType?.(), { lazy: true });
  const item = (): TransferItem => ({ value: cloneDraftValue(props.value), type: effectiveType(),
    typeName: classifyData(props.value), label: props.label, source: "fenel" });
  // B4 wave 4 lane E: a Local reader's copy and drag are prepared in its
  // worker on intent (`prepare-reader-transfer-item`), so the gesture writes
  // synchronously; until that item lands they refuse visibly. The page
  // registry and frame are never read for it.
  const reader = useReaderRuntime();
  const localCopy = reader?.kind === "local" ? createLocalTransferCopy(() => reader, () => props.session?.() ?? reader.session(),
    () => props.value == null || !props.session || !localEditorSession(reader, props.session()) ? undefined : item()) : undefined;
  const localSession = () => !!localCopy && !!props.session && localEditorSession(reader, props.session());

  async function transfer(captured: TransferSnapshot, signal: AbortSignal) {
    const current = props.current;
    const assertCurrent = () => {
      if (props.current !== current || current && !current())
        throw new Error("This data changed. Paste or drop again when its display is ready.");
    };
    assertCurrent();
    if (!props.onChange || !props.session) return;
    const epoch = sessionEpoch();
    const previous = props.value;
    const previousType = effectiveType();
    const revision = props.revision?.();
    const items = await ingestTransfer(captured, { signal, resolveSavedValue: props.resolveSavedValue });
    signal.throwIfAborted();
    assertCurrent();
    assertCurrentSession(epoch);
    if (!props.onChange || !props.session) return;
    if (previous !== props.value || previousType !== effectiveType() || revision !== props.revision?.()) {
      throw new Error("This value changed during import. Paste or drop again to use its current contents.");
    }
    const session = props.session();
    // A Local reader's untyped data is typed by its worker's analysis, never the page frame.
    const result = await adaptTransferForSession(items, { type: effectiveType() ?? (localSession() ? undefined : typeForTransfer(item(), session.environment,
      { registry: session.registry, evaluateContext: session.evaluateContext })), currentValue: props.value,
      session }, signal);
    signal.throwIfAborted();
    assertCurrent();
    if (!props.onChange || !props.session) return;
    if (previous !== props.value || previousType !== effectiveType() || revision !== props.revision?.()) {
      throw new Error("This value changed during import. Paste or drop again to use its current contents.");
    }
    const { appended, ...change } = result;
    await props.onChange({ ...change, revision, ...(appended ? { edit: { path: [], append: appended } } : {}) });
  }

  async function replaceChild(key: string | number, child: ValueChange) {
    if (props.current && !props.current()) throw new Error("This data changed. Edit again when its display is ready.");
    if (!props.onChange || !props.session) return;
    const values = typeof key === "number" ? [...props.value as unknown[]]
      : Object.assign(Object.create(null), props.value) as Record<string, unknown>;
    (values as any)[key] = child.value;
    const next = { ...item(), value: values };
    const expr = expressionForTransfer(next, props.session().environment);
    const path = [key, ...(child.edit?.path ?? [])];
    await props.onChange({ value: values, expr, type: effectiveType(), revision: child.revision,
      edit: child.edit && "append" in child.edit ? { path, append: child.edit.append }
        : { path, expr: child.edit?.expr ?? child.expr } });
  }

  function childType(key: string | number, readFacts: () => SourceReaderValueReadPacket | undefined = () => props.readFacts): FenelType | undefined {
    const facts = readFacts();
    if (facts) {
      const child = facts.children.find(child => child.key === key);
      return child?.type ?? child?.declaredType;
    }
    if (props.requiresReadFacts) return undefined;
    // A Local child's type comes only with its typed owner's packet.
    if (localSession()) return undefined;
    const session = props.session?.();
    if (!session) return undefined;
    const type = effectiveType() ?? typeForTransfer(item(), session.environment, { registry: session.registry, evaluateContext: session.evaluateContext });
    return childValueType(props.value, type, key, session);
  }
  function childSurface(key: string | number, value: () => unknown, label: string,
    readFacts?: () => SourceReaderValueReadPacket | undefined) {
    const projection = () => readFacts?.()?.children.find(child => child.key === key);
    const path = () => [...(props.path ?? []), key];
    const childLabel = () => projection()?.label ?? label;
    const render = (childFacts?: ValueStructureFacts) => {
      const painted = createMemo(() => childFacts?.() ?? { facts: undefined, value: value() });
      return <DataValueSurface value={painted().value}
      type={painted().facts ? painted().facts!.root.field.type : projection()?.type ?? projection()?.declaredType}
      getType={() => painted().facts ? painted().facts!.root.field.type : childType(key, readFacts)} label={childLabel()}
      session={props.session} revision={props.revision} resolveSavedValue={props.resolveSavedValue}
      path={path()} renderChild={props.renderChild} renderValue={props.renderValue}
      preparedChildren={props.preparedChildren} current={props.current}
      readFacts={painted().facts} requiresReadFacts={!!readFacts?.() || props.requiresReadFacts}
      structuralOnly={!!readFacts?.()}
      depth={(props.depth ?? 0) + 1} onChange={props.onChange ? (next) => replaceChild(key, next) : undefined} />;
    };
    const preview: ContainedValuePreview = { get value() { return value(); }, get label() { return childLabel(); },
        get caption() { const current = projection(); return current ? current.caption : typeof key === "string" ? label : undefined; },
        get path() { return path(); }, getType: () => childType(key, readFacts),
        get typeLabel() { return projection()?.typeLabel; }, get typeIcon() { return projection()?.typeIcon; },
        get valueIcon() { return projection()?.ownPresentation?.icon; }, get valueEmoji() { return projection()?.ownPresentation?.emoji; } };
    const wrapReady: ContainedValueWrapper = (data, body) => {
      const transferred = <DataValueSurface value={data.value} type={data.getType()} label={data.label}
        session={props.session} revision={props.revision} resolveSavedValue={props.resolveSavedValue}
        path={data.path} renderChild={props.renderChild} renderValue={props.renderValue}
        readFacts={data.readFacts} requiresReadFacts preparedChildren current={data.readCurrent}
        renderBody={body} depth={(props.depth ?? 0) + 1}
        onChange={props.onChange ? next => replaceChild(key, next) : undefined} />;
      return <Show when={props.renderChild} fallback={transferred}>{wrapper => <>{wrapper()(data, () => transferred)}</>}</Show>;
    };
    return <Show when={props.preparedChildren && readFacts?.() && props.renderValue} fallback={<Show when={props.renderChild} fallback={render()}>
      {wrapper => <>{wrapper()(preview, render)}</>}
    </Show>}>{reader => <>{reader()(preview, render, wrapReady)}</>}</Show>;
  }
  const keys = createMemo(() => {
    if (!props.value || typeof props.value !== "object" || Array.isArray(props.value)
      || hasDataPreview(props.value)) return undefined;
    const prototype = Object.getPrototypeOf(props.value);
    return prototype === Object.prototype || prototype === null
      ? Object.keys(props.value).filter((key) => key !== "$tag") : undefined;
  }, { lazy: true });
  const recordLabel = () => {
    const descriptor = props.value && typeof props.value === "object" ? Object.getOwnPropertyDescriptor(props.value, "$tag") : undefined;
    return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : "Record";
  };

  const structure = (readValue: ValueStructureFacts = () => ({ facts: props.readFacts, value: props.value })) => {
    const painted = createMemo(readValue);
    const readFacts = () => painted().facts;
    const value = () => painted().value;
    // This closure is also the existing structural fallback of the descendant
    // TypedReadValue. Its packet names this node, never the parent's value.
    const recordKeys = () => {
      const facts = readFacts();
      return facts ? facts.root.structure === "record" ? facts.children.map(child => child.key as string) : undefined : keys();
    };
    return <Show when={!props.requiresReadFacts || !!readFacts()} fallback={<span class="text-muted" role="status">Preparing data…</span>}>
    <Show when={(props.depth ?? 0) < 16} fallback={<span class="text-muted" data-tooltip="The complete data is retained">…</span>}>
    <Show when={readFacts() ? readFacts()!.root.structure === "array" : Array.isArray(value())} fallback={
      <Show when={recordKeys()} fallback={<DataPreview value={value()} />}>
        <details class="fenel-transfer-record" open={expanded()}
          onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>{readFacts()?.root.recordLabel ?? recordLabel()}</summary>
          <Show when={expanded()}>
            <For each={recordKeys()!.slice(0, visible())}>{(key) => <div class="fenel-transfer-field">
              <span class="fenel-transfer-field__label">{key}</span>
              {childSurface(key, () => Object.getOwnPropertyDescriptor(value(), key)?.value,
                key, readFacts)}
            </div>}</For>
            <Show when={recordKeys()!.length > visible()}><button type="button" class="expr-form__btn"
              onClick={() => setVisible((count) => count + 40)}>Show more fields</button></Show>
          </Show>
        </details>
      </Show>
    }>
      <div class="home-item__list">
        <Show when={expanded()} fallback={<button type="button" class="expr-form__btn"
          onClick={() => setExpanded(true)}>Show {(value() as unknown[]).length} items</button>}>
        <Show when={readFacts()} fallback={<For keyed={false} each={(value() as unknown[]).slice(0, visible())}>{(child, index) => <div class="home-item__list-cell">
          {childSurface(index, child, `Item ${index + 1}`)}
        </div>}</For>}>{packet => <For each={packet().children.slice(0, visible()).map(child => child.key)}>{key => <div class="home-item__list-cell">
          {childSurface(key, () => Object.getOwnPropertyDescriptor(value(), key)?.value,
            "", readFacts)}
        </div>}</For>}</Show>
        <Show when={(value() as unknown[]).length === 0}>
          <div class="text-muted">Empty list</div>
        </Show>
        <Show when={(value() as unknown[]).length > visible()}><button type="button" class="expr-form__btn"
          onClick={() => setVisible((count) => count + 40)}>Show more items</button></Show>
        </Show>
      </div>
    </Show>
  </Show></Show>;
  };
  return <DataTransferTarget label={props.readFacts || props.requiresReadFacts ? props.label ?? "Data" : !props.onChange ? props.label ?? (props.session ? classifyData(props.value) : "Data") : Array.isArray(props.value)
    ? "List — paste or drop to append items" : `${props.label ?? classifyData(props.value)} — paste or drop a value`}
    onTransfer={props.onChange && props.session ? transfer : undefined} hideCopy={props.hideCopy}
    onCopyIntent={() => { if (localSession()) localCopy!.intent(); }} copyValue={props.value == null || !props.session ? undefined : () => {
      if (props.current && !props.current()) throw new Error("This data changed. Copy again when its display is ready.");
      if (localSession()) return localCopy!.copy();
      const session = props.session!();
      return prepareTransferItem(item(), session.environment, session.registry, session.evaluateContext);
    }}>
    <Show when={props.renderBody} fallback={<Show when={!props.structuralOnly && props.renderValue} fallback={<>{props.presentation}{structure()}</>}>
      {render => <>{render()({ get value() { return props.value; }, get label() { return props.label ?? "Data"; },
        get path() { return props.path ?? []; }, getType: effectiveType }, structure)}</>}
    </Show>}>{body => <>{body()(structure)}</>}</Show>
  </DataTransferTarget>;
}
