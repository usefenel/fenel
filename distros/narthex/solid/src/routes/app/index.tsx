// /app remains a compatible entry to the same public/account Home as /.
// The /app/home deep-link mounts the complete authenticated workspace.
//
// Keep a local default component for the filesystem route manifest.
//
// Old stats overview moved to `/app/overview`.
import HomePage from "~/lib/home-surface";

export default function DashboardIndex() {
  return <HomePage />;
}
