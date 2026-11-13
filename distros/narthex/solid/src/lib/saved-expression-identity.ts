import { collectReferencedSavedExpressions, type ExprNode } from "@fenel/engine/authoring/expression";
import { dispatchEngineBody } from "@fenel/engine/engine-bodies-dispatch";
import { evaluate } from "@fenel/engine/expressions";
import { refHandle } from "@fenel/engine/authoring/environment";
import { Just, Nothing, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import { isInertAuthoringSession, type AuthoringSession } from "./expression-runner/account-authoring-session";
import { authoringExpressionLogic } from "./expression-runner/expression-evaluation";
import { savedExpressionDeclaration } from "./saved-expression-map";

function stable(value: unknown): string {
  const seen = new WeakSet<object>();
  const encode = (current: unknown): unknown => {
    if (current === null || typeof current !== "object") return current;
    if (seen.has(current as object)) return null;
    seen.add(current as object);
    if (Array.isArray(current)) return current.map(encode);
    const source = current as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = encode(source[key]);
    return out;
  };
  try { return JSON.stringify(encode(value)) ?? "null"; }
  catch { return "unstringifiable"; }
}

/** The resolved expression, so two lenses and two copies of the same picture
 * share one result. A reference is substituted by its target. */
export function expressionKey(node: ExprNode, saved: ReadonlyMap<string, ExprNode>): string {
  const stack: string[] = [];
  const visit = (current: ExprNode): string => {
    const declaration = savedExpressionDeclaration(current);
    const suffix = declaration ? `:declaration:${stable(declaration)}` : "";
    if (current.kind === "literal") {
      // Reuse the codec's executable slots; raw literal data stays opaque.
      const refs = collectReferencedSavedExpressions(current);
      const dependencies = refs.map(savedExprId => visit({ kind: "ref", savedExprId }));
      return `L:${stable(current.value)}${dependencies.length ? `:refs:${stable(dependencies)}` : ""}${suffix}`;
    }
    if (current.kind === "param") return `P:${current.name}${suffix}`;
    if (current.kind === "ref") {
      if (stack.includes(current.savedExprId)) return `cycle:${current.savedExprId}`;
      const target = saved.get(current.savedExprId);
      if (!target) return `missing:${current.savedExprId}`;
      stack.push(current.savedExprId);
      const body = `${visit(target)}${suffix}`;
      stack.pop();
      return body;
    }
    const syntax = current.callSyntax ? `${current.callSyntax}:` : "";
    return `C:${syntax}${current.fnId}(${current.args.map(visit).join(",")})${suffix}`;
  };
  return visit(node);
}

type MediaCall = Extract<ExprNode, { kind: "call" }>;
type MediaFacts = { picture: boolean; sampled: boolean; weight: number; slice: Maybe<"picture" | "sound"> };

/** B3: source selects existing call slots; the canonical codec chooses their
 * emitted heads, and this exact reader resolves them. No literal payload is
 * copied or interpreted. Fenel owns every media/priority/admission decision.
 * GLOBAL_ONLY for closed policy forwards: they resolve no reader definition;
 * only the reference lookup below uses the current reader's exact frame. */
export function expressionMediaScheduling(node: ExprNode, saved: ReadonlyMap<string, ExprNode>, session: AuthoringSession,
  options: { capture?: boolean } = {}): Omit<MediaFacts, "slice"> & { slice?: "picture" | "sound"; root?: MediaCall } {
  // B4 wave 4 lane S: a frameless (Local) page session makes no media
  // decision. Its worker computes these facts for each evaluation request
  // (`capture: "unless-sampled"`, its own scheduling weight and slices).
  if (isInertAuthoringSession(session)) return { picture: false, sampled: false, weight: 0 };
  const context = session.evaluateContext;
  const inputs = dispatchEngineBody("engine:authoringMediaSchedulingCalls", [node,
    [...saved].map(([id, expression]) => ({ id, expression })),
  ]) as { root: Maybe<MediaCall>; calls: MediaCall[] };
  const root = peelMaybeValue(inputs.root);
  const calls = root ? [root, ...inputs.calls] : inputs.calls;
  const logic = calls.map(call => authoringExpressionLogic({ ...call, args: [] }, undefined, session));
  const lookups = dispatchEngineBody("engine:authoringMediaSchedulingLookups", [logic]) as Maybe<{ head: string; expression: unknown }>[];
  const rows = lookups.map(lookup => {
    const provenance = { hasClassifier: context._resolveBareName !== undefined, hasRoutingTable: context._routingTable !== undefined };
    try {
      const projected = peelMaybeValue(lookup);
      // Value-position lookup uses the evaluator's existing import/member
      // projection and returns a reference without calling the function body.
      const handle = projected === null ? undefined : refHandle(evaluate(projected.expression, {}, context));
      const selected = handle === undefined ? undefined : context.getFunction?.(handle);
      // A same-id edited draft is not the repository render implementation.
      // Registry egress preserves this immutable declaration identity.
      const target = selected !== undefined && selected === session.registry.getFunction?.(selected.id) ? Just(selected.id) : Nothing;
      const routes = projected === null || handle === undefined || context._resolveBareName === undefined ? []
        : [context._resolveBareName(projected.head), context._resolveBareName(handle)];
      return { target, routes, ...provenance };
    } catch {
      // Optional scheduling metadata cannot reject a lazy branch the ordinary
      // evaluator never reaches. A failed lookup admits no sampled slice.
      return { target: Nothing, routes: [], ...provenance };
    }
  });
  const targets = dispatchEngineBody("engine:authoringMediaSchedulingTargets", [rows]) as Maybe<string>[];
  const facts = dispatchEngineBody("engine:authoringMediaSchedulingFacts", [inputs.root, root ? logic[0] : {},
    root ? targets[0] : Nothing, root ? targets.slice(1) : targets, !!options.capture,
  ]) as MediaFacts;
  return { ...facts, slice: peelMaybeValue(facts.slice) ?? undefined, ...(root ? { root } : {}) };
}

/** A picture render samples a field once per pixel. Image pipelines do not. */
export function expressionRendersPicture(node: ExprNode, saved: ReadonlyMap<string, ExprNode>, session: AuthoringSession): boolean {
  return expressionMediaScheduling(node, saved, session).picture;
}

/** Picture, sound, and movie renders sample a field across a whole grid.
 *  Image pipelines do not. */
export function expressionRendersSampledMedia(node: ExprNode, saved: ReadonlyMap<string, ExprNode>, session: AuthoringSession): boolean {
  return expressionMediaScheduling(node, saved, session).sampled;
}

/** Prefer a job that is not a full picture render, so a photo is not stuck
 * behind a plot that has not started yet. */
export function preferReadyJob<T>(waiting: T[], deferred: (job: T) => boolean): T | undefined {
  if (waiting.length === 0) return undefined;
  const ready = waiting.findIndex(job => !deferred(job));
  return waiting.splice(ready >= 0 ? ready : 0, 1)[0];
}
