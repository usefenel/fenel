// ---------------------------------------------------------------------------
// module-migrate-time.test.ts — module-substrate Phase 3b parity proof.
//
// The FIRST native-carrying `FenelModule` → `module … where` migration, and
// the proof of the `ffi/` split. `time` was a Shape-B module: 7 `defineFunction`
// specs in `engine/src/modules/time.ts` (now / timestamp / duration /
// hostDateParse / parseIsoTimestamp / formatIsoTimestamp / nowIso) plus 8
// source-level helper functions loaded from `types.fenel`, with 4 of the specs
// backed by TS natives (now / hostDateParse / formatIsoTimestamp / nowIso).
//
// Phase 3b retired the TS spec wrapper: the four pre-migration `.fenel` files
// consolidated into `fenel/modules/time/time.fenel` (header + sigs + facet
// directives + entities + bodies + 4 `@native` FOREIGN DECLARATIONS), the
// irreducible host-time calls moved to `fenel/modules/time/ffi/time-ffi.ts`,
// and the TS file shrank to a thin `loadFenelModule` + ffi-import seam.
//
// This test is the proof the migration dropped NOTHING and the FFI split
// preserved the runtime contract: every one of the 15 functions resolves by id
// + codeName with the SAME identity the specs emitted; the 4 native-backed
// functions are bodyless foreign declarations. Pure host helpers stay directly
// callable while protected clock reads exercise through perform.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { timeModule } from "./modules/time";
import { createRegistry } from "./registry";
import { humanizeCodeName } from "./fenel-module";
import { evaluate } from "./json-logic";
import { mintTestAuthorityForNothing } from "./authority-test-support";
import { overlayUserFunctions } from "./system-registry";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) --
// The 7 functions that carried rich `defineFunction` identity. category is
// uniformly "time" (the header-derived default == the old explicit
// `category: "time"`); none declared an ioAction. The 4 native-backed ones are
// also the FFI foreign declarations.
type Expected = { label: string; tags: string[]; description: string; native: boolean };
const RICH: Record<string, Expected> = {
  now: {
    label: "Now",
    tags: ["time", "primitive", "effect"],
    description:
      "Current wall-clock time as a Timestamp (ms since epoch). Effectful — successive calls return different values.",
    native: true,
  },
  timestamp: {
    label: "Timestamp",
    tags: ["time", "constructor"],
    description: "Build a Timestamp from milliseconds since the Unix epoch.",
    native: false,
  },
  duration: {
    label: "Duration",
    tags: ["time", "constructor"],
    description: "Build a Duration from a number of milliseconds.",
    native: false,
  },
  hostDateParse: {
    label: "Host Date.parse",
    tags: ["time", "primitive", "io"],
    description:
      "Irreducible IO leaf — ask the host runtime to parse an ISO 8601 string into epoch milliseconds. Nothing if the input isn't a recognised date format. Prefer `parseIsoTimestamp` which wraps the result in a Timestamp record.",
    native: true,
  },
  parseIsoTimestamp: {
    label: "Parse ISO timestamp",
    tags: ["time", "parser"],
    description: "Parse an ISO 8601 string into a Timestamp. Nothing on parse failure.",
    native: false,
  },
  formatIsoTimestamp: {
    label: "Format ISO timestamp",
    tags: ["time", "format"],
    description: "Format a Timestamp as an ISO 8601 string in UTC.",
    native: true,
  },
  nowIso: {
    label: "Now (ISO 8601)",
    tags: ["time", "primitive", "effect"],
    description:
      "Phase 12d sub-step 3 — current wall-clock as an ISO 8601 string in UTC, in one call. Equivalent to `formatIsoTimestamp now` but a single sync native — `new Date().toISOString()`. Effectful; successive calls return different values.",
    native: true,
  },
};

// The 8 source-level helpers carried NO directives pre-migration — only the
// auto-derived Codeable + humanized Labelable + module-name Categorizable. The
// header-driven migration reproduces exactly that (no Describable / Taggable).
const AUTO_LABELS: Record<string, string> = {
  addDuration: "Add Duration",
  diffTimestamps: "Diff Timestamps",
  before: "Before",
  after: "After",
  seconds: "Seconds",
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};

const RICH_NAMES = Object.keys(RICH);
const AUTO_NAMES = Object.keys(AUTO_LABELS);
// The approved calendar-day slice adds these source bodies and one ordinary
// checked-codec value. All legacy function, native and identity pins stay exact.
const CALENDAR_NAMES = [
  "calendarDateWholeWithin", "calendarDateLeapYear", "calendarDateMonthLength",
  "calendarDateValid", "calendarDate", "calendarDateDigit", "calendarDateTextShape",
  "decodeCalendarDate", "encodeCalendarDate", "calendarDateIso",
];
const ALL_NAMES = [...RICH_NAMES, ...AUTO_NAMES, ...CALENDAR_NAMES];
const ids = ALL_NAMES.map((n) => `time:${n}`);
// The 4 native-backed functions == the FFI foreign declarations.
const NATIVE_NAMES = RICH_NAMES.filter((n) => RICH[n]!.native);
const DIRECT_NATIVE_NAMES = ["hostDateParse", "formatIsoTimestamp"];
const PROTECTED_NATIVE_NAMES = ["now", "nowIso"];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("time migration — header-driven identity", () => {
  test("the `module time where` header is authoritative (lowercase prefix preserved)", () => {
    expect(timeModule.name).toBe("time");
  });

  test("legacy functions and the bounded CalendarDate additions use the `time:` id-prefix", () => {
    expect((timeModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("Timestamp, Duration and the distinct CalendarDate owner ride along from the `.fenel`", () => {
    expect((timeModule.entities ?? []).map((e) => e.id).sort()).toEqual(["CalendarDate", "Duration", "Timestamp"]);
  });

  test("module label preserved", () => {
    // loadFenelModule wraps the label in Just(...)
    expect(JSON.stringify(timeModule.label)).toContain("Time");
  });
});

describe("time migration — the `ffi/` split (foreign declarations + native map)", () => {
  test("exactly the 4 native-backed functions are BODYLESS foreign declarations", () => {
    const bodyless = (timeModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `time:${n}`).sort());
  });

  test("every Fenel-bodied function carries its `.fenel` body", () => {
    for (const f of timeModule.functions ?? []) {
      const isNative = NATIVE_NAMES.includes(f.id.slice("time:".length));
      if (!isNative) expect(f.body, `${f.id} should have a body`).toBeDefined();
    }
  });

  test("nativeImpls (the ffi/ leaf map) is rekeyed to the `time:` id-namespace, one per foreign decl", () => {
    expect(Object.keys(timeModule.nativeImpls ?? {}).sort()).toEqual(
      NATIVE_NAMES.map((n) => `time:${n}`).sort(),
    );
  });

  test("no nativeImplsCtx / ioHandlers / credentialRequirements (plain-nativeImpls module)", () => {
    expect(timeModule.nativeImplsCtx).toBeUndefined();
    expect(timeModule.ioHandlers).toBeUndefined();
    expect(timeModule.credentialRequirements).toBeUndefined();
  });
});

describe("time migration — identity-facet parity (DECISION 1: directives → ClassInstances)", () => {
  const insts = timeModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `time:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): time declares no @category, so NONE carry a
  // stored Categorizable — the `time` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — time declares no @category (category derives at read time)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `time:${n}`)).toBeUndefined();
    }
  });

  test("Labelable (rich): explicit @label preserved for the 7 spec'd functions", () => {
    for (const n of RICH_NAMES) {
      expect(methodOf(insts, "Labelable", `time:${n}`)).toEqual({ label: RICH[n]!.label });
    }
  });

  // Phase 3j: the 8 auto helpers no longer carry a STORED Labelable — the loader
  // stopped stamping the humanized-codeName default. The SAME label now derives at
  // READ time: humanizeCodeName(codeName) reproduces the old AUTO_LABELS value
  // byte-identically (the store→read move is lossless, proven here + against the
  // dispatch path in phase-3j-display-fallback.test.ts).
  test("Labelable (auto): the 8 helpers carry NO stored Labelable; the humanized label moves to read time", () => {
    for (const n of AUTO_NAMES) {
      expect(methodOf(insts, "Labelable", `time:${n}`)).toBeUndefined();
      expect(humanizeCodeName(n)).toBe(AUTO_LABELS[n]!);
    }
  });

  test("Describable + Taggable: present & byte-identical for the 7 spec'd functions", () => {
    for (const n of RICH_NAMES) {
      expect(methodOf(insts, "Describable", `time:${n}`)).toEqual({ description: RICH[n]!.description });
      expect(methodOf(insts, "Taggable", `time:${n}`)).toEqual({ tags: RICH[n]!.tags });
    }
  });

  test("Describable + Taggable: ABSENT for the 8 auto helpers (no directives, pre-migration parity)", () => {
    for (const n of AUTO_NAMES) {
      expect(methodOf(insts, "Describable", `time:${n}`)).toBeUndefined();
      expect(methodOf(insts, "Taggable", `time:${n}`)).toBeUndefined();
    }
  });

  test("no stray identity instances (only the expected facet set)", () => {
    // Preserve the original 15 Codeable + 7 rich function-facet sets. CalendarDate
    // adds ten Codeable function/value rows, one Codeable/Labelable/Describable
    // type row, and one ordinary Iso value. No Date alias or new native row.
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts).toEqual({
      Codeable: 26,
      Labelable: 8,
      Describable: 8,
      Taggable: 7,
      Iso: 1,
    });
  });
});

describe("time migration — resolution + descriptor-first exercise through createRegistry", () => {
  const reg = createRegistry([timeModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `time:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("listModuleMembers sees the current source functions, codec value and type owners", () => {
    // The current ordinary module-member index includes type owners as well as
    // function/value names. Preserve both existing temporal types explicitly.
    expect(reg.listModuleMembers("time").sort()).toEqual([
      ...ALL_NAMES, "CalendarDate", "Duration", "Timestamp",
    ].sort());
  });

  test("pure helpers stay direct while protected clock reads live only behind perform", () => {
    const ctx = reg.evaluateContext();
    const natives = ctx.natives;
    expect(natives, "the registry context exposes the merged native map").toBeDefined();
    const nat = natives!;
    for (const n of DIRECT_NATIVE_NAMES) {
      expect(typeof nat[`time:${n}`], `direct native present: time:${n}`).toBe("function");
      expect(ctx._nativePerformDescriptors?.plain[`time:${n}`]).not.toBe(true);
    }
    for (const n of PROTECTED_NATIVE_NAMES) {
      expect(nat[`time:${n}`], `protected native absent: time:${n}`).toBeUndefined();
      expect(ctx._nativePerformDescriptors?.plain[`time:${n}`]).toBe(true);
    }

    // The protected read exercises by descriptor; the pure parser remains a
    // direct host primitive. Both keep the pre-migration return shape.
    const nowVal = evaluate(
      { call: ["time:now"] },
      {},
      ctx,
    ) as { $tag?: string; epochMs?: number };
    expect(nowVal.$tag).toBe("Timestamp");
    expect(typeof nowVal.epochMs).toBe("number");

    const parsed = nat["time:hostDateParse"]!("2024-01-01T00:00:00Z") as { $tag?: string; _0?: number };
    expect(parsed.$tag).toBe("Just");
    expect(typeof parsed._0).toBe("number");

    const missed = nat["time:hostDateParse"]!("not-a-date") as { $tag?: string };
    expect(missed.$tag).toBe("Nothing");
  });

  test("a user-function overlay preserves the live perform frame for protected natives", () => {
    const base = reg.evaluateContext();
    const ctx = overlayUserFunctions(base, [{
      id: "user:nowIso",
      params: [],
      returns: { $ref: "String" },
      body: { call: ["time:nowIso"] },
    } as never]);
    expect(ctx._performTable).toBe(base._performTable);
    expect(ctx._nativePerformDescriptors).toBe(base._nativePerformDescriptors);
    expect(ctx._specRegistry).toBe(base._specRegistry);
    expect(evaluate({ call: ["user:nowIso"] }, {}, ctx)).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    // rights R2a — the overlay must carry the CALLER authority through, so a
    // restricted frame stays restricted after user functions are layered on.
    // rights R2a — minted through the SHARED std kernel, not through `reg`.
    // This registry has no `std` module, so its own checker cannot run and its
    // mint refuses; the handle is authenticated process-wide, so one minted
    // elsewhere is exactly as valid on this frame. What the pin is about is the
    // OVERLAY carrying the authority through, not where it came from.
    const refusing = mintTestAuthorityForNothing();
    const restricted = overlayUserFunctions(
      { ...base, _authority: refusing },
      [{
        id: "user:nowIso",
        params: [],
        returns: { $ref: "String" },
        body: { call: ["time:nowIso"] },
      } as never],
    );
    expect(restricted._authority).toBe(refusing);
    // ⚠ THE REASON IS `undecided`, NOT `refused`, AND THAT IS CORRECT. This
    // registry has no `std` module, so its OWN checker cannot evaluate the
    // judgment and the verdict is unreadable — which the gate reads as a
    // refusal. The pin is that the overlay carried the authority through at
    // all: under the registry bootstrap this call SUCCEEDS.
    expect(() => evaluate({ call: ["user:nowIso"] }, {}, restricted)).toThrow(
      /authority refused "time:nowIso"/,
    );
    // The shared std kernel this pin mints through is built on first use.
  }, 120_000);

  test("a Fenel-bodied function that calls a native resolves end-to-end (parseIsoTimestamp → hostDateParse)", () => {
    // parseIsoTimestamp has a Fenel body that calls the `hostDateParse` native;
    // both must coexist in one registry. Body present + native present is the
    // structural proof; the runtime cross-call is exercised by self-host samples.
    const fn = reg.getFunction("time:parseIsoTimestamp");
    expect(fn?.body, "parseIsoTimestamp keeps its Fenel body").toBeDefined();
    const natives = reg.evaluateContext().natives;
    expect(typeof natives?.["time:hostDateParse"]).toBe("function");
  });
});
