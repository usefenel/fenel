/** C2 exact policy-input identity only. There is deliberately no API that
 * creates/rebases an anchor from a successful full render or current checkout.
 * The reviewed anchor is a source-policy input; producer evidence binds it.
 */
export type ReviewedEntityProjectionAnchor = Readonly<{
  schema: "fenel.owner-input-projection-anchor.v1";
  category: "canonical-standalone-entity-envelope.v1";
  policyDigest: string;
  consumerSurfaceDigest: string;
  finiteConsumerPlanDigest: string;
}>;

export type CurrentProjectionSurface = Readonly<{
  policyDigest: string;
  /** Complete byte-pinned consumer surface: TS/native code AND every Fenel
   * body that can consume it. ?.fenel being labelled raw does not make it data.
   * This surface excludes only regions whose data role the reviewed plan proves.
   */
  consumerSurfaceDigest: string;
  finiteConsumerPlanDigest: string;
}>;

function exactDataFields(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const observed = Reflect.ownKeys(descriptors);
  if (observed.length !== keys.length || observed.some(key => typeof key !== "string" || !keys.includes(key))) return undefined;
  const data: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)?.value as PropertyDescriptor | undefined;
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    data[key] = descriptor.value;
  }
  return data;
}

const digestFields = ["policyDigest", "consumerSurfaceDigest", "finiteConsumerPlanDigest"] as const;
const sha256 = /^[0-9a-f]{64}$/;

export function matchReviewedEntityProjectionAnchor(
  anchor: ReviewedEntityProjectionAnchor | undefined,
  current: CurrentProjectionSurface,
): "REVIEWED" | "UNREVIEWED" {
  // Production callers must originate these records from captured closed JSON
  // wire, not arbitrary host objects. The descriptor check also refuses missing
  // fields/accessors/exotic prototypes without invoking a getter. Read failures
  // fail closed; this is exact wire identity, never a semantic source selector.
  try {
    const admitted = exactDataFields(anchor, ["schema", "category", ...digestFields]);
    const surface = exactDataFields(current, digestFields);
    if (admitted === undefined || surface === undefined
      || admitted.schema !== "fenel.owner-input-projection-anchor.v1"
      || admitted.category !== "canonical-standalone-entity-envelope.v1") return "UNREVIEWED";
    for (const field of digestFields) {
      const retained = admitted[field];
      const observed = surface[field];
      if (typeof retained !== "string" || !sha256.test(retained)
        || typeof observed !== "string" || !sha256.test(observed)
        || retained !== observed) return "UNREVIEWED";
    }
    return "REVIEWED";
  } catch { return "UNREVIEWED"; }
}
