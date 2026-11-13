import { Show, createEffect, createMemo, createSignal, For } from "solid-js";
import { parseFenel, printFenel } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { exprNodeToLogic, logicToExprNode as decodeLogic } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { DIRECTIVE_POLICY } from "@fenel/engine/authoring/source-module";
import { TypeBuilder } from "~/lib/type-builder/TypeBuilder";
import { ExpressionEditor, logicToExprNode, toLogic, LambdaParamsContext } from "~/lib/expression-runner";
import type { AuthoringSession } from "~/lib/expression-runner/authoring-session";

type Directive = { name: string; args: string[] };
type SourceField = { name: string; type: FenelType; default?: unknown; [key: string]: unknown };
type Constructor = { name: string; fields?: SourceField[]; type?: FenelType; [key: string]: unknown };
type Declaration = Record<string, any>;

function StringSlots(props: { values: string[]; onChange: (values: string[]) => void; label: string }) {
  return <div class="module-slots"><For keyed={false} each={props.values}>{(value, index) => <div class="module-inline">
    <input aria-label={`${props.label} ${index + 1}`} value={value()} onInput={(event) => props.onChange(props.values.map((old, i) => i === index ? event.currentTarget.value : old))} />
    <button type="button" onClick={() => props.onChange(props.values.filter((_, i) => i !== index))}>Remove</button>
  </div>}</For><button type="button" onClick={() => props.onChange([...props.values, props.label === "Argument" ? "" : `${props.label === "Type parameter" ? "a" : props.label === "Name" ? "member" : "value"}${props.values.length + 1}`])}>Add {props.label.toLowerCase()}</button></div>;
}

function DirectivesEditor(props: { values: Directive[]; kind: string; onChange: (values: Directive[]) => void }) {
  const rows = () => DIRECTIVE_POLICY.filter((row) => row.context === "DcAnyDecl" || row.context === (props.kind === "type_def" ? "DcTypeDecl" : "DcFunctionDecl"));
  const replace = (index: number, value: Directive) => props.onChange(props.values.map((old, i) => i === index ? value : old));
  return <details><summary>Declaration annotations ({props.values.length})</summary><For keyed={false} each={props.values}>{(directive, index) => <div class="module-card">
    <div class="module-inline"><select aria-label="Annotation" value={directive().name} onChange={(event) => {
      const policy = rows().find((row) => row.name === event.currentTarget.value)!;
      replace(index, { name: policy.name, args: Array.from({ length: policy.minArgs }, () => "") });
    }}><For keyed={false} each={rows()}>{(row) => <option value={row().name}>{row().name}</option>}</For></select>
    <button type="button" onClick={() => props.onChange(props.values.filter((_, i) => i !== index))}>Remove annotation</button></div>
    <StringSlots label="Argument" values={directive().args} onChange={(args) => replace(index, { ...directive(), args })} />
  </div>}</For><button type="button" onClick={() => props.onChange([...props.values, { name: "label", args: [""] }])}>Add annotation</button></details>;
}

function BodyEditor(props: { value: unknown; onChange: (value: unknown) => void; session?: AuthoringSession; params?: string[]; functionName?: string; signature?: FenelType }) {
  const params = () => {
    const signature = props.functionName && props.session?.sourceModule
      ? props.session.environment.getFunctionEntry?.(`${props.session.sourceModule}:${props.functionName}`)
      : undefined;
    const declared = props.signature && "$arrow" in props.signature ? props.signature.$arrow.params : [];
    return (props.params ?? []).map((name, index) => ({ name, type: signature?.params[index]?.type ?? declared[index]?.type ?? { $ref: "Value" } as FenelType })).filter((param) => param.name.length > 0);
  };
  return <LambdaParamsContext value={params}><ExpressionEditor
    expr={props.session?.mode === "module" ? logicToExprNode(props.value, props.params ?? [], props.session) : decodeLogic(props.value, props.params)}
    onChange={(node) => props.onChange(props.session?.mode === "module" ? toLogic(node, undefined, props.session) : exprNodeToLogic(node, { fnCodeName: (id) => id }))}
    authoringSession={props.session}
  /></LambdaParamsContext>;
}

function TypeDeclarationEditor(props: { value: Declaration; onChange: (value: Declaration) => void; session?: AuthoringSession }) {
  const constructors = () => (props.value.constructors ?? []) as Constructor[];
  const setConstructors = (next: Constructor[]) => props.onChange({ ...props.value, constructors: next });
  const patchConstructor = (index: number, next: Constructor) => setConstructors(constructors().map((old, i) => i === index ? next : old));
  return <>
    <label>Type parameters<StringSlots label="Type parameter" values={props.value.params ?? []} onChange={(params) => props.onChange({ ...props.value, params })} /></label>
    <Show when={props.value.alias !== undefined}><TypeBuilder value={props.value.alias} onChange={(alias) => props.onChange({ ...props.value, alias })} authoringSession={props.session} /></Show>
    <Show when={props.value.refined !== undefined}><TypeBuilder value={props.value.refined} onChange={(refined) => props.onChange({ ...props.value, refined })} authoringSession={props.session} /></Show>
    <Show when={props.value.alias === undefined && props.value.refined === undefined}>
      <label><input type="checkbox" checked={props.value.kindSig !== undefined} onChange={(event) => {
        const next = { ...props.value }; if (event.currentTarget.checked) next.kindSig = { $type: true }; else delete next.kindSig; props.onChange(next);
      }} /> Explicit data kind</label>
      <Show when={props.value.kindSig !== undefined}><TypeBuilder value={props.value.kindSig} onChange={(kindSig) => props.onChange({ ...props.value, kindSig })} authoringSession={props.session} /></Show>
      <For keyed={false} each={constructors()}>{(constructor, index) => <section class="module-card">
        <div class="module-inline"><label>Constructor<input value={constructor().name} onInput={(event) => patchConstructor(index, { ...constructor(), name: event.currentTarget.value })} /></label><button type="button" onClick={() => setConstructors(constructors().filter((_, i) => i !== index))}>Remove constructor</button></div>
        <label><input type="checkbox" checked={constructor().type !== undefined} onChange={(event) => {
          const next = { ...constructor() }; if (event.currentTarget.checked) next.type = { $ref: props.value.name }; else delete next.type; patchConstructor(index, next);
        }} /> Explicit constructor signature</label>
        <Show when={constructor().type !== undefined}><TypeBuilder value={constructor().type} onChange={(type) => patchConstructor(index, { ...constructor(), type })} authoringSession={props.session} /></Show>
        <Show when={constructor().type === undefined}><For keyed={false} each={constructor().fields ?? []}>{(field, fieldIndex) => {
          const replaceField = (next: SourceField) => patchConstructor(index, { ...constructor(), fields: constructor().fields!.map((old, i) => i === fieldIndex ? next : old) });
          return <div class="module-card"><div class="module-inline"><label>Field<input value={field().name} onInput={(event) => replaceField({ ...field(), name: event.currentTarget.value })} /></label><button type="button" onClick={() => patchConstructor(index, { ...constructor(), fields: constructor().fields!.filter((_, i) => i !== fieldIndex) })}>Remove field</button></div>
            <TypeBuilder value={field().type} onChange={(type) => replaceField({ ...field(), type })} authoringSession={props.session} />
            <label><input type="checkbox" checked={Object.hasOwn(field(), "default")} onChange={(event) => { const next = { ...field() }; if (event.currentTarget.checked) next.default = { $tag: "Just", _0: 0 }; else delete next.default; replaceField(next); }} /> Default method or value</label>
            <Show when={Object.hasOwn(field(), "default")}><BodyEditor value={(field().default as { _0?: unknown })?._0} onChange={(value) => replaceField({ ...field(), default: { $tag: "Just", _0: value } })} session={props.session} /></Show>
          </div>;
        }}</For><button type="button" onClick={() => patchConstructor(index, { ...constructor(), fields: [...(constructor().fields ?? []), { name: `field${(constructor().fields?.length ?? 0) + 1}`, type: { $ref: "String" } }] })}>Add field or method</button></Show>
      </section>}</For><button type="button" onClick={() => setConstructors([...constructors(), { name: `Case${constructors().length + 1}`, fields: [] }])}>Add constructor</button>
    </Show>
    <label><input type="checkbox" checked={props.value.opaque !== undefined} onChange={(event) => { const next = { ...props.value }; if (event.currentTarget.checked) next.opaque = { repr: "string" }; else delete next.opaque; props.onChange(next); }} /> Opaque representation</label>
    <Show when={props.value.opaque}><label>Representation<input value={props.value.opaque?.repr ?? ""} onInput={(event) => props.onChange({ ...props.value, opaque: { ...props.value.opaque, repr: event.currentTarget.value } })} /></label></Show>
  </>;
}

export function SourceModuleEditor(props: { source: string; onChange: (source: string) => void; session?: AuthoringSession; resetKey?: unknown; onDraftStatus?: (error: string | undefined) => void }) {
  const [lens, setLens] = createSignal<"visual" | "source">("visual");
  const parsed = createMemo(() => {
    if (!props.source.trim()) return { declarations: [] as Declaration[], error: "" };
    try { const value = parseFenel(props.source) as Declaration; return { declarations: (value?.program ?? [value]) as Declaration[], error: "" }; }
    catch (error) { return { declarations: [] as Declaration[], error: String(error) }; }
  });
  const [visualDraft, setVisualDraft] = createSignal<{ baseSource: string; emittedSource?: string; declarations: Declaration[]; error: string; resetKey: unknown }>();
  const activeDraft = () => {
    const draft = visualDraft();
    return draft && draft.resetKey === props.resetKey && props.source === (draft.emittedSource ?? draft.baseSource) ? draft : undefined;
  };
  const declarations = () => activeDraft()?.declarations ?? parsed().declarations;
  const draftError = () => activeDraft()?.error || parsed().error;
  // Notify the owning workspace when an incomplete visual draft must not be
  // checked/published. Prop synchronization is independent of source printing.
  createEffect(
    () => draftError() || undefined,
    (status) => props.onDraftStatus?.(status),
  );
  let emptyRegistry: ModuleRegistry | undefined;
  const draftSession = createMemo<AuthoringSession>(() => {
    const rows = declarations();
    const environment = createAuthoringEnvironment({
      types: rows.filter((row) => row?.type_def?.name).map((row) => ({ id: row.type_def.name, name: row.type_def.name, description: "Draft declaration", category: "entity" })),
      functions: rows.filter((row) => row?.def?.name).map((row) => {
        const definition = row.def;
        const signature = rows.find((candidate) => candidate?.type_sig?.name === definition.name)?.type_sig?.type as FenelType | undefined;
        const arrow = signature && "$arrow" in signature ? signature.$arrow : undefined;
        return {
          id: definition.name, label: definition.name, description: "Draft declaration", kind: "function" as const,
          params: ((definition.params ?? []) as string[]).filter(Boolean).map((name, index) => ({ name, type: arrow?.params[index]?.type ?? { $ref: "Value" }, label: { $tag: "Nothing" } as const, ui: { $tag: "Nothing" } as const, meta: {} })),
          returns: arrow?.returns ?? signature ?? { $ref: "Value" },
          signatureOutcome: { $tag: "AnnotationRequired" as const, diagnostics: [{ code: "source-module-draft", functionId: definition.name, message: "Check the source module to resolve its signature and imports." }] },
        };
      }),
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    });
    return Object.freeze({
      mode: "detached" as const,
      get registry() { return emptyRegistry ??= createRepositoryRegistry([]); },
      catalog: environment.catalog, environment, evaluateContext: {},
    });
  });
  // A stable facade lets already-mounted expression/type editors see the
  // current local declaration catalogue and checked module session.
  const editingSession: AuthoringSession = Object.freeze({
    get mode() { return props.session?.mode ?? "detached"; },
    get sourceModule() { return props.session?.sourceModule; },
    get registry() { return (props.session ?? draftSession()).registry; },
    get catalog() { return (props.session ?? draftSession()).catalog; },
    get environment() { return (props.session ?? draftSession()).environment; },
    get evaluateContext() { return (props.session ?? draftSession()).evaluateContext; },
  });
  const emit = (next: Declaration[]) => {
    const baseSource = props.source;
    try {
      const source = printFenel({ program: next } as never);
      let error = "";
      try { parseFenel(source); } catch (cause) { error = String(cause); }
      setVisualDraft({ baseSource, emittedSource: source, declarations: next, error, resetKey: props.resetKey });
      if (source !== props.source) props.onChange(source);
    } catch (cause) {
      const error = String(cause);
      setVisualDraft({ baseSource, declarations: next, error, resetKey: props.resetKey });
    }
  };
  const replace = (index: number, next: Declaration) => emit(declarations().map((old, i) => i === index ? next : old));
  const add = (kind: string) => {
    const declaration: Declaration = kind === "module_decl" ? { module_decl: { name: "MyModule" } }
      : kind === "import_decl" ? { import_decl: { module: "engine", names: [] } }
      : kind === "fixity" ? { fixity: { op: "+", assoc: "l", prec: 6 } }
      : kind === "type_sig" ? { type_sig: { name: "newFunction", type: { $ref: "String" } } }
      : kind === "type_def" ? { type_def: { name: "NewType", params: [], constructors: [{ name: "NewType", fields: [] }] } }
      : kind === "alias" ? { type_def: { name: "NewAlias", params: [], alias: { $ref: "String" } } }
      : { def: { name: "newFunction", params: [], body: "" } };
    emit([...declarations(), declaration]);
  };
  return <div class="module-editor">
    <div class="module-inline"><button type="button" aria-pressed={lens() === "visual" ? "true" : "false"} onClick={() => setLens("visual")}>Visual declarations</button><button type="button" aria-pressed={lens() === "source" ? "true" : "false"} onClick={() => setLens("source")}>Fenel source</button></div>
    <Show when={draftError()}><p role="alert">{draftError()}</p></Show>
    <Show when={lens() === "source"} fallback={<>
      <Show when={parsed().error && !activeDraft()}><p>The source has an incomplete declaration. Open Fenel source to finish it.</p></Show>
      <For keyed={false} each={declarations()}>{(declaration, index) => {
        const kind = () => declaration() && typeof declaration() === "object" && !Array.isArray(declaration()) ? Object.keys(declaration())[0] ?? "expression" : "expression";
        const value = () => declaration()?.[kind()] ?? {};
        const known = () => ["module_decl", "import_decl", "type_def", "type_sig", "def", "fixity"].includes(kind());
        const change = (next: Declaration) => replace(index, { [kind()]: next });
        // Selected and alias frames are written `using` (the printer's choice,
        // modules-as-values Phase 5c-1a); qualified and hiding frames `import`.
        const opensNames = () => value().names !== undefined || value().as !== undefined;
        return <section class="module-card" data-declaration-kind={kind()}>
          <div class="module-inline"><strong>{({ module_decl: "Module", import_decl: opensNames() ? "Using" : "Import", type_def: "Type or interface", type_sig: "Type signature", def: "Function or instance value", fixity: "Operator fixity" } as Record<string, string>)[kind()] ?? kind()}</strong>
            <button type="button" disabled={index === 0} onClick={() => { const next = [...declarations()]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; emit(next); }}>Move up</button>
            <button type="button" onClick={() => emit(declarations().filter((_, i) => i !== index))}>Remove declaration</button></div>
          <Show when={known() && kind() !== "import_decl" && kind() !== "fixity"}><label>Name<input aria-label="Declaration name" value={value().name ?? ""} onInput={(event) => change({ ...value(), name: event.currentTarget.value })} /></label></Show>
          <Show when={!known()}><pre>{printFenel(declaration() as never)}</pre><button type="button" onClick={() => setLens("source")}>Edit source expression</button></Show>
          <Show when={kind() === "import_decl"}>
            <label>Module<input aria-label="Import module" value={value().module} onInput={(event) => change({ ...value(), module: event.currentTarget.value })} /></label>
            <label>Mode<select aria-label="Import mode" value={value().names !== undefined ? "names" : value().as !== undefined ? "as" : value().hiding !== undefined ? "hiding" : "qualified"} onChange={(event) => { const mode = event.currentTarget.value; change({ module: value().module, ...(mode === "qualified" ? { qualified: true } : mode === "as" ? { as: "Alias" } : { [mode]: [] }) }); }}><option value="names">Selected names (using)</option><option value="as">Alias (using)</option><option value="qualified">Qualified only (import)</option><option value="hiding">Hide names (import)</option></select></label>
            <Show when={value().as !== undefined}><label>Alias<input aria-label="Import alias" value={value().as} onInput={(event) => change({ ...value(), as: event.currentTarget.value })} /></label></Show>
            <Show when={value().names !== undefined || value().hiding !== undefined}><StringSlots label="Name" values={value().names ?? value().hiding} onChange={(names) => change({ ...value(), [value().names !== undefined ? "names" : "hiding"]: names })} /></Show>
          </Show>
          <Show when={kind() === "fixity"}><div class="module-inline"><label>Operator<input value={value().op} onInput={(event) => change({ ...value(), op: event.currentTarget.value })} /></label><label>Precedence<input type="number" value={value().prec} onInput={(event) => change({ ...value(), prec: event.currentTarget.valueAsNumber })} /></label><label>Association<select value={value().assoc} onChange={(event) => change({ ...value(), assoc: event.currentTarget.value })}><option value="l">Left</option><option value="r">Right</option><option value="n">None</option></select></label></div></Show>
          <Show when={kind() === "type_sig"}><TypeBuilder value={value().type} onChange={(type) => change({ ...value(), type })} authoringSession={editingSession} /></Show>
          <Show when={kind() === "type_def"}><TypeDeclarationEditor value={value()} onChange={change} session={editingSession} /></Show>
          <Show when={kind() === "def"}><StringSlots label="Parameter" values={value().params ?? []} onChange={(params) => change({ ...value(), params })} /><BodyEditor value={value().body} onChange={(body) => change({ ...value(), body })} params={value().params} functionName={value().name} signature={declarations().find((row) => row?.type_sig?.name === value().name)?.type_sig?.type} session={editingSession} /></Show>
          <Show when={kind() === "def" || kind() === "type_sig" || kind() === "type_def"}><DirectivesEditor kind={kind()} values={value().directives ?? []} onChange={(directives) => {
            const next = { ...value(), directives };
            if (kind() === "type_def") { const discriminator = directives.find((row) => row.name === "discriminator"); if (discriminator) next.discriminator = discriminator.args[0]; else delete next.discriminator; }
            change(next);
          }} /></Show>
        </section>;
      }}</For>
      <fieldset class="module-inline module-add" disabled={!!parsed().error && !activeDraft()}><button type="button" onClick={() => add("module_decl")}>Add module header</button><button type="button" onClick={() => add("import_decl")}>Add using</button><button type="button" onClick={() => add("fixity")}>Add fixity</button><button type="button" onClick={() => add("type_def")}>Add type or interface</button><button type="button" onClick={() => add("alias")}>Add type alias</button><button type="button" onClick={() => add("type_sig")}>Add signature</button><button type="button" onClick={() => add("def")}>Add function or instance value</button></fieldset>
    </>}><textarea class="module-source" aria-label="Fenel module source" spellcheck={false} value={props.source} onInput={(event) => props.onChange(event.currentTarget.value)} /></Show>
  </div>;
}
