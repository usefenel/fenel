// ---------------------------------------------------------------------------
// module-migrate-ai.test.ts — module-substrate Phase 3l parity proof.
//
// ai is the capability+creds CARBON-COPY that confirms the email (Phase 3k)
// playbook generalizes: the second capability module whose FUNCTION + TYPES +
// CREDS + CAPABILITY + PROVIDERS are ALL authored Fenel-first. The ~128-LOC
// hand-assembled `engine/src/modules/ai.ts` (1 `defineFunction` spec + a TS
// `Interface` capability const + 2 TS provider-instance consts + inline creds)
// was replaced by `ai.fenel` (header + 2 data decls + the `callLLM` @native
// foreign decl) + `capability.fenel` (the AI record-of-methods type →
// seedFromType) + `instances.fenel` (the 2 providers as Fenel typed values) +
// `credentials.fenel` (the 2 ProviderCredentials) + a thin seam — NOTHING
// dropped, NO `ffi/` leaf, NO `nativeImpls`, NO dotted-name rename.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { aiModule, aiCapabilities, aiProviders } from "./modules/ai";
import { stdModule } from "./modules/std";
import { timeModule } from "./modules/time";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

const ENTITY_IDS = ["AIResponse", "AIError"];

// The lone function carried rich `defineFunction` identity (codeName + label +
// description + category="ai" + tags). The `module ai where` header supplies
// the `ai` category at READ time (Phase 3j — no stored Categorizable);
// @label/@description/@tags reproduce the rest. It is the bodyless `callLLM`
// IO-handler-backed @native foreign decl.
const RICH = {
  label: "Call LLM",
  tags: ["ai", "llm", "typeclass"],
  description:
    "Send a prompt to an LLM provider and get a response. If outputSchema is provided, attempts structured parsing.",
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("ai migration — header-driven identity + consolidation", () => {
  test("the `module ai where` header is authoritative (lowercase prefix preserved)", () => {
    expect(aiModule.name).toBe("ai");
  });

  test("module label preserved", () => {
    expect(JSON.stringify(aiModule.label)).toContain("AI");
  });

  test("the lone callLLM function registered under the legacy `ai:` id-prefix", () => {
    expect((aiModule.functions ?? []).map((f) => f.id)).toEqual(["ai:callLLM"]);
  });

  test("both data entities ride along from the consolidated `.fenel`", () => {
    expect((aiModule.entities ?? []).map((e) => e.id).sort()).toEqual([...ENTITY_IDS].sort());
  });
});

describe("ai migration — callLLM is a bodyless @native foreign decl (no ffi/ leaf)", () => {
  test("ai:callLLM is registered and BODYLESS (IO-handler-backed @native)", () => {
    const f = (aiModule.functions ?? []).find((f) => f.id === "ai:callLLM");
    expect(f).toBeDefined();
    expect(f?.body).toBeUndefined();
  });

  test("NO nativeImpls / nativeImplsCtx / ioHandlers (the simpler-than-email shape)", () => {
    expect(aiModule.nativeImpls).toBeUndefined();
    expect(aiModule.nativeImplsCtx).toBeUndefined();
    expect(aiModule.ioHandlers).toBeUndefined();
  });
});

describe("ai migration — creds-as-data (the credentials.fenel sidecar)", () => {
  test("credentialRequirements round-trips byte-identically from the `.fenel` values", () => {
    expect(aiModule.credentialRequirements).toEqual([
      { capability: "AI", provider: "anthropic", envVars: ["ANTHROPIC_API_KEY"] },
      { capability: "AI", provider: "openai", envVars: ["OPENAI_API_KEY"] },
    ]);
  });

  test("the creds value-decls do NOT leak into aiModule.instances (no registry/law footprint)", () => {
    const insts = aiModule.instances ?? [];
    expect(insts.some((i) => i.typeName === "ProviderCredentials")).toBe(false);
  });
});

describe("ai migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = aiModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name", () => {
    expect(methodOf(insts, "Codeable", "ai:callLLM")).toEqual({ codeName: "callLLM" });
  });

  // Phase 3j (identity-as-fallback): ai declares no @category, so NONE carry a
  // stored Categorizable — the `ai` category derives at read time.
  test("Categorizable: NONE stored — ai declares no @category", () => {
    expect(methodOf(insts, "Categorizable", "ai:callLLM")).toBeUndefined();
  });

  test("Labelable + Describable + Taggable: byte-identical", () => {
    expect(methodOf(insts, "Labelable", "ai:callLLM")).toEqual({ label: RICH.label });
    expect(methodOf(insts, "Describable", "ai:callLLM")).toEqual({ description: RICH.description });
    expect(methodOf(insts, "Taggable", "ai:callLLM")).toEqual({ tags: RICH.tags });
  });
});

describe("ai migration — Fenel-authored capability + providers", () => {
  test("the AI capability seed (seedFromType over capability.fenel) has the 1 plain-ident method", () => {
    expect(aiCapabilities).toHaveLength(1);
    expect(aiCapabilities[0]!.name).toBe("AI");
    expect(aiCapabilities[0]!.methods.map((m) => m.name)).toEqual(["complete"]);
  });

  test("the 2 providers (projected from instances.fenel) carry priority + fnId-string methods", () => {
    // Source order matches the retired const: anthropic (10) then openai (20).
    expect(aiProviders.map((p) => p.args[0])).toEqual(["anthropic", "openai"]);
    expect(aiProviders.every((p) => p.typeName === "AI")).toBe(true);
    const anthropic = aiProviders.find((p) => p.args[0] === "anthropic")!;
    const openai = aiProviders.find((p) => p.args[0] === "openai")!;
    expect(anthropic.priority).toBe(10);
    expect(openai.priority).toBe(20);
    // methods are fnId strings (codec model); `priority` is lifted out, not a method key.
    expect(Object.keys(anthropic.methods)).toEqual(["complete"]);
    expect(anthropic.methods.complete).toBe("AI.anthropic.complete");
    expect(openai.methods.complete).toBe("AI.openai.complete");
  });

  test("getCapability(\"AI\") is truthy; resolveCapabilityMethod ranks openai first (priority 20 > 10)", () => {
    const reg = createRegistry([stdModule, timeModule, aiModule]);
    expect(reg.getCapability("AI")).toBeTruthy();
    const resolved = reg.resolveCapabilityMethod("AI.complete");
    expect(resolved?.provider.args[0]).toBe("openai");
    expect(resolved?.spec).toBe("AI.openai.complete");
  });
});
