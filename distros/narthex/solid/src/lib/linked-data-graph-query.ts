// Transport for the linked-data graph (linked-data-graph.ts): ONE evaluation of
// Fenel's own dependency walk, asked for the parts of every member of a
// collection at once, and ONE evaluation of the members' values (a list of
// their references) for their cards. The query is the walk the Dependencies panel runs
// (`view.dependencyLinkedRounds`), started from the members, going towards
// their parts only and one link far; the packet is the reader's own captured
// source metadata (`view.readerSourceMetadata`), never a copy made here.
// Fenel finds the links, names them by the holder's field, and joins them;
// this file only builds the call and reads its answer.

import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { evaluateAuthoringExpressionInSession } from "./expression-runner/expression-evaluation";
import { evaluateExpressionInWorker, preparedSnapshotOwnerOf, registryHasSnapshotOwner } from "./expression-runner/authoring-catalog-worker";
import { concreteAuthoringSession } from "./expression-runner/account-authoring-session";
import { assertReaderSourceMetadata, type ReaderSourceMetadataCapture } from "./reader-source-metadata";

export type LinkedWalk = {
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string; labels: string[] }>;
};

/** An empty packet: the walk refuses every member against it ("missing"),
 * which is what a reader without source metadata must answer. */
const NO_PACKET = { $tag: "ReaderSourceMetadata", source: { $tag: "ThisTabSource" }, rootId: "-", generation: "-",
  expressions: [], occurrences: [], callableLabels: [] };

/** The one call: `dependencyLinkedRounds (fromMaybe none readerSourceMetadata) 1 steps walk`. */
export function linkedPartsExpression(resolve: (name: string) => string | undefined, members: readonly string[]): ExprNode {
  const rounds = resolve("view.dependencyLinkedRounds"), fromMaybe = resolve("std.fromMaybe"), packet = resolve("view.readerSourceMetadata");
  if (!rounds || !fromMaybe || !packet) throw new Error("This reader's dependency query is not ready yet.");
  const step = (identity: string): ExprNode => ({ kind: "literal",
    value: { $tag: "DependencyWalkStep", identity, towardParts: true, towardUsers: false } });
  return { kind: "call", fnId: rounds, args: [
    { kind: "call", fnId: fromMaybe, args: [{ kind: "literal", value: NO_PACKET }, { kind: "call", fnId: packet, args: [] }] },
    { kind: "literal", value: 1 },
    { kind: "literal", value: { __list: members.map(step) } },
    { kind: "literal", value: { $tag: "DependencyLinkedWalk", nodes: [], edges: [], seen: [], next: [] } },
  ] };
}

/** Reads the walk's answer: `Ok` with its nodes and edges, else the refusal as an error. */
export function readLinkedWalk(result: unknown): LinkedWalk {
  const answer = result as { $tag?: unknown; _0?: unknown } | undefined;
  if (answer?.$tag === "Err") throw new Error(typeof answer._0 === "string" ? answer._0 : "This data's links could not be read.");
  const walk = answer?.$tag === "Ok" ? answer._0 as { nodes?: unknown; edges?: unknown } : undefined;
  if (!walk || !Array.isArray(walk.nodes) || !Array.isArray(walk.edges)) throw new Error("This data's links could not be read.");
  const text = (value: unknown) => typeof value === "string" ? value : "";
  return {
    nodes: walk.nodes.map(node => ({ id: text((node as { id?: unknown }).id), label: text((node as { label?: unknown }).label) }))
      .filter(node => node.id !== ""),
    edges: walk.edges.map(edge => {
      const row = edge as { from?: unknown; to?: unknown; labels?: unknown };
      return { from: text(row.from), to: text(row.to), labels: Array.isArray(row.labels) ? row.labels.filter((label): label is string => typeof label === "string") : [] };
    }).filter(edge => edge.from !== "" && edge.to !== ""),
  };
}

/** The members' parts, from the reader that shows them: evaluated on the page
 * for a public or account reader, in its worker for a Local one. The answer
 * counts only while the metadata it was asked under still holds. */
export function readLinkedParts(reader: AuthoringSession, capture: ReaderSourceMetadataCapture,
  members: readonly string[]): Promise<LinkedWalk> {
  try {
    assertReaderSourceMetadata(capture, reader);
    const session = concreteAuthoringSession(reader);
    const expression = linkedPartsExpression(name => session.environment.resolveFunctionId(name), members);
    if (preparedSnapshotOwnerOf(reader) || registryHasSnapshotOwner(session.registry)) {
      const job = evaluateExpressionInWorker(reader, expression, new Map(), undefined, undefined, { sourceMetadata: capture, priority: "guidance" });
      if (!job) return Promise.reject(new Error("This reader's editing tools are not ready. Try again after preparation."));
      return job.then(evaluated => { assertReaderSourceMetadata(capture, reader); return readLinkedWalk(evaluated.result); });
    }
    const evaluated = evaluateAuthoringExpressionInSession(expression, undefined, reader, {}, { trace: false, sourceMetadata: capture });
    assertReaderSourceMetadata(capture, reader);
    return Promise.resolve(readLinkedWalk(evaluated.result));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** The members' values, in their order, from one evaluation of the list of
 * their references: on the page for a public or account reader (its registry
 * is there), in its worker for a Local one. The cards draw these values; the
 * parts' cards take theirs where a member holds them, with no other read. */
export function readLinkedValues(reader: AuthoringSession, members: readonly string[],
  saved: ReadonlyMap<string, ExprNode>): Promise<unknown[]> {
  try {
    const session = concreteAuthoringSession(reader);
    const node: ExprNode = { kind: "literal", value: { __list: members.map((id): ExprNode => ({ kind: "ref", savedExprId: id })) } };
    const read = (result: unknown) => {
      if (!Array.isArray(result) || result.length !== members.length) throw new Error("These data's values could not be read.");
      return result;
    };
    if (preparedSnapshotOwnerOf(reader) || registryHasSnapshotOwner(session.registry)) {
      const job = evaluateExpressionInWorker(reader, node, saved, undefined, undefined, { priority: "guidance" });
      if (!job) return Promise.reject(new Error("This reader's editing tools are not ready. Try again after preparation."));
      return job.then(evaluated => read(evaluated.result));
    }
    return Promise.resolve(read(evaluateAuthoringExpressionInSession(node, id => saved.get(id), reader, {}, { trace: false }).result));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}
