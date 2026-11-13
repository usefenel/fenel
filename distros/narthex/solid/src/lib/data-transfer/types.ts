import type { FenelType } from "@fenel/engine/types";

/** A copied value is data, never an executable ExprNode supplied by the sender. */
export type TransferItem = {
  value: unknown;
  typeName: string;
  /** Optional structural type, or the existing named entity's reference. */
  type?: FenelType;
  /** Source identities are captured on copy and rechecked by the receiver. */
  typeIdentities?: TransferTypeIdentity[];
  /** Wire metadata is never a trusted type until receiver-side verification. */
  typeCandidate?: { type: unknown; identities: TransferTypeIdentity[] };
  label?: string;
  source: "text" | "json" | "html" | "image" | "file" | "fenel";
  /** The plain representation remains available for a typed text destination. */
  text?: string;
  note?: string;
};

export type TransferTypeIdentity = { path: string; reference: string; identity?: string };

/** Capture during the paste/drop event. Browser DataTransfer stores expire. */
export type TransferSnapshot = {
  files: File[];
  text: string;
  html: string;
  internal: string;
  uriList: string;
  savedExprId?: string;
  savedExprName?: string;
};

export class TransferError extends Error {
  override name = "TransferError";
  constructor(message: string) { super(message); }
}

export const FENEL_DATA_MIME = "application/x-fenel-value+json";

export const TRANSFER_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  totalFileBytes: 20 * 1024 * 1024,
  textCharacters: 2 * 1024 * 1024,
  internalCharacters: 24 * 1024 * 1024,
  imagePixels: 1024 * 1024,
  files: 32,
  depth: 64,
  dataNodes: 6 * 1024 * 1024,
  expressionNodes: 10_000,
} as const;

export type IngestOptions = {
  signal?: AbortSignal;
  /** Rich clipboard text can be pasted as text into an existing String slot. */
  preferText?: boolean;
  /** Resolve a saved-expression drag only in the receiver's active account. */
  resolveSavedValue?: (id: string) => TransferItem | undefined | Promise<TransferItem | undefined>;
};
