import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFile,writeFile} from "node:fs/promises";
import {writeSync} from "node:fs";
import {join} from "node:path";
const {chromium}=createRequire(import.meta.url)(process.env.FENEL_TEST_PLAYWRIGHT_MODULE??"playwright");
if(process.env.FENEL_TEST_READY_FD==="3")writeSync(3,"__FENEL_FIXTURE_DRIVER_READY__\n");
const [before,after,cssPath,output]=process.argv.slice(2),css=await readFile(cssPath,"utf8"),receipts=[];
const browser=await chromium.launch({headless:true,timeout:30000,channel:process.env.FENEL_TEST_BROWSER_CHANNEL});
try{
 for(const [phase,bundle] of [["before",before],["after",after]]){
  for(const [device,viewport] of [["desktop",{width:1280,height:800}],["phone",{width:390,height:844}]]){
   const context=await browser.newContext({viewport,reducedMotion:"reduce",...(device==="phone"?{isMobile:true,hasTouch:true}:{})});
   const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));page.setDefaultTimeout(10000);
   try{
    await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="fixture"></div></body></html>'}));
    const script=await readFile(bundle,"utf8");
    const mount=async()=>{
      await page.goto("https://fenel.test/");await page.addStyleTag({content:css});await page.addScriptTag({content:script,type:"module"});
      await page.waitForFunction(()=>!!globalThis.homeComputed);
      await page.locator("[data-computed-child]").dispatchEvent("contextmenu",{bubbles:true,cancelable:true,clientX:device==="phone"?70:380,clientY:155});
      const suggestions=page.getByRole("menuitem",{name:"Suggestions",exact:true});await suggestions.waitFor();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await suggestions.focus();await suggestions.press("ArrowRight");
      if(phase==="before")await page.getByRole("menuitem",{name:"Open this data's source to check suggestions for its computed result.",exact:true}).waitFor();
      else await page.getByRole("menuitem",{name:"Uppercase",exact:true}).waitFor();
    };
    await mount();
    const state=await page.evaluate(()=>homeComputed.state());
    assert.equal(state.jobs.length,phase==="before"?0:1);assert.equal(state.preparations.length,0);assert.deepEqual(state.composed,[]);
    if(phase==="after"){
      assert.equal(state.jobs[0].expression.fnId,"fixture:loadCities");assert.deepEqual(state.jobs[0].sourcePath,[0,"city"]);
      assert.equal(state.jobs[0].value,"Paris");assert.equal(state.jobs[0].type.$ref,"String");assert.equal(state.jobs[0].expression.value,undefined);
      assert.equal(state.jobs[0].sourceType,undefined,"The observed child's type must not stand in for its producer declaration");
    }
    assert.deepEqual(errors,[]);await page.screenshot({path:join(output,`computed-home-${phase}-${device}.png`),fullPage:true,animations:"disabled"});
    const receipt={phase,device,workerJobs:state.jobs.length,preparations:state.preparations.length,input:state.jobs[0],errors};
    if(phase==="after"){
      for(const change of ["root-revision","source-ticket"]){
        await mount();const originalRevision=await page.evaluate(()=>homeComputed.state().jobs[0].revision);
        await page.evaluate(change=>{homeComputed.retain();if(change==="root-revision")homeComputed.replaceFrame();else homeComputed.replaceTicket();homeComputed.invokeHeld();},change);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const retired=await page.evaluate(()=>homeComputed.state());
        assert.equal(retired.preparations.length,0);assert.deepEqual(retired.composed,[]);assert.equal(retired.jobs.length,1);
        assert.ok(retired.issues.includes("This data changed. Open Suggestions again."));
        if(change==="source-ticket")assert.equal(await page.evaluate(()=>homeComputed.inspectInput().revision),originalRevision,"Ticket identity refusal is independent of the textual revision");
      }
      await mount();await page.getByRole("menuitem",{name:"Uppercase",exact:true}).click();
      await page.waitForFunction(()=>homeComputed.state().composed.length===1);
      const valid=await page.evaluate(()=>homeComputed.state());assert.equal(valid.preparations.length,1);assert.equal(valid.jobs.length,1);
      receipt.staleFrameRefused=true;receipt.sourceTicketRefused=true;receipt.closeBeforeValidSelection=true;
    }
    receipts.push(receipt);console.log(JSON.stringify({phase,device,workerJobs:state.jobs.length,staleFrameRefused:receipt.staleFrameRefused??false}));
   }finally{await context.close();}
  }
 }
 await writeFile(join(output,"browser-receipt.json"),JSON.stringify({evidence:"Actual Home/controller/menu; controlled worker replies; no policy or latency claim",receipts},null,2));
 console.log("PASS actual Home computed-child capture and stale-frame refusal");
}finally{await browser.close();}
