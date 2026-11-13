// C2: actual Lens settings, generic FieldRenderer and selected-module checked
// catalog. Fixture data and observable save callbacks are the only host setup.
import { createSignal, Errored, Loading, flush } from "solid-js";
import { render } from "@solidjs/web";
import { createRegistry } from "../../../../../implementations/typescript/engine/src/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { pictureModule } from "@fenel/engine/modules/picture";
import { setExprEntityModule } from "../../../../../implementations/typescript/engine/src/modules/set-expr-entities";
import { prepareEngineBodyDispatch, withInterpretedResolver } from "@fenel/engine/engine-bodies-dispatch";
import { buildSessionCatalog, sessionCatalogSections, environmentForCatalog, evaluateContextForCatalog } from "./expression-runner/authoring-catalog";
import { entitySchemaFields } from "@fenel/engine";
import { fieldEditPlan } from "@fenel/engine/authoring/field-render";
import { AuthoringSessionContext } from "./expression-runner/authoring-session";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { ReaderRuntime } from "./reader-runtime";
import type { WorkspacePreferences, WorkspaceBar } from "./workspace-wire";
import { sessionEpoch } from "./browser-session";
import WorkspaceSettings from "./workspace-settings";
import { defaultLensShortcuts, textLensShortcuts } from "./lens-shortcuts";

declare const selectedViewModule: import("@fenel/engine/types").FenelModule;
declare const fixtureIdentityLock: [string, string][];
declare const fixtureIdentityKinds: [string, string][];

let session: AuthoringSession;
let reader: ReaderRuntime;
let dispose: (() => void) | undefined;
let replacePreferences: ((value: WorkspacePreferences) => void) | undefined;
let publishReader: ((value: ReaderRuntime | undefined) => void) | undefined;
let preferences: () => WorkspacePreferences;
const saves: Array<{ bar: WorkspaceBar; lens?: unknown }> = [];
let closed = 0;
const original: WorkspacePreferences = {
  $tag: "WorkspacePreferences", activeLensId: "captured-lens", display: { $tag: "SingleLens" },
  bar: { $tag: "WorkspaceBar", mode: { $tag: "FloatingBar" }, position: { $tag: "BarBottom" } }, presentations: [],
  lenses: [{ $tag: "WorkspaceLens", id: "captured-lens", title: { $tag: "Just", _0: "Text utilities" },
    source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" }, presentation: { $tag: "AutomaticPresentation" },
    placement: { $tag: "DockedPlacement" }, subject: { $tag: "Nothing" }, shortcuts: { $tag: "Nothing" } },
    { $tag: "WorkspaceLens", id: "later-active-lens", title: { $tag: "Just", _0: "Another lens" },
      source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" }, presentation: { $tag: "AutomaticPresentation" },
      placement: { $tag: "DockedPlacement" }, subject: { $tag: "Nothing" }, shortcuts: { $tag: "Nothing" } }],
};

const fixture = {
  async mount(pending = false) {
    dispose?.(); saves.length = 0; closed = 0;
    await prepareEngineBodyDispatch();
    if (!session) withInterpretedResolver(() => {
      const registry = createRegistry([stdModule, pictureModule, setExprEntityModule, selectedViewModule], {
        codeNameLock: new Map(fixtureIdentityLock), fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source",
          lock: new Map(fixtureIdentityLock), identityKinds: new Map(fixtureIdentityKinds) },
      });
      // This selected profile deliberately has no control/media function
      // roster. Project exact type definitions from this registry through the
      // production catalog helper rather than asking the global preset catalog
      // for functions outside this reader.
      const sections = sessionCatalogSections(registry, [{ id: "function", label: "Functions", description: "Captured selected module functions",
        entries: registry.listFunctions().map(fn => ({ id: fn.id, name: fn.id, description: "", category: "function", fn })) },
        { id: "entity", label: "Types", description: "Captured selected module types",
        entries: registry.listIdentifiedEntities().map(entity => ({ id: entity.id, name: entity.id,
          description: "", category: "entity", entity: { id: entity.id, type: entity.type,
            ...(entity.params === undefined ? {} : { params: entity.params.map(parameter =>
              typeof parameter === "string" ? { name: parameter, constraints: [] } : parameter) }) } })) }]);
      const catalog = buildSessionCatalog(registry, "view", { sections });
      const environment = environmentForCatalog(catalog, registry);
      session = Object.freeze({ mode: "module", sourceModule: "view", registry, catalog, environment, evaluateContext: evaluateContextForCatalog(registry) });
      // B4 F1: a Local reader resolves declarations inertly (worker-published catalogue).
      reader = { kind: "local", epoch: sessionEpoch(), registry: () => registry, session: () => session, client: {},
        resolveTypeName: (name: string) => registry.getIdentifiedEntity(name)?.type } as ReaderRuntime;
    });
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => {
      const [value, setValue] = createSignal(structuredClone(original)); preferences = value; replacePreferences = setValue;
      const [runtime, setRuntime] = createSignal<ReaderRuntime | undefined>(pending ? undefined : reader); publishReader = setRuntime;
      return <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
        <Loading fallback={<p>Preparing lens settings…</p>}><AuthoringSessionContext value={session}>
          <WorkspaceSettings value={value()} persistent={true} reader={runtime()} onClose={() => { closed++; }}
            onSave={(bar, lens) => { saves.push(structuredClone({ bar, lens })); }} />
        </AuthoringSessionContext></Loading>
      </Errored>;
    }, host);
    flush();
  },
  changeActiveLens() {
    if (!replacePreferences) throw new Error("Mount first");
    replacePreferences({ ...preferences(), activeLensId: "later-active-lens" }); flush();
  },
  publishReader(mode: "ready" | "wrong-source" | "wrong-epoch" | "replacement") {
    if (!publishReader) throw new Error("Mount first");
    publishReader(mode === "ready" ? reader : mode === "wrong-source" ? { ...reader, kind: "public" }
      : mode === "wrong-epoch" ? { ...reader, epoch: reader.epoch + 1 }
      : { ...reader, registry: () => { throw new Error("A captured reader must not be replaced."); } });
    flush();
  },
  state: () => ({ saves: structuredClone(saves), closed, activeLens: preferences?.().activeLensId,
    defaults: session && withInterpretedResolver(() => defaultLensShortcuts(session)),
    textShortcuts: session && withInterpretedResolver(() => textLensShortcuts(session)) }),
  functionId(handle: string) {
    const fn = session.registry.getFunction(handle);
    if (!fn) throw new Error("The callable is not in this captured reader.");
    return fn.id;
  },
  schema() {
    const declaration = session.registry.getIdentifiedEntity("WorkspaceLens")!;
    const field = entitySchemaFields(declaration).find(field => field.name === "shortcuts")!;
    return { field, plan: fieldEditPlan({ registry: session.registry, field, value: { $tag: "Just", _0: [...defaultLensShortcuts(session), ...textLensShortcuts(session)] } }),
      shortcut: session.registry.getIdentifiedEntity("LensShortcut")?.type,
      catalogTypes: session.catalog.types.map(type => ({ id: type.entityId, name: type.name })),
      namedShortcut: session.environment.resolveNamedType?.("LensShortcut") };
  },
};
(globalThis as typeof globalThis & { workspaceSettingsFixture: typeof fixture }).workspaceSettingsFixture = fixture;
