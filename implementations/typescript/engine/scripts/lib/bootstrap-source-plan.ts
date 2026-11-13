import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { PARSER_BOOTSTRAP_JSON, PARSER_BOOTSTRAP_VERSION } from "../../src/generated/parser-bootstrap.generated";
import { PARSER_BOOTSTRAP_AST_ABI_VERSION } from "../../src/parse-cache-abi";
import { parseCacheKey } from "../../src/parse-cache-key";
import { isBootstrapCarrierSource, type BootstrapSourceLayout } from "./bootstrap-carriers";
import { inspectBootstrapPreflight, formatBootstrapPreflightChange, type BootstrapSeedEntry } from "./bootstrap-preflight";

export type BootstrapSourcePlan = {
  readonly ok: boolean;
  readonly warnings: readonly string[];
  readonly refusals: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly historical: readonly string[];
};

/** Recover bytes by the seed's content key. HEAD alone is not evidence: a seed
 * may have survived several source commits. Never mutate the working tree. */
function historicalSource(repoRoot: string, path: string, key: string): string | undefined {
  const git = (args: string[]) => execFileSync("git", args, {
    cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let revisions: string[];
  try {
    revisions = ["HEAD", ...git(["log", "--all", "--format=%H", "--", path]).trim().split(/\r?\n/)];
  } catch { return undefined; }
  for (const revision of new Set(revisions)) {
    if (revision !== "HEAD" && !/^[0-9a-f]{40,64}$/.test(revision)) continue;
    try {
      const source = git(["show", `${revision}:${path}`]);
      if (parseCacheKey(source) === key) return source;
    } catch { /* Deleted/missing versions are not matching evidence. */ }
  }
  return undefined;
}

export function prepareBootstrapSources(
  options: BootstrapSourceLayout & {
    readonly seedEntries?: Readonly<Record<string, BootstrapSeedEntry>>;
    readonly seedVersion?: number;
    readonly recordedSources?: Readonly<Record<string, string>>;
    readonly findHistorical?: (path: string, key: string) => string | undefined;
  },
): BootstrapSourcePlan {
  if ((options.seedVersion ?? PARSER_BOOTSTRAP_VERSION) !== PARSER_BOOTSTRAP_AST_ABI_VERSION) {
    return {
      ok: false, warnings: [], sources: new Map(), historical: [],
      refusals: ["parser-bootstrap: recorded seed AST ABI is incompatible with the current parser; historical bytes cannot warm it"],
    };
  }
  const seed = options.seedEntries ?? JSON.parse(PARSER_BOOTSTRAP_JSON) as Record<string, BootstrapSeedEntry>;
  const preflight = inspectBootstrapPreflight({ ...options, seedEntries: seed });
  const warnings = preflight.warnings.map(formatBootstrapPreflightChange);
  const refusals = preflight.refusals
    .filter((change) => change.kind !== "recorded-carrier-drift")
    .map(formatBootstrapPreflightChange);
  const sources = new Map<string, string>();
  const historical: string[] = [];
  // Stage every seed member, including non-carriers. This keeps the warm parser
  // graph internally consistent instead of mixing edited foundation definitions.
  for (const [path, entry] of Object.entries(seed)) {
    const absolute = resolve(options.repoRoot, path);
    const local = relative(resolve(options.repoRoot), absolute);
    if (local.startsWith("..") || isAbsolute(local) || resolve(absolute) === resolve(options.repoRoot)) {
      refusals.push(`${path}: seed source lies outside the repository`);
      continue;
    }
    let current: string | undefined;
    try { current = readFileSync(absolute, "utf8"); } catch { /* Recover recorded bytes below. */ }
    if (current !== undefined && parseCacheKey(current) === entry.srcHash) {
      sources.set(absolute, current);
      continue;
    }
    const old = options.recordedSources?.[path] ?? entry.source ?? (options.findHistorical
      ? options.findHistorical(path, entry.srcHash)
      : historicalSource(options.repoRoot, path, entry.srcHash));
    if (typeof old !== "string" || parseCacheKey(old) !== entry.srcHash) {
      refusals.push(`${path}: no historical bytes match recorded bootstrap key ${entry.srcHash}`);
      continue;
    }
    sources.set(absolute, old);
    historical.push(path);
    warnings.push(`${path}: warm bootstrap from verified historical key ${entry.srcHash}, then parse current source`);
  }
  return { ok: refusals.length === 0, warnings, refusals, sources, historical };
}

/** Generator-private loader, installed before ANY engine import. The process
 * exits after generation; the live runtime has no historical-source selector.
 * New imported carriers refuse during warmup, rather than entering a cold regex
 * parser. Unimported new carriers are parsed normally once the harness is warm. */
export async function withBootstrapSources<T>(
  plan: BootstrapSourcePlan,
  warm: () => Promise<void>,
  run: () => Promise<T>,
): Promise<T> {
  if (!plan.ok) throw new Error(plan.refusals.join("\n"));
  let warming = true;
  Bun.plugin({
    name: "fenel-verified-bootstrap-sources",
    setup(builder) {
      builder.onLoad({ filter: /\.fenel(?:\?raw)?$/ }, (args) => {
        const path = resolve(args.path.replace(/\?raw$/, ""));
        const source = warming ? plan.sources.get(path) : undefined;
        if (source !== undefined) return { loader: "object", exports: { default: source } };
        const current = readFileSync(path, "utf8");
        if (warming && isBootstrapCarrierSource(current)) {
          throw new Error(`parser-bootstrap: new imported regex carrier cannot warm from the seed: ${path}`);
        }
        return { loader: "object", exports: { default: current } };
      });
    },
  });
  try {
    await warm();
    warming = false;
    return await run();
  } finally {
    warming = false;
  }
}
