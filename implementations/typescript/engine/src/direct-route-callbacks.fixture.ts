import assert from "node:assert/strict";
import { evaluate, installServedDispatcher, type EvaluateContext, type ServedBareNameResolver } from "./json-logic";

const direct = () => ({ $tag: "Direct" } as const);
const resolved = (value: unknown) => ({ $tag: "Resolved", _0: { __fenelFn: true, params: [], body: value, closure: {} } } as const);
const install = (resolveBareName: ServedBareNameResolver) => installServedDispatcher({ resolveBareName, resolveDispatch: direct });
const frozenTable = () => Object.freeze({ routeIdx: Object.freeze(Object.create(null)) });
let table = frozenTable();
let version = 1;
let tableReads = 0;
const ctx: EvaluateContext = {
  _routingTable: () => { tableReads++; return table; },
  _routingTableVersion: () => version,
  natives: { target: () => "ordinary", first: () => "first", second: () => "second" },
};
let calls = 0;
let behavior = false;
const stateful: ServedBareNameResolver = (_table, _name, args) => { calls++; return behavior || args[0] === 2 ? resolved("custom") : direct(); };
install(stateful);
assert.equal(evaluate({ call: ["target", 1] }, {}, ctx), "ordinary");
assert.equal(evaluate({ call: ["target", 2] }, {}, ctx), "custom");
behavior = true;
assert.equal(evaluate({ call: ["target", 1] }, {}, ctx), "custom");
assert.equal(calls, 3);
install(() => resolved("intervening"));
assert.equal(evaluate({ call: ["target", 1] }, {}, ctx), "intervening");
behavior = false; install(stateful);
assert.equal(evaluate({ call: ["target", 1] }, {}, ctx), "ordinary");
assert.equal(calls, 4);
install(stateful);
behavior = true;
assert.equal(evaluate({ call: ["target", 1] }, {}, ctx), "custom");
assert.equal(calls, 5);

const observed: unknown[] = [];
install((current, name, args, frames, tags) => { observed.push({ current, name, args, frames, tags }); return direct(); });
ctx._importStack = [{ names: { local: "first" }, aliases: {} }];
assert.equal(evaluate({ call: ["local"] }, {}, ctx), "first");
ctx._importStack = [{ names: { local: "second" }, aliases: {} }];
assert.equal(evaluate({ call: ["local"] }, {}, ctx), "second");
ctx._dictStack = [{ typeName: "Live", args: ["current"], methods: {} }];
ctx._activeTags = ["current-tag"];
assert.equal(evaluate({ call: ["target", 3] }, {}, ctx), "ordinary");
assert.deepEqual(observed.at(-1), { current: table, name: "target", args: [3], frames: [{ typeName: "Live", key: "current", args: { $tag: "Just", _0: ["current"] }, methods: {} }], tags: ["current-tag"] });
assert.equal(tableReads, 1);
table = frozenTable(); version++;
evaluate({ call: ["target"] }, {}, ctx);
assert.equal(tableReads, 2);
assert.equal((observed.at(-1) as { current: unknown }).current, table);
const hostileContext = { ...ctx };
Object.defineProperty(hostileContext, "_dictStack", { get: () => { throw new Error("live frame read"); } });
assert.throws(() => evaluate({ call: ["target"] }, {}, hostileContext), /live frame read/);
ctx.natives = { target: () => { throw new Error("current native refusal"); } };
assert.throws(() => evaluate({ call: ["target"] }, {}, ctx), /current native refusal/);
console.log("custom callbacks, live context, and route versions passed");
