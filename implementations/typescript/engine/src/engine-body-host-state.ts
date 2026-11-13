// Internal host startup handoff. No executable imports or ambient host reads:
// compiled owners load the empty state and use ordinary Fenel computation.
// The engine root seals this once, before any engine definitions evaluate.

export type EngineBodyMemoHostServices = {
  readonly isProxy: (value: unknown) => boolean;
  readonly sha256Encoding: (encoding: string) => string;
  /** SHA-256 (hex) of bytes; optional (the digest walks then hash as text). */
  readonly sha256Bytes?: (bytes: Uint8Array) => string;
  readonly deflateKey: (bytes: Uint8Array) => Uint8Array;
  readonly inflateKey: (bytes: Uint8Array) => Uint8Array;
  readonly now: () => number;
  readonly buildFingerprint: string;
  readonly memoEnabled: () => boolean;
  readonly memoCapBytes: () => number;
};

export type EngineBodyReplayHostCapture = {
  readonly epoch?: string;
  readonly refused?: string;
  readonly text?: string;
  readonly stamp?: Readonly<Record<string, unknown>>;
  /** Host rechecks captured source bytes after the engine graph has loaded. */
  readonly verifyEpoch?: () => boolean;
};

export type EngineBodyHostState = {
  readonly memo?: EngineBodyMemoHostServices;
  readonly replay?: EngineBodyReplayHostCapture;
};

let installed: EngineBodyHostState | undefined;
let sealed = false;

/** Startup only: a late host cannot certify code that has already evaluated. */
export function installEngineBodyHostState(state: EngineBodyHostState): void {
  if (sealed || installed !== undefined) throw new Error("Engine host startup must precede the engine root exactly once.");
  installed = Object.freeze({
    ...(state.memo === undefined ? {} : { memo: Object.freeze({ ...state.memo }) }),
    ...(state.replay === undefined ? {} : { replay: Object.freeze({ ...state.replay,
      ...(state.replay.stamp === undefined ? {} : { stamp: Object.freeze({ ...state.replay.stamp }) }) }) }),
  });
}

export function sealEngineBodyHostState(): Readonly<EngineBodyHostState> {
  sealed = true;
  return installed ?? Object.freeze({});
}
