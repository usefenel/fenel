/** Readable runtime data, including values JSON cannot represent. This is a
 * display format, never a persistence codec or a parser for user input. */
export function formatRuntimeValue(value: unknown, indent = 0): string {
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number): string => {
    if (item === null) return "null";
    if (typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") return Object.is(item, -0) ? "-0" : String(item);
    if (typeof item !== "object") return String(item);
    if (item instanceof Uint8Array || item instanceof ArrayBuffer) {
      const bytes = item instanceof Uint8Array ? item : new Uint8Array(item);
      return `${item instanceof Uint8Array ? "Bytes" : "ArrayBuffer"} [${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(" ")}]`;
    }
    if (item instanceof Date) return JSON.stringify(Date.prototype.toISOString.call(item));
    if (seen.has(item)) return "<cycle>";
    if (depth >= 64) return "<nested value>";
    seen.add(item);
    try {
      const array = Array.isArray(item);
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const entries = array
        ? Array.from({ length: item.length }, (_, index) => [String(index), descriptors[String(index)]] as const)
        : Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable);
      const values = entries.map(([key, descriptor]) => {
        const text = !descriptor ? "<absent>" : "value" in descriptor ? visit(descriptor.value, depth + 1) : "<accessor>";
        return array ? text : `${JSON.stringify(key)}: ${text}`;
      });
      const [open, close] = array ? ["[", "]"] : ["{", "}"];
      if (!values.length) return open + close;
      if (!indent) return open + values.join(", ") + close;
      const pad = " ".repeat(indent * (depth + 1));
      return open + "\n" + values.map(text => pad + text).join(",\n") + "\n" + " ".repeat(indent * depth) + close;
    } finally { seen.delete(item); }
  };
  return visit(value, 0);
}
