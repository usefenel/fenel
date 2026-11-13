// Test support for the literal-witness tests (imported only by `*.test.ts`).
// C1 only: preserve the original eager preparation as an independent source
// oracle. Dependencies are supplied by each test; loading this helper builds
// no registry and installs no evaluator, hook or production fallback.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

type WitnessModule = typeof import("../literal-witness");
export type LiteralWitnessOracle = Pick<WitnessModule,
  "prepareAuthoringLiteralWitnesses" | "inferAuthoringExpressionWithLiteralWitnesses">;
export type LiteralWitnessOracleDependencies = {
  checkAuthoringSchemeStructure: typeof import("../../signature-inference").checkAuthoringSchemeStructure;
  engineRequire: typeof import("../../engine-require").engineRequire;
  inferAuthoringExpression: typeof import("../expression-authoring").inferAuthoringExpression;
  peelToArrowType: typeof import("../expression-authoring").peelToArrowType;
  projectAuthoringScheme: typeof import("../scheme-projection").projectAuthoringScheme;
  expectedTypeConsumer: typeof import("../call-scheme").expectedTypeConsumer;
  inferCallScheme: typeof import("../call-scheme").inferCallScheme;
};

export const EAGER_LITERAL_WITNESS_SHA256 = "fb470707dff2b34fa2b9723c8d68569855e26e087c839dc5eaa35746bcd34560";
export function eagerLiteralWitnessSource(): string {
  // A `-text` rule in `.gitattributes` preserves these exact oracle bytes on
  // Windows checkouts as well as Linux; no line-ending normalization is used.
  const bytes = readFileSync(new URL("./literal-witness-eager-2026-11-03.ts.txt", import.meta.url));
  if (createHash("sha256").update(bytes).digest("hex") !== EAGER_LITERAL_WITNESS_SHA256) {
    throw new Error("The preserved eager literal-witness source changed.");
  }
  return bytes.toString("utf8");
}

export function loadLiteralWitnessOracle(source: string, dependencies: LiteralWitnessOracleDependencies): LiteralWitnessOracle {
  const stripped = source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/export function /g, "function ");
  const code = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(stripped);
  const names = Object.keys(dependencies);
  return new Function(...names, code + ";return { prepareAuthoringLiteralWitnesses, inferAuthoringExpressionWithLiteralWitnesses };")(
    ...names.map(name => dependencies[name as keyof LiteralWitnessOracleDependencies]),
  ) as LiteralWitnessOracle;
}
