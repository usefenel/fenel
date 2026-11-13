// ---------------------------------------------------------------------------
// Games — FFI leaf (the irreducible host bridge: the CTX-threading game-loop
// natives that re-enter the evaluator to fold inputs + render state, plus the
// `mkGame` record constructor).
//
// module-substrate Phase 3g — games is a composer with BOTH maps:
//   - PLAIN native (`mkGame`) — pure record constructor, no ctx → `gamesNatives`
//     → the module's `nativeImpls`;
//   - CTX natives (`gameStateAt` / `_gameViewAt` / `gameToAnim` / `gameToMovie`
//     / `runGame`) — re-enter the evaluator via `invokeCallable` to fold the
//     input Event stream through the Game's `update` closure + render via the
//     `view` closure → take the `EvaluateContext` as their first arg →
//     `gamesNativesCtx` → the module's `nativeImplsCtx`. Which map an impl lands
//     in is the ONLY thing that decides plain-vs-ctx — no `.fenel` marker.
//
// AXIS DECISION (Phase 3g cross-module ffi-leaf import) — this leaf imports a
// SIBLING MEDIA LEAF's native LEAF-TO-LEAF (a `fenel/ffi → fenel/ffi` edge):
// `sampleSoundNative` + the `AmplitudeValue` type from `../../sound/ffi/
// sound-ffi` (a SAME-PHASE base, 3g), used by the `gameAudioAt` helper. Never
// bounces through the engine seam.
//
// F-PERMANENT-REVISIT FLAG: `gameStateAtNative` / `gameViewAtNative` /
// `gameToAnimNative` / `gameToMovieNative` / `runGameNative` are genuine bridge
// leaves — they re-enter the evaluator to run user closures / emit live-marker
// values. But the pure helpers — `asEventEntries`, `mkGameNative` (record
// bundling), `gameAudioAtNative` (a thin passthrough to sampleSound) — are
// PURE record-reshaping / dispatch that compose from std fns + the sound
// primitive. They are parked here to preserve Phase-3g PARITY (byte-for-byte
// with the retired `engine/src/modules/games.ts` natives), same posture as
// picture's / sound's pure helpers; a Fenel re-port is a later-sweep candidate
// the parity brief forbids porting now.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder — this is a media-cluster leaf.
// ---------------------------------------------------------------------------

import { invokeCallable, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { sampleSoundNative, type AmplitudeValue } from "../../sound/ffi/sound-ffi";

// ---------------------------------------------------------------------------
// Native helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

const TRANSPARENT_AMP: AmplitudeValue = { l: 0, r: 0 };

type EventEntryRec = { timestamp: number; payload: unknown };

function asEventEntries(v: unknown): EventEntryRec[] {
  const entries = (v as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => ({
    timestamp: Number((e as { timestamp?: unknown })?.timestamp) || 0,
    payload: (e as { payload?: unknown })?.payload,
  }));
}

// ---------------------------------------------------------------------------
// PLAIN native — `mkGame`, a pure record constructor, no ctx.
// ---------------------------------------------------------------------------

/** Build a Game record from initial state, update fn, view fn, and inputs. */
function mkGameNative(
  initial: unknown,
  update: unknown,
  view: unknown,
  inputs: unknown,
): {
  initial: unknown;
  update: unknown;
  view: unknown;
  inputs: unknown;
} {
  return { initial, update, view, inputs };
}

// ---------------------------------------------------------------------------
// CTX natives — re-enter the evaluator to fold inputs + render state.
// ---------------------------------------------------------------------------

/** Compute the Game's state at time t: fold all inputs whose timestamp <= t
 *  into the state via `update`, starting from `initial`. */
function gameStateAtNative(
  ctx: EvaluateContext,
  game: unknown,
  time: unknown,
): unknown {
  const g = game as { initial?: unknown; update?: unknown; inputs?: unknown };
  if (!g) return null;
  const entries = asEventEntries(g.inputs).slice().sort((a, b) => a.timestamp - b.timestamp);
  const t = Number((time as { seconds?: unknown })?.seconds) || 0;
  let state = g.initial;
  for (const e of entries) {
    if (e.timestamp > t) break;
    state = invokeCallable(g.update, [state, e.payload], ctx);
  }
  return state;
}

/** The closure body invoked by gameToAnim's resulting Animate: at time t,
 *  compute the state via `gameStateAt`, then render via the Game's view fn. */
function gameViewAtNative(
  ctx: EvaluateContext,
  game: unknown,
  time: unknown,
): unknown {
  const state = gameStateAtNative(ctx, game, time);
  const view = (game as { view?: unknown })?.view;
  return invokeCallable(view, [state], ctx);
}

/** Convert a Game into an Animation — at each instant, derive the current
 *  state from the input stream and render it via the Game's view function. */
function gameToAnimNative(_ctx: EvaluateContext, game: unknown): unknown {
  return {
    $tag: "Animate",
    _0: {
      __fenelFn: true,
      params: ["t"],
      body: { call: ["_gameViewAt", { var: "_game" }, { var: "t" }] },
      closure: { _game: game },
    },
  };
}

/** Convert a Game into a Movie by pairing its visual derivation with a
 *  Sound. The Sound is sampled in parallel as the visual evolves. */
function gameToMovieNative(_ctx: EvaluateContext, game: unknown, audio: unknown): unknown {
  return {
    $tag: "MovieAt",
    _0: {
      __fenelFn: true,
      params: ["t"],
      body: {
        call: [
          "scene",
          { call: ["_gameViewAt", { var: "_game" }, { var: "t" }] },
          { call: ["sampleSound", { var: "_audio" }, { var: "t" }] },
        ],
      },
      closure: { _game: game, _audio: audio },
    },
  };
}

/** Sample the audio at a Time — internal helper exposed in case a Game's
 *  audio is itself a Wave with a closure that needs invocation. Currently
 *  the engine's `sampleSound` already handles both Buffer and Wave; this
 *  is here for symmetry / future extension. */
function gameAudioAtNative(
  ctx: EvaluateContext,
  audio: unknown,
  time: unknown,
): AmplitudeValue {
  if (!audio) return TRANSPARENT_AMP;
  return sampleSoundNative(ctx, audio, time);
}

/** `runGame` — IO bridge for live interactivity. Returns a "live" Movie
 *  marker that the frontend recognises and routes to its LiveGame Solid
 *  component. The marker carries the source Game so the frontend can
 *  derive state from real DOM events at run time. */
function runGameNative(_ctx: EvaluateContext, game: unknown): unknown {
  return { $tag: "LiveGame", _0: game };
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl. The seam rekeys each to the `games:`
// id-namespace via `rekeyNativesById` and attaches them to the FenelModule's
// `nativeImpls` (plain) + `nativeImplsCtx` (ctx).
// ---------------------------------------------------------------------------

export const gamesNatives: Record<string, (...args: unknown[]) => unknown> = {
  mkGame: (initial: unknown, update: unknown, view: unknown, inputs: unknown) =>
    mkGameNative(initial, update, view, inputs),
};

export const gamesNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  gameStateAt: (ctx: EvaluateContext, game: unknown, time: unknown) => gameStateAtNative(ctx, game, time),
  _gameViewAt: (ctx: EvaluateContext, game: unknown, time: unknown) => gameViewAtNative(ctx, game, time),
  gameToAnim: (ctx: EvaluateContext, game: unknown) => gameToAnimNative(ctx, game),
  gameToMovie: (ctx: EvaluateContext, game: unknown, audio: unknown) => gameToMovieNative(ctx, game, audio),
  runGame: (ctx: EvaluateContext, game: unknown) => runGameNative(ctx, game),
};

export {
  mkGameNative,
  gameStateAtNative,
  gameViewAtNative,
  gameToAnimNative,
  gameToMovieNative,
  gameAudioAtNative,
  runGameNative,
};
