import { expect, test } from "bun:test";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";

test("importing all showcase examples never acquires an authoring registry or source compiler", async () => {
  // A fresh host loader catches eager module initialization before any other
  // authoring test can warm its detached session. This is the gallery import.
  const script = `
    await Bun.plugin({ name: "refuse-gallery-acquisition", setup(build) {
      build.onLoad({ filter: /[\\\\/]((?:authoring-(?:session|catalog)(?:[.-][^\\\\/]*)?)|repository-registry|system-entities|type-foundation|seed-values-source)\\.(?:ts|tsx)$/ }, args => {
        throw new Error("Gallery import acquired " + args.path);
      });
    } });
    const { SEED_VALUES } = await import(${JSON.stringify(new URL("./seed-values.ts", import.meta.url).href)});
    console.log(JSON.stringify(SEED_VALUES.map(value => value.name)));
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", script], {
    cwd: process.cwd(),
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  const snapshot = await Bun.file(new URL("../generated/seed-values.json", import.meta.url)).json();
  const values = decodeCheckpointValue(snapshot.values, CHECKPOINT_VALUE_ENCODING) as Array<{ name: string }>;
  expect(JSON.parse(stdout)).toEqual(values.map(value => value.name));
  expect(values.length).toBeGreaterThan(50);
});
