import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/publicdemo/claims-demo.fenel?raw";
import { evaluate, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { publicClaimsDemoModule } from "./modules/public-demos";
import { proverModule } from "./modules/prover";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { verify, type Judgment } from "./kernel";
import { reflProof, type ProofTerm } from "./prover";
import { Just, Nothing } from "./type-foundation";

// C1: production source, boundary forwards, proposer and kernel. The fixture
// supplies no alternative decision procedure or test-only native pipeline.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  // Production activation already includes prover's canonical evidence
  // types. This fixture carries only those data declarations: no arbitrary
  // proposer/verifier function, native or namespace override is installed.
  const evidenceTypes = {
    ...proverModule,
    functions: [],
    functionSignatureDeclarations: [],
    functionNamespaceOverrides: [],
    instances: [],
    nativeImpls: {},
    nativeImplsCtx: {},
  };
  registry = createRegistry([stdModule, setExprEntityModule, evidenceTypes, publicClaimsDemoModule]);
  context = registry.evaluateContext();
}, 60_000);

type Claim = {
  title: string;
  definition: unknown;
  domain: string;
  claim: unknown;
  evidence: { $tag: string; _0?: number; counterexample?: unknown };
  certificate: { $tag: "Nothing" } | { $tag: "Just"; _0: ProofTerm };
  kernelVerdict: unknown;
  samples: unknown[];
  explanation: string;
};

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [`ClaimsDemo:${name}`, ...args] }, {}, context);
}

function checked(name: string, ...args: unknown[]): Claim {
  const result = call(name, ...args) as { $tag: string; _0: Claim };
  expect(result.$tag).toBe("Ok");
  return result._0;
}

describe("source-owned named claims", () => {
  test.each([
    ["finiteNumberSubset", [1, 2], [1, 2, 3]],
    ["paymentCurrencyChoices", ["EUR", "USD"], ["EUR", "USD", "GBP"]],
  ])("%s preserves the proposed proof and the kernel's exact grade", (name, members, allowed) => {
    const result = checked(name, members, allowed);
    expect(result.evidence).toEqual({ $tag: "SolverChecked" });
    expect(result.kernelVerdict).toEqual(Just({ $tag: "Ok", _0: result.evidence }));
    expect(result.certificate.$tag).toBe("Just");
    if (result.certificate.$tag !== "Just") throw new Error("Expected a proposed certificate");
    expect(result.certificate._0.$tag).toBe("DecidableSetResult");
    const verified = verify(result.claim as Judgment, result.certificate._0);
    expect(verified.$tag).toBe("Ok");
    if (verified.$tag !== "Ok") throw new Error("Expected the kernel to accept the proposed certificate");
    expect(result.evidence).toEqual(verified._0);
    expect(result.definition).toHaveProperty("$ref", `ClaimsDemo:${name}`);
    expect(result.samples).toEqual([]);
    expect(result.explanation).toContain("SolverChecked is distinct from Proven");
  });

  test("edited allowed sets produce concrete counterexamples and recover", () => {
    const denied = checked("finiteNumberSubset", [1, 2], [1]);
    expect(denied.evidence).toEqual({ $tag: "Refuted", counterexample: 2 });
    expect(denied.certificate).toEqual(Nothing);
    expect(denied.kernelVerdict).toEqual(Nothing);
    const currency = checked("paymentCurrencyChoices", ["EUR", "JPY"], ["EUR", "USD"]);
    expect(currency.evidence).toEqual({ $tag: "Refuted", counterexample: "JPY" });
    expect(currency.certificate).toEqual(Nothing);
    expect(checked("finiteNumberSubset", [1, 2], [1, 2]).evidence).toEqual({ $tag: "SolverChecked" });
  });

  test("certificates cannot be reused after the claim changes or forged", () => {
    const accepted = checked("finiteNumberSubset", [1, 2], [1, 2, 3]);
    if (accepted.certificate.$tag !== "Just") throw new Error("Expected a proposed certificate");
    const proof = accepted.certificate._0;
    const changed = checked("finiteNumberSubset", [1, 2], [1]);
    expect(verify(changed.claim as Judgment, proof).$tag).toBe("Err");
    expect(verify(accepted.claim as Judgment, reflProof(1)).$tag).toBe("Err");
    expect(verify(accepted.claim as Judgment, { ...proof, witness: { left: { $tag: "SeEnum", values: [99] }, right: { $tag: "SeEnum", values: [1, 2, 3] } } } as ProofTerm).$tag).toBe("Err");
    expect(verify(accepted.claim as Judgment, { $tag: "Imagination" } as unknown as ProofTerm).$tag).toBe("Err");
  });

  test("sample evidence follows actual predicate results and never creates a certificate", () => {
    const success = checked("positiveNumberSamples", [1, 2, 3]);
    expect(success.evidence).toEqual({ $tag: "SampleTested", _0: 3 });
    expect(success.samples).toEqual([1, 2, 3]);
    expect(success.certificate).toEqual(Nothing);
    expect(success.kernelVerdict).toEqual(Nothing);
    expect(success.explanation).toContain("not a theorem certificate");
    const failed = checked("positiveNumberSamples", [1, -2, 3]);
    expect(failed.evidence).toEqual({ $tag: "Refuted", counterexample: -2 });
    expect(call("claimPositive", -2)).toBe(false);
    expect(call("claimPositive", 3)).toBe(true);
    expect(checked("positiveNumberSamples", [1, 0]).evidence).toEqual({ $tag: "Refuted", counterexample: 0 });
    expect(checked("positiveNumberSamples", []).evidence).toEqual({ $tag: "Unknown" });
  });

  test("the source library is named ordinary data with exact evidence boundaries", () => {
    const claims = call("namedClaims") as Claim[];
    expect(claims).toHaveLength(5);
    expect(claims.map(claim => claim.evidence.$tag)).toEqual(["SolverChecked", "SolverChecked", "SampleTested", "Refuted", "Unknown"]);
    expect(claims.every(claim => claim.title.length > 0 && claim.domain.length > 0)).toBe(true);
    expect(claims.every(claim => typeof claim.definition === "object" && claim.definition !== null && "$ref" in claim.definition)).toBe(true);
    expect(claims[4]!.certificate).toEqual(Nothing);
    expect(claims[4]!.kernelVerdict).toEqual(Nothing);
    const inputs = call("claimsDemoStartingInputs") as Array<{ function: unknown; arguments: unknown[] }>;
    expect(inputs).toHaveLength(4);
    expect(inputs.map(input => input.arguments)).toEqual([[[1, 2], [1, 2, 3]], [["EUR", "USD"], ["EUR", "USD", "GBP"]], [[1, 2, 3]], [[1, -2, 3]]]);
    expect(registry.getFunction("ClaimsDemo:claimsDemoPropose")).toBeUndefined();
    expect(registry.getFunction("ClaimsDemo:claimsDemoVerify")).toBeUndefined();
    expect(registry.getFunction("prover:structuralPropose")).toBeUndefined();
    expect(registry.getFunction("kernel:verify")).toBeUndefined();
    expect(Object.keys(publicClaimsDemoModule.nativeImpls ?? {}).sort()).toEqual([
      "ClaimsDemo:claimsDemoCurrencySubset", "ClaimsDemo:claimsDemoNumberSubset",
    ]);
  });

  test("finite bounds reject unsupported data before any certificate exists", () => {
    for (const values of [[21], [0.5], [NaN], [Infinity], Array.from({ length: 13 }, () => 1), [{ $tag: "SeRef", handle: "hidden" }]]) {
      expect(call("finiteNumberSubset", values, [1])).toMatchObject({ $tag: "Err" });
      expect(call("positiveNumberSamples", values)).toMatchObject({ $tag: "Err" });
    }
    for (const values of [["EU"], [123], [{ a: 1, b: 2, c: 3 }], [[1, 2, 3]], Array.from({ length: 13 }, () => "EUR")]) {
      expect(call("paymentCurrencyChoices", values, ["EUR"])).toMatchObject({ $tag: "Err" });
    }
    for (const [name, values] of [["finiteNumberSubsetCertificate", [{ $tag: "SeRef", handle: "hidden" }]], ["finiteCurrencySubsetCertificate", [{ a: 1, b: 2, c: 3 }]]] as const) {
      const report = dispatchEngineBody(`engine:${name}`, [values, []]) as { proposal: unknown; verdict: unknown };
      expect(report.proposal).toMatchObject({ $tag: "Err", _0: { $tag: "OutOfScope" } });
      expect(report.verdict).toEqual(Nothing);
    }
  });

  test("a public caller cannot replace the closed pipeline's canonical routines", () => {
    let foreignLookups = 0;
    const foreign = new Set(["prover:structuralPropose", "kernel:verify", "engine:propSubset"]);
    const altered: EvaluateContext = {
      ...context,
      getFunction: name => {
        if (foreign.has(name)) {
          foreignLookups++;
          return { ...registry.getFunction("ClaimsDemo:claimPositive")!, id: name, body: { $tag: "Ok", _0: { $tag: "Proven" } } };
        }
        return context.getFunction?.(name);
      },
    };
    const result = evaluate({ call: ["ClaimsDemo:finiteNumberSubset", [1, 2], [1, 2, 3]] }, {}, altered) as { $tag: string; _0: Claim };
    expect(result.$tag).toBe("Ok");
    expect(result._0.evidence).toEqual({ $tag: "SolverChecked" });
    expect(foreignLookups).toBe(0);
  });

  test("the authored guards and predicate agree across parser paths", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([import("./engine-bodies-dispatch"), import("./fenel-parser")]);
    // Complete record declarations exceed the existing 120-token self-hosted
    // parser fence. Exercise the authored eligibility/predicate bodies within
    // its supported budget; production loading/evaluation above covers all
    // claims through the permitted source parser path.
    for (const name of ["claimsWholeNumber", "claimsCurrencyCode", "claimPositive"]) {
      const declaration = SOURCE.match(new RegExp(`^${name} :.*\\r?\\n${name} .*`, "m"))?.[0];
      expect(declaration).toBeDefined();
      const native = parseViaFenelParser(declaration!);
      expect(native).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(native).toEqual(JSON.parse(JSON.stringify(parse(declaration!))));
    }
  }, 60_000);
});
