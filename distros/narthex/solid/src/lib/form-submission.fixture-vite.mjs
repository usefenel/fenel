import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { defineConfig } from "../../node_modules/vite/dist/node/index.js";
import solid from "../../node_modules/@solidjs/vite-plugin/dist/esm/index.mjs";

const seams = new Set(["@fenel/engine/authoring/form-runtime", "@fenel/engine/authoring/surface",
  "~/lib/account-field-registry", "~/lib/field-renderer", "~/lib/layout-renderer"]);
const controlled = fileURLToPath(new URL("./form-submission.fixture-dependencies.tsx", import.meta.url));
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const beforeSources = new Map();
if (process.env.FENEL_FORM_BASELINE === "1") {
  const revision = process.env.SMOKE_BASELINE_REVISION ?? "HEAD";
  for (const path of ["distros/narthex/solid/src/lib/widget/FenelForm.tsx",
    "distros/narthex/solid/src/routes/p/[accountSlug]/[pageSlug].tsx"]) {
    beforeSources.set(fileURLToPath(new URL(`../../../../../${path}`, import.meta.url)).replace(/\\/g, "/"),
      execFileSync("git", ["show", `${revision}:${path}`], { cwd: repository, encoding: "utf8" }));
  }
}

// C1: compile the complete existing form hosts while controlling their domain
// preparation seams; native submit events and request/lifecycle code are real.
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [{ name: "form-submission-controlled-seams", enforce: "pre",
    resolveId(source) { if (seams.has(source)) return controlled; },
    load(id) { return beforeSources.get(id.split("?")[0].replace(/\\/g, "/")); },
  }, solid()],
  resolve: { alias: [
    { find: /^~\/lib\/(account-field-registry|field-renderer|layout-renderer)$/, replacement: controlled },
    { find: "~", replacement: fileURLToPath(new URL("../", import.meta.url)) },
  ] },
  server: { host: "127.0.0.1", port: 3110, strictPort: true },
});
