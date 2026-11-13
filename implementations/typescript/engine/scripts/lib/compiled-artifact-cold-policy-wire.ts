/** C2/B3 closed argument wire only. Semantic decisions remain Fenel-bodied.
 * Bytes are parsed here, so getters, proxies and exotic objects cannot enter
 * the evaluator as facts. Duplicate JSON names refuse before JSON erases them.
 */
import { expectClosedKeys, expectWireArray, expectWireLiteral, expectWireRecord,
  expectWireString, parseJsonBytes } from "./artifact-wire-json";

const ENTITY_FACT_KEYS = Object.freeze([
  "closedStandaloneLoader", "completeSourceProvenance", "completeConsumerRoster",
  "reviewedConsumerAnchor", "canonicalLoaderAdmitted", "hasEntityConsumer", "hasPrimaryConsumer",
  "hasBootstrapConsumer", "hasHarnessConsumer", "hasGlobalInstallerConsumer", "hasDirectRawConsumer",
  "hasUnknownConsumer",
]);

export type ColdPolicyWireInvocation = Readonly<{
  functionId: "ownerinputpolicy:ownerEntityOnlyEligible" | "ownerinputpolicy:ownerIdentityRowRetained";
  args: readonly [Readonly<Record<string, string | boolean>>];
}>;

export function decodeColdPolicyControls(bytes: Uint8Array): readonly ColdPolicyWireInvocation[] {
  return Object.freeze(expectWireArray(parseJsonBytes(bytes), "$controls").map((value, index) => {
    const path = `$controls[${index}]`;
    const row = expectWireRecord(value, path);
    expectClosedKeys(row, ["functionId", "args"], [], path);
    const functionId = expectWireLiteral(row.functionId,
      ["ownerinputpolicy:ownerEntityOnlyEligible", "ownerinputpolicy:ownerIdentityRowRetained"], path + ".functionId");
    const args = expectWireArray(row.args, path + ".args");
    if (args.length !== 1) throw new Error("cold policy wire requires exactly one argument");
    const facts = expectWireRecord(args[0], path + ".args[0]");
    const booleans = functionId === "ownerinputpolicy:ownerEntityOnlyEligible" ? ENTITY_FACT_KEYS
      : ["declaredInEntityOnlySource", "neededByFullConsumerDomain"];
    expectClosedKeys(facts, functionId === "ownerinputpolicy:ownerEntityOnlyEligible" ? booleans
      : ["kind", ...booleans], [], path + ".args[0]");
    const decoded: Record<string, string | boolean> = Object.create(null);
    for (const key of booleans) {
      if (facts[key] !== true && facts[key] !== false) throw new Error(`cold policy fact ${key} is not a Boolean`);
      Object.defineProperty(decoded, key, { value: facts[key], enumerable: true });
    }
    if (functionId === "ownerinputpolicy:ownerIdentityRowRetained") {
      const kind = expectWireLiteral(expectWireString(facts.kind, path + ".kind"),
        ["function", "type", "field", "reserved"], path + ".kind");
      Object.defineProperty(decoded, "kind", { value: kind, enumerable: true });
    }
    return Object.freeze({ functionId, args: Object.freeze([Object.freeze(decoded)]) as readonly [Readonly<Record<string, string | boolean>>] });
  }));
}
