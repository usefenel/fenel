import { Title } from "@solidjs/meta";
import { createSignal, createMemo, For, Show, onCleanup } from "solid-js";

// ============================================================================
// Types
// ============================================================================

type Group = { label: string; color: string; fill: string };
type Node = { id: string; label: string; group: string; cx: number; cy: number };
type Edge = { from: string; to: string; label?: string };

// ============================================================================
// Package Graph (mirrors docs/ARCHITECTURE.md dependency graph)
// ============================================================================

type PkgNode = {
  id: string;
  label: string;
  tech: string;
  color: string;
  fill: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  notes: string;
};

const PKG_NODES: PkgNode[] = [
  { id: "solid",   label: "distros/narthex/solid",       tech: "SolidStart · Vinxi",   color: "#2563eb", fill: "#eff6ff", cx: 180, cy: 60,  w: 230, h: 56, notes: "SPA dashboard + flow editor + public pages + embeddable widget" },
  { id: "api",     label: "implementations/typescript/api",      tech: "Hono on Bun · :3001",  color: "#059669", fill: "#ecfdf5", cx: 540, cy: 60,  w: 230, h: 56, notes: "HTTP server, route mounts, webhooks, 60s timeout tick" },
  { id: "bot",     label: "implementations/typescript/bot",      tech: "grammY · long-poll",   color: "#0891b2", fill: "#ecfeff", cx: 900, cy: 60,  w: 230, h: 56, notes: "Telegram bot. /start, /actions, callback dispatch" },
  { id: "core",    label: "implementations/typescript/core",     tech: "actions · schemas",    color: "#d97706", fill: "#fffbeb", cx: 540, cy: 200, w: 230, h: 56, notes: "Action registry + dispatch, Zod schemas, payments, email" },
  { id: "runtime", label: "implementations/typescript/runtime",  tech: "flow evaluator",       color: "#7c3aed", fill: "#f5f3ff", cx: 280, cy: 340, w: 230, h: 56, notes: "Pure turn() evaluator, IO suspend/resume, providers" },
  { id: "db",      label: "implementations/typescript/db",       tech: "Drizzle · Postgres",   color: "#475569", fill: "#f8fafc", cx: 540, cy: 340, w: 230, h: 56, notes: "Schema, queries, event store, SetExpr -> SQL compiler" },
  { id: "engine",  label: "implementations/typescript/engine",   tech: "zero-dep · universal", color: "#e11d48", fill: "#fff1f2", cx: 540, cy: 480, w: 250, h: 56, notes: "Type system, set algebra, modules, parser/printer, validation" },
];

const PKG_EDGES: { from: string; to: string; label?: string; dashed?: boolean }[] = [
  { from: "solid",   to: "api",     label: "/api proxy", dashed: true },
  { from: "solid",   to: "engine",  label: "build-time" },
  { from: "api",     to: "core" },
  { from: "api",     to: "db" },
  { from: "api",     to: "runtime" },
  { from: "api",     to: "engine" },
  { from: "bot",     to: "core" },
  { from: "core",    to: "db" },
  { from: "core",    to: "engine" },
  { from: "runtime", to: "core" },
  { from: "runtime", to: "db" },
  { from: "runtime", to: "engine" },
  { from: "db",      to: "engine" },
];

const pkgMap = new Map(PKG_NODES.map((p) => [p.id, p]));

// ============================================================================
// Entry Points (request lifecycle steps)
// ============================================================================

const ENTRY_POINTS = [
  { id: "http",    label: "HTTP request",       desc: "Browser → Hono routes → dispatch → db" },
  { id: "tg",      label: "Telegram message",   desc: "grammY long-poll → dispatch via core" },
  { id: "submit",  label: "Form submission",    desc: "Public page POST → validateForm → processEvent" },
  { id: "hook",    label: "Webhook callback",   desc: "Stripe / Calendly → dispatch + processEvent" },
  { id: "timer",   label: "Timer tick (60s)",   desc: "checkAllTimeouts() wakes suspended flow instances" },
  { id: "widget",  label: "Widget embed",       desc: "External page <script> → fetch form → submit" },
];

// ============================================================================
// Type System (FenelType + SetExpr + Modules + Capabilities + Typeclasses)
// ============================================================================

const FENEL_TYPE_VARIANTS = [
  { tag: "$void",    role: "uninhabited" },
  { tag: "$unit",    role: "single value" },
  { tag: "$ref",   role: "named primitive" },
  { tag: "$var",     role: "type variable" },
  { tag: "$record",  role: "named field set" },
  { tag: "$variant", role: "tagged union" },
  { tag: "$tuple",   role: "ordered product" },
  { tag: "$map",     role: "key -> value" },
  { tag: "$refined", role: "type + SetExpr" },
  { tag: "$mu",      role: "recursive fixed point" },
  { tag: "$tagged",  role: "phantom-tagged" },
  { tag: "$opaque",  role: "abstract / pure pair" },
  { tag: "$el",      role: "dependent type — value-as-type via Expression (incl. deferred type apps via `call`)" },
  { tag: "$type",    role: "the universe of types" },
];

const SET_EXPR_VARIANTS = [
  { tag: "SeAll",        role: "universe" },
  { tag: "SeNone",       role: "empty set" },
  { tag: "SeEnum",       role: "finite literals" },
  { tag: "SeInterval",   role: "ordered range" },
  { tag: "SeRef",        role: "registered set" },
  { tag: "SePattern",    role: "regex / template" },
  { tag: "SeWhere",      role: "JSON Logic predicate" },
  { tag: "SeCtor",       role: "constructor-shaped values" },
  { tag: "SeMu",         role: "recursive fixed point" },
  { tag: "SeArrow",      role: "function-shaped values" },
  { tag: "SeUnion",      role: "A ∪ B" },
  { tag: "SeIntersect",  role: "A ∩ B" },
  { tag: "SeDiff",       role: "A \\ B" },
  { tag: "SeComplement", role: "¬ A" },
];

const MODULES = [
  { name: "std",       desc: "75+ functions: math, string, collection, logic, date, markup", primary: true },
  { name: "control",   desc: "retry, timeout, parallel, race, for_each, par_map, while_true" },
  { name: "io",        desc: "read, sleep, end_flow, emit, http_request — IO primitives" },
  { name: "ecom",      desc: "messaging · payment · storage capabilities + providers" },
  { name: "ai",        desc: "callLLM, ai capability, anthropic + openai providers" },
  { name: "social",    desc: "Social / Conversational / Discoverable typeclasses" },
  { name: "twitter",   desc: "metrics, recent, post_reply, viral check" },
  { name: "templates", desc: "Renderable typeclass: email, sms, telegram, pdf" },
  { name: "license",   desc: "License ADT + composition algebra (MIT, GPL, RevShare…)" },
];

const CAPABILITIES = [
  { name: "messaging",     methods: "send",                          providers: "email, sms, telegram" },
  { name: "payment",       methods: "create_checkout, verify, refund", providers: "stripe, nowpayments" },
  { name: "ai",            methods: "complete, embed",               providers: "anthropic, openai" },
  { name: "Storage",       methods: "store, retrieve, delete, publicUrl", providers: "s3, r2, local" },
  { name: "Renderable",    methods: "render, mime_type, max_length", providers: "email, sms, telegram, pdf" },
  { name: "Social",        methods: "read_post, create_post, get_metrics, list_recent", providers: "twitter, telegram, instagram" },
];

const TYPECLASSES = [
  "Referenceable", "Groupable", "HasDefault", "Undefinable", "Labelable",
  "Codeable", "Describable", "Iconable", "Aliasable", "Inputable",
];

// ============================================================================
// Flow Lifecycle (state machine for flow_instances)
// ============================================================================

type StateNode = { id: string; label: string; cx: number; cy: number; color: string; terminal?: boolean };
type StateEdge = { from: string; to: string; label: string; curve?: number };

const FLOW_STATES: StateNode[] = [
  { id: "trigger",    label: "trigger",          cx: 90,  cy: 100, color: "#94a3b8" },
  { id: "running",    label: "running",          cx: 280, cy: 100, color: "#2563eb" },
  { id: "wt_timer",   label: "waiting_timer",    cx: 540, cy: 40,  color: "#d97706" },
  { id: "wt_event",   label: "waiting_event",    cx: 540, cy: 110, color: "#d97706" },
  { id: "wt_choice",  label: "awaiting_choice",  cx: 540, cy: 180, color: "#d97706" },
  { id: "completed",  label: "completed",        cx: 820, cy: 60,  color: "#059669", terminal: true },
  { id: "cancelled",  label: "cancelled",        cx: 820, cy: 130, color: "#475569", terminal: true },
  { id: "failed",     label: "failed",           cx: 820, cy: 200, color: "#dc2626", terminal: true },
];

const FLOW_EDGES: StateEdge[] = [
  { from: "trigger",   to: "running",   label: "processEvent" },
  { from: "running",   to: "wt_timer",  label: "sleep / wait" },
  { from: "running",   to: "wt_event",  label: "read(T)" },
  { from: "running",   to: "wt_choice", label: "read(choice)" },
  { from: "wt_timer",  to: "running",   label: "wakeAt elapsed" },
  { from: "wt_event",  to: "running",   label: "matched event" },
  { from: "wt_choice", to: "running",   label: "selectChoice" },
  { from: "running",   to: "completed", label: "turn() done" },
  { from: "running",   to: "failed",    label: "throw" },
  { from: "running",   to: "cancelled", label: "cancel" },
];

const flowMap = new Map(FLOW_STATES.map((s) => [s.id, s]));

// ============================================================================
// Statistics row
// ============================================================================

const STATS = [
  { label: "Packages",         value: "7",   sub: "monorepo workspaces" },
  { label: "Database tables",  value: "30+", sub: "Drizzle schemas" },
  { label: "FenelType variants", value: "16+", sub: "universal type union" },
  { label: "SetExpr variants", value: "12",  sub: "constraint algebra" },
  { label: "Engine modules",   value: "9",   sub: "std, control, io…" },
  { label: "Built-in typeclasses", value: "10", sub: "across 16+ instances" },
];

// ============================================================================
// Stack (left vertical for tabbed view)
// ============================================================================

type Layer = { id: string; label: string; tech: string; color: string; fill: string; items: string[] };

const LAYERS_TOP: Layer[] = [
  { id: "frontend", label: "Frontend", tech: "SolidJS · Vinxi", color: "#2563eb", fill: "#eff6ff", items: ["Dashboard", "Flow Editor", "Form Builder", "Expression Builder", "Field Renderer", "Layout Renderer", "Markup Editor", "ADT Builder", "Variant Value", "Widget Embed"] },
  { id: "api",      label: "API",      tech: "Hono", color: "#059669", fill: "#ecfdf5", items: ["/app/*", "/actions/:name", "/query", "/forms/:slug", "/p/:account/:page", "/r/:account/:tag", "/webhooks/stripe", "/webhooks/calendly", "/input/*"] },
  { id: "core",     label: "Core",     tech: "Business Logic", color: "#d97706", fill: "#fffbeb", items: ["Action Registry", "dispatch()", "Zod Schemas", "Payments", "Email Transport"] },
];

const LAYERS_SPLIT: Layer[] = [
  { id: "runtime", label: "Runtime", tech: "Flow Engine", color: "#7c3aed", fill: "#f5f3ff", items: ["turn() Evaluator", "IO Suspend/Resume", "processEvent()", "checkAllTimeouts()", "Span Tracing", "Provider Handlers"] },
  { id: "engine",  label: "Engine",  tech: "Type System", color: "#e11d48", fill: "#fff1f2", items: ["FenelType", "SetExpr", "9 Modules", "FenelCheck", "Parser/Printer", "Pattern Match", "Validation", "Widget Hints"] },
];

const LAYER_DB: Layer = { id: "db", label: "Database", tech: "PostgreSQL · Drizzle", color: "#475569", fill: "#f8fafc", items: ["accounts", "profiles", "items / plans", "purchases", "flow_instances", "flow_spans", "events", "entity_instances", "+22 more"] };

// ============================================================================
// Entity Model (existing, kept)
// ============================================================================

const NH = 32;
const NR = 8;
const PD = 24;
const BG_GROUPS = ["audience", "commerce", "content", "automation", "schema"];

const GROUPS: Record<string, Group> = {
  core:       { label: "Core",           color: "#4f46e5", fill: "#eef2ff" },
  audience:   { label: "Audience",       color: "#2563eb", fill: "#dbeafe" },
  commerce:   { label: "Commerce",       color: "#059669", fill: "#d1fae5" },
  content:    { label: "Content",        color: "#d97706", fill: "#fef3c7" },
  automation: { label: "Automation",     color: "#7c3aed", fill: "#ede9fe" },
  schema:     { label: "Schema",         color: "#e11d48", fill: "#ffe4e6" },
  infra:      { label: "Infrastructure", color: "#6b7280", fill: "#f3f4f6" },
};

const NODES: Node[] = [
  { id: "account",      label: "Account",         group: "core",       cx: 540,  cy: 50  },
  { id: "profile",      label: "Profile",         group: "audience",   cx: 240,  cy: 260 },
  { id: "handle",       label: "Handle",          group: "audience",   cx: 65,   cy: 175 },
  { id: "phone",        label: "Phone",           group: "audience",   cx: 65,   cy: 225 },
  { id: "tag",          label: "Tag",             group: "audience",   cx: 65,   cy: 285 },
  { id: "relationship", label: "Relationship",    group: "audience",   cx: 360,  cy: 145 },
  { id: "intent",       label: "Intent",          group: "audience",   cx: 145,  cy: 415 },
  { id: "item",         label: "Item",            group: "commerce",   cx: 700,  cy: 170 },
  { id: "plan",         label: "Plan",            group: "commerce",   cx: 870,  cy: 170 },
  { id: "inventory",    label: "Inventory",       group: "commerce",   cx: 1040, cy: 170 },
  { id: "purchase",     label: "Purchase",        group: "commerce",   cx: 870,  cy: 305 },
  { id: "paymentStep",  label: "Payment Step",    group: "commerce",   cx: 1040, cy: 305 },
  { id: "entitlement",  label: "Entitlement",     group: "commerce",   cx: 700,  cy: 305 },
  { id: "form",         label: "Form",            group: "content",    cx: 280,  cy: 535 },
  { id: "submission",   label: "Submission",      group: "content",    cx: 280,  cy: 640 },
  { id: "page",         label: "Page",            group: "content",    cx: 100,  cy: 535 },
  { id: "proxyLink",    label: "Proxy Link",      group: "content",    cx: 100,  cy: 640 },
  { id: "emailTpl",     label: "Email Template",  group: "content",    cx: 460,  cy: 640 },
  { id: "fnDef",        label: "Function Def",    group: "automation", cx: 580,  cy: 480 },
  { id: "fnInst",       label: "Function Inst",   group: "automation", cx: 580,  cy: 555 },
  { id: "trace",        label: "Trace",           group: "automation", cx: 730,  cy: 555 },
  { id: "entityDef",    label: "Entity Type",     group: "schema",     cx: 930,  cy: 480 },
  { id: "entityInst",   label: "Entity Instance", group: "schema",     cx: 930,  cy: 555 },
  { id: "view",         label: "Lens",            group: "schema",     cx: 1100, cy: 480 },
  { id: "library",      label: "Function Lib",    group: "schema",     cx: 1100, cy: 555 },
  { id: "channel",      label: "Channel",         group: "infra",      cx: 730,  cy: 640 },
  { id: "platform",     label: "Platform",        group: "infra",      cx: 85,   cy: 55  },
  { id: "integration",  label: "Integration",     group: "infra",      cx: 300,  cy: 55  },
  { id: "event",        label: "Event",           group: "infra",      cx: 460,  cy: 400 },
];

const EDGES: Edge[] = [
  { from: "account", to: "profile" },
  { from: "account", to: "item" },
  { from: "account", to: "integration", label: "configures" },
  { from: "profile", to: "handle",       label: "identified by" },
  { from: "profile", to: "phone",        label: "contacted via" },
  { from: "profile", to: "tag",          label: "classified" },
  { from: "profile", to: "intent",       label: "intends" },
  { from: "profile", to: "relationship", label: "relates" },
  { from: "profile", to: "purchase",     label: "purchases" },
  { from: "profile", to: "entitlement",  label: "granted" },
  { from: "profile", to: "fnInst",       label: "participates" },
  { from: "profile", to: "submission",   label: "submits" },
  { from: "profile", to: "event",        label: "logged" },
  { from: "item",        to: "plan",        label: "priced by" },
  { from: "item",        to: "inventory",   label: "tracked by" },
  { from: "plan",        to: "purchase",    label: "sold via" },
  { from: "purchase",    to: "paymentStep", label: "paid in" },
  { from: "purchase",    to: "entitlement", label: "grants" },
  { from: "item",        to: "entitlement", label: "unlocks" },
  { from: "form",     to: "submission", label: "collects" },
  { from: "page",     to: "form",       label: "embeds" },
  { from: "fnDef",    to: "fnInst",   label: "runs as" },
  { from: "fnInst",   to: "trace",    label: "traced by" },
  { from: "entityDef", to: "entityInst", label: "instantiated" },
  { from: "entityDef", to: "view",       label: "displayed via" },
  { from: "intent", to: "item",     label: "targets" },
  { from: "intent", to: "plan",     label: "targets" },
  { from: "handle", to: "platform", label: "on" },
  { from: "integration", to: "platform", label: "connects" },
];

// ============================================================================
// Concept Map
// ============================================================================

const CONCEPTS = [
  { fenel: "FenelFunction", is: "Durable, typed, composable function — every function in the system",
    like: "Haskell do-block · Temporal workflow · OS process" },
  { fenel: "IO functions",  is: "read(T), sleep(d), race(fns), emit, http_request — FenelFunctions whose return type is IO",
    like: "IO a · read(2) · threadDelay · Promise.race" },
  { fenel: "Expression",    is: "Universal AST — function bodies, predicates, conditions",
    like: "S-expression · Excel formula · JSON Logic" },
  { fenel: "FenelType",     is: "Universal type representation — 16-variant union",
    like: "Haskell ADT · TypeScript type · JSON Schema" },
  { fenel: "SetExpr",       is: "Constraint algebra — types ARE sets",
    like: "SQL WHERE · regex · type constraint" },
  { fenel: "Interface",     is: "Bounded polymorphism — methods dispatched by type, with instances",
    like: "Haskell typeclass · Rust trait · Java interface" },
  { fenel: "Module",        is: "Domain bundle — declares types, functions, typeclasses, instances, and runtime hooks",
    like: "Haskell module · npm package · OCaml functor" },
  { fenel: "Trace",         is: "Execution observability — reified call stack with parent-child links",
    like: "OpenTelemetry span · strace · Sentry breadcrumb" },
  { fenel: "Action",        is: "Server-side write dispatch — typed mutations from the API surface",
    like: "Redux action · OS syscall · Salesforce Apex" },
];

// ============================================================================
// Evolution Timeline
// ============================================================================

const EVOLUTION = [
  {
    color: "#7c3aed", title: "Expression Engine",
    items: [
      "Flows are Expression programs (ASTs), not step arrays",
      "Pure turn() evaluator with IO suspend/resume",
      "Flow spans — reified call stack, batch-inserted on completion",
      "FenelCheck linter — forward propagate + backward invert",
      "Fenel text syntax with parser, printer, and locale keywords (fr, es, ar)",
      "IO primitives unified: read(T), sleep(d), emit, http_request",
      "Behavioral steps eliminated — types drive behavior",
    ],
  },
  {
    color: "#e11d48", title: "Type System & Modules",
    items: [
      "FenelType: 16-variant universal union ($record, $variant, $mu, $refined…)",
      "SetExpr constraint algebra (14 canonical ADT cases) compiled to JS validation AND SQL",
      "Widget hints derived from types, not manually configured",
      "9 modules: std, control, io, ecom, twitter, social, license, template, ai",
      "Capability/provider split with priority-based resolution",
      "Custom entity types (entityDefinitions + entityInstances)",
      "Universal entity query: SetExpr -> Drizzle SQL via setExprToSQL",
    ],
  },
  {
    color: "#2563eb", title: "Visual Editor",
    items: [
      "Canvas-based function builder with FunctionStep ADT (action/wait/branch/choose/scope/call_function/set)",
      "Bidirectional Expression <-> visual step conversion",
      "Expression builder with condition trees and validation hints",
      "Form builder with FieldRenderer dispatch by FenelType tag",
      "LayoutRenderer: 12-column grid + JSON Logic visibility predicates",
      "Markup editor: dual visual + code modes for Markup ADT",
    ],
  },
  {
    color: "#d97706", title: "Foundation",
    items: [
      "Multi-tenant data model (accounts, profiles, items, plans)",
      "Commerce pipeline (purchases, entitlements, payment steps, refunds)",
      "Action dispatch system with Zod validation per action",
      "Hono API server + SolidJS dashboard",
      "Append-only events table for audit + flow triggering",
    ],
  },
];

// ============================================================================
// On the Horizon
// ============================================================================

const HORIZON = [
  { name: "Pattern matching",    desc: "match/with over ADTs, structural patterns, guards, $bind variables" },
  { name: "ADT system",          desc: "Tagged unions with constructors, $tag values, uppercase convention" },
  { name: "AI typeclasses",      desc: "Prompts as typed functions with typeclass constraints, natural language body" },
  { name: "Semantic zoom",       desc: "Same flow renders as code, visual canvas, outline, or spreadsheet" },
  { name: "Collaboration",       desc: "Real-time co-editing, suggestion mode, branch-and-merge, structural diff" },
  { name: "Localized naming",    desc: "Function names as locale strings — multilingual syntax like Excel" },
  { name: "Authentication",      desc: "Session-cookie and bearer-token account authority across private requests" },
  { name: "Per-account registry", desc: "Scope module-level singletons (dispatchRegistry, named sets) per request" },
];

// ============================================================================
// SVG helpers
// ============================================================================

function nw(label: string) {
  return Math.max(70, label.length * 8.2 + 28);
}

function borderPt(cx1: number, cy1: number, cx2: number, cy2: number, w: number, h: number) {
  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  if (dx === 0 && dy === 0) return { x: cx1, y: cy1 };
  const sx = dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx1 + dx * s, y: cy1 + dy * s };
}

const nodeMap = new Map(NODES.map((n) => [n.id, n]));

const groupBounds = BG_GROUPS.map((gid) => {
  const nodes = NODES.filter((n) => n.group === gid);
  const g = GROUPS[gid];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of nodes) {
    const w = nw(n.label);
    x1 = Math.min(x1, n.cx - w / 2);
    y1 = Math.min(y1, n.cy - NH / 2);
    x2 = Math.max(x2, n.cx + w / 2);
    y2 = Math.max(y2, n.cy + NH / 2);
  }
  return { gid, x: x1 - PD, y: y1 - PD, w: x2 - x1 + PD * 2, h: y2 - y1 + PD * 2, ...g };
});

// ============================================================================
// Sub-components
// ============================================================================

function LayerBox(props: { layer: Layer; half?: boolean; glow?: boolean }) {
  return (
    <div
      style={{
        background: props.glow ? `${props.layer.color}18` : props.layer.fill,
        border: `1.5px solid ${props.glow ? props.layer.color : `${props.layer.color}25`}`,
        "border-radius": "8px",
        padding: "0.6rem 1rem",
        flex: props.half ? "1" : undefined,
        transition: "all 0.2s ease",
        "box-shadow": props.glow ? `0 0 16px ${props.layer.color}25` : "none",
      }}
    >
      <div style={{ display: "flex", "align-items": "baseline", gap: "0.75rem", "margin-bottom": "0.3rem" }}>
        <span style={{ "font-weight": "700", "font-size": "0.88rem", color: props.layer.color }}>{props.layer.label}</span>
        <span style={{ "font-size": "0.72rem", color: "#94a3b8" }}>{props.layer.tech}</span>
      </div>
      <div style={{ display: "flex", gap: "0.35rem", "flex-wrap": "wrap" }}>
        <For each={props.layer.items}>
          {(item) => (
            <span style={{
              "font-size": "0.7rem",
              color: props.layer.color,
              background: `${props.layer.color}10`,
              padding: "1px 6px",
              "border-radius": "3px",
              "font-family": "ui-monospace, monospace",
            }}>{item}</span>
          )}
        </For>
      </div>
    </div>
  );
}

function PackageGraph(props: { hovered: () => string | null; setHovered: (id: string | null) => void }) {
  const incident = createMemo(() => {
    const id = props.hovered();
    if (!id) return null;
    const s = new Set<string>([id]);
    for (const e of PKG_EDGES) {
      if (e.from === id) s.add(e.to);
      if (e.to === id) s.add(e.from);
    }
    return s;
  });

  return (
    <svg viewBox="0 0 1080 580" style={{ width: "100%", height: "auto", display: "block", "min-width": "640px" }}>
      <defs>
        <marker id="pkg-ah" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
        </marker>
        <marker id="pkg-ah-dim" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#cbd5e1" />
        </marker>
      </defs>

      {/* Edges */}
      <For each={PKG_EDGES}>
        {(edge) => {
          const fn = pkgMap.get(edge.from)!;
          const tn = pkgMap.get(edge.to)!;
          const p1 = borderPt(fn.cx, fn.cy, tn.cx, tn.cy, fn.w, fn.h);
          const p2 = borderPt(tn.cx, tn.cy, fn.cx, fn.cy, tn.w, tn.h);
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          const active = () => {
            const inc = incident();
            return !inc || inc.has(edge.from) && inc.has(edge.to);
          };
          return (
            <g>
              <line
                x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke={active() ? "#64748b" : "#cbd5e1"}
                stroke-width={active() ? 1.6 : 0.8}
                stroke-dasharray={edge.dashed ? "5 4" : undefined}
                marker-end={`url(#${active() ? "pkg-ah" : "pkg-ah-dim"})`}
                opacity={active() ? 1 : 0.3}
              />
              <Show when={edge.label && active()}>
                <text x={mx} y={my - 5} text-anchor="middle" font-size="10" fill="#64748b" pointer-events="none"
                      style={{ background: "white" }}>
                  {edge.label}
                </text>
              </Show>
            </g>
          );
        }}
      </For>

      {/* Nodes */}
      <For each={PKG_NODES}>
        {(n) => {
          const isActive = () => {
            const inc = incident();
            return !inc || inc.has(n.id);
          };
          return (
            <g
              onMouseEnter={() => props.setHovered(n.id)}
              onMouseLeave={() => props.setHovered(null)}
              style={{ cursor: "pointer" }}
              opacity={isActive() ? 1 : 0.25}
            >
              <rect
                x={n.cx - n.w / 2} y={n.cy - n.h / 2}
                width={n.w} height={n.h} rx={10}
                fill={n.fill}
                stroke={props.hovered() === n.id ? n.color : `${n.color}80`}
                stroke-width={props.hovered() === n.id ? 2.5 : 1.5}
              />
              <text x={n.cx} y={n.cy - 4} text-anchor="middle" font-size="13" font-weight="700" fill={n.color}>
                {n.label}
              </text>
              <text x={n.cx} y={n.cy + 14} text-anchor="middle" font-size="10" fill="#64748b">
                {n.tech}
              </text>
            </g>
          );
        }}
      </For>

      {/* Hover detail */}
      <Show when={props.hovered()}>
        {(_) => {
          const n = pkgMap.get(props.hovered()!)!;
          return (
            <g>
              <rect x="20" y="540" width="1040" height="32" rx={6} fill="#f8fafc" stroke="#e2e8f0" />
              <text x="36" y="560" font-size="12" fill={n.color} font-weight="600">{n.label}</text>
              <text x={36 + n.label.length * 7.5 + 12} y="560" font-size="11" fill="#475569">{n.notes}</text>
            </g>
          );
        }}
      </Show>
    </svg>
  );
}

function FlowLifecycle() {
  return (
    <svg viewBox="0 0 950 240" style={{ width: "100%", height: "auto", display: "block", "min-width": "640px" }}>
      <defs>
        <marker id="fl-ah" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
        </marker>
      </defs>

      <For each={FLOW_EDGES}>
        {(edge) => {
          const fn = flowMap.get(edge.from)!;
          const tn = flowMap.get(edge.to)!;
          const w = 130;
          const h = 32;
          const p1 = borderPt(fn.cx, fn.cy, tn.cx, tn.cy, w, h);
          const p2 = borderPt(tn.cx, tn.cy, fn.cx, fn.cy, w, h);
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          const dy = Math.abs(p1.y - p2.y);
          const labelOffset = dy < 10 ? -8 : (p1.y < p2.y ? -6 : 6);
          return (
            <g>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#94a3b8" stroke-width="1.4" marker-end="url(#fl-ah)" />
              <text x={mx} y={my + labelOffset} text-anchor="middle" font-size="9.5" fill="#475569" pointer-events="none">
                <tspan style={{ background: "white" }}>{edge.label}</tspan>
              </text>
            </g>
          );
        }}
      </For>

      <For each={FLOW_STATES}>
        {(s) => (
          <g>
            <rect
              x={s.cx - 65} y={s.cy - 16}
              width="130" height="32"
              rx={s.terminal ? 16 : 6}
              fill={`${s.color}12`}
              stroke={s.color}
              stroke-width={s.terminal ? 2 : 1.4}
              stroke-dasharray={s.id === "trigger" ? "4 3" : undefined}
            />
            <text x={s.cx} y={s.cy + 4} text-anchor="middle" font-size="12" font-weight="600" fill={s.color}
                  font-family="ui-monospace, monospace">
              {s.label}
            </text>
          </g>
        )}
      </For>
    </svg>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AboutPage() {
  const [view, setView] = createSignal<"stack" | "deps" | "data" | "types" | "flow">("deps");
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [pkgHovered, setPkgHovered] = createSignal<string | null>(null);
  const [traceLayer, setTraceLayer] = createSignal<string | null>(null);

  const TRACE_STEPS = ["frontend", "api", "core", "runtime", "engine", "db", "engine", "runtime", "core", "api", "frontend"];

  let traceTimer: ReturnType<typeof setInterval> | undefined;
  onCleanup(() => { if (traceTimer) clearInterval(traceTimer); });

  function startTrace() {
    if (traceTimer) clearInterval(traceTimer);
    let i = 0;
    setTraceLayer(TRACE_STEPS[0]);
    traceTimer = setInterval(() => {
      i++;
      if (i >= TRACE_STEPS.length) {
        clearInterval(traceTimer!);
        traceTimer = undefined;
        setTraceLayer(null);
      } else {
        setTraceLayer(TRACE_STEPS[i]);
      }
    }, 350);
  }

  const connected = createMemo(() => {
    const id = hovered();
    if (!id) return null;
    const s = new Set<string>([id]);
    for (const e of EDGES) {
      if (e.from === id) s.add(e.to);
      if (e.to === id) s.add(e.from);
    }
    return s;
  });

  const card = { background: "white", "border-radius": "12px", padding: "1.25rem", "box-shadow": "0 1px 3px rgba(0,0,0,0.08)" } as const;
  const h2 = { margin: "2rem 0 0.75rem", "font-size": "1.15rem", "font-weight": "600", color: "#1e293b" } as const;

  function tabStyle(active: boolean) {
    return {
      padding: "0.35rem 0.9rem", "border-radius": "6px", cursor: "pointer",
      border: `1px solid ${active ? "#4f46e5" : "#e2e8f0"}`,
      background: active ? "#4f46e5" : "white",
      color: active ? "white" : "#475569",
      "font-size": "0.8rem", "font-weight": "500",
    };
  }

  const viewMeta = createMemo(() => {
    switch (view()) {
      case "stack": return "5 layers · SolidJS → Hono → Postgres";
      case "deps":  return `${PKG_NODES.length} packages · ${PKG_EDGES.length} dependency edges`;
      case "data":  return `${NODES.length} entities · ${EDGES.length} relationships`;
      case "types": return `${FENEL_TYPE_VARIANTS.length} type variants · ${SET_EXPR_VARIANTS.length} set variants · ${MODULES.length} modules`;
      case "flow":  return `${FLOW_STATES.length - 1} flow states · ${FLOW_EDGES.length} transitions`;
    }
  });

  return (
    <div style={{ padding: "1.5rem", "max-width": "1300px" }}>
      <Title>About — Fenel</Title>

      {/* Header */}
      <div style={{ "margin-bottom": "1rem" }}>
        <h1 style={{ margin: "0 0 0.3rem", "font-size": "1.5rem" }}>System Architecture</h1>
        <p style={{ color: "#64748b", margin: "0", "font-size": "0.85rem", "font-style": "italic" }}>
          A flow is a function. A form is a read. A constraint is a set. A widget is a type. Everything composes.
        </p>
      </div>

      {/* Statistics row */}
      <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem", "margin-bottom": "1.25rem" }}>
        <For each={STATS}>
          {(s) => (
            <div style={{ ...card, padding: "0.75rem 0.9rem" }}>
              <div style={{ "font-size": "0.7rem", color: "#94a3b8", "text-transform": "uppercase", "letter-spacing": "0.04em" }}>{s.label}</div>
              <div style={{ "font-size": "1.4rem", "font-weight": "700", color: "#1e293b", "line-height": "1.1", margin: "0.1rem 0" }}>{s.value}</div>
              <div style={{ "font-size": "0.7rem", color: "#64748b" }}>{s.sub}</div>
            </div>
          )}
        </For>
      </div>

      {/* View Toggle */}
      <div style={{ display: "flex", gap: "0.4rem", "margin-bottom": "1rem", "align-items": "center", "flex-wrap": "wrap" }}>
        <button style={tabStyle(view() === "deps")} onClick={() => setView("deps")}>Package Graph</button>
        <button style={tabStyle(view() === "stack")} onClick={() => setView("stack")}>Layered Stack</button>
        <button style={tabStyle(view() === "data")} onClick={() => setView("data")}>Data Model</button>
        <button style={tabStyle(view() === "types")} onClick={() => setView("types")}>Type System</button>
        <button style={tabStyle(view() === "flow")} onClick={() => setView("flow")}>Flow Lifecycle</button>
        <span style={{ color: "#94a3b8", "font-size": "0.78rem", "margin-left": "auto" }}>
          {viewMeta()}
        </span>
      </div>

      {/* ========================================================== */}
      {/* PACKAGE GRAPH                                              */}
      {/* ========================================================== */}
      <Show when={view() === "deps"}>
        <div style={{ ...card, "overflow-x": "auto" }}>
          <p style={{ margin: "0 0 0.5rem", "font-size": "0.78rem", color: "#94a3b8" }}>
            Hover a package to see its dependencies. Solid arrows are runtime imports; dashed are HTTP boundaries.
          </p>
          <PackageGraph hovered={pkgHovered} setHovered={setPkgHovered} />
          <div style={{ "margin-top": "0.5rem", "font-size": "0.72rem", color: "#94a3b8", "line-height": "1.6" }}>
            <strong style={{ color: "#e11d48" }}>engine</strong> is the foundation — zero external runtime dependencies.{" "}
            <strong style={{ color: "#475569" }}>db</strong> imports only engine + drizzle-orm + postgres.{" "}
            <strong style={{ color: "#7c3aed" }}>runtime</strong> assembles all 9 modules into a registry and registers IO handlers + provider implementations.{" "}
            Only <strong style={{ color: "#059669" }}>api</strong> depends on every backend package.{" "}
            <strong style={{ color: "#0891b2" }}>bot</strong> only touches core (action dispatch).
          </div>
        </div>
      </Show>

      {/* ========================================================== */}
      {/* LAYERED STACK                                              */}
      {/* ========================================================== */}
      <Show when={view() === "stack"}>
        <div style={card}>
          <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "0.75rem" }}>
            <span style={{ "font-size": "0.78rem", color: "#94a3b8" }}>Layers — request flows top to bottom</span>
            <button
              style={{
                padding: "0.3rem 0.7rem", "border-radius": "5px", cursor: "pointer",
                border: "1px solid #e2e8f0", background: traceLayer() ? "#f1f5f9" : "white",
                color: "#475569", "font-size": "0.75rem",
              }}
              disabled={!!traceLayer()}
              onClick={startTrace}
            >
              {traceLayer() ? "● Tracing…" : "▶ Trace a request"}
            </button>
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "3px" }}>
            <For each={LAYERS_TOP}>
              {(l) => <LayerBox layer={l} glow={traceLayer() === l.id} />}
            </For>
            <div style={{ display: "flex", gap: "3px" }}>
              <For each={LAYERS_SPLIT}>
                {(l) => <LayerBox layer={l} half glow={traceLayer() === l.id} />}
              </For>
            </div>
            <LayerBox layer={LAYER_DB} glow={traceLayer() === LAYER_DB.id} />
          </div>

          <div style={{ "margin-top": "1rem", "font-size": "0.72rem", color: "#94a3b8", "line-height": "1.6" }}>
            <strong style={{ color: "#64748b" }}>@fenel/engine</strong> is zero-dep, universal — runs browser + server.{" "}
            <strong style={{ color: "#64748b" }}>@fenel/runtime</strong> evaluates Expression programs with durable IO suspension.{" "}
            <strong style={{ color: "#64748b" }}>@fenel/core</strong> registers business actions and dispatches them.{" "}
            <strong style={{ color: "#64748b" }}>@fenel/api</strong> exposes everything via Hono routes (port 3001).{" "}
            <strong style={{ color: "#64748b" }}>@fenel/solid</strong> renders the dashboard and visual flow editor.
          </div>
        </div>
      </Show>

      {/* ========================================================== */}
      {/* DATA MODEL                                                 */}
      {/* ========================================================== */}
      <Show when={view() === "data"}>
        <div style={{ ...card, "overflow-x": "auto" }}>
          <p style={{ margin: "0 0 0.5rem", "font-size": "0.78rem", color: "#94a3b8" }}>
            Hover any entity to trace its connections. 30+ Postgres tables grouped by concern.
          </p>
          <svg
            viewBox="0 0 1200 700"
            style={{ width: "100%", height: "auto", display: "block", "min-width": "700px" }}
            font-family="system-ui, -apple-system, sans-serif"
          >
            <defs>
              <marker id="ah" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="7" markerHeight="5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
              </marker>
              <marker id="ah-dim" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="7" markerHeight="5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#cbd5e1" />
              </marker>
            </defs>

            <For each={groupBounds}>
              {(gb) => (
                <g>
                  <rect x={gb.x} y={gb.y} width={gb.w} height={gb.h} rx={12} fill={gb.fill} opacity={0.45} />
                  <text x={gb.x + 10} y={gb.y + 15} font-size="10" font-weight="600" fill={gb.color} opacity={0.7}>
                    {gb.label}
                  </text>
                </g>
              )}
            </For>

            <For each={EDGES}>
              {(edge) => {
                const fn = nodeMap.get(edge.from)!;
                const tn = nodeMap.get(edge.to)!;
                const p1 = borderPt(fn.cx, fn.cy, tn.cx, tn.cy, nw(fn.label), NH);
                const p2 = borderPt(tn.cx, tn.cy, fn.cx, fn.cy, nw(tn.label), NH);
                const mx = (p1.x + p2.x) / 2;
                const my = (p1.y + p2.y) / 2;
                const active = () => { const h = hovered(); return !h || edge.from === h || edge.to === h; };

                return (
                  <g>
                    <line
                      x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                      stroke={active() ? "#94a3b8" : "#e2e8f0"}
                      stroke-width={active() ? 1.4 : 0.7}
                      marker-end={`url(#${active() ? "ah" : "ah-dim"})`}
                      opacity={active() ? 1 : 0.2}
                    />
                    <Show when={edge.label && hovered() && active()}>
                      <text x={mx} y={my - 5} text-anchor="middle" font-size="9" fill="#475569" pointer-events="none">
                        {edge.label}
                      </text>
                    </Show>
                  </g>
                );
              }}
            </For>

            <For each={NODES}>
              {(node) => {
                const w = nw(node.label);
                const g = GROUPS[node.group];
                const nodeActive = () => { const c = connected(); return !c || c.has(node.id); };

                return (
                  <g
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: "pointer" }}
                    opacity={nodeActive() ? 1 : 0.15}
                  >
                    <rect
                      x={node.cx - w / 2} y={node.cy - NH / 2}
                      width={w} height={NH} rx={NR}
                      fill="white"
                      stroke={hovered() === node.id ? g.color : `${g.color}55`}
                      stroke-width={hovered() === node.id ? 2.5 : 1.2}
                    />
                    <text
                      x={node.cx} y={node.cy + 4.5}
                      text-anchor="middle" font-size="12" font-weight="500"
                      fill={g.color} pointer-events="none"
                    >
                      {node.label}
                    </text>
                  </g>
                );
              }}
            </For>

            <g transform="translate(10, 682)">
              <For each={Object.entries(GROUPS)}>
                {([, group], i) => (
                  <g transform={`translate(${i() * 160}, 0)`}>
                    <rect width="14" height="14" rx="3" fill="white" stroke={group.color} stroke-width="1.5" />
                    <text x="20" y="11" font-size="11" fill="#475569">{group.label}</text>
                  </g>
                )}
              </For>
            </g>
          </svg>
        </div>
      </Show>

      {/* ========================================================== */}
      {/* TYPE SYSTEM                                                */}
      {/* ========================================================== */}
      <Show when={view() === "types"}>
        <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "0.75rem" }}>
          <div style={card}>
            <div style={{ display: "flex", "align-items": "baseline", gap: "0.5rem", "margin-bottom": "0.5rem" }}>
              <h3 style={{ margin: 0, "font-size": "0.95rem", color: "#e11d48" }}>FenelType</h3>
              <span style={{ "font-size": "0.72rem", color: "#94a3b8" }}>universal type union · implementations/typescript/engine/src/types.ts:253</span>
            </div>
            <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "4px" }}>
              <For each={FENEL_TYPE_VARIANTS}>
                {(v) => (
                  <div style={{ display: "flex", "align-items": "baseline", gap: "0.5rem", padding: "3px 6px", background: "#fff1f2", "border-radius": "4px" }}>
                    <code style={{ "font-size": "0.74rem", color: "#e11d48", "font-weight": "600" }}>{v.tag}</code>
                    <span style={{ "font-size": "0.7rem", color: "#64748b" }}>{v.role}</span>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: "flex", "align-items": "baseline", gap: "0.5rem", "margin-bottom": "0.5rem" }}>
              <h3 style={{ margin: 0, "font-size": "0.95rem", color: "#7c3aed" }}>SetExpr</h3>
              <span style={{ "font-size": "0.72rem", color: "#94a3b8" }}>constraint algebra · fenel/modules/engine/set-expr-types.fenel</span>
            </div>
            <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "4px" }}>
              <For each={SET_EXPR_VARIANTS}>
                {(v) => (
                  <div style={{ display: "flex", "align-items": "baseline", gap: "0.5rem", padding: "3px 6px", background: "#f5f3ff", "border-radius": "4px" }}>
                    <code style={{ "font-size": "0.74rem", color: "#7c3aed", "font-weight": "600" }}>{v.tag}</code>
                    <span style={{ "font-size": "0.7rem", color: "#64748b" }}>{v.role}</span>
                  </div>
                )}
              </For>
            </div>
            <div style={{ "margin-top": "0.6rem", "font-size": "0.72rem", color: "#94a3b8", "line-height": "1.5" }}>
              The same SetExpr value compiles to <strong>JS validation</strong> via <code>contains()</code> AND <strong>SQL WHERE</strong> via <code>setExprToSQL()</code>.
            </div>
          </div>
        </div>

        <div style={{ ...card, "margin-top": "0.75rem" }}>
          <div style={{ display: "flex", "align-items": "baseline", gap: "0.5rem", "margin-bottom": "0.5rem" }}>
            <h3 style={{ margin: 0, "font-size": "0.95rem", color: "#2563eb" }}>Modules</h3>
            <span style={{ "font-size": "0.72rem", color: "#94a3b8" }}>9 standard · assembled into ModuleRegistry by runtime</span>
          </div>
          <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.5rem" }}>
            <For each={MODULES}>
              {(m) => (
                <div style={{
                  padding: "0.5rem 0.7rem",
                  background: m.primary ? "#eff6ff" : "#f8fafc",
                  border: `1px solid ${m.primary ? "#bfdbfe" : "#e2e8f0"}`,
                  "border-radius": "6px",
                }}>
                  <code style={{ "font-size": "0.78rem", "font-weight": "600", color: "#2563eb" }}>{m.name}</code>
                  <div style={{ "font-size": "0.72rem", color: "#475569", "margin-top": "2px" }}>{m.desc}</div>
                </div>
              )}
            </For>
          </div>
        </div>

        <div style={{ display: "grid", "grid-template-columns": "1.4fr 1fr", gap: "0.75rem", "margin-top": "0.75rem" }}>
          <div style={card}>
            <div style={{ display: "flex", "align-items": "baseline", gap: "0.5rem", "margin-bottom": "0.5rem" }}>
              <h3 style={{ margin: 0, "font-size": "0.95rem", color: "#059669" }}>Typeclasses with runtime instances</h3>
              <span style={{ "font-size": "0.72rem", color: "#94a3b8" }}>methods dispatched per provider</span>
            </div>
            <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "0.78rem" }}>
              <thead>
                <tr style={{ "border-bottom": "1.5px solid #e2e8f0" }}>
                  <th style={{ "text-align": "left", padding: "0.35rem 0.5rem", color: "#059669", "font-weight": "600" }}>Name</th>
                  <th style={{ "text-align": "left", padding: "0.35rem 0.5rem", color: "#475569", "font-weight": "600" }}>Methods</th>
                  <th style={{ "text-align": "left", padding: "0.35rem 0.5rem", color: "#475569", "font-weight": "600" }}>Providers</th>
                </tr>
              </thead>
              <tbody>
                <For each={CAPABILITIES}>
                  {(c) => (
                    <tr style={{ "border-bottom": "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.35rem 0.5rem", "font-family": "ui-monospace, monospace", "font-weight": "600", color: "#059669" }}>{c.name}</td>
                      <td style={{ padding: "0.35rem 0.5rem", color: "#1e293b", "font-size": "0.74rem" }}>{c.methods}</td>
                      <td style={{ padding: "0.35rem 0.5rem", color: "#64748b", "font-size": "0.74rem" }}>{c.providers}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>

          <div style={card}>
            <div style={{ display: "flex", "align-items": "baseline", gap: "0.5rem", "margin-bottom": "0.5rem" }}>
              <h3 style={{ margin: 0, "font-size": "0.95rem", color: "#d97706" }}>Built-in Typeclasses</h3>
              <span style={{ "font-size": "0.72rem", color: "#94a3b8" }}>builtin-classes.ts</span>
            </div>
            <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap" }}>
              <For each={TYPECLASSES}>
                {(tc) => (
                  <span style={{
                    "font-size": "0.74rem",
                    color: "#d97706",
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    padding: "2px 8px",
                    "border-radius": "4px",
                    "font-family": "ui-monospace, monospace",
                  }}>{tc}</span>
                )}
              </For>
            </div>
            <div style={{ "margin-top": "0.6rem", "font-size": "0.72rem", color: "#94a3b8", "line-height": "1.5" }}>
              16+ built-in instances tie types to display, defaults, references, and input channels.
            </div>
          </div>
        </div>
      </Show>

      {/* ========================================================== */}
      {/* FLOW LIFECYCLE                                             */}
      {/* ========================================================== */}
      <Show when={view() === "flow"}>
        <div style={{ ...card, "overflow-x": "auto" }}>
          <p style={{ margin: "0 0 0.5rem", "font-size": "0.78rem", color: "#94a3b8" }}>
            Flow instance state machine. Persistent state lives in <code>flow_instances.variables</code>; <code>turn()</code> is pure and resumable.
          </p>
          <FlowLifecycle />
          <div style={{ "margin-top": "0.75rem", display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.6rem" }}>
            <div style={{ padding: "0.55rem 0.75rem", background: "#f8fafc", "border-radius": "6px", border: "1px solid #e2e8f0" }}>
              <strong style={{ "font-size": "0.78rem", color: "#1e293b" }}>Entry points</strong>
              <ul style={{ margin: "0.25rem 0 0", "padding-left": "1.1rem", "font-size": "0.72rem", color: "#475569" }}>
                <For each={ENTRY_POINTS}>
                  {(ep) => (
                    <li style={{ "margin-bottom": "1px" }}>
                      <code style={{ color: "#2563eb" }}>{ep.label}</code> — {ep.desc}
                    </li>
                  )}
                </For>
              </ul>
            </div>
            <div style={{ padding: "0.55rem 0.75rem", background: "#f5f3ff", "border-radius": "6px", border: "1px solid #ddd6fe" }}>
              <strong style={{ "font-size": "0.78rem", color: "#1e293b" }}>What persists</strong>
              <ul style={{ margin: "0.25rem 0 0", "padding-left": "1.1rem", "font-size": "0.72rem", color: "#475569" }}>
                <li><code>_evalStack</code> — entire frame stack as JSON</li>
                <li><code>_letTarget</code> — binding name awaiting IO result</li>
                <li><code>_suspendMeta</code> — typed <code>SuspendMeta</code> variant carrying per-status payload: <code>WaitEvent</code> {`{event, filter}`} / <code>AwaitingChoice</code> {`{schema}`} / <code>WaitTimer</code> {`{wakeAt, retryReason}`} (dispatches on <code>$tag</code>)</li>
                <li><code>_timeoutAt</code> — millisecond target for event-wait timeout (unused legacy reader)</li>
              </ul>
            </div>
            <div style={{ padding: "0.55rem 0.75rem", background: "#ecfdf5", "border-radius": "6px", border: "1px solid #a7f3d0" }}>
              <strong style={{ "font-size": "0.78rem", color: "#1e293b" }}>Observability</strong>
              <ul style={{ margin: "0.25rem 0 0", "padding-left": "1.1rem", "font-size": "0.72rem", color: "#475569" }}>
                <li>Each function call emits a <code>Span</code> with parent-child links</li>
                <li>Pure call spans are <code>kind: "pure"</code>; IO spans get <code>capability</code> + <code>provider</code></li>
                <li>Batch-inserted into <code>flow_spans</code> on completion</li>
                <li>Action mutations append to <code>events</code> via <code>appendEvent()</code></li>
              </ul>
            </div>
          </div>
        </div>
      </Show>

      {/* ========================================================== */}
      {/* CONCEPT MAP                                                */}
      {/* ========================================================== */}
      <h2 style={h2}>Concept Map</h2>
      <div style={{ ...card, "overflow-x": "auto" }}>
        <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "0.82rem" }}>
          <thead>
            <tr style={{ "border-bottom": "2px solid #e2e8f0" }}>
              <th style={{ "text-align": "left", padding: "0.5rem 0.75rem", color: "#4f46e5", "font-weight": "600" }}>Fenel</th>
              <th style={{ "text-align": "left", padding: "0.5rem 0.75rem", color: "#475569", "font-weight": "600" }}>What it is</th>
              <th style={{ "text-align": "left", padding: "0.5rem 0.75rem", color: "#94a3b8", "font-weight": "600" }}>If you know…</th>
            </tr>
          </thead>
          <tbody>
            <For each={CONCEPTS}>
              {(c) => (
                <tr style={{ "border-bottom": "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.5rem 0.75rem", "font-weight": "600", "font-family": "ui-monospace, monospace", color: "#4f46e5" }}>{c.fenel}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#1e293b" }}>{c.is}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", "font-size": "0.78rem" }}>{c.like}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      {/* ========================================================== */}
      {/* EVOLUTION                                                  */}
      {/* ========================================================== */}
      <h2 style={h2}>Evolution</h2>
      <div style={card}>
        <For each={EVOLUTION}>
          {(phase, i) => (
            <div style={{
              display: "flex", gap: "1rem",
              "padding-bottom": i() < EVOLUTION.length - 1 ? "1.25rem" : "0",
              "border-left": `2px solid ${phase.color}22`,
              "margin-left": "0.5rem",
              "padding-left": "1.25rem",
              position: "relative",
            }}>
              <div style={{
                position: "absolute", left: "-6px", top: "2px",
                width: "10px", height: "10px", "border-radius": "50%",
                background: phase.color,
              }} />
              <div>
                <div style={{ "font-weight": "600", color: "#1e293b", "font-size": "0.9rem", "margin-bottom": "0.3rem" }}>
                  {phase.title}
                </div>
                <ul style={{ margin: "0", "padding-left": "1.2rem", "font-size": "0.78rem", color: "#475569", "line-height": "1.7" }}>
                  <For each={phase.items}>{(item) => <li>{item}</li>}</For>
                </ul>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* ========================================================== */}
      {/* ON THE HORIZON                                             */}
      {/* ========================================================== */}
      <h2 style={h2}>On the Horizon</h2>
      <div style={card}>
        <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(250px, 1fr))", gap: "0.75rem" }}>
          <For each={HORIZON}>
            {(h) => (
              <div style={{ padding: "0.6rem 0.75rem", background: "#f8fafc", "border-radius": "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ "font-weight": "600", "font-size": "0.85rem", color: "#1e293b", "margin-bottom": "0.15rem" }}>{h.name}</div>
                <div style={{ "font-size": "0.75rem", color: "#64748b" }}>{h.desc}</div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div style={{ height: "2rem" }} />
    </div>
  );
}
