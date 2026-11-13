import type { JSX } from "@solidjs/web";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { AuthoringSession } from "../expression-runner/authoring-session";
import { assertCurrentSession, sessionEpoch } from "../browser-session";
import { DataTransferTarget } from "./DataTransferTarget";
import { classifyData, ingestTransfer, type TransferItem, type TransferSnapshot } from "./index";
import { prepareTransferItem } from "./expressions";
import { adaptTransferForSession } from "./session-analysis";
import { cloneDraftValue } from "../native-draft";

export function ExpressionTransferTarget(props: {
  node: ExprNode;
  onChange: (node: ExprNode) => void;
  session: AuthoringSession;
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  typeName?: string;
  /** A Local reader's value is evaluated in its worker (a promise). */
  readValue: () => unknown;
  resolveSavedValue?: (id: string) => TransferItem | undefined | Promise<TransferItem | undefined>;
  /** B4 wave 4 lane E: a Local reader's copy, prefetched in its worker on
   * intent (`createLocalExpressionCopy`); the page registry is never read. */
  localCopy?: { intent: () => void; copy: () => TransferItem | undefined };
  children: JSX.Element;
}) {
  async function transfer(captured: TransferSnapshot, signal: AbortSignal) {
    const epoch = sessionEpoch();
    const previous = props.node;
    const previousType = props.expectedType;
    const values = await ingestTransfer(captured, { signal, resolveSavedValue: props.resolveSavedValue });
    signal.throwIfAborted();
    assertCurrentSession(epoch);
    if (previous !== props.node || previousType !== props.expectedType) {
      throw new Error("This expression changed during import. Paste or drop again into its current slot.");
    }
    let currentValue: unknown;
    try { currentValue = await props.readValue(); } catch { /* Incomplete slots can receive a complete value. */ }
    signal.throwIfAborted();
    const result = await adaptTransferForSession(values, {
      type: props.expectedType, expectedScheme: props.expectedScheme, typeName: props.typeName,
      currentValue, session: props.session,
    }, signal);
    signal.throwIfAborted();
    if (previous !== props.node || previousType !== props.expectedType) {
      throw new Error("This expression changed during import. Paste or drop again into its current slot.");
    }
    props.onChange(result.expr);
  }

  return <DataTransferTarget label={`${props.typeName ?? "Value"} — paste or drop data`}
    hideCopy
    onTransfer={transfer} onCopyIntent={() => props.localCopy?.intent()}
    copyValue={props.node.kind === "literal" && props.node.value == null ? undefined : props.localCopy ? () => props.localCopy!.copy() : () => {
      const value = props.readValue();
      return value === undefined ? undefined : prepareTransferItem({ value: cloneDraftValue(value), type: props.expectedType,
        typeName: props.typeName ?? classifyData(value), source: "fenel" }, props.session.environment, props.session.registry);
    }}>
    {props.children}
  </DataTransferTarget>;
}
