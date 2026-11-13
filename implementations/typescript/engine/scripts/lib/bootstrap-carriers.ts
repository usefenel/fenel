import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Deliberately broad. A false positive costs one seed row; a false negative is
 * a cold-boot landmine. In particular, prose `in /` hits stay admitted. */
export const BOOTSTRAP_CARRIER_PATTERN = /(∈|\bin)\s*\//;

export function isBootstrapCarrierSource(source: string): boolean {
  return BOOTSTRAP_CARRIER_PATTERN.test(source);
}

function repoRelative(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split("\\").join("/");
}

/** Recursive filesystem walk, not a git-index walk: untracked `.fenel` files
 * are intentional inputs and are surfaced by the regeneration snapshot. */
export function walkFenelFiles(repoRoot: string, dir = join(repoRoot, "fenel")): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const absolutePath = join(dir, name);
    if (statSync(absolutePath).isDirectory()) {
      out.push(...walkFenelFiles(repoRoot, absolutePath));
    } else if (name.endsWith(".fenel")) {
      out.push(repoRelative(repoRoot, absolutePath));
    }
  }
  return out.sort();
}

export function bootstrapCarrierFiles(repoRoot: string): string[] {
  return walkFenelFiles(repoRoot).filter((path) =>
    isBootstrapCarrierSource(readFileSync(join(repoRoot, path), "utf8"))
  );
}

export type BootstrapSourceLayout = {
  readonly repoRoot: string;
  readonly engineSrc?: string;
  readonly typeFoundationPath?: string;
};

function resolvedLayout(layout: BootstrapSourceLayout): {
  repoRoot: string;
  engineSrc: string;
  typeFoundationPath: string;
} {
  const engineSrc = layout.engineSrc
    ?? join(layout.repoRoot, "implementations", "typescript", "engine", "src");
  return {
    repoRoot: layout.repoRoot,
    engineSrc,
    typeFoundationPath: layout.typeFoundationPath
      ?? join(engineSrc, "type-foundation.ts"),
  };
}

/** Files parsed during early module initialization, before the parser harness
 * can be assumed warm. */
export function bootstrapEarlyInitFiles(layout: BootstrapSourceLayout): string[] {
  const { repoRoot, typeFoundationPath } = resolvedLayout(layout);
  const source = readFileSync(typeFoundationPath, "utf8");
  // Keep this deliberately syntax-tolerant: formatting may put the module
  // specifier on the next line, and either quote style is valid TypeScript.
  // Missing one early import downgrades an unsafe carrier to a mere warning.
  const rawImport = /\bfrom\s*(["'])([^"']+\.fenel)\?raw\1/g;
  const files = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = rawImport.exec(source)) !== null) {
    files.add(repoRelative(repoRoot, resolve(dirname(typeFoundationPath), match[2]!)));
  }
  files.add("fenel/std/parser-fixities.fenel");
  return [...files].sort();
}

/** The exact three-part bootstrap corpus: early `?raw` imports,
 * `parser-fixities.fenel`, and every deliberately broad carrier hit. */
export function bootstrapInitCycleFiles(layout: BootstrapSourceLayout): string[] {
  const files = new Set(bootstrapEarlyInitFiles(layout));
  for (const path of bootstrapCarrierFiles(layout.repoRoot)) files.add(path);
  return [...files].sort();
}
