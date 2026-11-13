import {test,expect} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {createRoot,createMemo,createSignal,createEffect,onSettled,flush} from '../../node_modules/solid-js/dist/solid.dev.js';
// C1 / A2-B3 scheduling: actual Home owner hooks and Suggestions controller.
// Only checked worker replies and animation-frame host ports are controlled;
// no engine, registry or browser starts, and no applicability verdict is mocked.
const home=await readFile(new URL('../routes/app/home.tsx',import.meta.url),'utf8');
const surface=await readFile(new URL('./DataInspectionDialog.tsx',import.meta.url),'utf8');
const begin=home.indexOf('  const lensOccurrence = suggestionSourceForTarget('),end=home.indexOf('  const canvasSourceReference =',begin);
if(begin<0||end<begin)throw Error('Home Suggestions owner boundary moved');
const factoryStart=surface.indexOf('export function createDataInspectionSuggestions('),factoryEnd=surface.indexOf('const panelOrder:',factoryStart);
if(factoryStart<0||factoryEnd<factoryStart)throw Error('Shared Suggestions controller boundary moved');
const transpiler=new Bun.Transpiler({loader:'tsx'});
const factoryCode=transpiler.transformSync(surface.slice(factoryStart,factoryEnd)).replace(/^export /gm,'').replaceAll('import("./expression-runner/authoring-catalog-worker")','loadWorker()');
const homeCode=transpiler.transformSync(home.slice(begin,end));
async function settle(){for(let i=0;i<12;i++){await Promise.resolve();flush()}}
function fixture(){
 let stop,owner,captures=0,currentInput={revision:'initial',value:5},epoch=1;
 const requests=[],frames=new Map();let nextFrame=0;
 const [subject,setSubject]=createSignal({item:{id:'focused'},evaluated:{value:5}});
 const worker={},session={};
 const workerApi={authoringWorkerSnapshot:()=>worker,discoverDataSuggestionsInWorker:(_session,input,options,signal)=>{requests.push({session:_session,input,options,signal});return new Promise(resolve=>{requests.at(-1).resolve=resolve})}};
 const controller=new Function('createSignal','createMemo','onSettled','loadWorker',factoryCode+';return createDataInspectionSuggestions;')(createSignal,createMemo,onSettled,async()=>workerApi);
 const bindings={createDataInspectionSuggestions:controller,captureDataOccurrence:source=>source.capture(),
 suggestionSourceForTarget:()=>({state:'source',capture:()=>{captures++;const input=currentInput;return {session,input,current:()=>currentInput===input,select:()=>{throw Error('No selection in scheduling control')}}}}),
 props:{pane:{registerSuggestions:value=>{owner=value},source:()=>({$tag:'ThisTabSource'})}},onSettled,createEffect,
 sessionEpoch:()=>epoch,reader:{revision:()=>1},root:()=>({revision:1}),scope:()=>({kind:'value',itemId:'focused'}),draftValueFingerprint:JSON.stringify,workspaceSourceKey:()=> 'local',
 dataSuggestions:{invalidate(){}},initialSuggestions:undefined,lensExpressionSubject:subject,heldLensSubject:()=>undefined,
 authoringWorkerRetired:()=>false,homeAuthoringSession:()=>session,authoringWorkerSnapshot:()=>worker,
 requestAnimationFrame:callback=>{const id=++nextFrame;frames.set(id,callback);return id},cancelAnimationFrame:id=>frames.delete(id)};
 createRoot(dispose=>{stop=dispose;new Function(...Object.keys(bindings),homeCode)(...Object.values(bindings));createEffect(subject,()=>{})});flush();
 return {requests,stop,owner:()=>owner,captures:()=>captures,paint:()=>{setSubject({item:{id:'focused'},evaluated:{value:6}});flush()},
 latest:()=>{currentInput={revision:'latest',value:6}},drainFrames:()=>{while(frames.size){const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback()}flush()},
 changeSource:()=>{currentInput={revision:'replacement',value:7}},reply:()=>{const request=requests.at(-1);request.resolve({revision:request.input.revision,suggestions:[],undecided:[],coverage:{operationsChecked:0,operationsSeen:0,operationsAvailable:0}})}};
}
test('ordinary focused data paint makes no discovery; explicit open captures latest input',async()=>{
 const h=fixture();try{await settle();h.drainFrames();await settle();h.paint();h.drainFrames();await settle();expect(h.requests).toHaveLength(0);expect(h.captures()).toBe(0);
 h.latest();h.owner().open();await settle();expect(h.requests).toHaveLength(1);expect(h.requests[0].input).toMatchObject({revision:'latest',value:6});expect(h.requests[0].session).toBeDefined();expect(h.requests[0].signal.aborted).toBe(false);
 h.owner().close();expect(h.requests[0].signal.aborted).toBe(true);
 }finally{h.stop()}
});
test('explicit discovery still refuses a changed source and remains cancellable',async()=>{
 const h=fixture();try{h.owner().open();await settle();expect(h.requests).toHaveLength(1);h.changeSource();h.reply();await settle();expect(h.owner().issue()).toBe('This data changed. Open Suggestions again.');expect(h.owner().read()).toBeUndefined();h.owner().close();expect(h.requests[0].signal.aborted).toBe(true)}finally{h.stop()}
});

// Execute the actual Home capture/intent functions and the unchanged shared
// controller. Deferred replies are transport fixtures, not inference oracles.
const intentFrom=home.indexOf('  let activeSuggestionIntent:');
const intentTo=home.indexOf('  const lensOccurrence =',intentFrom);
const menuFrom=home.indexOf('  function openContextMenu(');
const menuTo=home.indexOf('  function captureContainedOccurrence(',menuFrom);
if(intentFrom<0||intentTo<intentFrom||menuFrom<0||menuTo<menuFrom)throw Error('Home context Suggestions intent boundary moved');
const intentCode=transpiler.transformSync(home.slice(intentFrom,intentTo));
const openMenuCode=transpiler.transformSync(home.slice(menuFrom,menuTo));
const firstRowFrom=home.indexOf('{ id: "lens-shortcuts", label: "Suggestions", icon: "lightbulb",',home.indexOf('  function contextItems('));
const firstRowEnd=home.indexOf('children: contextDataSuggestionItems(menu) },',firstRowFrom)+'children: contextDataSuggestionItems(menu) }'.length;
const secondRowFrom=home.indexOf('{ id: "lens-shortcuts", label: "Suggestions", icon: "lightbulb",',firstRowEnd);
const secondRowEnd=home.indexOf('...contextDataSuggestionItems(menu)] },',secondRowFrom)+'...contextDataSuggestionItems(menu)] }'.length;
if(firstRowFrom<0||secondRowFrom<0||firstRowEnd<firstRowFrom||secondRowEnd<secondRowFrom)throw Error('Home context Suggestions menu rows moved');
const rows=[home.slice(firstRowFrom,firstRowEnd),home.slice(secondRowFrom,secondRowEnd)].map(row=>
 new Function('menu','item','props','startMenuDataSuggestions','contextDataSuggestionItems',
 transpiler.transformSync(`const row = ${row}; return row;`)));

function contextFixture(){
 const state={epoch:7,revision:1,reader:{},captureError:undefined,forceCurrent:false,value:5,onCapture:undefined};
 const session={},worker={},captures=[],requests=[],preparations=[],selected=[],issues=[],items=new Map();
 let api,stop;
 const [menu,setMenu]=createSignal(),[started,setStarted]=createSignal();
 const workerApi={authoringWorkerSnapshot:()=>worker,
  discoverDataSuggestionsInWorker:(capturedSession,input,options,signal)=>new Promise(resolve=>requests.push({session:capturedSession,input,options,signal,resolve})),
  prepareDataSuggestionInWorker:(capturedSession,suggestion,input,signal)=>new Promise(resolve=>preparations.push({session:capturedSession,suggestion,input,signal,resolve}))};
 const controller=new Function('createSignal','createMemo','onSettled','loadWorker',factoryCode+';return createDataInspectionSuggestions;')
  (createSignal,createMemo,onSettled,async()=>workerApi);
 const dataOccurrence={state:'source'};
 const capture=()=>{
  if(state.captureError)throw state.captureError;
  const {target,occurrence}=api.targets(),epoch=state.epoch,revision=state.revision,reader=state.reader;
  const input={revision:`${epoch}:${revision}:${target?.id}`,value:state.value,expression:{kind:'literal',value:state.value}};
  if(state.reference)input.reference=state.reference;
  const source={session,input,...(state.dispositions?{dispositions:state.dispositions}:{}),current:()=>state.forceCurrent||state.epoch===epoch&&state.revision===revision&&state.reader===reader
   &&api.targets().target===target&&api.targets().occurrence===occurrence,
   select:(node,suggestion,options)=>selected.push({node,suggestion,input,options}),reportIssue:message=>issues.push(message)};
  captures.push(source);state.onCapture?.(source,captures.length);return source;
 };
 createRoot(dispose=>{
  stop=dispose;
  api=new Function('dataOccurrence','createDataInspectionSuggestions','captureDataOccurrence','setStartedSuggestionMenu','startedSuggestionMenu','contextMenu','menuIsCurrent','draftValueFingerprint',
   `let suggestionTarget, suggestionOccurrence; ${intentCode}; return { dataSuggestions, captureDataSuggestionsFor, startMenuDataSuggestions, contextDataSuggestionItems, openDataSuggestionsFor,
    targets:()=>({target:suggestionTarget,occurrence:suggestionOccurrence}) };`)
   (dataOccurrence,controller,capture,setStarted,started,menu,target=>target.epoch===state.epoch&&target.viewId==='view',JSON.stringify);
 });flush();
 class FixtureElement{constructor(id){this.id=id}closest(selector){return selector==='[data-locus-item]'?{dataset:{locusItem:this.id}}:undefined}}
 const openMenu=new Function('Element','ownsLocusContextMenu','locusContextPosition','current','scopeSubject','stage','clamp01','findLocusItem','dataSuggestions','captureDataSuggestionsFor',
  'setContextMenu','sessionEpoch','scope','props','workspaceSourceKey','transferCommandsFor',openMenuCode+';return openContextMenu;')
  (FixtureElement,()=>true,()=>({x:40,y:60}),()=>({id:'view'}),()=>({row:{view:{items:[...items.values()]}}}),undefined,value=>value,
   (_items,id)=>items.get(id),api.dataSuggestions,api.captureDataSuggestionsFor,setMenu,()=>state.epoch,()=>({kind:'root'}),{},()=>'',()=>undefined);
 const row=(target=menu())=>rows[target.occurrence?0:1](target,target.item,{},api.startMenuDataSuggestions,api.contextDataSuggestionItems);
 const reply=(request=requests.at(-1),label=request.input.revision,truncated=false)=>request.resolve({$tag:'RankedSuggestions',revision:request.input.revision,
  suggestions:[{identity:label,label,icon:'check',missingArguments:0,revision:request.input.revision}],undecided:[],
  omittedConfirmed:0,omittedUndecided:0,coverage:{operationsChecked:32,operationsSeen:4861,operationsAvailable:4861,skipped:0,truncated}});
 return {state,api,requests,preparations,captures,selected,issues,stop,menu,row,reply,
  rightClick(id,contained=false){const item={id};items.set(id,item);const occurrence=contained?{item,current:()=>true}:undefined;
   openMenu({target:new FixtureElement(id),preventDefault(){},stopPropagation(){}},occurrence);flush();return menu()},
  close(){api.dataSuggestions.close();setMenu(undefined);flush()},replaceMenu(value){setMenu(value);flush()}};
}

test('ordinary and contained right-click capture immediately but start full discovery only from their submenu hook',async()=>{
 for(const contained of [false,true]){const h=contextFixture();try{
  const menu=h.rightClick('original',contained);await settle();expect(h.captures).toHaveLength(1);expect(h.requests).toHaveLength(0);
  expect(h.row(menu).children).toMatchObject([{id:'data-suggestions-pending',disabled:true}]);
  h.row(menu).onOpen();await settle();expect(h.captures).toHaveLength(2);expect(h.requests).toHaveLength(1);
  expect(h.requests[0].input).toBe(h.captures[1].input);expect(h.requests[0].session).toBe(h.captures[0].session);
  expect(h.requests[0].options).toEqual({maxOperations:32,maxSuggestions:20});
 }finally{h.stop()}}
});

test('repeated submenu intents before Solid commits start exactly once',async()=>{
 const h=contextFixture();try{const menu=h.rightClick('A'),row=h.row(menu);
  row.onOpen();row.onOpen();h.api.startMenuDataSuggestions(menu);expect(menu.suggestionIntent.requested).toBe(true);
  await settle();expect(h.requests).toHaveLength(1);expect(h.captures).toHaveLength(2);
 }finally{h.stop()}
});

test('stale captured input and replaced menu identities never recapture or post discovery',async()=>{
 for(const change of [h=>h.state.epoch++,h=>h.state.revision++,h=>h.state.reader={},h=>h.replaceMenu({...h.menu()})]){
  const h=contextFixture();try{const menu=h.rightClick('A');change(h);h.row(menu).onOpen();await settle();
   expect(h.captures).toHaveLength(1);expect(h.requests).toHaveLength(0);
  }finally{h.stop()}
 }
});

test('a failed right-click capture is retained as refusal rather than retried on submenu intent',async()=>{
 const h=contextFixture();try{h.state.captureError=new Error('Original source unavailable');const menu=h.rightClick('A');
  h.state.captureError=undefined;h.row(menu).onOpen();await settle();expect(h.captures).toHaveLength(0);expect(h.requests).toHaveLength(0);
  expect(h.api.dataSuggestions.issue()).toBe('Original source unavailable');
 }finally{h.stop()}
});

test('a permissive old current predicate cannot authorize a newly captured revision or draft',async()=>{
 for(const change of [h=>h.state.revision++,h=>h.state.value=7]){
  const h=contextFixture();try{const menu=h.rightClick('A');h.state.forceCurrent=true;change(h);h.row(menu).onOpen();await settle();
   expect(h.captures).toHaveLength(2);expect(h.requests).toHaveLength(0);
   expect(h.api.dataSuggestions.issue()).toBe('This data changed. Open Suggestions again.');
  }finally{h.stop()}
 }
});

test('an original fence retired during fresh capture refuses discovery even when the new fence is current',async()=>{
 const h=contextFixture();try{const menu=h.rightClick('A');
  h.state.onCapture=(fresh,count)=>{if(count===2){h.captures[0].current=()=>false;fresh.current=()=>true}};
  h.row(menu).onOpen();await settle();expect(h.captures).toHaveLength(2);expect(h.captures[1].current()).toBe(true);
  expect(h.requests).toHaveLength(0);expect(h.api.dataSuggestions.issue()).toBe('This data changed. Open Suggestions again.');
 }finally{h.stop()}
});

test('a later original-fence retirement prevents late discovery publication while the fresh fence remains current',async()=>{
 const h=contextFixture();try{const menu=h.rightClick('A');h.row(menu).onOpen();await settle();expect(h.requests).toHaveLength(1);
  h.captures[0].current=()=>false;expect(h.captures[1].current()).toBe(true);h.reply(undefined,'Late result');await settle();
  expect(h.api.dataSuggestions.read()).toBeUndefined();expect(h.row(menu).children.some(row=>row.label==='Late result')).toBe(false);
  expect(h.api.dataSuggestions.issue()).toBe('This data changed. Open Suggestions again.');
 }finally{h.stop()}
});

test('the original fence still blocks selection before and after asynchronous worker preparation',async()=>{
 for(const retireBeforePrepare of [true,false]){const h=contextFixture();try{
  const menu=h.rightClick('A');h.row(menu).onOpen();await settle();h.reply();await settle();const action=h.row(menu).children[0];h.close();
  if(retireBeforePrepare)h.captures[0].current=()=>false;
  action.onSelect();await settle();expect(h.captures[1].current()).toBe(true);
  expect(h.preparations).toHaveLength(retireBeforePrepare?0:1);
  if(!retireBeforePrepare){h.captures[0].current=()=>false;h.preparations[0].resolve({ok:true,node:{kind:'literal',value:42}});await settle()}
  expect(h.selected).toHaveLength(0);expect(h.issues.at(-1)).toBe('This data changed. Open Suggestions again.');
 }finally{h.stop()}}
});

test('new menu placeholders hide old results and late answers cannot take the new menu owner',async()=>{
 const h=contextFixture();try{
  const a=h.rightClick('A');h.row(a).onOpen();await settle();h.reply(undefined,'A result');await settle();
  expect(h.row(a).children[0].label).toBe('A result');h.close();
  const b=h.rightClick('B');expect(h.row(b).children[0].id).toBe('data-suggestions-pending');expect(h.row(b).children.some(row=>row.label==='A result')).toBe(false);
  h.row(b).onOpen();await settle();const old=h.requests.at(-1);h.close();
  const c=h.rightClick('C');h.row(c).onOpen();await settle();h.reply(old,'Late B result');await settle();
  expect(h.row(c).children.some(row=>row.label==='Late B result')).toBe(false);expect(old.signal.aborted).toBe(true);
  h.reply(undefined,'C result');await settle();expect(h.row(c).children[0].label).toBe('C result');
 }finally{h.stop()}
});

test('selection keeps its held capture after menu close and retains asynchronous preparation recheck',async()=>{
 const h=contextFixture();try{const menu=h.rightClick('A');h.row(menu).onOpen();await settle();h.reply();await settle();
  const action=h.row(menu).children[0];h.close();action.onSelect();await settle();expect(h.preparations).toHaveLength(1);
  expect(h.preparations[0].input).toBe(h.requests[0].input);
  h.preparations[0].resolve({ok:true,node:{kind:'literal',value:42}});await settle();expect(h.selected).toHaveLength(1);
 }finally{h.stop()}
});

test('More and held-panel lifetimes keep the existing owner behavior',async()=>{
 const h=contextFixture();try{const menu=h.rightClick('A');h.row(menu).onOpen();await settle();h.reply(undefined,'A result',true);await settle();
  const oldAction=h.row(menu).children[0];
  h.row(menu).children.find(row=>row.id==='data-suggestions-more').onSelect();await settle();
  expect(h.requests.at(-1).options).toEqual({maxOperations:128,maxSuggestions:20});expect(h.captures).toHaveLength(3);
  h.reply(undefined,'Expanded result');await settle();oldAction.onSelect();await settle();expect(h.preparations).toHaveLength(0);
  expect(h.issues.at(-1)).toBe('This data changed. Open Suggestions again.');
  const release=h.api.dataSuggestions.hold();await settle();const active=h.requests.at(-1);h.close();expect(active.signal.aborted).toBe(false);
  release();expect(active.signal.aborted).toBe(true);
 }finally{h.stop()}
});

test('explicit Home handoff remains eager and joins matching owner work',async()=>{
 const h=contextFixture();try{const item={id:'A'};h.api.openDataSuggestionsFor(item);await settle();expect(h.requests).toHaveLength(1);
  h.api.openDataSuggestionsFor(item);await settle();expect(h.requests).toHaveLength(1);expect(h.requests[0].signal.aborted).toBe(false);
 }finally{h.stop()}
});

// Demo 1 (2026-11-07): a complete action picked from the right-click menu shows
// its computed result at once; only an action that needs inputs opens a draft.
test('a complete menu action is applied with its result, an incomplete one opens its draft',async()=>{
 for(const missing of [0,1]){const h=contextFixture();try{const menu=h.rightClick('A');h.row(menu).onOpen();await settle();
  const request=h.requests.at(-1);request.resolve({$tag:'RankedSuggestions',revision:request.input.revision,
   suggestions:[{identity:'act',label:'Act',icon:'check',missingArguments:missing,revision:request.input.revision}],undecided:[],
   omittedConfirmed:0,omittedUndecided:0,coverage:{operationsChecked:1,operationsSeen:1,operationsAvailable:1,skipped:0,truncated:false}});
  await settle();const action=h.row(menu).children[0];h.close();action.onSelect();await settle();
  h.preparations[0].resolve({ok:true,node:{kind:'literal',value:42}});await settle();
  expect(h.selected).toHaveLength(1);
  if(missing)expect(h.selected[0].options).toBeUndefined();else expect(h.selected[0].options).toMatchObject({evaluate:true});
 }finally{h.stop()}}
});

// Demo 1 (2026-11-07): the menu applies an action by its default destination,
// within the destinations its source supports (review S4). Apply here prepares
// over the authored copy (no reference to the data itself, review B4); new data
// keeps the reference input.
test('Apply here prepares over the authored copy; New data keeps the reference input',async()=>{
 const reference={kind:'ref',savedExprId:'tab:A'};
 for(const [disposition,dispositions,expected] of [['ApplyToDraft',undefined,'ApplyToDraft'],['ApplyToDraft',['CreateDerivedData'],'CreateDerivedData'],['CreateDerivedData',undefined,'CreateDerivedData']]){
  const h=contextFixture();try{h.state.reference=reference;h.state.dispositions=dispositions;const menu=h.rightClick('A');h.row(menu).onOpen();await settle();
   const request=h.requests.at(-1);expect(request.input.reference).toBe(reference);
   request.resolve({$tag:'RankedSuggestions',revision:request.input.revision,
    suggestions:[{identity:'act',label:'Act',icon:'check',missingArguments:0,revision:request.input.revision,disposition}],undecided:[],
    omittedConfirmed:0,omittedUndecided:0,coverage:{operationsChecked:1,operationsSeen:1,operationsAvailable:1,skipped:0,truncated:false}});
   await settle();const action=h.row(menu).children[0];h.close();action.onSelect();await settle();
   const prepared=h.preparations[0];
   if(expected==='ApplyToDraft'){expect(prepared.input.reference).toBeUndefined();expect(prepared.input.expression).toBe(request.input.expression);expect(prepared.input.revision).toBe(request.input.revision)}
   else expect(prepared.input).toBe(request.input);
   prepared.resolve({ok:true,node:{kind:'literal',value:42}});await settle();
   expect(h.selected[0].options).toEqual({evaluate:true,disposition:expected});
  }finally{h.stop()}}
});

// Review minor: the right-click row's submenu offers the other destination and the draft.
test('a complete menu action offers the other destination and Open expression',async()=>{
 for(const [choice,expected] of [[0,{evaluate:true,disposition:'ApplyToDraft'}],[1,undefined]]){
  const h=contextFixture();try{const menu=h.rightClick('A');h.row(menu).onOpen();await settle();
   const request=h.requests.at(-1);request.resolve({$tag:'RankedSuggestions',revision:request.input.revision,
    suggestions:[{identity:'act',label:'Act',icon:'check',missingArguments:0,revision:request.input.revision,disposition:'CreateDerivedData'}],undecided:[],
    omittedConfirmed:0,omittedUndecided:0,coverage:{operationsChecked:1,operationsSeen:1,operationsAvailable:1,skipped:0,truncated:false}});
   await settle();const action=h.row(menu).children[0];
   expect(action.children.map(row=>row.label)).toEqual(['Apply here','Open expression']);
   h.close();action.children[choice].onSelect();await settle();
   h.preparations[0].resolve({ok:true,node:{kind:'literal',value:42}});await settle();
   expect(h.selected[0].options).toEqual(expected);
  }finally{h.stop()}}
});
