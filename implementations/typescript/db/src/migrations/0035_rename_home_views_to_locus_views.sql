-- Rename home_views table → locus_views per design/naming.md.
-- "Desktop" split into Locus (the personal space) + View (the layout).
-- The existing `views` table holds reusable TypeView templates and
-- can't share the name with the per-user-layouts table — so the
-- per-user table becomes `locus_views` (views that live inside a
-- locus) to keep the scope explicit. Index renamed too.

ALTER TABLE home_views RENAME TO locus_views;
ALTER INDEX home_views_account_idx RENAME TO locus_views_account_idx;
