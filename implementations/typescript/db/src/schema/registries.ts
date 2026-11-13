import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// ---------------------------------------------------------------------------
// Registries — the unit of publishable, version-pinned, shareable code.
//
// A registry holds Fenel source text (functions, types, instances, …) under
// a `<slug>@<version>` coordinate. Once published, a (slug, version) pair
// is immutable: funnels pin to it and are guaranteed to keep dispatching to
// the same code. New work goes to a new version; old funnels are not
// disturbed.
//
// `slug` is `<owner>/<name>` (e.g. `fenel/std`, `acme/utils`). The
// std ships as `fenel/std` — conceptually no different from a
// user-published registry, just hard-coded at engine boot.
//
// `ownerAccountId` is null for the built-in `fenel/*` registries (anyone
// can install them); user-published registries reference the publishing
// account.
//
// `source` is the canonical `.fenel` source text. The engine's
// `loadFenelModule(source, slug)` parses it into a `FenelModule` at load
// time. We cache the parsed result in `module` for cheap reads — this
// stays consistent with `source` because (slug, version) is immutable.
//
// `dependencies` lists other registries this one imports, each pinned to
// a specific version: `[{ "registry": "fenel/std", "version": "1.4.2" }]`.
//
// `contentHash` is the sha256 of `source` — caches a content-addressed
// identity that stays useful when slug/version metadata is questionable.
// ---------------------------------------------------------------------------

export const registries = pgTable(
  "registries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    version: text("version").notNull(),
    ownerAccountId: uuid("owner_account_id").references(() => accounts.id),
    source: text("source").notNull(),
    module: jsonb("module").$type<Record<string, unknown>>(),
    dependencies: jsonb("dependencies")
      .$type<Array<{ registry: string; version: string }>>()
      .notNull()
      .default([]),
    contentHash: text("content_hash").notNull(),
    label: text("label"),
    description: text("description"),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("registries_slug_version_idx").on(table.slug, table.version),
    index("registries_owner_idx").on(table.ownerAccountId),
  ],
);

// ---------------------------------------------------------------------------
// Registry imports — what each account has installed.
//
// An account "installs" a registry to make its names resolvable in that
// account's funnels. Installation is a per-version pin: bumping the
// installed version is an explicit edit (and the moment migrations run
// for stored data shaped under the prior version's types).
//
// Built-in registries (`fenel/std` etc.) are installed implicitly for
// every account at account creation; the row makes the dependency
// explicit and pins the version.
// ---------------------------------------------------------------------------

export const registryImports = pgTable(
  "registry_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    registryId: uuid("registry_id")
      .notNull()
      .references(() => registries.id),
    installedAt: timestamp("installed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("registry_imports_account_registry_idx").on(
      table.accountId,
      table.registryId,
    ),
    index("registry_imports_account_idx").on(table.accountId),
  ],
);
