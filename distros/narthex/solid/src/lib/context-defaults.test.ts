import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Solid 2's useContext THROWS (ContextNotFoundError; an empty message in the
// production build) when a context has no provider above the reader and was
// created with no default or with `undefined`. Two regressions in one night
// came from that: RecordRowLimitContext (every record page showed "Could not
// load data.") and NearScreenContext (the Tree of life's "Tree" button left
// the generic record for good). A context a reader may meet without its
// provider takes `null`, a real value, and its readers treat null as absent.

const SRC = join(import.meta.dir, "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sources(path);
    // Shipped code only: tests, fixtures, harnesses and smoke pages are not served.
    return /\.(ts|tsx)$/.test(entry.name) && !/(\.test\.|fixture|harness|smoke)/.test(entry.name) ? [path] : [];
  });
}

/** Every `createContext` whose default Solid 2 reads as absent, as "file: Name". */
function contextsWithoutDefault(): string[] {
  const found: string[] = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    const pattern = /(?:const|let)\s+(\w+)\s*=\s*createContext\b/g;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      let at = match.index + match[0].length;
      if (text[at] === "<") {
        // Skip the type argument, which may nest `<…>` and span lines.
        let depth = 0;
        for (; at < text.length; at++) {
          if (text[at] === "<") depth++;
          else if (text[at] === ">" && text[at - 1] !== "=") { depth--; if (depth === 0) { at++; break; } }
        }
      }
      const call = text.slice(at).match(/^\(\s*(undefined)?\s*\)/);
      if (call) found.push(`${relative(SRC, file).replaceAll("\\", "/")}: ${match[1]}`);
    }
  }
  return found.sort();
}

/** The declaration of `name` in `file`, evaluated with Solid's own createContext. */
async function realContext(file: string, name: string) {
  const text = readFileSync(join(SRC, file), "utf8");
  const declaration = new RegExp(`export const ${name}\\s*=\\s*createContext[\\s\\S]*?\\);`).exec(text)?.[0]
    ?? new RegExp(`const ${name}\\s*=\\s*createContext[\\s\\S]*?\\);`).exec(text)?.[0];
  expect(declaration).toBeDefined();
  const { createContext } = await import("solid-js") as { createContext: (value?: unknown) => unknown };
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(declaration!).replace(/^export /gm, "");
  return new Function("createContext", `${js}; return ${name};`)(createContext);
}

async function readOutside(context: unknown): Promise<{ value: unknown } | { threw: string }> {
  const { createRoot, useContext } = await import("solid-js") as any;
  return createRoot((dispose: () => void) => {
    try { return { value: useContext(context) }; } catch (error) { return { threw: String(error) }; } finally { dispose(); }
  });
}

describe("contexts read outside their provider", () => {
  test("only the contexts that are always provided keep no default", () => {
    expect(contextsWithoutDefault()).toEqual([
      // Required by design: useWorkspaceReadiness() throws its own error without
      // it, and both HomeEntry mounts pass `readiness` first.
      "lib/workspace-readiness.tsx: WorkspaceReadinessContext",
      // home.tsx's readers are file-private components of HomePage, under its
      // provider; 28 readers, listed in .tmp-night/s1112/treefix/STATUS.md.
      "routes/app/home.tsx: HomeDataContext",
    ]);
  });

  test("the workspace chrome reads as absent outside the application shell", async () => {
    const context = await realContext("lib/workspace-chrome.tsx", "WorkspaceChromeContext");
    expect(await readOutside(context)).toEqual({ value: null });
    // useWorkspaceChrome() turns that into `undefined`, which its reader meets with `chrome?.`.
    expect(readFileSync(join(SRC, "lib/workspace-chrome.tsx"), "utf8")).toContain("useContext(WorkspaceChromeContext) ?? undefined");
  });

  // A call drawn outside an ExprFieldShell (a `where` form's root has none,
  // ExpressionEditor.tsx) reads no inspector and no node chrome.
  test("the expression inspector and node chrome read as absent outside an ExprFieldShell", async () => {
    for (const name of ["ExpressionInspectorContext", "ExpressionChromeContext"]) {
      const context = await realContext("lib/expression-runner/expression-surfaces.tsx", name);
      expect(await readOutside(context)).toEqual({ value: null });
    }
  });

  test("the notification centre reads as absent outside the application shell (the local bell)", async () => {
    const context = await realContext("lib/locus-notifications.tsx", "LocusNotificationContext");
    expect(await readOutside(context)).toEqual({ value: null });
  });
});
