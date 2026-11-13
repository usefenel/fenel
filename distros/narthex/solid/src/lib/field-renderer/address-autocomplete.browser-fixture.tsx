import { createSignal, flush, Show } from "solid-js";
import { render } from "@solidjs/web";
// @ts-expect-error The C2 build supplies the exact current/committed source.
import { AddressAutocomplete } from "fixture:address-autocomplete";

// C2 host fixture: complete production address leaf with inert, held Fetch.
// No registry/provider acquisition, real addresses, credentials or API calls.
type Held = {
  endpoint: string;
  body: Record<string, unknown>;
  signal?: AbortSignal | null;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  settled: boolean;
  resolveJson?: (body: unknown) => void;
};

const initialAddress = { formatted: "10 Old Street, Paris", placeId: "old", city: "Paris" };
const [value, setValue] = createSignal<unknown>(initialAddress);
const [mounted, setMounted] = createSignal(true);
const [changes, setChanges] = createSignal<unknown[]>([]);
const [submissions, setSubmissions] = createSignal<unknown[]>([]);
let held: Held[] = [];
let echo = true;
let rejectAbort = false;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const endpoint = String(input).split("/").at(-1)!;
  if (endpoint !== "autocomplete" && endpoint !== "details") throw new Error(`Unexpected fixture IO: ${input}`);
  return new Promise<Response>((resolve, reject) => {
    const request: Held = { endpoint, body: JSON.parse(String(init?.body)), signal: init?.signal, resolve, reject, settled: false };
    held.push(request);
    if (rejectAbort) request.signal?.addEventListener("abort", () => {
      if (!request.settled) {
        request.settled = true;
        reject(new DOMException("Aborted", "AbortError"));
      }
    }, { once: true });
  });
}) as typeof fetch;

function Fixture() {
  return <main class="address-fixture">
    <header><h1>Address editing</h1><p>A lookup is held while the person keeps typing. Requests never leave this fixture.</p></header>
    <form onSubmit={event => { event.preventDefault(); setSubmissions(previous => [...previous, value()]); }}>
      <section>
        <label id="fixture-address-label" for="fixture-address">Delivery address</label>
        <Show when={mounted()}>
          <AddressAutocomplete value={value()} labelId="fixture-address-label" placeholder="Start typing an address..." config={{ debounceMs: 20, minLength: 3 }}
            onChange={(next: unknown) => { setChanges(previous => [...previous, next]); if (echo) setValue(next); }} />
        </Show>
        <p class="address-fixture__hint">Choose an address suggestion.</p>
        <button type="submit" class="fe-btn">Submit draft</button>
        <button type="reset" class="fe-btn">Reset form</button>
      </section>
      <section class="address-fixture__data">
        <h2>Current submitted data</h2>
        <pre data-model>{value() === undefined ? "No selected address" : JSON.stringify(value(), null, 2)}</pre>
        <h2>Submitted snapshots</h2>
        <pre data-submissions>{JSON.stringify(submissions().map(next => next === undefined ? "No selected address" : next), null, 2)}</pre>
      </section>
    </form>
  </main>;
}

render(() => <Fixture />, document.getElementById("fixture")!);

const fixture = {
  mount(options: { value?: unknown; echo?: boolean; rejectAbort?: boolean } = {}) {
    setMounted(false); flush();
    held = []; echo = options.echo ?? true; rejectAbort = options.rejectAbort ?? false;
    setValue(Object.hasOwn(options, "value") ? options.value : initialAddress);
    setChanges([]); setSubmissions([]); flush();
    setMounted(true); flush();
    document.querySelector<HTMLInputElement>(".fr-autocomplete input")?.setAttribute("id", "fixture-address");
  },
  unmount() { setMounted(false); flush(); },
  replace(next: unknown) { setValue(next); flush(); },
  state() {
    return { value: value(), changes: changes(), submissions: submissions(), requests: held.map(request => ({
      endpoint: request.endpoint, body: request.body, settled: request.settled, aborted: !!request.signal?.aborted,
    })) };
  },
  release(index: number, body: unknown, status = 200) {
    const request = held[index];
    if (!request || request.settled) throw new Error(`Missing held request ${index}`);
    request.settled = true;
    request.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  },
  fail(index: number) {
    const request = held[index];
    if (!request || request.settled) throw new Error(`Missing held request ${index}`);
    request.settled = true; request.reject(new TypeError("Fixture network refusal"));
  },
  releaseHeaders(index: number) {
    const request = held[index];
    if (!request || request.settled) throw new Error(`Missing held request ${index}`);
    request.settled = true;
    const response = new Response("{}", { status: 200 });
    Object.defineProperty(response, "json", { value: () => new Promise(resolve => { request.resolveJson = resolve; }) });
    request.resolve(response);
  },
  releaseJson(index: number, body: unknown) {
    const request = held[index];
    if (!request?.resolveJson) throw new Error(`Missing held JSON ${index}`);
    request.resolveJson(body);
  },
};

(globalThis as unknown as { addressFixture: typeof fixture }).addressFixture = fixture;
fixture.mount();
