import { expect, test } from "bun:test";
import { repositoryFunctionChoices, requestRepositoryFunctionChoices } from "./authoring-catalogue-transport";

// The early picker's worker read: every way it can end settles the promise,
// so a picker never stays "Reading functions…" forever.
type FakeWorker = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  posted: unknown[];
  terminated: number;
  postMessage(message: unknown): void;
  terminate(): void;
};
function fakeWorker(behaviour: (worker: FakeWorker) => void) {
  const created: FakeWorker[] = [];
  const make = (): FakeWorker => {
    const worker: FakeWorker = {
      onmessage: null, onerror: null, onmessageerror: null, posted: [], terminated: 0,
      postMessage(message) { worker.posted.push(message); behaviour(worker); },
      terminate() { worker.terminated++; },
    };
    created.push(worker);
    return worker;
  };
  // Structurally the worker surface the transport uses.
  return { create: () => make() as never, created };
}

test("a worker that never answers times out and is terminated", async () => {
  const fake = fakeWorker(() => {});
  await expect(requestRepositoryFunctionChoices(fake.create, 20)).rejects.toThrow("Reading the function list took too long.");
  expect(fake.created[0]!.terminated).toBe(1);
});

test("an undecodable worker message fails the read", async () => {
  const fake = fakeWorker(worker => setTimeout(() => worker.onmessageerror?.({} as MessageEvent), 0));
  await expect(requestRepositoryFunctionChoices(fake.create, 10_000)).rejects.toThrow("The function list could not be read.");
  expect(fake.created[0]!.terminated).toBe(1);
});

test("a worker error and a reported error fail the read; choices resolve once", async () => {
  const failing = fakeWorker(worker => setTimeout(() => worker.onerror?.({ message: "" } as ErrorEvent), 0));
  await expect(requestRepositoryFunctionChoices(failing.create, 10_000)).rejects.toThrow("The repository catalogue is unavailable.");
  const reported = fakeWorker(worker => setTimeout(() => worker.onmessage?.({ data: { error: "no chunk" } } as MessageEvent), 0));
  await expect(requestRepositoryFunctionChoices(reported.create, 10_000)).rejects.toThrow("no chunk");
  const choices = [{ id: "std:split", label: "Split", codeName: "split", params: [{ name: "text" }, { name: "delimiter" }] }];
  const answering = fakeWorker(worker => setTimeout(() => {
    worker.onmessage?.({ data: { choices } } as MessageEvent);
    worker.onmessageerror?.({} as MessageEvent);
  }, 0));
  expect(await requestRepositoryFunctionChoices(answering.create, 10_000)).toEqual(choices);
  expect(answering.created[0]!.terminated).toBe(1);
  expect(answering.created[0]!.posted).toEqual([{ method: "function-choices" }]);
});

test("listing fields keep the naming fields the picker shows", () => {
  expect(repositoryFunctionChoices([
    { id: "std:split", label: "Split", codeName: "split", targetId: "std:split", kind: "function", description: "Split text",
      parentModule: "std", params: [{ name: "text", type: { $ref: "String" } }, { name: "delimiter" }], scheme: {} },
    { id: "broken" },
  ])).toEqual([{ id: "std:split", label: "Split", codeName: "split", targetId: "std:split", kind: "function", description: "Split text",
    parentModule: "std", params: [{ name: "text" }, { name: "delimiter" }] }]);
});
