// ---------------------------------------------------------------------------
// TermsEditor — domain-specific editor for plan terms expressions
//
// Plan terms are JSON Logic expressions that produce Term[]:
//   { type: "payment", amount: 2999, currency: "USD" }
//   { type: "grant", entitlement: "signals" }
//   { type: "revoke", entitlement: "old-signals" }
//   { type: "subscription", ... }
//
// The editor supports:
//   - Adding individual terms (payment, grant, revoke, subscription)
//   - Conditional groups (if/then/else for audience targeting)
//   - Dynamic values via variable references (profile.country, profile.tags)
//   - Produces valid JSON Logic that evaluates to Term[]
// ---------------------------------------------------------------------------

import { Show, For, createSignal, snapshot } from "solid-js";
import { LocusSelect } from "../locus-select";
import "./terms-editor.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Term = {
  type: string;
  [key: string]: unknown;
};

type TermGroup = {
  kind: "always" | "conditional";
  terms: Term[];
  // Conditional fields
  condField?: string;
  condOp?: string;
  condValue?: string;
  elseBranch?: Term[];
};

export type TermsEditorProps = {
  value: Record<string, unknown> | undefined;
  onChange: (expr: Record<string, unknown> | undefined) => void;
};

const TERM_TYPES = [
  { value: "payment", label: "Payment", icon: "$" },
  { value: "grant", label: "Grant", icon: "+" },
  { value: "revoke", label: "Revoke", icon: "-" },
  { value: "subscription", label: "Subscription", icon: "~" },
];

const COND_OPS = [
  { value: "in", label: "is in" },
  { value: "==", label: "equals" },
  { value: "!=", label: "not equals" },
  { value: ">", label: "greater than" },
  { value: "<", label: "less than" },
];

// ---------------------------------------------------------------------------
// JSON Logic <-> TermGroup conversion
// ---------------------------------------------------------------------------

function groupsToExpr(groups: TermGroup[]): Record<string, unknown> | undefined {
  if (groups.length === 0) return undefined;

  const parts: unknown[] = [];

  for (const g of groups) {
    const termsArr = g.terms.map(termToLiteral);
    if (g.kind === "conditional" && g.condField) {
      const condition = buildCondition(g.condField, g.condOp || "==", g.condValue || "");
      const elseArr = (g.elseBranch ?? []).map(termToLiteral);
      parts.push({ "if": [condition, termsArr, elseArr] });
    } else {
      parts.push(termsArr);
    }
  }

  if (parts.length === 1) {
    // Single group — snapshot
    const single = parts[0];
    if (Array.isArray(single)) return { "val": single };
    return single as Record<string, unknown>;
  }
  // Multiple groups — merge
  return { "merge": parts };
}

function buildCondition(field: string, op: string, value: string): Record<string, unknown> {
  const varRef = { "var": field };
  if (op === "in") {
    const vals = value.split(",").map((v) => v.trim()).filter(Boolean);
    return { "in": [varRef, vals] };
  }
  // Try numeric
  const num = Number(value);
  const val = value !== "" && !isNaN(num) ? num : value;
  return { [op]: [varRef, val] };
}

function termToLiteral(term: Term): Record<string, unknown> {
  const obj: Record<string, unknown> = { type: term.type };
  for (const [k, v] of Object.entries(term)) {
    if (k === "type") continue;
    if (v === "" || v === undefined) continue;
    // Check if value is a variable reference (starts with $)
    if (typeof v === "string" && v.startsWith("$")) {
      obj[k] = { "var": v.slice(1) };
    } else {
      // Auto-coerce numbers
      const num = Number(v);
      obj[k] = typeof v === "string" && v !== "" && !isNaN(num) ? num : v;
    }
  }
  return obj;
}

function exprToGroups(expr: Record<string, unknown> | undefined): TermGroup[] {
  if (!expr || Object.keys(expr).length === 0) return [];
  try {
    // { "val": [...terms] }
    if ("val" in expr && Array.isArray(expr.val)) {
      return [{ kind: "always", terms: (expr.val as Record<string, unknown>[]).map(literalToTerm) }];
    }
    // { "if": [cond, thenTerms, elseTerms] }
    if ("if" in expr && Array.isArray(expr.if)) {
      const [cond, then_, else_] = expr.if as [unknown, unknown, unknown];
      const { field, op, value } = parseCondition(cond);
      return [{
        kind: "conditional",
        terms: Array.isArray(then_) ? (then_ as Record<string, unknown>[]).map(literalToTerm) : [],
        condField: field, condOp: op, condValue: value,
        elseBranch: Array.isArray(else_) ? (else_ as Record<string, unknown>[]).map(literalToTerm) : [],
      }];
    }
    // { "merge": [...parts] }
    if ("merge" in expr && Array.isArray(expr.merge)) {
      return (expr.merge as unknown[]).map((part) => {
        if (Array.isArray(part)) {
          return { kind: "always" as const, terms: (part as Record<string, unknown>[]).map(literalToTerm) };
        }
        if (typeof part === "object" && part && "if" in part) {
          const ifExpr = part as { if: [unknown, unknown, unknown] };
          const [cond, then_, else_] = ifExpr.if;
          const { field, op, value } = parseCondition(cond);
          return {
            kind: "conditional" as const,
            terms: Array.isArray(then_) ? (then_ as Record<string, unknown>[]).map(literalToTerm) : [],
            condField: field, condOp: op, condValue: value,
            elseBranch: Array.isArray(else_) ? (else_ as Record<string, unknown>[]).map(literalToTerm) : [],
          };
        }
        return { kind: "always" as const, terms: [] };
      });
    }
    // Fallback: treat as raw
    return [];
  } catch {
    return [];
  }
}

function literalToTerm(obj: Record<string, unknown>): Term {
  const term: Term = { type: (obj.type as string) || "payment" };
  for (const [k, v] of Object.entries(obj)) {
    if (k === "type") continue;
    if (v && typeof v === "object" && "var" in (v as Record<string, unknown>)) {
      term[k] = "$" + (v as { var: string }).var;
    } else {
      term[k] = v;
    }
  }
  return term;
}

function parseCondition(cond: unknown): { field: string; op: string; value: string } {
  if (!cond || typeof cond !== "object") return { field: "", op: "==", value: "" };
  const c = cond as Record<string, unknown>;
  for (const op of ["==", "!=", ">", "<", ">=", "<="]) {
    if (op in c && Array.isArray(c[op])) {
      const [left, right] = c[op] as [unknown, unknown];
      const field = left && typeof left === "object" && "var" in (left as Record<string, unknown>)
        ? (left as { var: string }).var : "";
      return { field, op, value: String(right ?? "") };
    }
  }
  if ("in" in c && Array.isArray(c.in)) {
    const [left, right] = c.in as [unknown, unknown];
    const field = left && typeof left === "object" && "var" in (left as Record<string, unknown>)
      ? (left as { var: string }).var : "";
    const values = Array.isArray(right) ? (right as unknown[]).join(", ") : String(right ?? "");
    return { field, op: "in", value: values };
  }
  return { field: "", op: "==", value: "" };
}

// ---------------------------------------------------------------------------
// Blank term factories
// ---------------------------------------------------------------------------

function blankTerm(type: string): Term {
  switch (type) {
    case "payment": return { type: "payment", amount: "", currency: "USD" };
    case "grant": return { type: "grant", entitlement: "" };
    case "revoke": return { type: "revoke", entitlement: "" };
    case "subscription": return { type: "subscription", interval: "month", amount: "", currency: "USD" };
    default: return { type, amount: "" };
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TermRow(props: { term: Term; onChange: (t: Term) => void; onRemove: () => void }) {
  const typeInfo = () => TERM_TYPES.find((t) => t.value === props.term.type) ?? TERM_TYPES[0];

  function updateField(key: string, value: string) {
    props.onChange({ ...props.term, [key]: value });
  }

  return (
    <div class={["te-term", { [`te-term--${props.term.type}`]: true }]}>
      <div class="te-term-header">
        <span class="te-term-icon">{typeInfo().icon}</span>
        <LocusSelect
          class="te-term-type"
          label="Term type"
          value={props.term.type}
          options={TERM_TYPES}
          onChange={(value) => props.onChange(blankTerm(value))}
        />
        <button type="button" class="te-remove" onClick={props.onRemove}>&times;</button>
      </div>
      <div class="te-term-fields">
        <Show when={props.term.type === "payment" || props.term.type === "subscription"}>
          <div class="te-field">
            <label class="te-field-label">Amount (cents)</label>
            <input class="te-input" type="text" value={String(props.term.amount ?? "")}
              placeholder="2999 or $profile.discount_price"
              onInput={(e) => updateField("amount", e.currentTarget.value)} />
          </div>
          <div class="te-field te-field--sm">
            <label class="te-field-label">Currency</label>
            <input class="te-input" type="text" value={String(props.term.currency ?? "USD")}
              placeholder="USD"
              onInput={(e) => updateField("currency", e.currentTarget.value)} />
          </div>
        </Show>
        <Show when={props.term.type === "subscription"}>
          <div class="te-field te-field--sm">
            <label class="te-field-label">Interval</label>
            <LocusSelect class="te-select" label="Billing interval" value={String(props.term.interval ?? "month")}
              options={[{ value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }]}
              onChange={(value) => updateField("interval", value)} />
          </div>
        </Show>
        <Show when={props.term.type === "grant" || props.term.type === "revoke"}>
          <div class="te-field">
            <label class="te-field-label">Entitlement</label>
            <input class="te-input" type="text" value={String(props.term.entitlement ?? "")}
              placeholder="e.g. signals, vip-lounge"
              onInput={(e) => updateField("entitlement", e.currentTarget.value)} />
          </div>
        </Show>
      </div>
    </div>
  );
}

function TermGroupEditor(props: {
  group: TermGroup;
  index: number;
  onChange: (g: TermGroup) => void;
  onRemove: () => void;
}) {
  function updateTerm(i: number, t: Term) {
    const terms = [...props.group.terms];
    terms[i] = t;
    props.onChange({ ...props.group, terms });
  }
  function removeTerm(i: number) {
    props.onChange({ ...props.group, terms: props.group.terms.filter((_, idx) => idx !== i) });
  }
  function addTerm(type: string) {
    props.onChange({ ...props.group, terms: [...props.group.terms, blankTerm(type)] });
  }
  function updateElseTerm(i: number, t: Term) {
    const elseBranch = [...(props.group.elseBranch ?? [])];
    elseBranch[i] = t;
    props.onChange({ ...props.group, elseBranch });
  }
  function removeElseTerm(i: number) {
    props.onChange({ ...props.group, elseBranch: (props.group.elseBranch ?? []).filter((_, idx) => idx !== i) });
  }
  function addElseTerm(type: string) {
    props.onChange({ ...props.group, elseBranch: [...(props.group.elseBranch ?? []), blankTerm(type)] });
  }
  function toggleConditional() {
    if (props.group.kind === "always") {
      props.onChange({ ...props.group, kind: "conditional", condField: "", condOp: "==", condValue: "", elseBranch: [] });
    } else {
      props.onChange({ ...props.group, kind: "always", condField: undefined, condOp: undefined, condValue: undefined, elseBranch: undefined });
    }
  }

  return (
    <div class={["te-group", { "te-group--conditional": !!(props.group.kind === "conditional") }]}>
      <div class="te-group-header">
        <span class="te-group-label">Group #{props.index + 1}</span>
        <div class="te-group-actions">
          <button type="button"
            class={["te-cond-toggle", { "te-cond-toggle--active": !!(props.group.kind === "conditional") }]}
            onClick={toggleConditional}>
            {props.group.kind === "conditional" ? "Remove condition" : "Add condition"}
          </button>
          <button type="button" class="te-remove" onClick={props.onRemove}>&times;</button>
        </div>
      </div>

      {/* Condition row */}
      <Show when={props.group.kind === "conditional"}>
        <div class="te-condition">
          <span class="te-cond-kw">IF</span>
          <input class="te-input te-input--var" type="text"
            value={props.group.condField ?? ""}
            placeholder="profile.country"
            onInput={(e) => props.onChange({ ...props.group, condField: e.currentTarget.value })} />
          <LocusSelect class="te-select te-select--op"
            label="Condition operator"
            value={props.group.condOp ?? "=="}
            options={COND_OPS}
            onChange={(value) => props.onChange({ ...props.group, condOp: value })} />
          <input class="te-input" type="text"
            value={props.group.condValue ?? ""}
            placeholder="US, CA"
            onInput={(e) => props.onChange({ ...props.group, condValue: e.currentTarget.value })} />
        </div>
        <div class="te-branch-label">THEN</div>
      </Show>

      {/* Terms */}
      <For keyed={false} each={props.group.terms}>
        {(term, i) => (
          <TermRow term={term()} onChange={(t) => updateTerm(i, t)} onRemove={() => removeTerm(i)} />
        )}
      </For>
      <div class="te-add-row">
        <For each={TERM_TYPES}>
          {(t) => (
            <button type="button" class="te-add-btn" onClick={() => addTerm(t.value)}>
              <span class="te-add-icon">{t.icon}</span> {t.label}
            </button>
          )}
        </For>
      </div>

      {/* Else branch */}
      <Show when={props.group.kind === "conditional"}>
        <div class="te-branch-label">ELSE</div>
        <For keyed={false} each={props.group.elseBranch ?? []}>
          {(term, i) => (
            <TermRow term={term()} onChange={(t) => updateElseTerm(i, t)} onRemove={() => removeElseTerm(i)} />
          )}
        </For>
        <div class="te-add-row">
          <For each={TERM_TYPES}>
            {(t) => (
              <button type="button" class="te-add-btn" onClick={() => addElseTerm(t.value)}>
                <span class="te-add-icon">{t.icon}</span> {t.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export function TermsEditor(props: TermsEditorProps) {
  const [groups, setGroups] = createSignal<TermGroup[]>(exprToGroups(props.value));
  const [showRaw, setShowRaw] = createSignal(false);

  function emitChange(newGroups: TermGroup[]) {
    setGroups(newGroups);
    props.onChange(groupsToExpr(newGroups) ?? {});
  }

  function updateGroup(i: number, g: TermGroup) {
    const next = [...groups()];
    next[i] = g;
    emitChange(next);
  }
  function removeGroup(i: number) {
    emitChange(groups().filter((_, idx) => idx !== i));
  }
  function addGroup() {
    emitChange([...groups(), { kind: "always", terms: [blankTerm("payment")] }]);
  }

  const rawJson = () => {
    const expr = groupsToExpr(groups());
    return expr ? JSON.stringify(expr, null, 2) : "";
  };

  return (
    <div class="te-editor">
      <Show when={groups().length === 0}>
        <div class="te-empty">
          <p class="te-empty-text">No terms defined. Add a group to start building your offer.</p>
          <button type="button" class="te-add-group-btn" onClick={addGroup}>
            + Add Term Group
          </button>
        </div>
      </Show>

      <For keyed={false} each={groups()}>
        {(group, i) => (
          <TermGroupEditor
            group={group()}
            index={i}
            onChange={(g) => updateGroup(i, g)}
            onRemove={() => removeGroup(i)}
          />
        )}
      </For>

      <Show when={groups().length > 0}>
        <div class="te-footer">
          <button type="button" class="te-add-group-btn" onClick={addGroup}>
            + Add Group
          </button>
          <button type="button" class="te-raw-toggle" onClick={() => setShowRaw(!showRaw())}>
            {showRaw() ? "Hide JSON" : "Show JSON"}
          </button>
        </div>
      </Show>

      <Show when={showRaw()}>
        <pre class="te-raw">{rawJson()}</pre>
      </Show>
    </div>
  );
}
