import { onSettled, createEffect, type Component } from "solid-js";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import { fenelLanguage } from "./fenel-language";
import { parse, ParseError } from "@fenel/engine/fenel-parser";
import { inferExprType, type TypeEnv } from "@fenel/engine/fenel-check";
import type { Expression } from "@fenel/engine/types";

// Prop synchronization has its own transaction origin, preserving native edits.
const externalValue = Annotation.define<boolean>();

const fenelCompletions = (context: CompletionContext): CompletionResult | null => {
  const word = context.matchBefore(/[\w.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const keywords = [
    { label: "let", type: "keyword", info: "Bind a value" },
    { label: "if", type: "keyword", info: "Conditional" },
    { label: "then", type: "keyword", info: "Then branch" },
    { label: "else", type: "keyword", info: "Else branch" },
    { label: "case", type: "keyword", info: "Pattern match" },
    { label: "of", type: "keyword", info: "Match arms" },
    { label: "where", type: "keyword", info: "Local bindings" },
    { label: "do", type: "keyword", info: "Sequence block" },
    { label: "type", type: "keyword", info: "Type definition" },
    { label: "read", type: "function", info: "Read typed input" },
    { label: "sleep", type: "function", info: "Timer delay" },
    { label: "emit", type: "function", info: "Fire event" },
    { label: "end_function", type: "function", info: "Terminate function" },
    { label: "http_request", type: "function", info: "HTTP call" },
  ];

  const types = [
    { label: "String", type: "type" },
    { label: "Number", type: "type" },
    { label: "Boolean", type: "type" },
    { label: "List", type: "type" },
    { label: "Record", type: "type" },
    { label: "Date", type: "type" },
    { label: "File", type: "type" },
  ];

  return { from: word.from, options: [...keywords, ...types] };
};

/**
 * Linter factory — closes over an externally-supplied TypeEnv so callers
 * (e.g. FunctionSpecEditor) can bind their params into the editor's scope.
 * Defaults to an empty env when no accessor is given.
 */
function makeFenelLinter(getEnv: () => TypeEnv) {
  return linter((view) => {
    const doc = view.state.doc.toString();
    if (!doc.trim()) return [];
    const diagnostics: Diagnostic[] = [];

    try {
      const ast = parse(doc) as Expression;
      const env: TypeEnv = new Map(getEnv());
      try {
        inferExprType(ast, env);
      } catch (e) {
        if (e instanceof Error && e.message) {
          diagnostics.push({
            from: 0,
            to: Math.min(doc.length, 1),
            severity: "warning",
            message: `Type: ${e.message}`,
          });
        }
      }
    } catch (e) {
      if (e instanceof ParseError) {
        const line = Math.min(e.line, view.state.doc.lines);
        const lineObj = view.state.doc.line(line);
        diagnostics.push({
          from: lineObj.from,
          to: lineObj.to,
          severity: "error",
          message: e.message,
        });
      }
    }

    return diagnostics;
  });
}

const fenelLinter = makeFenelLinter(() => new Map());

export type FenelCodeEditorProps = {
  value: string;
  /** Document identity; changing it starts a fresh native undo/redo history. */
  documentKey?: string;
  onChange?: (value: string) => void;
  readonly?: boolean;
  class?: string;
  minHeight?: string;
  /** Soft-wrap source within the available editor width without changing it. */
  wrapLines?: boolean;
  /**
   * Externally-supplied type environment for the linter (variable name →
   * SetExpr constraint). Used by surrounding editors that want bound params
   * (FunctionSpecEditor) or upstream-flow types to resolve in the body.
   */
  typeEnv?: TypeEnv;
};

export type InlineCodeEditorProps = {
  value: string;
  /** Document identity; changing it starts a fresh native undo/redo history. */
  documentKey?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  class?: string;
};

export const InlineCodeEditor: Component<InlineCodeEditorProps> = (props) => {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;
  // Read reactive props in the tracked phase; settled setup and native editor
  // callbacks consume the captured values without creating Solid primitives.
  let current: InlineCodeEditorProps = { value: "", onChange: () => {} };
  const placeholder = new Compartment();

  createEffect(
    () => ({ value: props.value, documentKey: props.documentKey, onChange: props.onChange, placeholder: props.placeholder }),
    (next) => {
      const documentChanged = current.documentKey !== next.documentKey;
      const placeholderChanged = current.placeholder !== next.placeholder;
      current = next;
      if (!view) return;
      if (documentChanged) {
        view.setState(createState());
        return;
      }
      if (placeholderChanged) view.dispatch({ effects: placeholder.reconfigure(next.placeholder
        ? EditorView.contentAttributes.of({ "aria-placeholder": next.placeholder }) : []) });
      if (view.state.doc.toString() !== next.value) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.value },
          annotations: externalValue.of(true) });
      }
    },
  );

  const createState = () => {
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.transactions.some(transaction => transaction.docChanged && transaction.annotation(externalValue) !== true)) {
        const val = update.state.doc.toString().replace(/\n/g, " ");
        current.onChange(val);
      }
    });

    return EditorState.create({
      doc: current.value,
      extensions: [
        history(),
        bracketMatching(),
        fenelLanguage,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({ override: [fenelCompletions] }),
        keymap.of([
          ...defaultKeymap.filter((k) => k.key !== "Enter"),
          ...historyKeymap,
        ]),
        updateListener,
        EditorView.theme({
          "&": {
            fontSize: "12.5px",
            background: "#1e1e2e",
            borderRadius: "4px",
            border: "1px solid #334155",
          },
          "&.cm-focused": {
            outline: "none",
            borderColor: "#6366f1",
            boxShadow: "0 0 0 2px rgba(99, 102, 241, 0.15)",
          },
          ".cm-scroller": {
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: "12.5px",
            overflow: "hidden",
            padding: "4px 8px",
            lineHeight: "1.5",
          },
          ".cm-content": {
            padding: "0",
            minHeight: "auto",
          },
          ".cm-line": { padding: "0" },
          ".cm-gutters": { display: "none" },
          ".cm-activeLine": { backgroundColor: "transparent" },
        }),
        oneDark,
        EditorState.transactionFilter.of((tr) => {
          if (tr.newDoc.lines > 1) return [];
          return tr;
        }),
        placeholder.of(current.placeholder
          ? EditorView.contentAttributes.of({ "aria-placeholder": current.placeholder })
          : []),
      ],
    });
  };

  onSettled(() => {
    const mounted = new EditorView({ state: createState(), parent: container });
    view = mounted;
    return () => { view = undefined; mounted.destroy(); };
  });

  return <div ref={container} class={`fe-inline-code ${props.class ?? ""}`} />;
};

export const FenelCodeEditor: Component<FenelCodeEditorProps> = (props) => {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;
  // Retain one native editor while the tracked snapshot and options change.
  let current: FenelCodeEditorProps = { value: "" };
  const options = new Compartment();
  const presentation = () => [
    current.wrapLines ? EditorView.lineWrapping : [],
    EditorState.readOnly.of(!!current.readonly),
    EditorView.theme({
      "&": { minHeight: current.minHeight ?? "120px" },
      ".cm-scroller": { fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "13px" },
    }),
  ];

  createEffect(
    () => ({ value: props.value, documentKey: props.documentKey, onChange: props.onChange, readonly: props.readonly,
      wrapLines: props.wrapLines, minHeight: props.minHeight, typeEnv: props.typeEnv }),
    (next) => {
      const documentChanged = current.documentKey !== next.documentKey;
      const optionsChanged = current.readonly !== next.readonly || current.wrapLines !== next.wrapLines
        || current.minHeight !== next.minHeight;
      current = next;
      if (!view) return;
      if (documentChanged) {
        view.setState(createState());
        return;
      }
      if (optionsChanged) view.dispatch({ effects: options.reconfigure(presentation()) });
      if (view.state.doc.toString() !== next.value) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.value },
          annotations: externalValue.of(true) });
      }
    },
  );

  const createState = () => {
    const updateListener = EditorView.updateListener.of((update) => {
      if (current.onChange
        && update.transactions.some(transaction => transaction.docChanged && transaction.annotation(externalValue) !== true)) {
        current.onChange(update.state.doc.toString());
      }
    });

    return EditorState.create({
      doc: current.value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        fenelLanguage,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        autocompletion({ override: [fenelCompletions] }),
        makeFenelLinter(() => current.typeEnv ?? new Map()),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        updateListener,
        options.of(presentation()),
      ],
    });
  };

  onSettled(() => {
    const mounted = new EditorView({ state: createState(), parent: container });
    view = mounted;
    return () => { view = undefined; mounted.destroy(); };
  });

  return <div ref={container} class={props.class ?? "fenel-code-editor"} />;
};
