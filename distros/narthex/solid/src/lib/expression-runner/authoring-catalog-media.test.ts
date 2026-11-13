// GP-13 — the media demos (picture / sound / track / games) must evaluate
// through the session the browser evaluates with, not to a silent `null`.
//
// Both describes drive the PRODUCT sessions from `authoring-session.ts`, not a
// hand-built registry: the Values page evaluates through
// `accountAuthoringSession` (routes/values.tsx), which uses
//   - the detached seed-profile session when the account has NO installed
//     source module (`DETACHED_AUTHORING_SESSION` is the same cached session), and
//   - the source-module session (`sourceModuleSessionFor` /
//     `sourceModuleAuthoringSession`) when it has one or more.
// Only `sourceModulesForAccount` (the `/modules/installed` loader) is stubbed.
// Expressions are marshalled as `toLogic` in `index.tsx` does.
//
// GP-13 regression: the fallback source-module path previously returned null.
// Cause, verified 2026-09-24: `sourceModuleRegistryInputs` in
// `implementations/typescript/engine/src/authoring/source-module.ts` builds the
// source-module registry over `modulesFor("execute")`. picture, sound,
// animation, movie, track, events, games, crossmodal, path, view (and the
// SetExpr entity module) are SEED_ONLY in `module-manifest.ts`, so their Fenel
// bodies and natives were absent from that registry. Most media functions are
// Fenel-bodied (`picture.solid`, `sound.sine`), so no distro-side native merge
// can fix it; `evaluateContextForCatalog` is not the cause (the ctx-natives
// merge there was the first hypothesis, and it is refuted by the first describe).
// Measured on staging (read-only, 2026-09-24): one installed source module
// (`readiness-check`), so one staging account sees the null today.
//
// The manifest now appends these pure definitions to execute in their existing
// seed order. The source registry, runtime and install-name reservation share
// that same profile. These tests retain the direct/fallback session path as
// well as the detached path; the committed account-registry path is separately
// covered by the account startup tests.
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { prepareSourceModule, type SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import { evaluateWithTrace } from "@fenel/engine/expressions";
import type { AuthoringSession } from "./account-authoring-session";
import { exprNodeToLogic } from "./expr-node-codec";
import type { ExprNode } from "./index";

const PROBE_ACCOUNT = "gp13-probe-account";
const PROBE_SOURCE = "module Gp13Probe where\nimport std (add)\n\nprobeOffset : Number -> Number\nprobeOffset value = add value 1\n";
/** One trivial installed module, carrying the field identity the installer
 *  mints and `/modules/installed` serves. The array identity must be stable:
 *  the session caches key on it. */
const PROBE_DOCUMENTS: readonly SourceModuleDocument[] = Object.freeze([{
  id: "gp13-probe-registry",
  slug: `${PROBE_ACCOUNT}/gp13probe`,
  version: "1.0.0",
  namespace: "gp13probe",
  source: PROBE_SOURCE,
  identity: prepareSourceModule(PROBE_SOURCE, "gp13probe", undefined, () => crypto.randomUUID()).identity,
}]);

mock.module("../user-registries", () => ({
  sourceModulesForAccount: (accountId: string) => accountId === PROBE_ACCOUNT ? PROBE_DOCUMENTS : [],
}));

const lit = (value: unknown): ExprNode => ({ kind: "literal", value });
const call = (fnId: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId, args });
const RED = { r: 239, g: 68, b: 68, a: 255 };

type Image = { width: number; height: number; pixels: unknown[] } | null;
type Sound = { sampleRate: number; samples: unknown[] } | null;

/** The marshalling `toLogic` in `index.tsx` performs for a session. */
function logicOf(session: AuthoringSession, node: ExprNode): unknown {
  const environment = session.environment;
  return exprNodeToLogic(node, {
    fnCodeName: (id) => environment.functionCodeName(id) ?? id,
    constructorName: (id) => environment.constructorCodeName(id),
    operatorCodeName: (_notation, node) => environment.operatorCodeName(node.aliasId, node.arity),
  });
}

/** A list literal holding already-marshalled items, as `seed-values.ts` builds it. */
const list = (session: AuthoringSession, ...items: ExprNode[]): ExprNode => lit(items.map((item) => logicOf(session, item)));

function run(session: AuthoringSession, node: ExprNode): unknown {
  return evaluateWithTrace(logicOf(session, node), {}, session.evaluateContext).result;
}

const pictureRender = call("picture:render", call("picture:solid", lit(RED)), lit(2), lit(2));
const soundRender = call("sound:renderSound", call("sound:sine", lit(440)), lit(0.02), lit(100));

let detached: AuthoringSession;
let installed: AuthoringSession;

beforeAll(async () => {
  const sessions = await import("./authoring-session");
  detached = sessions.DETACHED_AUTHORING_SESSION;
  // Touch a semantic field so the cached seed registry is built here, inside the
  // hook's timeout, rather than inside the first test.
  void detached.registry;
  installed = sessions.accountAuthoringSession({ accountId: PROBE_ACCOUNT, functions: [] });
  void installed.registry;
}, 900_000);

test("generic sampling and rendering retain exact picture method targets in both product sessions", () => {
  for (const session of [detached, installed]) {
    const context = session.evaluateContext;
    const picture = run(session, call("picture:solid", lit(RED)));
    const point = run(session, call("picture:point", lit(0), lit(0)));
    expect(picture).toMatchObject({ $tag: "Field" });
    // These are the actual instance-derived targets consumed by the generic
    // natives, so a Codeable change cannot turn their refs into self-recursion.
    expect(context._sampleByTag?.Field).toBe("picture:sample");
    expect(context._renderByTag?.Field).toBe("picture:render");
    for (const head of ["dispatch:sample", "sample"]) {
      expect(evaluateWithTrace({ call: [head, picture, point] }, {}, context).result).toEqual(RED);
    }
    for (const head of ["dispatch:render", "render"]) {
      const image = evaluateWithTrace({ call: [head, picture, 2, 2] }, {}, context).result as Image;
      expect(image).toEqual({ width: 2, height: 2, pixels: [RED, RED, RED, RED] });
    }
  }
}, 60_000);

describe("GP-13: media modules evaluate in the detached (seed-profile) session", () => {
  test("picture: render a solid colour", () => {
    const image = run(detached, pictureRender) as Image;
    expect(image).not.toBeNull();
    expect(image!.width).toBe(2);
    expect(image!.height).toBe(2);
    expect(image!.pixels[0]).toEqual(RED);
  });

  test("sound: render a sine", () => {
    const sound = run(detached, soundRender) as Sound;
    expect(sound).not.toBeNull();
    expect(sound!.sampleRate).toBe(100);
    expect(sound!.samples.length).toBe(2);
  });

  test("track: mix a one-entry track down and render it", () => {
    const sound = run(detached, call("sound:renderSound",
      call("track:mixDown", call("track:track", list(detached, call("track:trackEntry", lit(0), call("sound:sine", lit(440)))))),
      lit(0.02), lit(100))) as Sound;
    expect(sound).not.toBeNull();
    expect(sound!.sampleRate).toBe(100);
    expect(sound!.samples.length).toBe(2);
  });

  test("games: the state of a click counter after three clicks", () => {
    const game = call("games:mkGame",
      lit(0),
      lit({ __fenelFn: true, params: ["s", "i"], body: { call: ["add", { var: "s" }, 1] }, closure: {} }),
      lit({ __fenelFn: true, params: ["s"], body: { call: ["circle", { call: ["point", 8, 8] }, { var: "s" }, RED] }, closure: {} }),
      call("events:event", list(detached,
        call("events:eventEntry", lit(0.5), lit("click")),
        call("events:eventEntry", lit(1.0), lit("click")),
        call("events:eventEntry", lit(1.5), lit("click")),
      )));
    expect(run(detached, game)).not.toBeNull();
    expect(run(detached, call("games:gameStateAt", game, lit({ $tag: "Time", seconds: 2 })))).toBe(3);
  });
});

describe("GP-13: media modules in the account session with an installed source module", () => {
  test("control: the session is the source-module session, and it evaluates", () => {
    expect(installed.registry.modules.some((module) => module.name === "Gp13Probe")).toBe(true);
    const image = run(installed, call("std:imageSample", lit(0))) as Image;
    expect(image).not.toBeNull();
    expect(image!.width).toBeGreaterThan(0);
  });

  test("the installed-source session includes the same pure-media modules", () => {
    for (const name of ["picture", "sound", "animation", "movie", "track", "events", "games", "crossmodal", "path", "view"]) {
      expect(installed.registry.modules.some((module) => module.name === name)).toBe(true);
    }
  });

  test("picture: render a solid colour", () => {
    const image = run(installed, pictureRender) as Image;
    expect(image).not.toBeNull();
    expect(image!.pixels[0]).toEqual(RED);
  });

  test("sound: render a sine", () => {
    const sound = run(installed, soundRender) as Sound;
    expect(sound).not.toBeNull();
    expect(sound!.samples.length).toBe(2);
  });
});
