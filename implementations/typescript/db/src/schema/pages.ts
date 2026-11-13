// Page entity now lives in entity_instances. This file keeps the JSONB types
// callers still depend on (PageBlock, PageBlockForm, PageConfig).
// storage-as-effect Phase 4a (2026-06-19) — the dedicated page_submissions
// relation table is RETIRED (migration 0080); page submissions are now
// instances of the form's type (state:tryCreateInstanceByName), captured the
// same way as types:submit — no bespoke table.

export type PageBlockForm = {
  type: "form";
  typeRef: string;
  flowId?: string;
  submitLabel?: string;
};

export type PageBlock = PageBlockForm;

export type PageConfig = {
  brandColor?: string;
  logo?: string;
  thankYouMessage?: string;
  redirectUrl?: string;
};
