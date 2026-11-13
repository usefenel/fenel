// ---------------------------------------------------------------------------
// signature-phase-4-static-gate.test.ts — the Phase 4+4b source-tree static
// gate (the brief's verification step 6: content-granular invariant scans the
// live census must NOT claim to prove).
//
// SLICE 2 SCOPE — the inert-evidence posture proofs:
//   (a) the P4-D1 validation data (validation.fenel) is NOT judgment-
//       reachable: no checker/decider/kernel/judgment/synthesis Fenel source
//       and no decider ctx-native surface references its constructors;
//   (b) the S2 leaf (validation-canonical-bytes.ts) is host-API-free (no
//       node:/bun: imports anywhere in its module — the browser-parity
//       posture); validation canonicalization stays in the trusted-entry seam,
//       while the pinned source/module and S1 consumers use raw SHA-256 only;
//   (c) the fnTypeMarker test-fixture mutator is production-unreachable
//       (the D0b static-proof obligation on top of the NODE_ENV gate);
//   (d) no production `SignatureTrust` consumer grew beyond the P2 census
//       set this phase will delete at D7 (a drift tripwire, not the deletion
//       scan — that lands with the cutover).
// The slice-3/4 additions (SeAll-installation negatives, function-id-only
// lookup negatives, trust-type deletion scans, browser node:crypto scans over
// the validation modules, the bodylessness-is-total removal) extend this file.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import { engineModule } from "./modules/engine";
import { stdModule } from "./modules/std";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");

const read = (relative: string): string =>
  readFileSync(join(REPO, relative), "utf8");

/** The P4-D1 constructor names (the closed evidence vocabulary). */
const D1_CONSTRUCTOR_FAMILIES = [
  "RsnEffectfulScEff", "RsnCapture", "RsnQuantifiedReflection",
  "RsnParserRepresentationDivergence", "RsnSccAssumptionNotValidated",
  "EligUnsupported", "EligEvidenceIncomplete", "EligEvidenceComplete",
  "ClaimAdmissible", "ClaimFenced",
  "VdUnchecked", "VdValidated", "VdRefuted", "VdIndeterminate",
  "McoPassed", "McoRefuted", "McoIndeterminate",
  "OsaExternalDependency", "OsaVerifiedPrimitive", "OsaCurrentSccAssumption",
  "TseCertifiedFenelDependency", "TseVerifiedPrimitiveRoot",
  "SueAuthorized", "SueNegative",
  "NsuFenced", "NsuAmbiguous", "NsuParserDivergent",
  "PrsVerified", "PrsNegative",
  "FenelSccValidation", "PrimitiveValidation",
] as const;

/** The judgment-reachable Fenel sources (checker, deciders, kernel, judgment,
 * containment, inhabitation, synthesis, the resolver) — the surfaces the
 * slice-3 cutover may touch and slice 2 must NOT. */
const JUDGMENT_FENEL_SOURCES = [
  "fenel/modules/engine/check.fenel",
  "fenel/modules/engine/set-algebra-deciders.fenel",
  "fenel/modules/engine/containment.fenel",
  "fenel/modules/engine/judgment.fenel",
  "fenel/modules/engine/kernel.fenel",
  "fenel/modules/engine/inhabit.fenel",
  "fenel/modules/engine/synthesize.fenel",
  "fenel/modules/engine/type-to-set.fenel",
  "fenel/modules/engine/inference.fenel",
  "fenel/modules/engine/analyze.fenel",
  "fenel/modules/engine/totality.fenel",
  "fenel/modules/engine/dispatch.fenel",
] as const;

// TIMEOUTS, and why they are here (signature-substrate slice 3j1). Every test
// in this file walks the source tree with `readdirSync` + `readFileSync`. Warm,
// the whole suite runs in ~1.4 s; on a COLD filesystem cache the same suite
// takes ~28 s and individual tests exceed bun's 5 s default — measured twice
// while widening `(e4)`'s root set from three directories to seven. A test that
// fails because the OS page cache was cold is a false failure, and a false
// failure trains the next session to ignore this file. The explicit bound is
// generous on purpose: it is there to stop a hang, not to police duration.
describe("Phase-4 static gate (slice 2) — inert-evidence posture", () => {
  it("(a) no judgment-reachable Fenel source references a P4-D1 constructor", () => {
    for (const source of JUDGMENT_FENEL_SOURCES) {
      const text = read(source);
      for (const ctor of D1_CONSTRUCTOR_FAMILIES) {
        expect(
          text.includes(ctor),
          `${source} references ${ctor} — the D1 evidence data must stay inert until the slice-3 cutover`,
        ).toBe(false);
      }
    }
  }, 120_000);

  it("(a2) the decider ctx-native surface does not read the D1 evidence data", () => {
    const dispatchHost = read("implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    for (const ctor of ["SueAuthorized", "TseCertifiedFenelDependency", "VdValidated", "OsaExternalDependency"]) {
      expect(
        dispatchHost.includes(ctor),
        `engine-bodies-dispatch.ts references ${ctor} before the slice-3 cutover`,
      ).toBe(false);
    }
  }, 120_000);

  it("(b) the S2 leaf is host-API-free, with one canonicalization seam and pinned raw-hash consumers", () => {
    const leaf = read("implementations/typescript/engine/src/validation-canonical-bytes.ts");
    // Import-statement scans (the module DOC may name node:crypto — the
    // test-only oracle mention — but nothing may IMPORT a host API).
    expect(/from\s+["']node:/.test(leaf)).toBe(false);
    expect(/from\s+["']bun:?/.test(leaf)).toBe(false);
    expect(/\brequire\(/.test(leaf)).toBe(false);
    expect(/\bimport\(/.test(leaf)).toBe(false);
    // AMENDED BY SLICE 3g, and the amendment is the cutover this clause was
    // waiting for rather than a relaxation. It used to read "production
    // UNCONSUMED", with the recorded reason "its first production consumer is
    // the slice-3 validator, which lands with the hash-domain TCB discipline".
    // That validator is `vteValidate`, and it needs the digest INSIDE the
    // trusted path: a digest supplied by the caller would make every binding
    // the caller's word, which is exactly what the entry exists not to take.
    //
    // So the claim narrows from "nobody consumes it" to "EXACTLY ONE seam
    // consumes it, and it stays host-API-free". The host-API scans above are
    // unchanged and remain the substantive half — a leaf reaching for
    // `node:crypto` would break the browser/Node byte agreement A6 rests on,
    // consumer or no consumer.
    const roots = [
      "implementations/typescript/engine/src",
      "implementations/typescript/runtime/src",
      "distros/narthex/solid/src",
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          if (entry === "node_modules" || entry === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (/\.test\.tsx?$/.test(entry)) continue;
        if (entry === "validation-canonical-bytes.ts") continue; // the leaf itself
        const text = readFileSync(full, "utf8");
        if (text.includes("validation-canonical-bytes")) offenders.push(full);
      }
    };
    for (const root of roots) walk(join(REPO, root));
    // RE-PINNED: `authoring/source-module.ts` (added in `178ffe1cb`) hashes
    // module SOURCE TEXT with the leaf's raw SHA-256. It imports `sha256Bytes`
    // only. S1's existing engine-body-memo consumer likewise hashes its own
    // encoded bytes; neither may import validation canonicalization.
    expect(offenders.map((o) => o.slice(REPO.length + 1).split(sep).join("/")).sort()).toEqual([
      "implementations/typescript/engine/src/authoring/source-module.ts",
      "implementations/typescript/engine/src/engine-bodies-dispatch.ts",
      "implementations/typescript/engine/src/engine-body-memo.ts",
    ]);
    const sourceModule = read("implementations/typescript/engine/src/authoring/source-module.ts");
    expect(sourceModule.match(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/validation-canonical-bytes"/)?.[1]?.trim())
      .toBe("sha256Bytes");
    expect(/\bcanonical(Digest|Bytes)\b/.test(sourceModule)).toBe(false);
    const memo = read("implementations/typescript/engine/src/engine-body-memo.ts");
    expect(memo.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/validation-canonical-bytes"/)?.[1]?.trim())
      .toBe("sha256Bytes");
    expect(/\bcanonical(Digest|Bytes)\b/.test(memo)).toBe(false);
    // And the consumer is the ctx-native seam, not scattered call sites.
    const seam = read("implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    expect(seam).toContain("from \"./validation-canonical-bytes\"");
    expect(seam.match(/canonicalDigest\(/g) ?? []).toHaveLength(1);
  }, 120_000);

  it("(c) the fnTypeMarker fixture mutator is production-unreachable", () => {
    // The NODE_ENV gate (landed 966e8515) is the runtime guard; this scan is
    // the D0b static proof: no non-test source calls the fixture mutator.
    const roots = [
      "implementations/typescript/engine/src",
      "implementations/typescript/runtime/src",
      "distros/narthex/solid/src",
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          if (entry === "node_modules" || entry === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (/\.test\.tsx?$/.test(entry)) continue;
        // The DEFINITION SITE, by exact path. A bare basename test skips ANY
        // file called `engine-bodies-dispatch.ts` anywhere under the scanned
        // roots, which is a self-inflicted blind spot rather than an exclusion.
        if (full === join(REPO, "implementations", "typescript", "engine", "src", "engine-bodies-dispatch.ts")) continue;
        // Code only: a comment may NAME the mutator (json-logic.ts cites it as
        // the precedent for its own test-only guard) without calling it.
        const code = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        if (code.includes("__registerFnTypeMarkerFixtureForTests")) offenders.push(full);
      }
    };
    for (const root of roots) walk(join(REPO, root));
    expect(offenders).toEqual([]);
  }, 120_000);

  it("(e) the slice-2b ledger/inventory vocabulary is not judgment-reachable", () => {
    const LEDGER_CONSTRUCTORS = [
      "UlsResolved", "UlsFenced", "UlsLexical", "UlsMissing", "UlsAmbiguous",
      "UlsDynamicOrReflective", "UseLedgerRow", "SignatureUseLedger",
      "LgoLedger", "LgoFenced", "ValidationRoute", "PrimitiveRootRow",
      "VrcConvertToFenel", "VrcRootRequired", "VrcFenced",
    ] as const;
    for (const source of JUDGMENT_FENEL_SOURCES) {
      const text = read(source);
      for (const ctor of LEDGER_CONSTRUCTORS) {
        expect(
          text.includes(ctor),
          `${source} references ${ctor} — the slice-2b ledger must stay inert until the slice-3 cutover`,
        ).toBe(false);
      }
      // Constructor names are NOT sufficient. Cross-file Fenel resolution in
      // this repo is by BARE NAME through the `module engine where` union, so
      // a judgment source could CALL the walker without ever naming one of its
      // types. Scan the function namespace too (every ledger function carries
      // the `vlg` family prefix, which is why it has one).
      expect(
        /\bvlg[A-Z]/.test(text),
        `${source} calls a vlg* ledger function — the slice-2b ledger must not be judgment-reachable`,
      ).toBe(false);
    }
  }, 120_000);

  it("(e3) only the ONE sanctioned consumer references a vlg* function", () => {
    // A fixed judgment-file list is not enough: cross-file resolution goes
    // through the merged `module engine where` union, so an UNSCANNED bridge
    // file could call `vlgLedger` and a scanned judgment file could call the
    // bridge. The sound statement is repository-wide.
    //
    // SLICE 3f admits exactly ONE consumer — the occurrence carrier, which is
    // the identity projection over these very rows. The chain stays closed
    // because (e3b) below asserts the complementary half: nothing outside the
    // carrier references the CARRIER's namespace either. Two named files with a
    // proven-empty inbound edge set is still "no transitive path from a
    // judgment file", which is the property this test exists for.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".fenel")) continue;
        // Exclude by EXACT path, not basename: a second file merely NAMED
        // validation-ledger.fenel elsewhere in the corpus would otherwise be
        // silently exempt.
        if (full === join(REPO, "fenel", "modules", "engine", "validation-ledger.fenel")) continue;
        if (full === join(REPO, "fenel", "modules", "engine", "validation-carrier.fenel")) continue;
        if (full === join(REPO, "fenel", "modules", "engine", "validation-entry.fenel")) continue;
        // slice 3h — the checker ARM walks `VcaNode`s, so it is the second
        // sanctioned carrier consumer. The chain still reads as one door:
        // nothing reaches the ledger except through the carrier, nothing reaches
        // the carrier except the entry and the arm, and the arm is reachable in
        // production only THROUGH the entry (pinned by g3f below).
        if (full === join(REPO, "fenel", "modules", "engine", "validation-check.fenel")) continue;
        const code = readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
          .join("\n");
        if (/\bvlg[A-Z]/.test(code)) offenders.push(full);
      }
    };
    walk(join(REPO, "fenel"));
    expect(offenders).toEqual([]);
  }, 120_000);

  it("(e3b) NO Fenel source outside the carrier module references a vca*/vck* function", () => {
    // The complementary half of (e3), moved up one level again by slice 3g. The
    // carrier now has exactly ONE Fenel consumer — the trusted entry — so the
    // chain reads: nothing reaches the ledger except through the carrier, and
    // nothing reaches the carrier except through `vteValidate`. That is what
    // makes the entry the single door rather than one door among several.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".fenel")) continue;
        if (full === join(REPO, "fenel", "modules", "engine", "validation-carrier.fenel")) continue;
        if (full === join(REPO, "fenel", "modules", "engine", "validation-entry.fenel")) continue;
        // slice 3h — the checker ARM walks `VcaNode`s, so it is the second
        // sanctioned carrier consumer. The chain still reads as one door:
        // nothing reaches the ledger except through the carrier, nothing reaches
        // the carrier except the entry and the arm, and the arm is reachable in
        // production only THROUGH the entry (pinned by g3f below).
        if (full === join(REPO, "fenel", "modules", "engine", "validation-check.fenel")) continue;
        const code = readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
          .join("\n");
        if (/\b(vca|vck)[A-Z]/.test(code)) offenders.push(full);
      }
    };
    walk(join(REPO, "fenel"));
    expect(offenders).toEqual([]);
  }, 120_000);

  // ---- slice 3g — the trusted entry's own namespace ----------------------
  //
  // The entry is the one thing in this phase that MINTS, so the gate's job
  // changes shape here: no longer "prove nothing reaches this" but "prove
  // nothing reaches it EXCEPT the one door, and prove the door is visible".
  // Both halves below are scans, not call-graph proofs — the same honest limit
  // the ledger clauses already carry.

  it("(g3a) every declaration in the trusted entry carries the vte prefix", () => {
    // The soundness precondition for the namespace scans below, exactly as (e2)
    // is for (e): a declaration without the prefix would be invisible to them.
    const src = read("fenel/modules/engine/validation-entry.fenel");
    const declared = [...src.matchAll(/^([a-z][A-Za-z0-9]*)\s*:\s*\(/gm)].map((m) => m[1]!);
    expect(declared.length).toBeGreaterThan(20);
    for (const name of declared) expect(name).toMatch(/^vte[A-Z]/);
  }, 120_000);

  it("(g3b) no judgment source and no other Fenel module references a vte* function", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".fenel")) continue;
        if (full === join(REPO, "fenel", "modules", "engine", "validation-entry.fenel")) continue;
        // slice 3h — the checker arm reuses the entry's own total projections
        // (`vteClassOf`, `vteInstanceArrow`, `vteResidual`) rather than forking
        // second copies of them, which is the direction this phase has taken at
        // every step. It is the ONE new name on this list, and it is not a
        // second door: the arm mints nothing and returns no `VteOutcome`
        // (pinned by g3e's narrowed arm scan).
        if (full === join(REPO, "fenel", "modules", "engine", "validation-check.fenel")) continue;
        // STRING LITERALS are stripped as well as comments and directive prose
        // — the same rule the sibling observation-fence inertness scan uses.
        // The carrier's executable contract NAMES its satisfiers in
        // `satisfiedBy` strings, and a clause recording which function
        // discharges it is a record, not a call. The honest limit is unchanged
        // and already stated for (e5): a computed dispatch target evades any
        // literal scan, so this is a tripwire, not a call-graph proof.
        const code = readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
          .join("\n")
          .replace(/"(?:[^"\\]|\\.)*"/g, '""');
        if (/\bvte[A-Z]/.test(code)) offenders.push(full);
      }
    };
    walk(join(REPO, "fenel"));
    expect(offenders).toEqual([]);
  }, 120_000);

  it("(g3c) the AUTHORITATIVE entry takes no table and the non-authoritative pair is unchanged", () => {
    // The difference the brief requires a static gate to be able to SEE: the
    // authoritative path is a distinct entry constructing its own table, not a
    // flag on the pair that accepts one.
    const entry = read("fenel/modules/engine/validation-entry.fenel");
    expect(entry).toContain("vteValidate : (request: VteRequest) -> VteOutcome");
    const request = entry.match(/^VteRequest = VteRequest .*$/m)![0];
    for (const forbidden of ["entries", "VckEntry", "instance", "SetExpr"]) {
      expect(request).not.toContain(forbidden);
    }
    const carrier = read("fenel/modules/engine/validation-carrier.fenel");
    expect(carrier).toContain("vckPreflightTable : (carrier: VcaCarrier) -> (entries: [VckEntry]) -> VckPreflight");
    expect(carrier).toContain("NON-AUTHORITATIVE");
  }, 120_000);

  it("(g3d) no production TS surface dispatches the entry other than its one transport", () => {
    const roots = ["implementations/typescript/engine/src", "implementations/typescript/runtime/src"];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        const text = readFileSync(full, "utf8");
        if (/["']engine:vte[A-Z]/.test(text) || /\bdispatchedTrustedValidation\b/.test(text)) {
          offenders.push(full.slice(REPO.length + 1).split(sep).join("/"));
        }
      }
    };
    for (const root of roots) walk(join(REPO, root));
    expect(offenders).toEqual(["implementations/typescript/engine/src/engine-bodies-dispatch.ts"]);
  }, 120_000);

  it("(g3a2) the PUBLIC surface of the trusted entry is an exact allowlist", () => {
    // (g3a) only proves every declaration is prefixed, which makes the
    // namespace scans sound but says nothing about how many things are
    // PUBLIC. The result review's sharpest finding was that a public helper
    // returning `VteOutcome` is a second admitting entry whether or not
    // anything in-repo calls it, because every declaration in the module is
    // reachable by name through generic dispatch. So the public set is pinned
    // exactly: adding one fails here and forces the author to argue for it.
    //
    // Two of these — `vteValidate` and `vtePreflight` — can return
    // `VtaAdmitted`. `vtePreflight` re-runs the carrier binding, the caller
    // gate, the projection walk, the readiness gate and recomputes eligibility,
    // so reaching it directly is not weaker than reaching it through
    // `vteValidate`. That property is pinned by the trusted-entry suite, not
    // here; what is pinned here is that no THIRD such function appears.
    const src = read("fenel/modules/engine/validation-entry.fenel");
    const lines = src.split("\n");
    const publicDecls: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^([a-z][A-Za-z0-9]*)\s*:\s*\(/.exec(lines[i]!);
      if (m === null) continue;
      let internal = false;
      for (let j = i - 1; j >= 0; j--) {
        const line = lines[j]!;
        if (line.startsWith("@category \"engine-internal\"")) { internal = true; break; }
        if (!line.startsWith("@") && !line.startsWith("--") && line.trim() !== "") break;
        if (line.trim() === "" && j < i - 1) break;
      }
      if (!internal) publicDecls.push(m[1]!);
    }
    expect(publicDecls.sort()).toEqual([
      "vteAdmissionDigest",
      "vteAdmissionDomain",
      "vteArityFor",
      "vteArrowChainLength",
      "vteArrowRefusal",
      "vteAuthorityFor",
      "vteAuthorityKey",
      "vteBodyDomain",
      "vteCallerRefusal",
      "vteClassOf",
      "vteCoverageOk",
      "vteDigestsVerify",
      "vteDottedFormal",
      "vteEffectRefusal",
      "vteEligible",
      "vteEntriesRemint",
      "vteEntryDigest",
      "vteEntryVersion",
      "vteFirstUnsupported",
      "vteInputsDomain",
      "vteInputsHash",
      "vteInstanceArrow",
      "vteInstancesDerive",
      "vteKindCarriesScheme",
      "vteMintOne",
      "vteOccurrenceDomain",
      "vtePreflight",
      "vteProfileRefused",
      "vteProjectionSupported",
      "vteReadinessRefusal",
      "vteRequestRefusal",
      "vteResidual",
      "vteRoleCarriesScheme",
      "vteRowFor",
      "vteSchemeRefusal",
      "vteSetKey",
      "vteValidate",
    ]);
  }, 120_000);

  it("(g3e) no DIRECT LEXICAL reference to the admission vocabulary exists outside the entry", () => {
    // The namespace scans catch a caller of a `vte*` FUNCTION. They do not
    // catch a consumer that only pattern-matches the admission DATA, which is
    // how a checker would actually read one — so the vocabulary is scanned too.
    // This is the clause that has to move when 3h wires the construct-and-
    // consume seam; it should fail loudly at that moment rather than let the
    // consumption arrive unnoticed.
    const VOCAB = ["VteAdmission", "VtaAdmitted", "VtaRefused", "VteEntry", "VteOutcome", "VteRequest"];
    const offenders: string[] = [];
    const walkFenel = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walkFenel(full); continue; }
        if (!entry.endsWith(".fenel")) continue;
        if (full === join(REPO, "fenel", "modules", "engine", "validation-entry.fenel")) continue;
        const code = readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
          .join("\n")
          .replace(/"(?:[^"\\]|\\.)*"/g, '""');
        // slice 3h — THE CLAUSE MOVED BY NARROWING, NOT BY DELETING, which is
        // what the 3g comment above asked of it. The seam it was written to make
        // loud has now been wired and it is exactly ONE file: the checker arm
        // reads `VteEntry` and `VteAdmission` because consuming an admission is
        // its entire job. Every other Fenel source still may not name any of the
        // vocabulary, and the ARM still may not name the outcome constructors,
        // `VteOutcome` or `VteRequest` — only the entry decides an outcome, and
        // the arm consumes only what the mint already bound into an entry.
        const scanned = full === join(REPO, "fenel", "modules", "engine", "validation-check.fenel")
          ? ["VtaAdmitted", "VtaRefused", "VteOutcome", "VteRequest"]
          : VOCAB;
        for (const name of scanned) {
          if (new RegExp(`\\b${name}\\b`).test(code)) { offenders.push(`${full}:${name}`); break; }
        }
      }
    };
    walkFenel(join(REPO, "fenel"));
    expect(offenders).toEqual([]);

    // TS side: only the transport may name the request/outcome types.
    const tsOffenders: string[] = [];
    const walkTs = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "generated") continue;
          walkTs(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        const text = readFileSync(full, "utf8");
        if (VOCAB.some((name) => new RegExp(`\\b${name}\\b`).test(text))) {
          tsOffenders.push(full.slice(REPO.length + 1).split(sep).join("/"));
        }
      }
    };
    for (const root of ["implementations/typescript/engine/src", "implementations/typescript/runtime/src"]) {
      walkTs(join(REPO, root));
    }
    expect(tsOffenders).toEqual(["implementations/typescript/engine/src/engine-bodies-dispatch.ts"]);
  }, 120_000);

  it("(e4) neither ledger dispatch wrapper is referenced from the engine/runtime/solid/api/core/db/bot roots", () => {
    // The TypeScript side of the same reachability question.
    //
    // NAME IT FOR WHAT IT CHECKS. An earlier title said "have no production
    // consumer", which this clause does NOT establish: it is a LEXICAL marker
    // scan over the roots below, it excludes `generated/` and the wrapper's own
    // defining file, and it is not a call-graph proof — a computed dispatch
    // target still evades it.
    //
    // WIDENED, signature-substrate slice 3j1 §6-2. Rounds 4 and 5 of the 3j
    // design review named the gap concretely: `api` / `core` / `db` / `bot`
    // also depend on the engine, so an API route importing `dispatchEngineBody`
    // and calling `"engine:vlgRootInventory"` was a real production consumer
    // with this clause still green. Those four roots are now scanned. Measured
    // at the widening: zero hits in all four.
    //
    // HOW TO READ A FUTURE HIT (3j1 §6-2, and it is a rule, not a caveat): a
    // hit is a DIRECT-REFERENCE FINDING requiring investigation, NOT a
    // conclusion. The scan reads raw text including comments and strings; a
    // real consumer additionally requires a named production entry point and an
    // assembly path reaching the arm on producer-derived input. Do not suppress
    // a hit by adding an exclusion, and do not over-read one as proof that
    // consumer reachability is discharged.
    //
    // The broader claim that no production consumer is KNOWN to exist remains a
    // MEASURED FACT from a repo-wide direct-reference search, not a consequence
    // of this test.
    const roots = [
      "implementations/typescript/engine/src",
      "implementations/typescript/runtime/src",
      "distros/narthex/solid/src",
      "implementations/typescript/api/src",
      "implementations/typescript/core/src",
      "implementations/typescript/db/src",
      "implementations/typescript/bot/src",
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (/\.test\.tsx?$/.test(entry)) continue;
        // The DEFINITION SITE, by exact path. A bare basename test skips ANY
        // file called `engine-bodies-dispatch.ts` anywhere under the scanned
        // roots, which is a self-inflicted blind spot rather than an exclusion.
        if (full === join(REPO, "implementations", "typescript", "engine", "src", "engine-bodies-dispatch.ts")) continue;
        const text = readFileSync(full, "utf8");
        if (
          text.includes("dispatchedValidationUseLedger")
          || text.includes("dispatchedPrimitiveRootInventory")
          // The generic dispatcher is exported, so a production file could
          // bypass the wrappers entirely by naming the engine target id.
          // BACKTICKS TOO. A template literal `engine:vlgRootInventory` is a
          // direct reference the quote-only class missed entirely.
          || /["'`]engine:vlg[A-Z]/.test(text)
          // ...or consume the ledger's own vocabulary without naming a
          // function at all.
          || /\b(LgoLedger|LgoFenced|UseLedgerRow|SignatureUseLedger|PrimitiveRootInventory|PrimitiveRootRow|PrimitiveRootClass|LedgerBodyProvenance|LedgerOutcome|ValidationArity|ValidationRoute)\b/.test(text)
        ) offenders.push(full);
      }
    };
    for (const root of roots) walk(join(REPO, root));
    expect(offenders).toEqual([]);
  }, 120_000);

  it("(e5) no Fenel source outside the ledger consumes its VOCABULARY either", () => {
    // (e3) bans the function namespace; this bans the data namespace, so a
    // bridge cannot consume `LgoLedger`/`UseLedgerRow` without ever naming a
    // `vlg*` function. Together they are a reachability TRIPWIRE, not a proof:
    // a computed dispatch target (`concat "vlg" "Ledger"`) still evades a
    // literal scan. Slice 3 owns the transitive Fenel call graph.
    const VOCAB = [
      "LgoLedger", "LgoFenced", "UseLedgerRow", "SignatureUseLedger",
      "UseLedgerStatus", "LedgerBodyProvenance", "LedgerOutcome",
      "ValidationRoute", "ValidationArity",
      "PrimitiveRootRow", "PrimitiveRootInventory", "PrimitiveRootClass",
      "UlsResolved", "UlsFenced", "UlsLexical", "UlsMissing", "UlsAmbiguous",
      "UlsDynamicOrReflective", "VrcConvertToFenel", "VrcRootRequired", "VrcFenced",
    ] as const;
    const ledgerPath = join(REPO, "fenel", "modules", "engine", "validation-ledger.fenel");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!entry.endsWith(".fenel")) continue;
        if (full === ledgerPath) continue;
        // The occurrence carrier is the ONE sanctioned consumer (see e3/e3b).
        if (full === join(REPO, "fenel", "modules", "engine", "validation-carrier.fenel")) continue;
        if (full === join(REPO, "fenel", "modules", "engine", "validation-entry.fenel")) continue;
        // slice 3h — the checker ARM walks `VcaNode`s, so it is the second
        // sanctioned carrier consumer. The chain still reads as one door:
        // nothing reaches the ledger except through the carrier, nothing reaches
        // the carrier except the entry and the arm, and the arm is reachable in
        // production only THROUGH the entry (pinned by g3f below).
        if (full === join(REPO, "fenel", "modules", "engine", "validation-check.fenel")) continue;
        const code = readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
          .join("\n");
        for (const name of VOCAB) {
          if (new RegExp(`\\b${name}\\b`).test(code)) { offenders.push(`${full} :: ${name}`); break; }
        }
      }
    };
    walk(join(REPO, "fenel"));
    expect(offenders).toEqual([]);
  }, 120_000);

  it("(e2) the ledger's own functions all carry the scannable vlg prefix", () => {
    // (e) is only sound if the prefix invariant holds: a ledger function
    // WITHOUT the prefix would be invisible to that scan.
    const source = read("fenel/modules/engine/validation-ledger.fenel");
    const declared = [...source.matchAll(/^([a-z][A-Za-z0-9]*)\s*:\s*\(/gm)].map((m) => m[1]!);
    expect(declared.length).toBeGreaterThan(50);
    for (const name of declared) {
      expect(
        /^vlg[A-Z]/.test(name),
        `validation-ledger.fenel declares ${name} without the vlg prefix — gate (e) could not see a call to it`,
      ).toBe(true);
    }
  }, 120_000);

  it("(f) the ledger walker consumes the RAW body, never the unfaithful re-lift", () => {
    // The S1 gate's source-tree proof: the validation walker must not reach
    // `jsonLogicToSyntax` / `syntaxFromBody`, whose image invents appendItem
    // edges, rewrites `cat`, strictifies lazy ops, and re-nests let/do.
    // Scan CODE only: the module header deliberately NAMES the re-lift it
    // rejects, and a documented non-use is not a call. `--` comment lines and
    // `@label`/`@description`/`@tags`/`@category` directive prose are stripped.
    const ledgerCode = read("fenel/modules/engine/validation-ledger.fenel")
      .split("\n")
      .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
      .join("\n");
    const ledger = ledgerCode;
    for (const forbidden of ["jsonLogicToSyntax", "syntaxFromBody", "jsonLogicToExpr", "desugar "]) {
      expect(
        ledger.includes(forbidden),
        `validation-ledger.fenel reaches ${forbidden} — the ledger must walk the RAW stored body`,
      ).toBe(false);
    }
    // and it must not consume the P2 trust currency or mint a certificate
    for (const forbidden of ["SignatureTrust", "TrustedPrimitive", "InferredDerivation", "DependencyCertificate", "SccCertificate"]) {
      expect(
        ledger.includes(forbidden),
        `validation-ledger.fenel references ${forbidden} — slice 2b mints no authority`,
      ).toBe(false);
    }
  }, 120_000);

  it("(g) the ledger dispatch seam is transport-only (no second resolver)", () => {
    const host = read("implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    const start = host.indexOf("export function dispatchedValidationUseLedger");
    expect(start).toBeGreaterThan(-1);
    const seamRaw = host.slice(start, host.indexOf("export type PrimitiveRootRowInput"));
    // Scan CODE, not prose. A comment explaining which runtime route the Fenel
    // side compares against is documentation; banning the word makes a file
    // fail for describing the hazard it avoids, which is backwards. (Slice 3f:
    // the carrier's transport comment names `ctx.getFunction` for exactly that
    // reason.)
    const seam = seamRaw
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // The wrapper marshals and dispatches. It may not resolve, look up, or
    // classify — every one of those is a Fenel-owned decision.
    for (const forbidden of [
      "getFunction", "listSourceFunction", "getFunctionSignatureInfo",
      "fnTypeMarker", "registry", "BUILTIN_OP_NATIVES", "startsWith(",
    ]) {
      expect(
        seam.includes(forbidden),
        `the use-ledger wrapper references ${forbidden} — it must be marshal + dispatch only`,
      ).toBe(false);
    }
    // It reuses the ONE audited marshal rather than introducing a second.
    expect(seam.includes("marshalJsonLogic")).toBe(true);
  }, 120_000);

  it("(h) the enriched route carrier is a companion, not a replacement", () => {
    const inference = read("implementations/typescript/engine/src/signature-inference.ts");
    // P2's row type survives verbatim as the route-parity subset...
    expect(/export type SignatureResolutionRow = \{/.test(inference)).toBe(true);
    // ...and the companion extends it rather than redefining a rival shape.
    expect(
      /export type SignatureRouteEvidenceRow = SignatureResolutionRow & \{/.test(inference),
    ).toBe(true);
    // The producer lives in the registry (the frozen-route owner), not in a
    // validation-side re-resolver.
    const registry = read("implementations/typescript/engine/src/registry.ts");
    expect(registry.includes("listSourceFunctionRouteEvidenceImpl")).toBe(true);
    const ledgerHost = read("implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    expect(ledgerHost.includes("listSourceFunctionRouteEvidence")).toBe(false);
  }, 120_000);

  it("(d) the SignatureTrust production consumer set has not grown past the P2 census", () => {
    // The D7 cutover DELETES the type; until then this tripwire keeps new
    // consumers from appearing. The P2 census set (entry audit §4.1): the
    // type/def sites, the decode/plumbing in signature-inference.ts, the
    // registry storage/egress, the one boolean projection in
    // engine-bodies-dispatch.ts, and the public re-export.
    const allowed = new Set([
      "types.ts",
      "signature-inference.ts",
      "registry.ts",
      "registry-public.ts",
      "engine-bodies-dispatch.ts",
    ]);
    const offenders: string[] = [];
    const root = join(REPO, "implementations/typescript/engine/src");
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          if (entry === "node_modules" || entry === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.ts$/.test(entry)) continue;
        if (/\.test\.ts$/.test(entry)) continue;
        if (allowed.has(entry)) continue;
        const text = readFileSync(full, "utf8");
        if (/\bSignatureTrust\b/.test(text)) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  }, 120_000);
});

// ===========================================================================
// slice 3h — O2: THE POSITIVE ARCHITECTURAL GATE.
//
// Every clause above is a NEGATIVE scan: "this name appears nowhere it should
// not". Those catch a name that moved; they cannot say anything about what the
// validation modules REACH. O2 is the positive direction, in three clauses a
// static scan can actually prove, and each one states what it does NOT prove.
//
// The honest summary claim is: re-lift is unreachable from validation Fenel
// bodies, and every host seam the closure reaches is pinned. It is NOT
// "structurally impossible" — the syntactic closure is not dataflow evidence,
// and D6's behavioural pins carry the semantic weight. O2-c makes a host seam a
// visible, diffed event; it does not make one impossible.
// ===========================================================================
describe("slice 3h — O2: the positive architectural gate", () => {
  const VALIDATION_PREFIXES = ["vte", "vca", "vck", "vlg", "vob", "vrg", "fdc", "vch"];
  const RELIFT_ENTRY_POINTS = ["jsonLogicToSyntax", "syntaxFromBody", "jsonLogicToExpr", "desugar"];

  // ONLY `{call:[name, …]}` heads. A JSON-Logic RECORD is a plain object, so a
  // "any non-$ key is a key-as-fnId" reading treats every record FIELD NAME as a
  // call head — the first draft of this walk produced 700 phantom heads that way.
  // Parser-produced bodies emit the canonical call form for every application
  // (the operator-form shape was retired by migration 0040), so `call` heads are
  // the complete set for this corpus. STATED LIMIT: a computed dispatch target
  // evades any structural walk, exactly as the sibling ledger clauses record.
  const calleesOf = (node: unknown, out: Set<string>): void => {
    if (Array.isArray(node)) {
      for (const item of node) calleesOf(item, out);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "call" && Array.isArray(value) && typeof value[0] === "string") out.add(value[0]);
      calleesOf(value, out);
    }
  };

  const bareOf = (id: string): string => (id.includes(":") ? id.slice(id.indexOf(":") + 1) : id);

  const closure = (): { reached: Set<string>; unresolved: Set<string>; bodyless: Set<string> } => {
    const specById = new Map<string, { id: string; body?: unknown }>();
    const idByBare = new Map<string, string>();
    for (const mod of [engineModule, stdModule]) {
      for (const fn of mod.functions as { id: string; body?: unknown }[]) {
        specById.set(fn.id, fn);
        if (!idByBare.has(bareOf(fn.id))) idByBare.set(bareOf(fn.id), fn.id);
      }
    }
    // A qualified `module.member` head (Phase 5a dotted access, e.g.
    // `std.some`) names the declaration `module:member`; resolve it like any
    // other declared function rather than reading it as a ctx-native key.
    const qualifiedIdOf = (n: string): string | undefined => {
      const m = /^([a-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(n);
      if (m === null) return undefined;
      const id = `${m[1]}:${m[2]}`;
      return specById.has(id) ? id : undefined;
    };
    const isValidationName = (n: string): boolean =>
      VALIDATION_PREFIXES.some((p) => n.startsWith(p) && n.length > p.length && /[A-Z]/.test(n[p.length]!));
    const queue = [...idByBare.keys()].filter(isValidationName);
    const reached = new Set<string>();
    const unresolved = new Set<string>();
    const bodyless = new Set<string>();
    while (queue.length > 0) {
      const name = queue.pop()!;
      if (reached.has(name)) continue;
      reached.add(name);
      const id = idByBare.get(name) ?? qualifiedIdOf(name);
      // An UNRESOLVED head is a ctx-native key the dispatcher injects — a host
      // seam with no declaration at all, which is the kind O2-c's first list
      // pins.
      if (id === undefined) { unresolved.add(name); continue; }
      const spec = specById.get(id)!;
      // A BODYLESS declaration is a BOUNDARY NODE: the host seam behind it is
      // pinned by O2-c rather than walked through. Stopping at natives is what
      // makes this a closure over Fenel bodies rather than a claim about TS.
      if (spec.body === undefined || spec.body === null) { bodyless.add(id); continue; }
      const out = new Set<string>();
      calleesOf(spec.body, out);
      for (const callee of out) if (!reached.has(callee)) queue.push(callee);
    }
    return { reached, unresolved, bodyless };
  };

  it("(O2-a) the validation closure reaches NO re-lift entry point", () => {
    const { reached } = closure();
    expect(reached.size).toBeGreaterThan(50);
    for (const relift of RELIFT_ENTRY_POINTS) {
      expect({ relift, reached: reached.has(relift) }).toEqual({ relift, reached: false });
    }
  }, 120_000);

  it("(O2-b) the checker module names no second evidence channel", () => {
    const banned = ["fnTypeMarker", "arrowIdMembership", "setAlgebraArrowContains", "request.schemes"];
    const code = read("fenel/modules/engine/validation-check.fenel")
      .split("\n")
      .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
      .join("\n");
    for (const name of banned) {
      expect({ name, present: code.includes(name) }).toEqual({ name, present: false });
    }
  }, 120_000);

  it("(O2-c) every host seam the validation closure reaches is PINNED", () => {
    const { unresolved, bodyless } = closure();
    // THE UNION, computed over the FULL O2-a closure. Two seam kinds:
    //   • an UNRESOLVED head is a ctx-native key the dispatcher injects — no
    //     declaration exists at all, and `validationCanonicalDigest` is the one
    //     the entry itself reaches;
    //   • a BODYLESS `@native` declaration is a boundary node with a canonical
    //     id, and they are reached WHEREVER declared, not only in the validation
    //     modules (the `std:*` arithmetic/string leaves the deciders bottom out
    //     on).
    // An unresolved head NOT on this list FAILS — no unknown-callee
    // pass-through. A new host seam is thereby a visible, diffed event; the real
    // gate on its TS body stays the new-TS-requires-permission rule plus the
    // exceptions ledger.
    //
    // WHAT THIS LIST SHOWS AND THE HONEST READING OF IT. `fnTypeMarker`,
    // `bodyToExpr` and `checkCtorDeclaredWires` ARE in the closure, reached
    // through `setAlgebraContains` → `setAlgebraArrowContains` →
    // `arrowClosureContains`. That is the generic deciders' VALUE-membership
    // path and it is legitimate: it fires only when a decider HOLDS a runtime
    // closure, which the arm never does — the arm reasons over SETS. `bodyToExpr`
    // lifts THAT closure's own body, not the body under validation, which is why
    // it is not one of O2-a's four re-lift entry points. The exposure this leaves
    // is "a rule consults `fnTypeMarker` as an evidence channel", and that is
    // what O2-b's direct-name ban and D6's behavioural pins close.
    expect([...unresolved].sort()).toEqual([
      "bodyToExpr",
      "checkCtorDeclaredWires",
      "decideSubset",
      "fieldKeyCurrentWire",
      "fnBody",
      "fnTypeMarker",
      "namedInHierarchy",
      "namedMember",
      "namedSubsetCheck",
      "patternDisjoint",
      "patternMember",
      "patternSubsetArm",
      "tagInterval",
      "validationCanonicalDigest",
      "whereAggregable",
      "whereEmpty",
      "whereExtract",
      "whereMember",
    ]);
    // `std:chars` and `std:replaceAll` became visible when the walker learned
    // to resolve the qualified `std.some` head (engine/type-to-set.fenel)
    // instead of reading it as an unpinned ctx-native key.
    // Existing exact-numeric equality, field-identity indexing/encoding and
    // representation inspection extend the transitive closure. These pins
    // expose their existing host boundaries, not new checker evidence channels.
    expect([...bodyless].sort()).toEqual([
      "engine:exactEqualitySourceCall",
      "std:add", "std:at", "std:charCode", "std:charFromCode", "std:chars", "std:concat",
      "std:contains", "std:div", "std:elem", "std:entries", "std:eq", "std:floor", "std:fromEntries", "std:gt",
      "std:gte", "std:head", "std:init", "std:isArray", "std:isBoolean",
      "std:isNull", "std:isNumber", "std:isString", "std:join", "std:last",
      "std:length", "std:lookup", "std:lower", "std:lt", "std:lte",
      "std:mapGet", "std:mapSet", "std:mod", "std:mul", "std:neq",
      "std:numberIsFinite", "std:replaceAll", "std:representationValueSnapshot", "std:slice", "std:sortLex", "std:split", "std:startsWith",
      "std:sub", "std:tail", "std:toBoolean", "std:toNumber", "std:toString", "std:urlEncode",
    ]);
  }, 120_000);
});
