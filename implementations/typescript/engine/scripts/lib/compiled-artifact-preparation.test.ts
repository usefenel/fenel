// Draft C1 controls. Do not run while the canonical owner transaction is active.
import { describe, expect, test } from "bun:test";
import { exactImmutableDataSnapshot } from "../../src/self-host-immutable-data";
import { decodeReplayValue, encodeReplayValue } from "../../src/engine-body-value-transport";
import type { CompileCallBindings } from "../../src/compile-call-bindings";
import type { CompileSource } from "../../src/compilable";
import {
  prepareCompileSource,
  capturePreparedCompileCell,
  preparedCompileSourceAttempts,
  immutablePreparationMetadata,
  encodePreparationObservation,
  type PreparedCompiledArtifact,
  type PreparedCompileCell,
} from "./compiled-artifact-preparation";
import { decodePreparationPacket } from "./compiled-artifact-preparation-protocol";

const noBindingCapability = (_value: unknown): _value is CompileCallBindings => false;
const source = (body: unknown): CompileSource => ({
  name: "fixture:root", params: [], body, ctorDefs: {}, ctorWireNames: {}, callBindings: {},
});
const prepared = (input: CompileSource): PreparedCompiledArtifact => Object.freeze({
  artifact: "compiled-resolver",
  metadata: immutablePreparationMetadata({ identityDomain: {
      schema: "fenel.compiled-identity-input.v1", owner: "compiled-resolver", kind: "all", digest: "0".repeat(64),
    }, hash: "old-manifest", runtimeInputHash: "old-runtime",
    bootstrapRuntimeInputHash: "old-bootstrap", entryCodes: { "fixture:root": "root" },
    closureIds: ["fixture:root"], shards: {} }, exactImmutableDataSnapshot),
  cells: Object.freeze([capturePreparedCompileCell(input.name,
    () => prepareCompileSource(input, ["Ambiguous"], exactImmutableDataSnapshot, noBindingCapability))]),
});

function readyInput(packet: PreparedCompiledArtifact) {
  const cell = packet.cells[0];
  if (cell === undefined || cell.status !== "ready") throw new Error("fixture has no prepared input");
  return cell.input;
}

function readyCell(id: string): PreparedCompileCell {
  return capturePreparedCompileCell(id, () => prepareCompileSource({ ...source(id), name: id }, [],
    exactImmutableDataSnapshot, noBindingCapability));
}

describe("producer preparation observation (no artifact freshness authority)", () => {
  test("preparation isolates the actual compilation body from later caller mutation", () => {
    const body = { call: ["fixture:callee", { value: 1 }] };
    const packet = prepared(source(body));
    body.call[1] = { value: 999 };
    expect(readyInput(packet).immutable).toBe(true);
    expect(readyInput(packet).source.body).toEqual({ call: ["fixture:callee", { value: 1 }] });
    expect(Object.isFrozen(readyInput(packet).source.body)).toBe(true);
  });

  test("observation transports special values and explicit constructor conflicts without JSON loss", () => {
    const text = encodePreparationObservation(prepared(source({ a: -0, b: undefined, c: NaN, d: Infinity })), encodeReplayValue);
    const packet = decodePreparationPacket(new TextEncoder().encode(text));
    const data = decodeReplayValue(packet.data) as { sources: Array<{ source: CompileSource; constructorConflicts: string[] }> };
    const body = data.sources[0]!.source.body as Record<string, unknown>;
    expect(Object.is(body.a, -0)).toBe(true);
    expect(Object.hasOwn(body, "b")).toBe(true);
    expect(body.b).toBeUndefined();
    expect(Number.isNaN(body.c)).toBe(true);
    expect(body.d).toBe(Infinity);
    expect(data.sources[0]!.constructorConflicts).toEqual(["Ambiguous"]);
    expect(packet.authority).toBe("NONE");
    expect(packet.coverage).toBe("compile-inputs-only");
  });

  test("uncacheable ordinary input retains its original source and refuses observation", () => {
    const input = source(new Uint8Array([1, 2]));
    const packet = prepared(input);
    expect(readyInput(packet).immutable).toBe(false);
    expect(readyInput(packet).source).toBe(input);
    expect(() => encodePreparationObservation(packet, encodeReplayValue)).toThrow("refused");
  });

  test("array extension properties cannot silently disappear from an observation", () => {
    const list = Object.assign([1], { extra: 2 });
    const packet = prepared(source(list));
    expect(() => encodePreparationObservation(packet, encodeReplayValue)).toThrow("array extension properties");
  });

  test("render and preparation records are not interchangeable", () => {
    expect(() => decodePreparationPacket(new TextEncoder().encode(JSON.stringify({
      schema: "fenel.compiled-artifact-render.v1", artifact: "compiled-resolver", bytesBase64: "Cg==",
    }) + "\n"))).toThrow();
  });

  test("mixed preparation/compiler/serializer failures retain original closure order and compilation attempts", () => {
    const cells = [
      readyCell("fixture:first"),
      capturePreparedCompileCell("fixture:missing", () => "fixture:missing: no exact identified compiler definition / body"),
      readyCell("fixture:third"),
      capturePreparedCompileCell("fixture:bindings", () => "fixture:bindings: no immutable defining-module call bindings"),
      readyCell("fixture:last"),
    ];
    const failures: string[] = [];
    const attempts: string[] = [];
    const compiled: string[] = [];
    for (const [index, input] of preparedCompileSourceAttempts(cells, failures,
      (id, index) => attempts.push(`${index}:${id}`))) {
      compiled.push(`${index}:${input.source.name}`);
      // Script the same failure doors the worker loop owns; scheduling and
      // in-place preparation refusals come from its actual shared iterator.
      if (input.source.name === "fixture:first") failures.push("fixture:first: compile — rejected");
      if (input.source.name === "fixture:third") failures.push("fixture:third: serialise — rejected");
    }
    expect(attempts).toEqual(["0:fixture:first", "1:fixture:missing", "2:fixture:third", "3:fixture:bindings", "4:fixture:last"]);
    expect(compiled).toEqual(["0:fixture:first", "2:fixture:third", "4:fixture:last"]);
    expect(failures).toEqual([
      "fixture:first: compile — rejected",
      "fixture:missing: no exact identified compiler definition / body",
      "fixture:third: serialise — rejected",
      "fixture:bindings: no immutable defining-module call bindings",
    ]);
  });

  test("unexpected preparation throw follows preceding compilation attempts and stops at its original cell", () => {
    const failure = new Error("original preparation exception");
    const cells = [readyCell("fixture:first"),
      capturePreparedCompileCell("fixture:throws", () => { throw failure; }),
      readyCell("fixture:unreached")];
    const compiled: string[] = [];
    let observed: unknown;
    try {
      for (const [, input] of preparedCompileSourceAttempts(cells, [], () => {})) compiled.push(input.source.name);
    } catch (error) { observed = error; }
    expect(observed).toBe(failure);
    expect(compiled).toEqual(["fixture:first"]);
  });

  test("an unexpected compiler throw does not consume later refusals or attempt later cells", () => {
    const failure = new Error("original compiler exception");
    const cells = [readyCell("fixture:first"),
      capturePreparedCompileCell("fixture:later-refusal", () => "must remain unreported"),
      readyCell("fixture:unreached")];
    const attempts: string[] = [];
    const failures: string[] = [];
    let observed: unknown;
    try {
      for (const _input of preparedCompileSourceAttempts(cells, failures, id => attempts.push(id))) throw failure;
    } catch (error) { observed = error; }
    expect(observed).toBe(failure);
    expect(attempts).toEqual(["fixture:first"]);
    expect(failures).toEqual([]);
  });

  test("metadata-only observation refuses every incomplete recipe before transport", () => {
    for (const incomplete of [
      capturePreparedCompileCell("fixture:refused", () => "no exact body"),
      capturePreparedCompileCell("fixture:throws", () => { throw new Error("preparation failed"); }),
    ]) {
      const packet: PreparedCompiledArtifact = { ...prepared(source(0)), cells: [incomplete] };
      let transports = 0;
      expect(() => encodePreparationObservation(packet, value => { transports++; return encodeReplayValue(value); }))
        .toThrow("incomplete cell");
      expect(transports).toBe(0);
    }
    expect(() => encodePreparationObservation({ ...prepared(source(0)), cells: [] }, encodeReplayValue))
      .toThrow("incomplete closure");
  });
});
