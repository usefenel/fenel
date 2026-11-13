// ---------------------------------------------------------------------------
// /@:handle/:tag — receipt-link redirect with OG meta.
//
// Phase 12c-routes sub-step 3 — wrapper handles account lookup (via
// state:findAccountBySlug) + JSONB navigation of account.config.receipt_links
// (TS-side per Risk 3; dynamic-key lookup isn't in parseApp's `.` syntax
// and no std:lookup primitive exists). The receipt:findReceiptLink body
// normalises the resolved Maybe<RawLink> into a typed Maybe<ReceiptLink>.
//
// HTML formatting consumes sub-step 2's std:escapeHtml (Decision CC —
// strict superset of pre-12c-3's local escapeHtml that adds apostrophe
// escaping; same render pattern as sub-step 2's redirect.ts).
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";

type RawLink = {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
};

type AccountRow = {
  id: string;
  slug: string;
  name: string;
  config: Record<string, unknown> | null;
};

const receiptRoutes = new Hono();

async function escHtml(s: string): Promise<string> {
  return (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "std:escapeHtml", { s })) as string;
}

receiptRoutes.get("/@:handle/:tag", async (c) => {
  const handle = c.req.param("handle") ?? "";
  const tag = c.req.param("tag") ?? "";

  const accountMaybe = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "state:findAccountBySlug", {
    slug: handle,
  })) as { $tag: "Just"; _0: AccountRow } | { $tag: "Nothing" };

  if (accountMaybe.$tag === "Nothing") {
    return c.html(await notFoundPage(handle, tag), 404);
  }
  const account = accountMaybe._0;

  // JSONB navigation of account.config.receipt_links[tag] — TS-side per
  // Risk 3 (parseApp's `.` syntax handles only static keys; no std:lookup
  // primitive exists for record-by-string lookup).
  const config = account.config;
  const links = config?.["receipt_links"] as
    | Record<string, RawLink>
    | undefined;
  const rawLink = links?.[tag];

  const linkMaybe = rawLink != null
    ? {
        $tag: "Just" as const,
        _0: {
          url: rawLink.url,
          title: rawLink.title != null
            ? { $tag: "Just", _0: rawLink.title }
            : { $tag: "Nothing" },
          description: rawLink.description != null
            ? { $tag: "Just", _0: rawLink.description }
            : { $tag: "Nothing" },
          image: rawLink.image != null
            ? { $tag: "Just", _0: rawLink.image }
            : { $tag: "Nothing" },
        },
      }
    : { $tag: "Nothing" as const };

  const normalized = (await invokeIOActionAs(await mintLaneAuthorityFor(account.id, "receipt"), null, "receipt:findReceiptLink", {
    linkMaybe,
  })) as
    | {
        $tag: "Just";
        _0: {
          url: string;
          title: { $tag: "Just"; _0: string } | { $tag: "Nothing" };
          description: { $tag: "Just"; _0: string } | { $tag: "Nothing" };
          image: { $tag: "Just"; _0: string } | { $tag: "Nothing" };
        };
      }
    | { $tag: "Nothing" };

  if (normalized.$tag === "Nothing") {
    return c.html(await notFoundPage(handle, tag), 404);
  }

  const link = normalized._0;
  const title = link.title.$tag === "Just" ? link.title._0 : undefined;
  const description = link.description.$tag === "Just" ? link.description._0 : undefined;
  const image = link.image.$tag === "Just" ? link.image._0 : undefined;

  return c.html(await redirectPage(link.url, title, description, image));
});

async function redirectPage(
  url: string,
  title?: string,
  description?: string,
  image?: string,
): Promise<string> {
  const escTitle = await escHtml(title ?? "Redirecting...");
  const escTitleAttr = await escHtml(title ?? "");
  const escDesc = await escHtml(description ?? "");
  const escUrl = await escHtml(url);
  const imageMeta = image ? `<meta property="og:image" content="${await escHtml(image)}" />` : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escTitle}</title>
  <meta property="og:title" content="${escTitleAttr}" />
  <meta property="og:description" content="${escDesc}" />
  ${imageMeta}
  <meta property="og:type" content="website" />
  <meta http-equiv="refresh" content="0; url=${escUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${escUrl}">${escUrl}</a>...</p>
</body>
</html>`;
}

async function notFoundPage(handle: string, tag: string): Promise<string> {
  const escHandle = await escHtml(handle);
  const escTag = await escHtml(tag);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Not Found</title></head>
<body><p>Link @${escHandle}/${escTag} not found.</p></body>
</html>`;
}

export { receiptRoutes };
