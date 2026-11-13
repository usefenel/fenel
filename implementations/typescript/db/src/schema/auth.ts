import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// ---------------------------------------------------------------------------
// Users — the human (or programmatic actor) behind a `Subject`.
//
// Distinct from `accounts`: an account is a workspace / partition; a user
// is the identity that owns or collaborates on accounts. One user can
// belong to many accounts (via `account_memberships`); one account can
// have many users.
//
// `email` is the canonical handle for login. Password / magic-link / OAuth
// credentials are out of scope for this slice — sessions are issued by
// trusted callers (e.g. the dev-login endpoint, which is admin-only) and
// the user table just records identity.
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    /** Immutable identity link; ordinary account data never selects its owner. */
    personalAccountId: uuid("personal_account_id").references(() => accounts.id),
    /** scrypt hash in `<saltHex>:<hashHex>` form. Null for users created
     *  via dev-login who haven't yet set a password — they can only sign
     *  in via dev-login until they do. */
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_personal_account_idx").on(table.personalAccountId),
  ],
);

// ---------------------------------------------------------------------------
// Account memberships — which users belong to which accounts, and in what
// role.
//
// ⚠ ROLES ARE OPEN STRINGS AT THE SCHEMA, AND THE AUTHORITY POLICY IS NARROWER
// (rights R2b). `authority:knownRoles` also includes the narrow system-issued
// `personal` role; a row carrying an unknown role denotes the EMPTY envelope (ledger
// `au.policy.role.unknown`): the principal authenticates and every act refuses.
// Writing a role outside that list is a SILENT LOCKOUT, not a new permission
// level — the comment here used to list "admin" as if it were one. Adding a role
// is a Fenel arm in `authority:roleEnvelope` plus an entry in `knownRoles`.
// The membership row IS the first grant: a principal, a partition, a policy name
// (this column) and an id. The
// permission evaluator reads the membership row to make policy decisions.
//
// (One row per (user, account) pair. A user being a member of multiple
// accounts is represented as multiple rows.)
// ---------------------------------------------------------------------------

export const accountMemberships = pgTable(
  "account_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("account_memberships_user_account_idx").on(
      table.userId,
      table.accountId,
    ),
    index("account_memberships_account_idx").on(table.accountId),
  ],
);

// ---------------------------------------------------------------------------
// Sessions — opaque bearer tokens binding a request to a (user, account)
// pair.
//
// `tokenHash` is the SHA-256 of the raw token (the raw value is shown to
// the client once, never stored). Callers send `Authorization: Bearer
// <raw>`; the server hashes and looks up by hash.
//
// `accountId` is the account this session is currently scoped to — a
// user with multiple memberships can have one session per account, and
// the auth middleware threads the session's accountId into the Subject
// it constructs.
//
// `expiresAt` may be null for non-expiring tokens (programmatic API
// tokens). Interactive sessions set a finite expiry; the auth middleware
// rejects expired ones.
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    tokenHash: text("token_hash").notNull(),
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_idx").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
  ],
);
