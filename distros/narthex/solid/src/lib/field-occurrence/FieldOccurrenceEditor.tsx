import { TypeBuilder } from "~/lib/type-builder/TypeBuilder";
import {
  FieldOccurrenceEditorBase,
  type FieldOccurrenceEditorBaseProps,
} from "./FieldOccurrenceEditorBase";

export type FieldOccurrenceEditorProps = Omit<FieldOccurrenceEditorBaseProps, "renderTypeEditor">;

/** Shared field-entity/occurrence shell. TypeBuilder owns the occurrence type;
 * InstanceEditor owns UUID-keyed field facet method values. */
export function FieldOccurrenceEditor(props: FieldOccurrenceEditorProps) {
  return (
    <FieldOccurrenceEditorBase
      {...props}
      renderTypeEditor={(editor) => (
        <TypeBuilder value={editor.value} beforeChange={editor.beforeChange} onChange={editor.onChange} />
      )}
    />
  );
}
