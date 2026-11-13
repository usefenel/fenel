// Existing host middleware allowance: bridge document delivery through Solid
// start's broad /@ development exclusion. The browser keeps its account URL;
// the normal Home route and authorized reader still resolve its contents.
const VITE_NAMESPACES = ["/@vite", "/@id", "/@fs", "/@solidjs/vite-plugin"];

export function accountDocumentMiddleware(req, _res, next) {
  if (req.method !== "GET" || !req.headers.accept?.includes("text/html") || !req.url?.startsWith("/@")) return next();
  const pathname = req.url.split("?")[0];
  if (VITE_NAMESPACES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) return next();
  req.url = `/%40${req.url.slice(2)}`;
  return next();
}

export function accountDocumentPlugin() {
  return {
    name: "account-document-address",
    apply: /** @type {"serve"} */ ("serve"),
    configureServer(server) {
      server.middlewares.use(accountDocumentMiddleware);
    },
  };
}
