import type { TransferSnapshot } from "./types";

/** Menus invoke the same target as keyboard paste/drop, including nested fields. */
export type TransferCommands = {
  canCopy: () => boolean;
  canPaste: () => boolean;
  copy: () => Promise<void>;
  paste: (snapshot: TransferSnapshot) => Promise<void>;
};

const targets = new WeakMap<Element, TransferCommands>();

export function registerTransferCommands(element: Element, commands: TransferCommands): () => void {
  targets.set(element, commands);
  return () => { targets.delete(element); };
}

export function transferCommandsFor(element: Element | null): TransferCommands | undefined {
  const target = element?.closest("[data-fenel-transfer-target]");
  return target ? targets.get(target) : undefined;
}
