import {describe,expect,test} from "bun:test";
import {createRoot,createSignal,createStore,createMemo,createEffect,getOwner,runWithOwner,flush,latest,
  onSettled,isPending,refresh,NotReadyError} from "../../../node_modules/solid-js/dist/solid.dev.js";

// Host lifetime controls: actual production request/paint/port code, async shim,
// transport copier and Solid 2 graph. Source presentation answers are explicit
// fixtures; no registry, evaluator, membership or presentation policy is loaded.
const renderer=await Bun.file(new URL("./TypedReadValue.tsx",import.meta.url)).text();
const worker=await Bun.file(new URL("../expression-runner/authoring-catalog-worker.ts",import.meta.url)).text();
const surface=await Bun.file(new URL("../data-transfer/DataValueSurface.tsx",import.meta.url)).text();
const asyncSource=await Bun.file(new URL("../async-value.ts",import.meta.url)).text();
const registry=await Bun.file(new URL("../../../../../../implementations/typescript/engine/src/registry-transport.ts",import.meta.url)).text();
const transpiler=new Bun.Transpiler({loader:"ts"}),compile=source=>transpiler.transformSync(source).replace(/^export /gm,"");
const section=(source,start,end)=>{const first=source.indexOf(start),last=source.indexOf(end,first+start.length);if(first<0||last<0)throw Error("Production fixture boundary changed: "+start);return source.slice(first,last);};
const wrapper=section(renderer.slice(renderer.indexOf("export function TypedReadValue(")),"  const reader =","  const unavailable =");
const portsCode=section(renderer,"        const ownerPaint =","        const body =");
// B3: a Local read selects its worker session through this identity helper.
const localReadSession=new Function(`${compile(section(worker,"export function localReadSession(","/** Bind only a scope"))};return localReadSession;`)();
// B4 F1: the Local variant (snapshot owner + own-registry identity). A snapshot owner and its registry are 1:1
// (a restored worker keeps both), so a fixture session's owner is its registry.
const localReaderReadSession=new Function("preparedSnapshotOwnerOf","registryHasSnapshotOwner",`${compile(section(worker,"export function localReadSession(","/** Bind only a scope"))};return localReaderReadSession;`)(selected=>selected.registry,()=>false);
const snapshot=new Function(`${compile(section(registry,"export function registryTransportSnapshot<","/** An injective text encoding of a transport value,"))};return registryTransportSnapshot;`)();
const createAsyncValue=new Function("createMemo","createSignal","isPending","refresh",`${compile(asyncSource.slice(asyncSource.indexOf("const LOADING:")))};return createAsyncValue;`)(createMemo,createSignal,isPending,refresh);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const packet=label=>({root:{field:{name:"value",type:{$ref:"Profile"},label:{$tag:"Nothing"},meta:{},ui:{$tag:"Nothing"}},
  body:"structural",structure:"record",recordLabel:"Record",numeric:false,glyph:{},readPlan:null,
  typePresentation:{label,icon:"profile"}},children:[{key:"profile",path:["profile"],label:"profile",type:{$ref:label},
    typeLabel:label,typeIcon:"profile",caption:"Caption "+label,glyph:{}}]});
async function settle(){for(let tick=0;tick<10;tick++){await Promise.resolve();flush();}}
function fixture(options={}){
 let disposeRoot;
 const h=createRoot(dispose=>{
  disposeRoot=dispose;const owner=getOwner();
  const [data,setData]=createStore({profile:{city:"Paris"},count:1});
  const [value,setValue]=createSignal(data),[type,setType]=createSignal({$ref:"Profile"});
  const heldType=options.pendingType?deferred():undefined;
  const pendingType=heldType?createMemo(()=>heldType.promise):undefined;
  const sessionFor=label=>({label,registry:{label},environment:{},evaluateContext:{label}});
  const [session,setSession]=createSignal(sessionFor("reader-one")),[revision,setRevision]=createSignal(1);
  const [fieldRegistry,setFieldRegistry]=createSignal(options.foreign?{label:"foreign"}:undefined);
  const templatesFor=label=>({label,list:()=>[],listComponentNames:()=>[]});
  const [templates,setTemplates]=createSignal(templatesFor("templates-one"));
  const [token,setToken]=createSignal({label:"worker-one"}),[available,setAvailable]=createSignal(options.available!==false);
  const calls=[],opens=[],contexts=[],observed=[],handles=new WeakMap();
  // `client`: the surface listens to its reader's lifetime signal (absent here).
  const reader={client:{},kind:options.kind??"local",session,revision,templates,registry:()=>session().registry};
  const preparedReaderWorkerForSession=selected=>{if(!available())return undefined;const key=token();let tokens=handles.get(selected);if(!tokens){tokens=new WeakMap();handles.set(selected,tokens);}let handle=tokens.get(key);if(!handle){handle={session:selected,token:key};tokens.set(key,handle);}return handle;};
  const props={get value(){return value();},get type(){return pendingType?pendingType():type();},get fieldRegistry(){return fieldRegistry();},
    dataPath:["base"],onOpenData:data=>opens.push(data),onDataContext:(event,data)=>contexts.push({event,data})};
  const bindings={createMemo,createSignal,createAsyncValue,latest,onSettled,NotReadyError,props,
    useReaderRuntime:()=>reader,useAuthoringSession:()=>session(),registryTransportSnapshot:snapshot,
    preparedReaderWorkerForSession,localReadSession,localReaderReadSession,hasLocalReadWorker:selected=>!!preparedReaderWorkerForSession(selected),LUCIDE_BY_NAME:{profile:{}},
    runPreparedReaderWorker:(handle,payload,signal)=>{const held=deferred();calls.push({handle,payload,signal,...held});return held.promise;}};
  const api=new Function(...Object.keys(bindings),compile(`${wrapper};return{readInput,readRequest,current,projectedRead,paint,paintOwner,busy,retry,
    makePorts(owner){${portsCode};return ports;}};`))(...Object.values(bindings));
  createEffect(()=>({input:api.readInput(),paint:api.paint(),owner:api.paintOwner(),busy:api.busy(),request:api.readRequest()}),state=>{observed.push(state);});
  const makePorts=()=>runWithOwner(owner,()=>api.makePorts(api.paintOwner()));
  return{api,props,reader,data,setData,value,setValue,type,setType,session,setSession,sessionFor,revision,setRevision,
    fieldRegistry,setFieldRegistry,templates,setTemplates,templatesFor,setToken,setAvailable,calls,opens,contexts,observed,makePorts,heldType};
 });h.dispose=()=>{disposeRoot();flush();};return h;
}
async function withFixture(options,work){const h=fixture(options);try{await settle();return await work(h);}finally{h.dispose();await settle();}}
async function admit(h,label="old"){h.calls.at(-1).resolve({valueReads:[packet(label)]});await settle();expect(h.api.paint().packet.root.typePresentation.label).toBe(label);}

describe("Local arbitrary read packet lifetime",()=>{
 test("early Reflect capture owns immutable data while the wire contains no navigation ports",async()=>withFixture({},async h=>{
  expect(h.calls).toHaveLength(1);const input=h.api.readInput(),call=h.calls[0];
  expect(input.ui.value).toBe(h.data);expect(input.wire.value).not.toBe(h.data);
  expect(call.payload).toEqual({method:"project-reader-values",inputs:[input.wire],knownIcons:["profile"]});
  expect(Object.keys(call.payload.inputs[0])).not.toContain("occurrence");expect(Object.keys(call.payload.inputs[0])).not.toContain("onOpenData");
  expect(input.wire.value.profile.city).toBe("Paris");expect(h.api.paint()).toBeUndefined();expect(h.api.busy()).toBe(true);
  await admit(h);expect(h.api.busy()).toBe(false);
 }));

 test("same-owner deep changes retain paired old paint and owner while every old action refuses",async()=>withFixture({},async h=>{
  await admit(h);const old=h.api.paint(),owner=h.api.paintOwner(),ports=h.makePorts(),oldPorts=ports();expect(oldPorts.current()).toBe(true);
  h.setData(d=>{d.profile.city="Rome";});await settle();
  expect(h.calls).toHaveLength(2);expect(h.value()).toBe(h.data);
  expect(h.calls[1].payload.inputs[0].value.profile.city).toBe("Rome");expect(old.input.wire.value.profile.city).toBe("Paris");
  expect(h.api.paint()).toBe(old);expect(h.api.paintOwner()).toBe(owner);expect(oldPorts.current()).toBe(false);
  oldPorts.openData({value:old.input.wire.value.profile,label:"profile",path:["base","profile"],getType:()=>undefined});expect(h.opens).toEqual([]);
  await admit(h,"new");expect(h.api.paintOwner()).toBe(owner);expect(h.api.paint().input.wire.value.profile.city).toBe("Rome");
  expect(h.api.paint().packet.children[0].caption).toBe("Caption new");expect(ports().current()).toBe(true);
  ports().openData({value:h.api.paint().input.wire.value.profile,label:"profile",path:["base","profile"],getType:()=>undefined});
  expect(h.opens).toHaveLength(1);expect(h.opens[0].value).toBe(h.data.profile);
 }));

 test("a latest status companion cannot block the next owned source request",async()=>withFixture({},async h=>{
  await admit(h);const ports=h.makePorts(),original=ports();expect(original.current()).toBe(true);
  expect(latest(h.api.readRequest).state).toBe("ready");
  h.setData(d=>{d.profile.city="Rome";});
  // The native component graph can create this same companion indirectly.
  expect(original.current()).toBe(false);
  await settle();expect(h.calls).toHaveLength(2);expect(h.api.busy()).toBe(true);
  expect(h.api.paint().input.wire.value.profile.city).toBe("Paris");
  await admit(h,"next");expect(ports().current()).toBe(true);
 }));

 test("physical mapping restores exact raw roots/children and refuses wrong paths or descriptors",async()=>withFixture({},async h=>{
  await admit(h);const ports=h.makePorts()(),root=h.api.paint().input.wire.value;
  const data=(value,path)=>({value,label:"Data",path,getType:()=>undefined});
  expect(ports.selection(data(root,["base"])).value).toBe(h.data);
  expect(ports.selection(data(root.profile,["base","profile"])).value).toBe(h.data.profile);
  expect(ports.selection(data(root,["other"]))).toBeUndefined();expect(ports.selection(data(root,["base","missing"]))).toBeUndefined();
  // A custom component's new root retains its independent held value.
  expect(ports.selection(data("independent",["base"])).value).toBe("independent");
 }));

 for(const coordinate of ["session","worker","templates","lookup"]){test(coordinate+" change clears a sibling frame's paint",async()=>withFixture({},async h=>{
  await admit(h);const owner=h.api.paintOwner();
  if(coordinate==="session")h.setSession(h.sessionFor("reader-two"));
  else if(coordinate==="worker")h.setToken({label:"worker-two"});
  else if(coordinate==="templates")h.setTemplates(h.templatesFor("templates-two"));
  else h.setFieldRegistry(h.session().registry);
  await settle();expect(h.api.paint()).toBeUndefined();expect(h.api.paintOwner()).toBeUndefined();
  await admit(h,"replacement");expect(h.api.paintOwner()).not.toBe(owner);
 }));}

 test("out-of-order packets never replace a newer input and disposal aborts the actual request",async()=>withFixture({},async h=>{
  const first=h.calls[0];h.setData(d=>{d.profile.city="Rome";});await settle();expect(first.signal.aborted).toBe(true);
  await admit(h,"new");first.resolve({valueReads:[packet("stale")]});await settle();expect(h.api.paint().packet.root.typePresentation.label).toBe("new");
  h.setData(d=>{d.profile.city="Oslo";});await settle();const last=h.calls.at(-1);h.dispose();expect(last.signal.aborted).toBe(true);last.resolve({valueReads:[packet("disposed")]});await settle();expect(h.opens).toEqual([]);
 }));

 test("current refusal clears paint and the existing refetch retries without changing data",async()=>withFixture({},async h=>{
  await admit(h);const former=h.makePorts()();h.setData(d=>{d.profile.city="Rome";});await settle();h.calls.at(-1).reject(Error("Controlled refusal"));await settle();
  expect(h.api.paint()).toBeUndefined();expect(h.api.readRequest().state).toBe("error");
  const retry=h.api.retry();expect(former.current()).toBe(false);
  former.openData({value:h.data,label:"Data",path:["base"],getType:()=>undefined});expect(h.opens).toEqual([]);
  await settle();expect(h.api.busy()).toBe(true);await admit(h,"retried");await retry;expect(h.api.busy()).toBe(false);
 }));

 test("a graph suspension is rethrown instead of becoming a Local failure DTO",()=>{
  const inputCode=section(wrapper,"  const readInput =","  const current =");
  const suspension=Object.create(NotReadyError.prototype),session={registry:{},environment:{},evaluateContext:{}};
  const reader={client:{},kind:"local",session:()=>session,registry:()=>session.registry,templates:()=>({list:()=>[],listComponentNames:()=>[]}),revision:()=>1};
  const props={value:1,get type(){throw suspension;}};
  const input=new Function("createMemo","reader","inheritedSession","props","preparedReaderWorkerForSession","registryTransportSnapshot","NotReadyError","localReadSession","localReaderReadSession","hasLocalReadWorker",
   compile(`${inputCode};return readInput;`))(compute=>compute,reader,session,props,()=>({}),snapshot,NotReadyError,localReadSession,localReaderReadSession,()=>true);
  let thrown;try{input();}catch(error){thrown=error;}expect(thrown).toBe(suspension);
 });

 test("an actual suspended source prop resumes into its first worker flight",async()=>withFixture({pendingType:true},async h=>{
  expect(h.calls).toEqual([]);
  h.heldType.resolve({$ref:"Profile"});await settle();
  expect(h.calls).toHaveLength(1);expect(h.api.readInput().wire.type).toEqual({$ref:"Profile"});
  await admit(h,"resumed");expect(h.api.busy()).toBe(false);
 }));

 for(const bad of [{},{valueReads:[]},{valueReads:[{}]},{valueReads:[{...packet("bad"),root:{...packet("bad").root,readPlan:undefined}}]}]){
  test("malformed packet refuses without preparing a browser fallback",async()=>withFixture({},async h=>{h.calls[0].resolve(bad);await settle();expect(h.api.paint()).toBeUndefined();expect(h.api.readRequest().state).toBe("error");}));
 }

 for(const options of [{kind:"account"},{kind:"public"}])test("existing other-owner backend remains synchronous "+JSON.stringify(options),async()=>withFixture(options,async h=>{
  expect(h.api.readInput()).toBeUndefined();expect(h.calls).toEqual([]);
 }));
 // B3: a Local read with an unknown field owner is unavailable, never page reflection.
 test("a Local read with an unknown field owner fails closed",async()=>withFixture({foreign:true},async h=>{
  expect(h.api.readInput().error).toBeInstanceOf(Error);expect(h.calls).toEqual([]);
 }));
 test("a missing Local service fails closed",async()=>withFixture({available:false},async h=>{expect(h.api.readInput().error).toBeInstanceOf(Error);expect(h.calls).toEqual([]);expect(h.api.paint()).toBeUndefined();}));
});

describe("paired read surface transfer lifetime",()=>{
 test("a retired child edit refuses before reading or rewriting its original parent",async()=>{
  const writes=[],props={current:()=>false,get value(){throw Error("Retired parent must not be read");},
   session:()=>{throw Error("Retired session must not be read");},onChange:next=>writes.push(next)};
  const replaceChild=new Function("props",compile(`${section(surface,"  async function replaceChild(","  function childType(")};return replaceChild;`))(props);
  await expect(replaceChild("profile",{value:"stale",expr:{literal:"stale"}})).rejects.toThrow("This data changed.");
  expect(writes).toEqual([]);
 });
 // The actual transfer entry is the browser IO seam. Semantic import/adaptation
 // replies are controlled so these cases only check its private action lease.
 function transferFixture(){
  const ingested=deferred(),adapted=deferred(),published=[],calls=[];
  let ready=true;
  const session={environment:{},registry:{},evaluateContext:{}},value={original:true};
  const props={value,type:{$ref:"Profile"},current:()=>ready,session:()=>session,revision:()=>1,
   onChange:change=>published.push(change)};
  const bindings={props,sessionEpoch:()=>1,assertCurrentSession:epoch=>expect(epoch).toBe(1),
   effectiveType:()=>props.type,ingestTransfer:(capture,options)=>{calls.push({kind:"ingest",capture,options});return ingested.promise;},
   adaptTransferForSession:(items,options,signal)=>{calls.push({kind:"adapt",items,options,signal});return adapted.promise;},
   typeForTransfer:()=>{throw Error("Unexpected type inference");},item:()=>{throw Error("Unexpected transfer classification");}};
  const transfer=new Function(...Object.keys(bindings),compile(`${section(surface,"  async function transfer(","  async function replaceChild(")};return transfer;`))(...Object.values(bindings));
  return{props,value,session,ingested,adapted,published,calls,transfer,setReady:value=>{ready=value;}};
 }
 test("accepted import publishes exactly the adapted value once",async()=>{
  const h=transferFixture(),controller=new AbortController(),capture={text:"controlled"},items=[{value:"incoming"}],next={value:"adapted",expr:{literal:"adapted"}};
  const pending=h.transfer(capture,controller.signal);h.ingested.resolve(items);await settle();
  expect(h.calls.map(call=>call.kind)).toEqual(["ingest","adapt"]);expect(h.calls[1].options.currentValue).toBe(h.value);
  expect(h.calls[1].options.session).toBe(h.session);h.adapted.resolve(next);await pending;
  expect(h.published).toEqual([{...next,revision:1}]);
 });
 for(const stage of ["ingest","adapt"])for(const retirement of ["predicate","replacement","abort"]){
  test(`${retirement} during ${stage} refuses the captured transfer before publication`,async()=>{
   const h=transferFixture(),controller=new AbortController(),pending=h.transfer({text:"controlled"},controller.signal);
   // Attach the handler before releasing either awaited IO promise.
   const result=pending.then(()=>undefined,error=>error);
   if(stage==="adapt"){h.ingested.resolve([{value:"incoming"}]);await settle();expect(h.calls.at(-1).kind).toBe("adapt");}
   if(retirement==="predicate")h.setReady(false);
   else if(retirement==="replacement")h.props.current=()=>true;
   else controller.abort();
   if(stage==="ingest")h.ingested.resolve([{value:"incoming"}]);
   else h.adapted.resolve({value:"adapted",expr:{literal:"adapted"}});
   expect(await result).toBeInstanceOf(Error);expect(h.published).toEqual([]);
   if(stage==="ingest")expect(h.calls.map(call=>call.kind)).toEqual(["ingest"]);
  });
 }
});
