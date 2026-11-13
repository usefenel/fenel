import type { RouteSectionProps } from "@solidjs/router";
import DashboardLayout from "./app";
import HomeSurface from "~/lib/home-surface";

export default function Home(props: RouteSectionProps) {
  return (
    <DashboardLayout {...props} publicHome><HomeSurface /></DashboardLayout>
  );
}
