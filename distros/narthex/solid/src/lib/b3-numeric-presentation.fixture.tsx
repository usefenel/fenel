import { render } from "@solidjs/web";
import { VariantValueRenderer } from "./variant-value/VariantValueRenderer";
import { NumericFixtureContext, numericFixtureApi, numericFixtureScope } from "./b3-numeric-presentation.fixture-support";

// Only the surrounding test sheet is fixture JSX. Every displayed value,
// recursive child, loading state, failure and Retry button comes from the
// unchanged production renderer selected by the browser runner.
const half = { $tag: "Rational", num: 1, den: 2 };
const absentType = { $void: true } as const;
const rationalType = { $ref: "Rational" } as const;
const record = { amount: half };
const list = [half];
const scopes = {
  record: numericFixtureScope("recursive-record"),
  list: numericFixtureScope("recursive-list"),
  draft: numericFixtureScope("draft", "draft"),
  module: numericFixtureScope("module", "module"),
  failed: numericFixtureScope("failed"),
  ready: numericFixtureScope("ready"),
};

render(() => <main class="b3-numeric-sheet" style="max-width:920px;margin:28px auto;padding:0 24px;font-family:Arial,sans-serif;">
  <header style="margin-bottom:24px">
    <h1 style="font-size:22px;font-weight:600;margin:0 0 8px">Local data · nested numbers</h1>
    <p style="margin:0;color:#64748b;font-size:14px">The same data, read through its current context.</p>
  </header>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
    <section class="b3-numeric-card" data-case="recursive-record">
      <h2>Number inside a record</h2><p>Undeclared child type</p>
      <div class="b3-numeric-value"><NumericFixtureContext value={scopes.record}>
        <VariantValueRenderer type={absentType} value={record} />
      </NumericFixtureContext></div>
    </section>
    <section class="b3-numeric-card" data-case="recursive-list">
      <h2>Number inside a list</h2><p>Undeclared element type</p>
      <div class="b3-numeric-value"><NumericFixtureContext value={scopes.list}>
        <VariantValueRenderer type={absentType} value={list} />
      </NumericFixtureContext></div>
    </section>
    <section class="b3-numeric-card" data-case="draft">
      <h2>Current draft</h2><p>Draft codec reads as 2/3</p>
      <div class="b3-numeric-value"><NumericFixtureContext value={scopes.draft}>
        <VariantValueRenderer type={rationalType} value={half} />
      </NumericFixtureContext></div>
    </section>
    <section class="b3-numeric-card" data-case="module">
      <h2>Function context</h2><p>Function codec reads as 2/3</p>
      <div class="b3-numeric-value"><NumericFixtureContext value={scopes.module}>
        <VariantValueRenderer type={rationalType} value={half} />
      </NumericFixtureContext></div>
    </section>
    <section class="b3-numeric-card" data-case="failed">
      <h2>Interrupted display</h2><p>Numeric worker request failed</p>
      <div class="b3-numeric-value"><NumericFixtureContext value={scopes.failed}>
        <VariantValueRenderer type={rationalType} value={half} />
      </NumericFixtureContext></div>
    </section>
    <section class="b3-numeric-card" data-case="ready">
      <h2>Already ready</h2><p>This sibling stays visible during Retry</p>
      <div class="b3-numeric-value"><NumericFixtureContext value={scopes.ready}>
        <VariantValueRenderer type={{ $ref: "String" }} value="Ready sibling" />
      </NumericFixtureContext></div>
    </section>
  </div>
  <footer style="margin-top:22px;color:#64748b;font-size:12px">Controlled worker replies · actual recursive value renderer</footer>
</main>, document.body.appendChild(document.createElement("div")));

(globalThis as { b3NumericFixture?: typeof numericFixtureApi }).b3NumericFixture = numericFixtureApi;
