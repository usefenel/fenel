import { describe, expect, test } from "bun:test";

import { engineRequire, registerEngineModule } from "./engine-require";

describe("engineRequire partial-namespace recovery", () => {
  test("retries a real lazy module after an empty cyclic namespace was registered", () => {
    const original = engineRequire<typeof import("./maybe-bool")>("maybe-bool");

    try {
      registerEngineModule("maybe-bool", Object.create(null));

      const recovered = engineRequire<typeof import("./maybe-bool")>("maybe-bool");
      expect(recovered).toBe(original);
      expect(recovered.mJust(true)).toEqual({ $tag: "Just", _0: true });
    } finally {
      registerEngineModule("maybe-bool", original);
    }
  });
});
