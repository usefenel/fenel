import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARSER_BOOTSTRAP_JSON } from "../../src/generated/parser-bootstrap.generated";
import { parseCacheKey } from "../../src/parse-cache-key";
import {
  bootstrapEarlyInitFiles,
  bootstrapInitCycleFiles,
  isBootstrapCarrierSource,
  type BootstrapSourceLayout,
} from "./bootstrap-carriers";

export type BootstrapSeedEntry = {
  readonly srcHash: string;
  readonly ast: unknown;
  /** Exact normalized bytes permit another edit before the prior seed is
   * committed. Older seeds recover their bytes from verified Git history. */
  readonly source?: string;
};

export type BootstrapPreflightChange = {
  readonly path: string;
  readonly kind:
    | "recorded-carrier-drift"
    | "new-early-init-carrier"
    | "new-carrier"
    | "non-carrier-drift"
    | "removed-init-cycle-source";
  readonly recordedKey?: string;
  readonly worktreeKey?: string;
};

export type BootstrapPreflightResult = {
  readonly ok: boolean;
  readonly refusals: readonly BootstrapPreflightChange[];
  readonly warnings: readonly BootstrapPreflightChange[];
};

export type BootstrapPreflightOptions = BootstrapSourceLayout & {
  readonly seedEntries?: Readonly<Record<string, BootstrapSeedEntry>>;
};

function committedSeedEntries(): Readonly<Record<string, BootstrapSeedEntry>> {
  return JSON.parse(PARSER_BOOTSTRAP_JSON) as Record<string, BootstrapSeedEntry>;
}

/** Import-free safety decision made before the generator dynamically loads any
 * engine module. Recorded carrier drift cannot warm the harness from worktree
 * bytes, and a brand-new EARLY-init carrier has the same problem even though it
 * has no recorded key (M3 round-2 R2-5). Later/unreferenced new carriers are
 * safe: the unchanged recorded corpus warms the harness before they are parsed.
 * "Early init" deliberately means type-foundation's `?raw` imports plus
 * parser-fixities, the S0-derived universe this artifact already owns; a new
 * early `?raw` import elsewhere is outside this detector's declared scope. */
export function inspectBootstrapPreflight(
  options: BootstrapPreflightOptions,
): BootstrapPreflightResult {
  const seed = options.seedEntries ?? committedSeedEntries();
  const early = new Set(bootstrapEarlyInitFiles(options));
  const current = new Set(bootstrapInitCycleFiles(options));
  const refusals: BootstrapPreflightChange[] = [];
  const warnings: BootstrapPreflightChange[] = [];

  for (const path of current) {
    const source = readFileSync(join(options.repoRoot, path), "utf8");
    const worktreeKey = parseCacheKey(source);
    const recordedKey = seed[path]?.srcHash;
    if (recordedKey === worktreeKey) continue;

    const carrier = isBootstrapCarrierSource(source);
    if (carrier && recordedKey !== undefined) {
      refusals.push({ path, kind: "recorded-carrier-drift", recordedKey, worktreeKey });
    } else if (carrier && early.has(path)) {
      refusals.push({ path, kind: "new-early-init-carrier", worktreeKey });
    } else if (carrier) {
      warnings.push({ path, kind: "new-carrier", worktreeKey });
    } else {
      warnings.push({
        path,
        kind: "non-carrier-drift",
        ...(recordedKey === undefined ? {} : { recordedKey }),
        worktreeKey,
      });
    }
  }

  for (const [path, entry] of Object.entries(seed)) {
    if (!current.has(path)) {
      warnings.push({
        path,
        kind: "removed-init-cycle-source",
        recordedKey: entry.srcHash,
      });
    }
  }

  const byPath = (a: BootstrapPreflightChange, b: BootstrapPreflightChange) =>
    a.path.localeCompare(b.path);
  refusals.sort(byPath);
  warnings.sort(byPath);
  return { ok: refusals.length === 0, refusals, warnings };
}

export function formatBootstrapPreflightChange(change: BootstrapPreflightChange): string {
  switch (change.kind) {
    case "recorded-carrier-drift":
      return `${change.path}: recorded regex-carrier bytes changed `
        + `(${change.recordedKey} -> ${change.worktreeKey})`;
    case "new-early-init-carrier":
      return `${change.path}: new regex carrier is loaded during early initialization and has no seed entry`;
    case "new-carrier":
      return `${change.path}: new regex carrier will be parsed after the unchanged seed warms the harness`;
    case "non-carrier-drift":
      return `${change.path}: non-carrier init-cycle bytes changed; unchanged carriers can still warm the harness`;
    case "removed-init-cycle-source":
      return `${change.path}: no longer belongs to the init-cycle corpus and will be removed from the seed`;
  }
}
