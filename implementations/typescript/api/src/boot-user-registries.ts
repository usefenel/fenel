// Boot-time load of the default account's typeclass instances into the global
// dispatch registry (rights R3a: stamped with the owning account by `apply`).
//
// Only the instance partition is read: it is the only part boot applies. The
// views/functions rows used to be read beside it just to be counted in the log
// line, and that read ran CONCURRENTLY with the synchronous account-registry
// build inside `listInstances` (minutes of blocked event loop on a cold
// process). Its ~3.7 MB result then sat unread in the socket until PostgreSQL's
// statement_timeout (2 min on staging) cancelled it with 57014, and the shared
// catch skipped the instances too: the API announced readiness with an
// incomplete registry.
//
// Readiness contract: the instances are applied only from one complete read,
// never partially. A failed read is retried (bounded); when every attempt
// fails the boot refuses readiness (the caller's startup catch reports
// `failed` and exits), like the login sentinel does, instead of serving a
// registry that silently lacks the account's instances.
export type BootUserRegistryDependencies = {
  readonly listInstances: (accountId: string) => Promise<readonly { readonly instance: Record<string, unknown> }[]>;
  readonly apply: (accountId: string, instances: readonly Record<string, unknown>[]) => void;
  readonly log: (line: string) => void;
  readonly error: (line: string, err: unknown) => void;
  readonly sleep: (ms: number) => Promise<void>;
};

/** Delays before the second and third attempts. */
export const BOOT_USER_REGISTRY_RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000];

export async function loadBootUserRegistries(accountId: string, deps: BootUserRegistryDependencies): Promise<void> {
  const attempts = BOOT_USER_REGISTRY_RETRY_DELAYS_MS.length + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let specInstances: Record<string, unknown>[];
    try {
      specInstances = (await deps.listInstances(accountId)).map((row) => row.instance);
    } catch (err) {
      lastError = err;
      deps.error(`[api] Failed to load user registries (attempt ${attempt}/${attempts}):`, err);
      const delay = BOOT_USER_REGISTRY_RETRY_DELAYS_MS[attempt - 1];
      if (delay !== undefined) await deps.sleep(delay);
      continue;
    }
    deps.apply(accountId, specInstances);
    deps.log(`[api] Loaded user registries for ${accountId}: ${specInstances.length} spec instances`);
    return;
  }
  throw new Error(`[api] refusing to announce readiness: the user registries of ${accountId} could not be loaded`, { cause: lastError });
}
