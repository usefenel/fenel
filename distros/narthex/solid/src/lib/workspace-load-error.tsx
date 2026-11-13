import { LocusLoadFailure } from "./locus-notifications";

/** Readable recovery UI shared by workspace startup and route failures. */
export function WorkspaceLoadError(props: {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  belowHomeToolbar?: boolean;
}) {
  return <LocusLoadFailure message={props.title} detail={props.message} retry={props.onRetry} retryLabel={props.retryLabel} />;
}
