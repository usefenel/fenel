import { expect, test } from "bun:test";
import type { PluginOption } from "vite";
import { accountDocumentMiddleware, accountDocumentPlugin } from "./account-document-plugin.mjs";

// C1 host transport regression: no dev server is started or restarted.
function forwarded(url: string, method = "GET", accept: string | undefined = "text/html") {
  const request = { url, method, headers: { accept } };
  let calls = 0;
  const result = accountDocumentMiddleware(request, {}, () => { calls++; return "next"; });
  expect(calls).toBe(1);
  expect(result).toBe("next");
  return request.url;
}

test("account document URLs reach the ordinary shell without changing their path or input payload", () => {
  for (const path of ["/@fenel", "/@fenel/std/reverse", "/@rom/my-data", "/@account%20name/field%2Fname?input=a%26b&input=c"]) {
    const wire = forwarded(path);
    expect(wire).toBe(`/%40${path.slice(2)}`);
    expect(decodeURIComponent(wire)).toBe(decodeURIComponent(path));
    expect(new URL(wire, "http://fenel.test").pathname.startsWith("/@")).toBe(false);
  }
  expect(forwarded("/@fenel", "GET", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe("/%40fenel");
});

test("actual Vite namespaces keep their existing delivery", () => {
  for (const path of ["/@vite/client", "/@vite/env", "/@id/virtual:solid-ssr-entry-client.tsx", "/@fs/E:/source.ts",
    "/@solidjs/vite-plugin/dev-manifest?key=one", "/@vite", "/@id", "/@fs", "/@solidjs/vite-plugin"]) {
    expect(forwarded(path)).toBe(path);
  }
  expect(forwarded("/@vite-user/data")).toBe("/%40vite-user/data");
  expect(forwarded("/@solidjs/my-data")).toBe("/%40solidjs/my-data");
});

test("only HTML document GET requests are adapted", () => {
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) expect(forwarded("/@fenel", method)).toBe("/@fenel");
  for (const accept of ["*/*", "application/json", "text/javascript", ""]) expect(forwarded("/@fenel", "GET", accept)).toBe("/@fenel");
  for (const path of ["/", "/std/reverse", "/~", "/~/one", "/%40fenel", "/api/readiness", "/api/@fenel", "/webhooks/one", "/r/one"]) {
    expect(forwarded(path)).toBe(path);
  }
  const missing = { method: "GET", headers: {} };
  expect(() => accountDocumentMiddleware(missing, {}, () => {})).not.toThrow();
});

test("the plugin installs only the existing middleware seam during development", () => {
  const installed: unknown[] = [];
  const plugin = accountDocumentPlugin();
  const configured: PluginOption = plugin;
  expect(configured).toBe(plugin);
  expect(plugin.apply).toBe("serve");
  plugin.configureServer({ middlewares: { use: (middleware: unknown) => installed.push(middleware) } });
  expect(installed).toEqual([accountDocumentMiddleware]);
});
