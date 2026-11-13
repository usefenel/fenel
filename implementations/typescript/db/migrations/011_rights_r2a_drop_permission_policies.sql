-- rights R2a — drop the second policy engine's table.
--
-- `permission_policies` backed `dispatch:check` / `permissions:check`, a
-- Subject × Action × Resource product that decided authorization at DISPATCH.
-- Authority is now decided at EXERCISE by `perform`, against the opaque
-- minted envelope on the frame; there is no second engine to read rows for.
--
-- No data migration: rights C3 (`010_rights_c3_drop_anonymous_form_submit_grant.sql`)
-- removed the last seeded row, and the live semantics that remained were
-- `System -> allow everything` / `own account -> allow` / `anonymous -> no
-- matching row`. Those are now the identity-realm, member and anonymous
-- envelopes respectively.
--
-- This is a SYSTEM-SCHEMA migration — the kind `CLAUDE.md` reserves migrations
-- for — not a per-Fenel-type one.

DROP TABLE IF EXISTS permission_policies;
