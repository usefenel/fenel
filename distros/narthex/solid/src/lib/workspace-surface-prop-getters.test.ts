import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Solid compiles a conditional JSX prop (`a ? b : c`, `a && b`) into a getter
// that creates a new memo on EVERY read. LoadedWorkspace reads its props from
// pane callbacks that run inside owner-backed onSettled callbacks (e.g. the
// composer's Local creation draft -> retainCreationDraft reads `props.epoch`).
// Creating that memo there throws [PRIMITIVE_IN_FORBIDDEN_SCOPE] and the lens
// body became "Could not load data." (Local Browse -> Enter, 2026-10-17).
test("LoadedWorkspace props are plain getters that create no memo when read", async () => {
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const path = fileURLToPath(new URL("./workspace-surface.tsx", import.meta.url));
  const { code } = await compiler.transformAsync(readFileSync(path, "utf8"), {
    filename: path, generate: "dom", hydratable: false, dev: true,
  }) as { code: string };
  const start = code.indexOf("_$createComponent(LoadedWorkspace,");
  expect(start).toBeGreaterThan(-1);
  let depth = 0, end = start;
  for (let index = code.indexOf("(", start); index < code.length; index++) {
    if (code[index] === "(") depth++;
    else if (code[index] === ")" && --depth === 0) { end = index; break; }
  }
  const element = code.slice(start, end + 1);
  expect(element).toContain("get epoch()");
  expect(element).not.toMatch(/_\$memo\(/);
}, 120_000);
