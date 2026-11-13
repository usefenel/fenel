import { LocusSelect } from "./locus-select";
import { locusLayoutOption, type LocusLayoutChoice, type LocusLayoutOption } from "./locus-layout-options";
import "./locus-layout-control.css";

/** Choose a presentation of the current data. Its type lives with its breadcrumb. */
export function LocusLayoutControl(props: {
  kind: LocusLayoutChoice;
  options: readonly LocusLayoutOption[];
  onChange: (choice: LocusLayoutChoice) => void;
  disabled?: boolean;
}) {
  return <div class="locus-layout-control">
    <div class="locus-layout-control__choice" role="group" aria-label="Representation">
      <span class="locus-layout-control__label" aria-hidden="true">Representation</span>
      <LocusSelect
        label="Representation"
        value={props.kind}
        options={props.options}
        fallbackOption={locusLayoutOption(props.kind)}
        onChange={(choice) => props.onChange(choice as LocusLayoutChoice)}
        disabled={props.disabled || props.options.length < 2}
        minWidth="6rem"
      />
    </div>
  </div>;
}
