// Run with: bun test --conditions=browser --conditions=development ./distros/narthex/solid/src/lib/initial-address-editor-handoff.test.mjs
import { expect, test } from 'bun:test';
import { createComponent, createEffect, createMemo, createRoot, createSignal, flush, lazy, Loading, onCleanup, Show } from 'solid-js';
import { scopeKey } from './locus-scope';
const home = (await Bun.file(new URL('./home-entry.tsx', import.meta.url)).text()).replaceAll('\r\n', '\n');
const surface = (await Bun.file(process.env.B4HANDOFF_SURFACE || new URL('./workspace-surface.tsx', import.meta.url)).text()).replaceAll('\r\n', '\n');
const start = home.indexOf('  const showingWorkspace = createMemo('), end = home.indexOf('  // The workspace received', start);
const condition = surface.match(/<Show when=\{([^\n]+)\} fallback=\{<Show when=\{address\.initialFailure\(\)\}/)[1];
const compile = new Bun.Transpiler({ loader: 'ts' });
const ownerStart=surface.indexOf('  const localCreationDrafts ='), ownerEnd=surface.indexOf('  const [shortcutRequests,',ownerStart);
const ownerFactory=new Function('env',`with(env){${compile.transformSync(surface.slice(ownerStart,ownerEnd))};return {creationDraft,retainCreationDraft};}`);
const showing = new Function('env', `with(env) { ${compile.transformSync(home.slice(start,end))}; return showingWorkspace; }`);
const outerReady = new Function('address','hasPendingCreationPicker', `return ${condition}`);
const initialReadyBody = surface.slice(surface.indexOf('  function InitialAddress() {')).match(/request: entry.request, ready: \(\) => ([^,]+), loading: entry.preparing/)[1];
const initialReady = new Function('entry','address', `return ${initialReadyBody}`);
const settle = async () => { for (let i=0;i<30;i++) { await Promise.resolve(); flush(); } };
const resolveNode = node => { while (typeof node === 'function') node = node(); return Array.isArray(node) ? node.map(resolveNode).join('') : node; };

for (const [variant,scenario] of [['runtime','normal'],['address-settled','normal'],['normal-pane-only','normal'],
  ['normal-pane-only','cancel'],['normal-pane-only','failure-retry'],['normal-pane-only','navigation']]) test(`initial preview editing readiness: ${variant}/${scenario}`, async () => {
  const mounted = [], disposed = [], visible = [];
  let controls, editor, resolveIncoming, dispose;
  const incoming = new Promise(resolve => { resolveIncoming = resolve; });
  createRoot(end => {
    dispose=end;
    const [initialLoading,setInitialLoading]=createSignal(true), [runtimeReady,setRuntimeReady]=createSignal(false);
    const [failure,setFailure]=createSignal(), [route,setRoute]=createSignal('local');
    const client={epoch:0,signal:new AbortController().signal}, local={$tag:'ThisTabSource'}, root={kind:'root'};
    const owner=ownerFactory({createSignal,scopeKey,cloneDraftValue:structuredClone,surfaceClosed:false,props:{epoch:0},sessionEpoch:()=>0,
      runtimes:new Map([['local',{client}]])});
    const draft=()=>owner.creationDraft('selected-lens',local,root)?.action;
    const setDraft=action=>owner.retainCreationDraft('selected-lens',local,action?{focus:root,action}:undefined,client);
    const currentDraft=()=>owner.creationDraft('selected-lens',route()==='local'?local:{$tag:'PublicSource'},root)?.action;
    const address={initialLoading,initialFailure:failure};
    const hasPendingCreationPicker=()=>false;
    function Editor(props) {
      const id=crypto.randomUUID(), [params,setParams]=createSignal([]), [body,setBody]=createSignal({kind:'literal',value:''});
      mounted.push({id,place:props.place});
      onCleanup(()=>disposed.push(id));
      editor={id,place:props.place,params,body,setParams,setBody};
      return ()=>JSON.stringify({id,place:props.place,params:params(),body:body()});
    }
    function Entry(props) {
      const ready=()=>props.place==='normal' ? runtimeReady() : variant==='runtime' ? runtimeReady()
        : variant==='address-settled' ? !initialLoading()&&runtimeReady() : initialReady({runtime:runtimeReady},address);
      const env={createMemo,props:{pane:{},readRuntime:{}},workspace:{ready},requested:()=>!!currentDraft(),currentReads:()=>true,failed:()=>false,
        heldLiteralInspection:()=>false,newExpressionRequest:()=>undefined,currentNewOriginMatches:()=>true,request:()=>currentDraft()?{source:'new',action:currentDraft()}:undefined,
        creationReadAllowed:()=>true,readProjection:()=>undefined,workspaceEntered:()=>false,inspectionMode:()=> 'data',focusIntent:()=>undefined,
        inspectionIntent:()=>undefined,typePreviewIntent:()=>undefined,pickerOpen:()=>false,quickValue:()=>false,readingClipboard:()=>false,
        externalAdding:()=>false,drawerOpen:()=>false,savingQuickValue:()=>false,earlyDraftHeld:()=>false,earlyPickers:()=>0,dataInspectionPanelVisible:()=>false};
      const shown=showing(env);
      return createComponent(Show,{get when(){return shown()&&!!currentDraft();},fallback:'pending creation',get children(){return createComponent(Editor,{place:props.place});}});
    }
    const Incoming=lazy(()=>incoming);
    const out=createComponent(Loading,{fallback:'opening address',get children(){return createComponent(Show,{
      get when(){return outerReady(address,hasPendingCreationPicker);},get fallback(){return createComponent(Show,{get when(){return failure();},
        get fallback(){return createComponent(Entry,{place:'preview'});},children:'address failed'});},
      get children(){return createComponent(Incoming,{});}});}});
    createEffect(()=>resolveNode(out),value=>{visible.push(value);});
    controls={setInitialLoading,setRuntimeReady,setDraft,setFailure,setRoute,draft,normal:()=>createComponent(Entry,{place:'normal'})};
  });
  try {
    await settle();
    controls.setDraft('new:function'); controls.setRuntimeReady(true); await settle();
    if(variant==='runtime') expect(mounted.map(x=>x.place)).toEqual(['preview']);
    else expect(mounted).toEqual([]);
    if(scenario==='cancel') { controls.setDraft(undefined); await settle(); expect(controls.draft()).toBeUndefined(); }
    if(scenario==='navigation') { controls.setRoute('public'); await settle(); }
    if(scenario==='failure-retry') {
      controls.setFailure('controlled address refusal'); await settle();
      expect(visible.at(-1)).toBe('address failed'); expect(mounted).toEqual([]);
      controls.setFailure(undefined); await settle(); expect(mounted).toEqual([]);
      expect(controls.draft()).toBe('new:function');
    }
    controls.setInitialLoading(false); await settle();
    if(variant==='normal-pane-only') expect(mounted).toEqual([]);
    resolveIncoming({default:controls.normal}); await settle();
    if(scenario==='cancel'||scenario==='navigation') { expect(mounted).toEqual([]); return; }
    expect(mounted.at(-1).place).toBe('normal');
    if(variant==='normal-pane-only') {
      expect(mounted).toHaveLength(1);
      const identity=editor.id;
      editor.setParams([{name:'probeInput',type:{$ref:'Number'},key:{$tag:'NamedField',ref:{$ref:'parameter-uuid'}}}]);
      editor.setBody({kind:'param',name:'probeInput'}); await settle();
      expect(editor.id).toBe(identity); expect(editor.params()[0].key.ref.$ref).toBe('parameter-uuid');
      expect(editor.body()).toEqual({kind:'param',name:'probeInput'}); expect(disposed).toEqual([]);
    }
  } finally { dispose(); }
});
