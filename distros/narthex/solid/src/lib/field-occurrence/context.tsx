import { createContext, createSignal, useContext, type Accessor } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { FieldOwner } from "@fenel/engine/field-identity";
import type { FieldDef } from "@fenel/engine/types";
import type { FieldFacetDrafts, ReusableFieldCandidate } from "./FieldOccurrenceEditorBase";

export type FieldAuthoringContextValue = {
  /** Reports only an explicit Add action after the canonical browser leaf
   * minted its UUID. Existing/reused fields are never reported as new. */
  onFieldCreated?: (field: FieldDef) => void;
  /** A field this surface minted itself (its own Add): new at once, without
   * waiting for the server's identity answer. */
  isMintedField?: (fieldId: string) => boolean;
  facetsByFieldId: Readonly<Record<string, FieldFacetDrafts>>;
  onFieldFacetsChange: (fieldId: string, next: FieldFacetDrafts) => void;
  /** Install persisted facet state without marking the surrounding draft
   * dirty. Editors call this only after a field-id-tagged hydration completes. */
  onFieldFacetsHydrate?: (fieldId: string, next: FieldFacetDrafts) => void;
  /** Forget client replacement authority without requesting a facet delete.
   * Liveness/tombstoning remains the server planner's decision. */
  onFieldFacetsForget: (fieldId: string) => void;
  facetInterfaceNames?: readonly string[];
  reuseCandidates?: readonly ReusableFieldCandidate[];
  /** Present only for an already-persisted owner, enabling the separate
   * owner-local tombstone catalog and explicit resurrection action. */
  ownerKey?: string;
  owner?: FieldOwner;
  resurrectFieldIds?: readonly string[];
  onFieldResurrectionChange?: (fieldId: string, active: boolean) => void;
};

export type FieldResurrectionSelection = {
  readonly fieldIds: Accessor<readonly string[]>;
  readonly onChange: (fieldId: string, active: boolean) => void;
  readonly clear: () => void;
};

/** Shared explicit-resurrection draft state for every persisted authoring
 * surface. Keeping this separate from occurrence refs preserves the planner's
 * distinction between ordinary tombstone reuse and an intentional restore. */
export function createFieldResurrectionSelection(): FieldResurrectionSelection {
  const [fieldIds, setFieldIds] = createSignal<readonly string[]>([]);
  return {
    fieldIds,
    onChange(fieldId, active) {
      setFieldIds((current) => active
        ? current.includes(fieldId) ? current : [...current, fieldId]
        : current.filter((candidate) => candidate !== fieldId));
    },
    clear() {
      setFieldIds([]);
    },
  };
}

const FieldAuthoringContext = createContext<FieldAuthoringContextValue | null>(null);

export function FieldAuthoringProvider(props: FieldAuthoringContextValue & { children: JSX.Element }) {
  return (
    <FieldAuthoringContext value={props}>
      {props.children}
    </FieldAuthoringContext>
  );
}

export function useFieldAuthoringContext(): FieldAuthoringContextValue | null {
  return useContext(FieldAuthoringContext);
}
