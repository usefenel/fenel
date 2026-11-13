// ---------------------------------------------------------------------------
// /embed/forms/:slug — type definition + submission.
//
// forms-collapse Phase 3b (2026-06-08) / storage-as-effect Phase 4c
// (2026-06-19 — the funnel/form VOCABULARY retirement). There is NO "funnel"
// and NO "form" concept — only a registered Fenel `$record` type; submitting it
// is *calling the type's function with the typed input* (the path proven in
// Phases 2/3a is now the ONLY path). The legacy `submit_form` action + the
// `state:findFormBySlug` lookup + the TS `validate()` envelope + the
// `dispatch("submit_form")` branch are gone:
//   • GET /forms/:slug   → resolve the registered type by name (state:getType),
//     serve its `$record` schema so the widget renders the fields (FieldRenderer).
//   • POST /forms/:slug/submit → invoke the Fenel-bodied `types:submit`
//     directly (it dispatches: a per-type function owns capture+behavior+
//     return, else the generic capture). Validation + capture + emit live in the
//     Fenel body (Fenel-first — the route stays thin). The `/forms` URL is the
//     stable public widget path — a surface name, not the retired data concept.
//
// rights Phase C3 (2026-08-07) — THE LANE IS NOW GATED. The marker this file
// used to carry ("forms-collapse: open until the rights arc gates anonymous
// capture") described a real hole: this route is mounted behind a permissive
// middleware where anonymous is a valid subject, it takes its account from a
// caller-supplied `X-Account-Id` header, and it resolved ANY registered type
// name in that account — plus, through `resolveType`'s third arm, any
// compile-time system entity. So an anonymous caller could instantiate a
// private type, and GET served that type's `$record` schema on request.
//
// Both verbs now resolve through `types:embedResolve` (fenel/modules/types/
// resolve.fenel), which binds the canonical `types` row UUID and requires an
// owner-authored `EmbedPublication` for it. We still invoke the type's function
// DIRECTLY rather than through the action dispatcher (rights R2a deleted the
// check step that used to deny anonymous
// subjects by design and is the wrong shape for a deliberately public lane; the
// publication row is the author's opt-in instead.
//
// Every gate failure — unresolved slug, resolved-but-unpublished, system entity,
// ambiguous Codeable — returns ONE indistinguishable 404 on BOTH verbs. That is
// load-bearing, not cosmetic: a 403, or a different status for "exists but
// private", would confirm which type names live in an account and hand back
// exactly the private-schema roster the gate exists to hide. For the same
// reason the gate runs BEFORE any validation, since field-level validation
// errors are themselves a schema-enumeration channel.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";
import { loadPublicFieldRegistryBundle, PublicFieldRegistryBundleError } from "../public-field-registry-bundle";
import type { PublicFieldRootBinding } from "@fenel/engine/field-authoring";

const formRoutes = new Hono();

/** The resolved+published type this request is bound to: the canonical `types`
 *  row, re-read by UUID under the named account. */
type BoundType = { id: string; name: string; type: unknown };

/** rights C3 — resolve the caller's slug to a BOUND, PUBLISHED type, or null.
 *  Null covers unresolved / unpublished / not-an-account-type alike, and every
 *  caller must render it as the same 404. Any throw from the resolve path also
 *  denies: an exception here (registry build failure, DB error) must not fall
 *  through to a 500 carrying details about the account's types. */
async function bindPublishedType(
  accountId: string,
  slug: string,
): Promise<BoundType | null> {
  try {
    // ⚠ `slug`, NOT `name` — AND THAT IS A LIVE REPAIR, NOT A RENAME.
    //
    // `types:embedResolve` is declared `embedResolve : String -> Maybe ({  })`
    // with the body binder `slug`, so the params record key the runtime binds is
    // `slug`. This call passed `name`, the argument bound to nothing, and the
    // resolve answered `Nothing` for EVERY slug — so every `/forms/:slug`
    // request 404'd. SILENTLY, because `bindPublishedType` renders every null as
    // one indistinguishable "Form not found", which is the right thing to do for
    // a private schema roster and the reason nobody saw this.
    //
    // MEASURED against staging with the real registry and the real leaf:
    //   types:embedResolve {"slug":"CFApplication"} -> Just {id:"5bc56efd-…"}
    //   types:embedResolve {"name":"CFApplication"} -> Nothing
    // — the type row, the `EmbedPublication` row and the account are all real.
    // PRE-EXISTING: the `name` key is at HEAD and `resolve.fenel` is untouched by
    // rights R4a. Found by R4a C1a's acquisition-closure measurement, which had
    // to drive this path for real to enumerate what it performs.
    //
    // The deeper repair — a NAMED parameter in the declaration, so the contract
    // is STATED rather than inferred from a binder — SHIPPED IN THE SAME COMMIT:
    // `fenel/modules/types/resolve.fenel` now reads
    // `embedResolve : (slug: String) -> Maybe ({  })`. (An earlier draft of this
    // comment said it was "filed, not bundled"; adversarial review caught that it
    // had in fact been bundled, once C1a was already paying the owner regen.)
    const bound = (await invokeIOActionEphemeral(
      mintAcquisitionAuthorityFor(accountId), accountId, null, "types:embedResolve", {
        slug,
      })) as { $tag: "Just"; _0: BoundType } | { $tag: "Nothing" };
    if (bound.$tag !== "Just") return null;
    const row = bound._0;
    if (typeof row?.id !== "string" || typeof row?.name !== "string") return null;
    return row;
  } catch {
    return null;
  }
}

/** The single public failure of this lane. Same status, same body, both verbs. */
const notFound = { error: "Form not found" } as const;

/** rights C3 — the reserved token `types:submit` returns when the row bound by
 *  the gate has vanished before its own re-read. Not public copy: it exists to
 *  be distinguishable from the arbitrary strings the validation and capture arms
 *  forward. Spelled identically in `fenel/modules/types/submit.fenel`. */
const EMBED_GATE_NOT_FOUND = "__embed_gate_not_found__";

/**
 * GET /forms/:slug — get the submitted type's schema (for rendering).
 *
 * storage-as-effect Phase 4e — a thin invoke passthrough. The {slug, type,
 * config} assembly is PORTED into the Fenel body `types:formView` (Fenel-first;
 * net TS reduction), which carries the submit-CTA from the type's Submittable
 * representation into config. The auth-header check + the 404 mapping stay (the
 * HTTP leaf).
 *
 * rights C3 — slug RESOLUTION moved out of `formView` and into the gate:
 * `types:embedResolve` owns the name-then-Codeable-codeName-then-system-entity
 * fallback (the post-4d cf_application→CFApplication fix) AND the publication
 * check, and `formView` now takes the bound type-row UUID it returns. The
 * caller's slug is echoed back onto the response so the widget contract holds.
 */
formRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const accountId = c.req.header("x-account-id");
  if (!accountId) return c.json({ error: "X-Account-Id required" }, 400);

  // rights C3 — gate FIRST, and serve nothing type-derived before it passes.
  const bound = await bindPublishedType(accountId, slug);
  if (!bound) return c.json(notFound, 404);

  // Thread the BOUND canonical type-row UUID, not the caller's slug. Passing a
  // name here would re-enter the three-arm alias-tolerant resolver downstream
  // and the gate's bind would end at this boundary.
  const view = (await invokeIOActionAs(await mintLaneAuthorityFor(accountId, "forms"), null, "types:formView", {
    typeId: bound.id,
  })) as
    | { $tag: "Just"; _0: { slug: string; typeName: string; type: unknown; config: Record<string, unknown>; rootBinding?: PublicFieldRootBinding } }
    | { $tag: "Nothing" };
  if (view.$tag === "Just") {
    if (typeof view._0.typeName !== "string") {
      return c.json({ error: "Resolved type name missing" }, 500);
    }
    try {
      const fieldRegistry = await loadPublicFieldRegistryBundle(
        accountId,
        view._0.typeName,
        view._0.type,
        view._0.rootBinding,
      );
      // Echo the caller's slug; internal row provenance never crosses the
      // public wire boundary.
      const { rootBinding: _binding, ...publicView } = view._0;
      return c.json({ ...publicView, slug, fieldRegistry });
    } catch (error) {
      if (error instanceof PublicFieldRegistryBundleError && error.code === "RootTypeChanged") {
        return c.json(notFound, 404);
      }
      throw error;
    }
  }

  return c.json(notFound, 404);
});

/**
 * POST /forms/:slug/submit — submit an instance of the type.
 *
 * Submit = calling the type's function with the typed input; the Fenel-bodied
 * `types:submit` owns account-registry validation + coercion before either the
 * create-unverified-instance or behavior lane. It returns the ActionResult ADT.
 */
formRoutes.post("/:slug/submit", async (c) => {
  const slug = c.req.param("slug");
  const accountId = c.req.header("x-account-id");
  if (!accountId) return c.json({ error: "X-Account-Id required" }, 400);

  // rights C3 — gate BEFORE reading or validating the payload. `types:submit`
  // runs account-aware validation whose per-field errors describe the schema,
  // so an unpublished type must never reach it: the 404 has to precede the 422.
  const bound = await bindPublishedType(accountId, slug);
  if (!bound) return c.json(notFound, 404);

  const body = await c.req.json<{ data?: Record<string, unknown> }>();
  if (!body.data) return c.json({ error: "Missing data field" }, 400);

  // Same binding as GET: the id travels, so validation, the behavior probe and
  // the capture all key off the row this request was authorised against.
  const result = (await invokeIOActionAs(await mintLaneAuthorityFor(accountId, "forms"), null, "types:submit", {
    typeId: bound.id,
    data: body.data,
    adapter: "webapp",
  })) as
    | { $tag: "ActionOk"; data: Record<string, unknown> }
    | { $tag: "ActionErr"; message: string };
  if (result.$tag === "ActionErr") {
    // rights C3 — preserve the one-404 invariant across the POST-GATE window.
    // `types:submit` re-reads the bound row, and if it vanished between the gate
    // and the re-read (deleted, or moved account) it returns this reserved token
    // (see the note above `submit` in fenel/modules/types/submit.fenel). Without
    // this arm that case would answer 422 while the identical situation answers
    // 404 on GET — a status asymmetry on the very failure the gate exists to
    // make uniform. Everything else is a genuine validation/capture error and
    // keeps 422; the type is published by then, so its errors are public.
    //
    // Match the TOKEN, never the public wording: `ActionErr.message` is an open
    // string and the validation + capture arms both forward text they do not
    // control (a validator message, a raw backend `Error.message`). Comparing
    // against "Form not found" would let an unlucky backend error masquerade as
    // a gate failure. The public wording is produced HERE, from `notFound`.
    if (result.message === EMBED_GATE_NOT_FOUND) return c.json(notFound, 404);
    return c.json({ error: result.message }, 422);
  }
  return c.json(result.data);
});

export { formRoutes };
