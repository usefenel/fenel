import { expect, test } from "bun:test";
import { dispatchEngineBody, withInterpretedResolver } from "./engine-bodies-dispatch";

/** The production identity normalizer intentionally uses the interpreted
 * kernel plus existing iterative std natives while a registry is being built.
 * Exercise its actual current repository cardinality, not a four-field toy. */
test("repository-sized Codeable sorting preserves stable conflict order", () => {
  const size = 22_221;
  const owner = { $tag: "TypeFieldOwner", module: { $tag: "Just", _0: "scale" }, localId: "Fields" };
  const occurrences = Array.from({ length: size }, (_, index) => {
    const handle = `20000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
    const sourceName = `field${index}`;
    return { $tag: "ResolvedFieldOccurrence", owner, sourceName, qualifiedName: `scale/${sourceName}`,
      containerName: "scale/Fields", path: [{ $tag: "FieldNamed", name: sourceName }],
      key: { $tag: "NamedField", ref: { $tag: "FieldRef", handle } },
    };
  });
  // UUID encounter order in a real module roster is not lexical. Keep the
  // shuffle reproducible and avoid TimSort's already-sorted linear fast path.
  const shuffled = [...occurrences];
  let seed = 1234567;
  for (let index = shuffled.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const other = seed % (index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  const previous = occurrences[size - 1]!;
  const conflict = { ...previous, sourceName: "renamed", qualifiedName: "scale/renamed" };
  const result = withInterpretedResolver(() => dispatchEngineBody("engine:fieldIdentityCheckCodeables", [[...shuffled, conflict], {}, []])) as { $tag: string; _0?: Record<string, unknown> };
  expect(result.$tag).toBe("Just");
  expect(result._0?.$tag).toBe("FieldCodeableConflict");
  expect(result._0?.firstName).toBe(previous.sourceName);
  expect(result._0?.secondName).toBe("renamed");
  expect(result._0?.handle).toBe(previous.key.ref.handle);
}, 60_000);
