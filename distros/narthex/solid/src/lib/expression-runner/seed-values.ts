// B3: the original showcase expressions arrive as inert, lossless build data.
// Importing the gallery must not construct a detached registry or picker catalog.
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import snapshot from "../generated/seed-values.json";

export type SeedValue = {
  name: string;
  previousName?: string;
  description: string;
  expr: ExprNode;
  /** Exact checked build-session result, absent when inference abstains. */
  type?: FenelType;
};

if (snapshot.schema !== "fenel.seed-values.v1" || snapshot.encoding !== CHECKPOINT_VALUE_ENCODING) {
  throw new Error("The example data encoding is unavailable. Rebuild the application.");
}

export const SEED_VALUES = decodeCheckpointValue(snapshot.values, snapshot.encoding) as SeedValue[];
