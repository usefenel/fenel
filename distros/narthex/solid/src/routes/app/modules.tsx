import { Show, createEffect, createMemo, createSignal, For } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { evaluate } from "@fenel/engine";
import { assertSourceModuleNamespaces, reservedSourceModuleNamespaces, prepareSourceModule, prepareSourceModulesFromRows, sourceModuleAuthoringSession, sourceModuleVersionClosure, type SourceModuleDocument, type SourceModuleIdentity } from "@fenel/engine/authoring/source-module";
import { SourceModuleEditor } from "~/lib/module-editor/SourceModuleEditor";
import { ExpressionEditor, toLogic, type ExprNode } from "~/lib/expression-runner";
import type { AuthoringSession } from "~/lib/expression-runner/authoring-session";
import { apiFetch } from "~/lib/api";
import { formatRuntimeValue } from "~/lib/runtime-value-display";
import { subject } from "~/lib/auth";
import { reloadUserRegistries } from "~/lib/user-registries";
import template from "~/lib/module-editor/module-template.fenel?raw";
import "~/lib/module-editor/module-editor.css";

type ModuleRow = SourceModuleDocument & { label?: string; description?: string; ownerAccountId?: string | null; dependencies: { registry: string; version: string }[] };

export default function ModulesPage() {
  const [search, setSearch] = useSearchParams();
  const accountId = createMemo(() => { const current = subject(); return current?.$tag === "User" || current?.$tag === "Bot" ? current.accountId : undefined; });
  const [rows, setRows] = createSignal<ModuleRow[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [installedIds, setInstalledIds] = createSignal<string[]>([]);
  const [selectedId, setSelectedId] = createSignal<string>();
  const [source, setSource] = createSignal(template);
  const [name, setName] = createSignal("my-module");
  const [version, setVersion] = createSignal("1.0.0");
  const [identity, setIdentity] = createSignal<SourceModuleIdentity>();
  const [dependencies, setDependencies] = createSignal<{ registry: string; version: string }[]>([]);
  const [session, setSession] = createSignal<AuthoringSession>();
  const [expr, setExpr] = createSignal<ExprNode>({ kind: "literal", value: null });
  const [result, setResult] = createSignal("");
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [draftError, setDraftError] = createSignal<string>();
  const [documentKey, setDocumentKey] = createSignal(0);
  let epoch = 0;
  let revision = 0;
  let operation = 0;

  async function refresh() {
    const initiated = accountId();
    if (!initiated) return;
    const response = await apiFetch<{ modules: ModuleRow[]; installedIds: string[] }>("/modules");
    if (initiated !== accountId()) return;
    setRows(response.modules); setInstalledIds(response.installedIds); setLoaded(true);
  }
  createEffect(
    () => accountId(),
    () => {
    const initiated = ++epoch; operation++; revision++;
    setRows([]); setLoaded(false); setInstalledIds([]); setSession(undefined); setIdentity(undefined); setSelectedId(undefined);
    setSource(template); setName("my-module"); setVersion("1.0.0"); setDependencies([]); setDraftError(undefined); setDocumentKey((key) => key + 1);
    setExpr({ kind: "literal", value: null }); setResult(""); setError(""); setNotice(""); setBusy(false);
    void refresh().catch((reason) => { if (initiated === epoch) setError(String(reason)); });
  });
  createEffect(
    () => ({ id: typeof search.id === "string" ? search.id : undefined, loaded: loaded(), rows: rows() }),
    ({ id, loaded: isLoaded, rows: available }) => {
      if (!id || !isLoaded || selectedId() === id) return;
      const row = available.find((candidate) => candidate.id === id);
      if (row) open(row, false);
      else setError("This module version is not available in the current account.");
    },
  );

  function changed() { revision++; setSession(undefined); setResult(""); setNotice(""); }
  function editDependencies(next: { registry: string; version: string }[]) { setDependencies(next); changed(); }
  function editSource(next: string) { if (source() !== next) { changed(); setSource(next); } }
  function open(row: ModuleRow, updateLocation = true) {
    revision++; setDocumentKey((key) => key + 1); setDraftError(undefined);
    setSource(row.source); setName(row.slug.slice(row.slug.lastIndexOf("/") + 1)); setVersion(row.version);
    setSelectedId(row.id); setIdentity(row.identity); setDependencies(row.dependencies ?? []);
    setSession(undefined); setError(""); setNotice(""); setResult("");
    if (updateLocation) setSearch({ id: row.id }, { replace: true });
  }
  async function save() {
    const initiated = accountId(); if (!initiated) return;
    if (draftError()) { setError(draftError()!); return; }
    const startedRevision = revision; const currentOperation = ++operation;
    setBusy(true); setError("");
    try {
      const response = await apiFetch<{ module: ModuleRow }>("/modules", { method: "POST", body: JSON.stringify({ name: name(), version: version(), source: source(), dependencies: dependencies() }) });
      if (initiated !== accountId()) return;
      if (startedRevision === revision) open(response.module);
      await refresh();
      if (initiated === accountId() && currentOperation === operation) setNotice(`Saved ${response.module.version}.`);
    } catch (reason) { if (initiated === accountId() && currentOperation === operation) setError(String(reason)); }
    finally { if (currentOperation === operation) setBusy(false); }
  }
  async function install(row: ModuleRow, remove = false) {
    const initiated = accountId(); const currentOperation = ++operation;
    setBusy(true); setError("");
    try {
      await apiFetch(`/modules/${encodeURIComponent(row.id)}/install`, { method: remove ? "DELETE" : "POST" });
      if (initiated !== accountId() || currentOperation !== operation) return;
      setSession(undefined); await refresh(); await reloadUserRegistries(initiated);
      if (initiated === accountId() && currentOperation === operation) setNotice(remove ? "Module version removed from this account." : "Module version installed for this account.");
    } catch (reason) { if (initiated === accountId() && currentOperation === operation) setError(String(reason)); }
    finally { if (currentOperation === operation) setBusy(false); }
  }
  async function prepare() {
    if (draftError()) { setError(draftError()!); return; }
    const initiated = epoch; const startedRevision = revision; const currentOperation = ++operation;
    const draftSource = source(); const draftName = name().trim(); const draftIdentity = identity();
    const draftVersion = version().trim(); const draftDependencies = dependencies(); const draftAccount = accountId();
    const installedRows = rows().filter((row) => installedIds().includes(row.id) && row.id !== selectedId());
    setBusy(true); setError("");
    // Let the browser paint the in-progress state before entering the engine.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const draft = prepareSourceModule(draftSource, draftName, draftIdentity, () => crypto.randomUUID());
      const draftId = "@draft/current-module";
      const candidateRows = [
        ...installedRows.map((row) => ({ registry: { ...row, module: { sourceIdentity: row.identity, sourceNamespace: row.namespace } } })),
        { registry: { id: draftId, slug: `${draftAccount}/${draftName}`, version: draftVersion, source: draftSource,
          dependencies: draftDependencies, module: { sourceIdentity: draft.identity, sourceNamespace: draftName } } },
      ];
      const prepared = prepareSourceModulesFromRows(candidateRows);
      // rights R2b — the SAME reserved set the installer uses, read from the
      // base registry rather than re-derived. A draft named `authority` is
      // refused here for the same reason and with the same message it would be
      // refused at install.
      assertSourceModuleNamespaces(prepared, reservedSourceModuleNamespaces());
      const selectedVersions = new Set(sourceModuleVersionClosure(candidateRows, draftId).map((row) => row.registry.id));
      const built = sourceModuleAuthoringSession(prepared.filter((entry) => selectedVersions.has(entry.registryId!)), draft.module.name);
      if (initiated !== epoch || startedRevision !== revision || currentOperation !== operation) return;
      setIdentity(draft.identity); setSession(built); setNotice("Module ready. Its functions, constructors and imports are available below.");
    } catch (reason) { if (initiated === epoch && currentOperation === operation) setError(String(reason)); }
    finally { if (currentOperation === operation) setBusy(false); }
  }
  function exportSource() {
    const url = URL.createObjectURL(new Blob([source()], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${name() || "module"}.fenel`; link.click(); URL.revokeObjectURL(url);
  }
  function run() {
    const active = session(); if (!active) return;
    try { const value = evaluate(toLogic(expr(), undefined, active), {}, active.evaluateContext); setResult(formatRuntimeValue(value, 2)); setError(""); }
    catch (reason) { setError(String(reason)); }
  }
  return <main class="module-workspace">
    <div class="module-inline"><h1>Source modules</h1><a href="/app/functions">Functions</a><button type="button" onClick={() => { setSearch({ id: undefined }, { replace: true }); changed(); setDocumentKey((key) => key + 1); setDraftError(undefined); setSource(template); setName("my-module"); setVersion("1.0.0"); setSelectedId(undefined); setIdentity(undefined); setDependencies([]); }}>New module</button></div>
    <p>Author types, interfaces, functions and instance values together with their imports. Each saved version keeps its original Fenel source.</p>
    <Show when={error()}><p role="alert">{error()}</p></Show><Show when={notice()}><p role="status">{notice()}</p></Show>
    <details><summary>Saved versions ({rows().length})</summary><For keyed={false} each={rows()}>{(row) => <div class="module-card module-inline"><button type="button" onClick={() => open(row())}>{row().slug} @ {row().version}</button><button type="button" disabled={busy()} onClick={() => void install(row(), installedIds().includes(row().id))}>{installedIds().includes(row().id) ? "Remove installed version" : "Install version"}</button></div>}</For></details>
    <div class="module-inline"><label>Module file name<input aria-label="Module file name" value={name()} onInput={(event) => { setName(event.currentTarget.value); changed(); }} /></label><label>Version<input aria-label="Module version" value={version()} onInput={(event) => { setVersion(event.currentTarget.value); changed(); }} /></label><button type="button" disabled={busy() || !!draftError()} onClick={() => void save()}>Save new version</button><button type="button" onClick={exportSource}>Download .fenel</button><button type="button" disabled={busy() || !!draftError()} onClick={() => void prepare()}>{busy() ? "Working…" : "Check and use module"}</button></div>
    <details><summary>Pinned source dependencies ({dependencies().length})</summary><For keyed={false} each={dependencies()}>{(dependency, index) => <div class="module-inline"><label>Registry<input aria-label="Dependency registry" value={dependency().registry} onInput={(event) => editDependencies(dependencies().map((row, i) => i === index ? { ...row, registry: event.currentTarget.value } : row))} /></label><label>Version<input aria-label="Dependency version" value={dependency().version} onInput={(event) => editDependencies(dependencies().map((row, i) => i === index ? { ...row, version: event.currentTarget.value } : row))} /></label><button type="button" onClick={() => editDependencies(dependencies().filter((_, i) => i !== index))}>Remove dependency</button></div>}</For><button type="button" onClick={() => editDependencies([...dependencies(), { registry: "", version: "" }])}>Add dependency</button></details>
    <SourceModuleEditor source={source()} onChange={editSource} session={session()} resetKey={documentKey()} onDraftStatus={(message) => { setDraftError(message); if (message) setSession(undefined); }} />
    <Show when={session()}>{(active) => <section class="module-card"><h2>Use this module</h2><p>Choose a module function or construct an expression. Native declarations require an existing host implementation.</p><ExpressionEditor expr={expr()} onChange={setExpr} authoringSession={active()} /><button type="button" onClick={run}>Run expression</button><Show when={result()}><pre>{result()}</pre></Show></section>}</Show>
  </main>;
}
