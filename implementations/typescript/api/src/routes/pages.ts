// ---------------------------------------------------------------------------
// /p/:accountSlug/:pageSlug — public page rendering + submission.
//
// storage-as-effect Phase 4f (2026-06-19) — the page-lane TS collapse. This
// route is now a THIN HTTP leaf: routing + c.req.param/header/json + the
// state:getPageBySlug invoke + the formBlock find (page-block discrimination,
// a wire-shape detail) + HTTP status mapping. Everything else is Fenel:
//   - GET  → pages:pageView resolves the typeRef (types:resolveType — the
//     system-entity arm covers the live `profile` page) and assembles the
//     { page, form } response (form.type = the raw $record the widget renders
//     via fieldsOf → FieldRenderer). Mirror of the /forms GET (types:formView).
//   - POST → pages:submitPage folds in typeRef resolution plus account-aware
//     state:validateEntityInstance coercion and the capture (an instance of the resolved
//     type, no page_submissions row) + the page-anchored `submitted` event +
//     the redirect/message response. The body builds the ip + config Maybes from
//     the raw header/JSON values (the TS resolveFormFields helper, the recordType
//     rebuild, the @fenel/core validate() call, and the configForBody/ip
//     marshalling are DELETED — Decisions Z + AA retired; see pages.fenel).
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { PageBlockForm } from "@fenel/db";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";
import { loadPublicFieldRegistryBundle, PublicFieldRegistryBundleError } from "../public-field-registry-bundle";
import type { PublicFieldRootBinding } from "@fenel/engine/field-authoring";

const pageRoutes = new Hono();

type PageRow = {
  id: string;
  accountId: string;
  slug: string;
  name: string;
  published: boolean;
  blocks: PageBlockForm[];
  config: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// GET /p/:accountSlug/:pageSlug — render public page
// ---------------------------------------------------------------------------

pageRoutes.get("/:accountSlug/:pageSlug", async (c) => {
  const accountSlug = c.req.param("accountSlug");
  const pageSlug = c.req.param("pageSlug");

  const pageMaybe = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "state:getPageBySlug", {
    accountSlug,
    pageSlug,
  })) as { $tag: "Just"; _0: PageRow } | { $tag: "Nothing" };
  if (pageMaybe.$tag === "Nothing") return c.json({ error: "Page not found" }, 404);
  const page = pageMaybe._0;

  const formBlock = page.blocks.find((b): b is PageBlockForm => b.type === "form");
  if (!formBlock) return c.json({ error: "Page has no form" }, 404);

  // pages:pageView resolves the typeRef + assembles { page, form }. Invoked with
  // accountId = page.accountId so types:resolveType is account-scoped.
  const view = (await invokeIOActionAs(await mintLaneAuthorityFor(page.accountId, "pages"), null, "pages:pageView", {
    slug: page.slug,
    name: page.name,
    typeRef: formBlock.typeRef,
    submitLabel: formBlock.submitLabel || "Submit",
    config: page.config ?? {},
  }, { persistence: "ephemeral" })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (view.$tag === "Nothing") return c.json({ error: "Type not found: " + formBlock.typeRef }, 404);

  const publicView = view._0 as {
    form?: { typeName?: string; type?: unknown; rootBinding?: PublicFieldRootBinding };
    [key: string]: unknown;
  };
  if (typeof publicView.form?.typeName !== "string") {
    return c.json({ error: "Resolved type name missing" }, 500);
  }
  try {
    const fieldRegistry = await loadPublicFieldRegistryBundle(
      page.accountId,
      publicView.form.typeName,
      publicView.form?.type,
      publicView.form.rootBinding,
    );
    const { rootBinding: _binding, ...publicForm } = publicView.form;
    return c.json({ ...publicView, form: publicForm, fieldRegistry });
  } catch (error) {
    if (error instanceof PublicFieldRegistryBundleError && error.code === "RootTypeChanged") {
      return c.json({ error: "Type not found: " + formBlock.typeRef }, 404);
    }
    throw error;
  }
});

// ---------------------------------------------------------------------------
// POST /p/:accountSlug/:pageSlug/submit — handle form submission
// ---------------------------------------------------------------------------

pageRoutes.post("/:accountSlug/:pageSlug/submit", async (c) => {
  const accountSlug = c.req.param("accountSlug");
  const pageSlug = c.req.param("pageSlug");

  const pageMaybe = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "state:getPageBySlug", {
    accountSlug,
    pageSlug,
  })) as { $tag: "Just"; _0: PageRow } | { $tag: "Nothing" };
  if (pageMaybe.$tag === "Nothing") return c.json({ error: "Page not found" }, 404);
  const page = pageMaybe._0;

  const formBlock = page.blocks.find((b): b is PageBlockForm => b.type === "form");
  if (!formBlock) return c.json({ error: "No form block" }, 400);

  const body = await c.req.json<{ data?: Record<string, unknown> }>();
  if (!body.data) return c.json({ error: "Missing data" }, 400);

  // Raw visitor ip ("" when absent) — the Fenel body builds the Maybe<String>.
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "";

  const response = (await invokeIOActionAs(await mintLaneAuthorityFor(page.accountId, "pages"), null, "pages:submitPage", {
    pageId: page.id,
    pageSlug,
    typeRef: formBlock.typeRef,
    data: body.data,
    ip,
    flowConfigured: Boolean(formBlock.flowId),
    config: page.config ?? {},
  })) as Record<string, unknown>;

  // storage-as-effect Phase 4f — submitPage resolves + validates + captures in
  // Fenel; a resolve/validate/create failure surfaces as an { error } body. Map
  // it to 500 so the public widget's `!res.ok → result.error` path reports it.
  if (typeof response["error"] === "string") {
    return c.json({ error: response["error"] }, 500);
  }

  return c.json(response);
});

export { pageRoutes };
