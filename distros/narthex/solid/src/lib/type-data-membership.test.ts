// C1 UI-boundary harness: execute the production catalogue composition without
// mounting Solid. The real Fenel projection, substitution and judgment decide.
import { describe, expect, test } from "bun:test";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { decidableMembershipModule } from "@fenel/engine/modules/decidable-membership";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { contains } from "@fenel/engine/set-algebra";
import { typeToSetExpr } from "@fenel/engine/fenel-check";
import { prepareEngineBodyDispatch } from "@fenel/engine/engine-bodies-dispatch";
import { Bool, Nothing, Rational, Str } from "@fenel/engine/type-foundation";
import { namedFieldOccurrence } from "./field-occurrence/model";
import type { FenelType } from "@fenel/engine/types";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import SOURCE from "../../../../../fenel/modules/publicdemo/check-demo.fenel?raw";

await prepareEngineBodyDispatch();
const source = await Bun.file(new URL("./type-data-playground.tsx", import.meta.url)).text();
const from = source.indexOf("export function checkTypePlaygroundMembership(");
const until = source.indexOf("const repositoryReuseByRegistry =", from);
const transpiler = new Bun.Transpiler({ loader: "ts" });
const check = new Function("contains", "typeToSetExpr",
  `${transpiler.transformSync(source.slice(from, until).replace("export function", "function"))}; return checkTypePlaygroundMembership;`)(contains, typeToSetExpr) as (type:FenelType,value:unknown,session:AuthoringSession)=>ReturnType<typeof contains>;
const module = loadFenelModule(SOURCE, "CheckDemo");
const registry = createRegistry([stdModule, decidableMembershipModule, module]);
const definitions = new Map((module.entities ?? []).map(entity => [entity.id, entity.type]));
const primitiveTypes = { String: Str, Number: Rational, Boolean: Bool };
const entries = [...definitions].map(([name,type]) => ({id:name,name,type,description:"",category:"test"}));
const environment = createAuthoringEnvironment({types: [...entries,...Object.entries(primitiveTypes).map(([name,type])=>({id:name,name,type,description:"",category:"test"}))],capabilities:[],catalogTypes:[],functions:[],operatorCodeNameByNotation:new Map()});
const session = {mode:"detached",registry,environment,catalog:environment.catalog,evaluateContext:registry.evaluateContext()} as AuthoringSession;
const contact: FenelType = {$record:{fields:[
  namedFieldOccurrence("00000000-0000-4000-8000-000000000051","email",{$ref:"CheckEmailInput"}),
  namedFieldOccurrence("00000000-0000-4000-8000-000000000052","quantity",{$ref:"CheckQuantityInput"}),
]}};
const valid = {email:"rom@example.org",quantity:2};

describe("captured Contact membership", () => {
  test("missing captured refinements previously left the same valid Contact undecided", () => {
    expect(contains(typeToSetExpr(contact),valid,null,{},session.evaluateContext)).toEqual(Nothing);
    expect(check(contact,valid,session)).toEqual({$tag:"Just",_0:true});
  });
  test.each([{email:"broken",quantity:2},{email:"rom@example.org",quantity:0},{email:"rom@example.org",quantity:6},{email:"rom@example.org",quantity:"2"}])("refuses malformed email, out-of-range quantity or wrong representation: %j", value => {
    expect(check(contact,value,session)).toEqual({$tag:"Just",_0:false});
  });
  test.each([1,5])("admits inclusive quantity endpoint %s", quantity => {
    expect(check(contact,{...valid,quantity},session)).toEqual({$tag:"Just",_0:true});
  });
  test("uses the captured definition even when a registry with the same name disagrees", () => {
    const isolated = {...session,registry:{getIdentifiedEntity(){throw new Error("No registry fallback");}}} as unknown as AuthoringSession;
    expect(check(contact,valid,isolated)).toEqual({$tag:"Just",_0:true});
  });
  test("resolves a stable type identity through the captured catalogue rather than its display name", () => {
    const id="00000000-0000-4000-8000-000000000053";
    const captured=createAuthoringEnvironment({types:[{id:"Email",name:"Different display name",entityId:id,type:definitions.get("CheckEmailInput")!,description:"",category:"test"}],capabilities:[],catalogTypes:[],functions:[],operatorCodeNameByNotation:new Map()});
    const identified={...session,environment:captured,catalog:captured.catalog};
    expect(check({$ref:id},"rom@example.org",identified)).toEqual({$tag:"Just",_0:true});
    expect(check({$ref:id},"broken",identified)).toEqual({$tag:"Just",_0:false});
  });
  test("preserves unknown and cyclic aliases as Nothing, and does not resolve newly introduced aliases recursively", () => {
    for (const type of [{$ref:"Missing"},{$ref:"Cycle"},{$ref:"Outer"}] as FenelType[]) {
      const seen: string[] = [];
      const aliases = new Map<string,FenelType>([["Cycle",{$ref:"Cycle"}],["Outer",{$ref:"Inner"}],["Inner",definitions.get("CheckEmailInput")!]]);
      const custom = {...session,environment:{...environment,resolveTypeRef(ref:{$ref:string}){seen.push(ref.$ref);return aliases.get(ref.$ref);},resolveNamedType:()=>undefined}} as AuthoringSession;
      expect(check(type,"rom@example.org",custom)).toEqual(Nothing);
      if (!("$ref" in type)) throw new Error("This fixture must stay a reference");
      expect(seen).toEqual([type.$ref]);
    }
  });
  test("leaves canonical opaque atoms at their existing nominal set boundary", () => {
    expect(check({$ref:"String"},"text",session)).toEqual({$tag:"Just",_0:true});
    expect(check({$ref:"String"},42,session)).toEqual({$tag:"Just",_0:false});
    expect(check({$ref:"Number"},2,session)).toEqual({$tag:"Just",_0:true});
    expect(check({$ref:"Number"},"2",session)).toEqual({$tag:"Just",_0:false});
  });
  test("preserves degraded projections as Nothing", () => {
    const anonymous: FenelType={$record:{fields:[{name:"unkeyed",type:{$ref:"String"},label:Nothing,meta:{},ui:Nothing}]}};
    expect(check(anonymous,{unkeyed:"text"},session)).toEqual(Nothing);
    const degraded={...session,environment:{...environment,resolveTypeRef:()=>anonymous}} as AuthoringSession;
    expect(check({$ref:"LossyAlias"},{unkeyed:"text"},degraded)).toEqual(Nothing);
  });
  test("forwards the same captured evaluation context and explicit anonymous account to the existing judgment", () => {
    const calls: unknown[][]=[];
    const boundary = new Function("contains","typeToSetExpr",`${transpiler.transformSync(source.slice(from,until).replace("export function","function"))};return checkTypePlaygroundMembership;`)((...args:unknown[])=>{calls.push(args);return Nothing;},typeToSetExpr);
    expect(boundary({$ref:"Missing"},null,session)).toEqual(Nothing);
    expect(calls[0]![2]).toBeNull();
    expect(calls[0]![4]).toBe(session.evaluateContext);
  });
});
