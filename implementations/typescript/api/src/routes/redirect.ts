// ---------------------------------------------------------------------------
// /:accountSlug/:tag — proxy-link redirect.
//
// Phase 12c-routes sub-step 2 — wrapper handles proxy-link lookup (via
// state:findProxyLinkByAccountSlugAndTag), visitor-IP hashing (via
// crypto:sha256Hex), HTML template formatting (Decision R — wrapper does
// the wire-format-stable template; std:escapeHtml is the escape primitive).
//
// Body fires the proxy_link_click appendEvent + returns typed page-data
// (proxyLinks:redirectClick).
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";

const redirectRoutes = new Hono();

async function hashVisitor(ip: string): Promise<string> {
  // visitor-IP hash via the Fenel crypto:sha256Hex primitive — same digest
  // shape as the pre-12c-2 inline createHash call, sliced to 16 hex chars
  // (the pre-existing length on the wire). The salt suffix is kept inside
  // the wrapper since it's a wrapper-level convention, not an IO primitive.
  const digest = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "crypto:sha256Hex", {
    input: ip + "fenel-proxy-v1",
  })) as string;
  return digest.slice(0, 16);
}

async function escHtml(s: string): Promise<string> {
  return (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "std:escapeHtml", { s })) as string;
}

redirectRoutes.get("/:accountSlug/:tag", async (c) => {
  const slug = c.req.param("accountSlug");
  const tag = c.req.param("tag");
  if (!slug || !tag) return c.text("Not found", 404);

  const linkMaybe = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "state:findProxyLinkByAccountSlugAndTag", {
    accountSlug: slug,
    tag,
  })) as { $tag: "Just"; _0: ProxyLinkRow } | { $tag: "Nothing" };

  if (linkMaybe.$tag === "Nothing") return c.text("Not found", 404);
  const link = linkMaybe._0;

  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  const visitorHash = await hashVisitor(ip);
  const refererHeader = c.req.header("referer");
  const referer = refererHeader != null
    ? { $tag: "Just", _0: refererHeader }
    : { $tag: "Nothing" };

  // Fire the click event + collect typed page data from the Fenel body.
  // Best-effort — failures swallowed to keep the redirect path resilient,
  // matching the pre-12c-2 .catch(() => {}) semantics.
  const pageData = (await invokeIOActionAs(await mintLaneAuthorityFor(link.accountId, "redirect"), null, "proxyLinks:redirectClick", {
    link,
    visitorHash,
    referer,
  }).catch((e) => {
    console.error("[redirect] click handler failed", e);
    return { url: link.url, title: link.title, description: link.description, image: link.image };
  })) as {
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
  };

  const title = await escHtml(pageData.title ?? pageData.url);
  const desc = await escHtml(pageData.description ?? "");
  const destUrlAttr = await escHtml(pageData.url);
  const destUrlJs = JSON.stringify(pageData.url);
  const imageMeta = pageData.image
    ? `<meta property="og:image" content="${await escHtml(pageData.image)}" />\n<meta name="twitter:image" content="${await escHtml(pageData.image)}" />`
    : "";

  return c.html(`<!DOCTYPE html>
<html><head>
<title>${title}</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:site_name" content="Fenel" />
${imageMeta}
<meta name="twitter:card" content="${pageData.image ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
</head><body>
<script>window.location.replace(${destUrlJs});</script>
<noscript><a href="${destUrlAttr}">Continue to ${title}</a></noscript>
</body></html>`);
});

type ProxyLinkRow = {
  id: string;
  accountId: string;
  tag: string;
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
};

export { redirectRoutes };
