import { Show, createMemo } from "solid-js";
import { LocusSelect } from "./locus-select";

export type AccountDataOption = {
  /** A source selector coordinate, never authority or a local list id. */
  id: string;
  label: string;
  /** Read from the existing authorized account roster for browser addresses. */
  slug?: string;
  shared?: boolean;
  icon?: string;
};

export function accountDataIcon(option: Pick<AccountDataOption, "icon" | "shared"> | undefined): string {
  return option?.icon ?? (option?.shared ? "users" : "user");
}

/** A switch between public, tab-local and authorized account roots. Lists remain ordinary contents
 * of a root and are navigated through the data surface and breadcrumb. */
export function AccountDataSelector(props: {
  options: readonly AccountDataOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const options = createMemo(() => props.options.map((option) => ({
    value: option.id,
    label: option.label,
    icon: accountDataIcon(option),
  })));

  return <Show when={options().length > 0}>
    <LocusSelect
      label="Data source"
      tooltip="Select an account"
      value={props.value}
      options={options()}
      disabled={props.disabled || options().length < 2}
      onChange={props.onChange}
      class="account-data-selector"
    />
  </Show>;
}
