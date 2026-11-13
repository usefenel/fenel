// ---------------------------------------------------------------------------
// /app/audit — engine health dashboard.
//
// Surfaces the same checks the CI script (audit-effects.ts) runs:
//   - Spec-record law violations (Phase 10a-5b — replaces the legacy
//     Interface.laws walk over registered instances)
//   - Functions whose body uses effects without declaring them
//
// Read-only view. Run an audit of the live engine state, render
// findings. Quiet-success rendering when the engine is clean.
// ---------------------------------------------------------------------------

import { Title } from "@solidjs/meta";
import { createMemo, createSignal, For, Show, snapshot } from "solid-js";
import {
  validateSpecRecord,
  findUndeclaredRequires,
  type Constraint,
  type SpecValidationError,
  type FenelType,
} from "@fenel/engine";
import {
  dispatchRegistry,
  specEntities,
  interfaceCodeNameToName,
} from "@fenel/engine/system-entities";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { GLOBAL_ONLY, instanceVisible } from "@fenel/engine";

type LawViolation = {
  specId: string;
  className: string;
  target: unknown;
  field: string;
  reason: string;
};
type UndeclaredEntry = { fnId: string; constraints: Constraint[] };

function buildReport(): {
  lawViolations: LawViolation[];
  undeclared: UndeclaredEntry[];
} {
  const moduleRegistry = getSystemRegistry();
  const lookup = (name: string) => moduleRegistry.getFunction(name);

  const lawViolations: LawViolation[] = [];
  for (const specEntity of specEntities) {
    const className = interfaceCodeNameToName.get(specEntity.id);
    if (!className) continue;
    if (!specEntity.type) continue;
    // rights R3a — GLOBAL_ONLY, DECLARED (§8.1b). The audit page validates the
    // REPOSITORY's registered instances against their class records; an
    // account-authored instance appearing in every account's audit was the leak.
    const instances = dispatchRegistry.listInstances(className)
      .filter((instance) => instanceVisible(instance, GLOBAL_ONLY));
    for (const instance of instances) {
      const methods = instance.methods as Record<string, unknown>;
      const errs: SpecValidationError[] = validateSpecRecord(
        specEntity.type as FenelType,
        methods,
      );
      if (errs.length === 0) continue;
      for (const e of errs) {
        lawViolations.push({
          specId: specEntity.id,
          className,
          target: instance.args[0],
          field: e.field,
          reason: e.reason,
        });
      }
    }
  }

  const byFn = new Map<string, Constraint[]>();
  for (const fn of moduleRegistry.listFunctions()) {
    const missing = findUndeclaredRequires(fn, lookup);
    if (missing.length > 0) {
      byFn.set(fn.id, missing);
    }
  }
  const undeclared: UndeclaredEntry[] = Array.from(byFn.entries()).map(
    ([fnId, constraints]) => ({ fnId, constraints }),
  );

  return { lawViolations, undeclared };
}

export default function AuditPage() {
  const [revision, setRevision] = createSignal(0);
  const report = createMemo(() => {
    void revision();
    return buildReport();
  });
  const isClean = createMemo(
    () =>
      report().lawViolations.length === 0 && report().undeclared.length === 0,
  );

  return (
    <>
      <Title>Engine audit · Fenel</Title>
      <div class="audit-page">
        <header class="audit-page__head">
          <h1>Engine audit</h1>
          <button
            type="button"
            class="btn"
            onClick={() => setRevision((r) => r + 1)}
          >
            Re-run
          </button>
        </header>
        <p class="text-muted" style="font-size: 0.85rem">
          Same checks as <code>audit-effects --ci</code>: spec-record law
          violations + functions using effects without declaring them. Live
          snapshot of the in-process engine state.
        </p>

        <Show when={isClean()}>
          <div class="audit-page__clean">
            <div class="audit-page__clean-icon">✓</div>
            <div class="audit-page__clean-msg">
              <strong>All checks pass.</strong>
              <div class="text-muted" style="font-size: 0.85rem">
                {report().lawViolations.length} spec-law violations,{" "}
                {report().undeclared.length} undeclared-requires.
              </div>
            </div>
          </div>
        </Show>

        <Show when={report().lawViolations.length > 0}>
          <section class="audit-page__section">
            <h2>Spec-record law violations ({report().lawViolations.length})</h2>
            <table class="audit-page__table">
              <thead>
                <tr>
                  <th>Spec</th>
                  <th>Target</th>
                  <th>Field</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                <For each={report().lawViolations}>
                  {(v) => (
                    <tr>
                      <td class="mono">{v.specId}</td>
                      <td class="mono">{String(v.target)}</td>
                      <td class="mono">{v.field}</td>
                      <td>{v.reason}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </section>
        </Show>

        <Show when={report().undeclared.length > 0}>
          <section class="audit-page__section">
            <h2>
              Functions with undeclared transitive requires (
              {report().undeclared.length})
            </h2>
            <p class="text-muted" style="font-size: 0.78rem">
              These functions call other functions whose `requires` they
              don't propagate to their own signature. Phase 5.2 will turn
              these into hard type errors at registration; informational
              only today.
            </p>
            <table class="audit-page__table">
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Missing constraints</th>
                </tr>
              </thead>
              <tbody>
                <For each={report().undeclared}>
                  {(u) => (
                    <tr>
                      <td class="mono">{u.fnId}</td>
                      <td>
                        <For each={u.constraints}>
                          {(c) => (
                            <div class="mono" style="font-size: 0.78rem">
                              {c.class.entityId} :: {JSON.stringify(c.args)}
                            </div>
                          )}
                        </For>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </section>
        </Show>

      </div>
    </>
  );
}
