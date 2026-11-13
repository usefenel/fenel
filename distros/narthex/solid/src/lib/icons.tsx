// Inline SVG icons — Tabler-style, stroke-based, no external dependencies.
// Each icon is a simple SolidJS component returning an <svg>.
import { Dynamic, type JSX } from "@solidjs/web";
import { createMemo, Show } from "solid-js";
import typeIconFallbacks from "./type-icon-fallbacks.json";


type IconProps = {
  size?: number;
  class?: string;
  style?: JSX.CSSProperties;
};

function I(props: IconProps & { d: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      style={props.style}
    >
      <path d={props.d} />
    </svg>
  );
}

// Multi-path variant
function IM(props: IconProps & { paths: string[] }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      style={props.style}
    >
      {props.paths.map((d) => <path d={d} />)}
    </svg>
  );
}

// ---- Sidebar icons ----

export function IconLayoutDashboard(p: IconProps) {
  return <IM {...p} paths={[
    "M4 4h6v8H4z", "M14 4h6v6h-6z", "M14 14h6v6h-6z", "M4 16h6v4H4z"
  ]} />;
}

export function IconLayoutGrid(p: IconProps) {
  return <IM {...p} paths={["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h7v7h-7z"]} />;
}

export function IconLayoutCanvas(p: IconProps) {
  return <IM {...p} paths={["M3 3h18v18H3z", "M6 6h5v4H6z", "M13 8h5v6h-5z", "M7 13h4v5H7z"]} />;
}

export function IconGripVertical(p: IconProps) {
  return <IM {...p} paths={["M9 5h.01", "M15 5h.01", "M9 12h.01", "M15 12h.01", "M9 19h.01", "M15 19h.01"]} />;
}

export function IconTable(p: IconProps) {
  return <IM {...p} paths={["M3 3h18v18H3z", "M3 9h18", "M3 15h18", "M12 3v18"]} />;
}

export function IconListDetails(p: IconProps) {
  return <IM {...p} paths={[
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M7 8h2", "M13 8h4", "M7 12h2", "M13 12h4", "M7 16h2", "M13 16h4",
  ]} />;
}

export function IconPanelsTopLeft(p: IconProps) {
  return <IM {...p} paths={["M3 7h18v14H3z", "M3 7V3h7v4", "M10 4h5v3", "M15 5h6v2"]} />;
}

export function IconUsers(p: IconProps) {
  return <IM {...p} paths={[
    "M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
    "M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
    "M16 3.13a4 4 0 0 1 0 7.75", "M21 21v-2a4 4 0 0 0-3-3.85"
  ]} />;
}

export function IconFolder(p: IconProps) {
  return <I {...p} d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />;
}

export function IconActivity(p: IconProps) {
  return <I {...p} d="M3 12h4l3-9l4 18l3-9h4" />;
}

export function IconPackage(p: IconProps) {
  return <IM {...p} paths={[
    "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z",
    "M12 12l8-4.5", "M12 12v9", "M12 12L4 7.5"
  ]} />;
}

export function IconReceipt(p: IconProps) {
  return <IM {...p} paths={[
    "M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-2l-2 2l-2-2l-2 2l-2-2l-3 2z",
    "M9 7h6", "M9 11h6", "M9 15h4"
  ]} />;
}

export function IconShoppingCart(p: IconProps) {
  return <IM {...p} paths={[
    "M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    "M17 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    "M17 17H6V3H4"
  ]} />;
}

export function IconArchive(p: IconProps) {
  return <IM {...p} paths={[
    "M3 4m0 2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8",
    "M10 12h4"
  ]} />;
}

export function IconClipboard(p: IconProps) {
  return <IM {...p} paths={[
    "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2",
    "M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"
  ]} />;
}

export function IconLink(p: IconProps) {
  return <IM {...p} paths={[
    "M9 15l6-6",
    "M11 6l.463-.536a5 5 0 0 1 7.071 7.072L18 13",
    "M13 18l-.397.534a5.068 5.068 0 0 1-7.127 0a4.972 4.972 0 0 1 0-7.071L6 11"
  ]} />;
}

export function IconPhone(p: IconProps) {
  return <IM {...p} paths={[
    "M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  ]} />;
}

export function IconUser(p: IconProps) {
  return <IM {...p} paths={[
    "M12 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
    "M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
  ]} />;
}

export function IconCircleCheck(p: IconProps) {
  return <IM {...p} paths={[
    "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M9 12l2 2l4-4",
  ]} />;
}

export function IconCheck(p: IconProps) {
  return <I {...p} d="M5 12l4 4L19 6" />;
}

export function IconCircleX(p: IconProps) {
  return <IM {...p} paths={[
    "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M10 10l4 4m0-4l-4 4",
  ]} />;
}

export function IconMail(p: IconProps) {
  return <IM {...p} paths={[
    "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
    "M3 7l9 6l9-6"
  ]} />;
}

export function IconRoute(p: IconProps) {
  return <IM {...p} paths={[
    "M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    "M18 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    "M12 19H7a2 2 0 0 1 0-4h10a2 2 0 0 0 0-4H7a2 2 0 0 1 0-4h5"
  ]} />;
}

export function IconPlugConnected(p: IconProps) {
  return <IM {...p} paths={[
    "M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1-5-5L7 12z",
    "M17 12l-5-5l1.5-1.5a3.536 3.536 0 1 1 5 5L17 12z",
    "M3 21l2.5-2.5", "M18.5 5.5L21 3",
    "M10 11l-2 2", "M13 14l-2 2"
  ]} />;
}

export function IconSettings(p: IconProps) {
  return <IM {...p} paths={[
    "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065z",
    "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0"
  ]} />;
}

export function IconInfoCircle(p: IconProps) {
  return <IM {...p} paths={[
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M12 9h.01", "M11 12h1v4h1"
  ]} />;
}

export function IconBrandTelegram(p: IconProps) {
  return <I {...p} d="M15 10l-4 4l6 6l4-16l-18 7l4 2l2 6l3-4" />;
}

export function IconStack(p: IconProps) {
  return <IM {...p} paths={[
    "M12 2l-8 4l8 4l8-4l-8-4z",
    "M4 10l8 4l8-4",
    "M4 14l8 4l8-4",
  ]} />;
}

export function IconLogout(p: IconProps) {
  return <IM {...p} paths={[
    "M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2",
    "M9 12h12l-3 -3",
    "M18 15l3 -3",
  ]} />;
}

// ---- UI icons ----

export function IconMenu2(p: IconProps) {
  return <IM {...p} paths={["M4 6h16", "M4 12h16", "M4 18h16"]} />;
}

export function IconEllipsis(p: IconProps) {
  return <IM {...p} paths={["M5 12h.01", "M12 12h.01", "M19 12h.01"]} />;
}

export function IconX(p: IconProps) {
  return <IM {...p} paths={["M18 6L6 18", "M6 6l12 12"]} />;
}

export function IconPlus(p: IconProps) {
  return <IM {...p} paths={["M12 5v14", "M5 12h14"]} />;
}

export function IconTrash(p: IconProps) {
  return <IM {...p} paths={[
    "M4 7h16", "M10 11v6", "M14 11v6",
    "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12",
    "M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
  ]} />;
}

export function IconChevronDown(p: IconProps) {
  return <I {...p} d="M6 9l6 6l6-6" />;
}

// ---- Step type icons ----

export function IconBolt(p: IconProps) {
  return <I {...p} d="M13 3L4 14h7l-2 7l9-11h-7l2-7z" />;
}

export function IconClock(p: IconProps) {
  return <IM {...p} paths={[
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M12 7v5l3 3"
  ]} />;
}

export function IconBell(p: IconProps) {
  return <IM {...p} paths={[
    "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6",
    "M9 17v1a3 3 0 0 0 6 0v-1"
  ]} />;
}

export function IconCalendar(p: IconProps) {
  return <IM {...p} paths={[
    "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z",
    "M16 3v4", "M8 3v4", "M4 11h16",
    "M11 15h1", "M12 15v3"
  ]} />;
}

export function IconGitBranch(p: IconProps) {
  return <IM {...p} paths={[
    "M6 3v12", "M18 9a3 3 0 1 0 0 6",
    "M6 15a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h3"
  ]} />;
}

export function IconLightbulb(p: IconProps) {
  return <IM {...p} paths={[
    "M3 12h1", "M12 3v1", "M20 12h1", "M5.6 5.6l.7 .7", "M18.4 5.6l-.7 .7",
    "M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3",
    "M9.7 17h4.6",
  ]} />;
}

export function IconWorkflow(p: IconProps) {
  return <IM {...p} paths={[
    "M3 3h6v6H3z", "M15 15h6v6h-6z", "M6 9v6a3 3 0 0 0 3 3h6",
    "M9 6h6a3 3 0 0 1 3 3v6",
  ]} />;
}

export function IconFunction(p: IconProps) {
  return <IM {...p} paths={["M17 4h-2a3 3 0 0 0-3 3l-2 10a3 3 0 0 1-3 3H5", "M8 10h8"]} />;
}

/** Recipe's Iconable name. The type instance is `@icon "utensils"`; this map only draws it. */
export function IconUtensils(p: IconProps) {
  return <IM {...p} paths={[
    "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2",
    "M7 2v20",
    "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7",
  ]} />;
}

export function IconListCheck(p: IconProps) {
  return <IM {...p} paths={[
    "M3.5 5.5l1.5 1.5l2.5-2.5",
    "M3.5 11.5l1.5 1.5l2.5-2.5",
    "M3.5 17.5l1.5 1.5l2.5-2.5",
    "M11 6h9", "M11 12h9", "M11 18h9"
  ]} />;
}

export function IconPlayerPlay(p: IconProps) {
  return <I {...p} d="M7 4v16l13-8z" />;
}

export function IconBinaryTree(p: IconProps) {
  return <IM {...p} paths={[
    "M6 20a2 2 0 1 0 0-4a2 2 0 0 0 0 4z",
    "M18 20a2 2 0 1 0 0-4a2 2 0 0 0 0 4z",
    "M12 10a2 2 0 1 0 0-4a2 2 0 0 0 0 4z",
    "M12 10v2", "M12 12l-6 4", "M12 12l6 4",
  ]} />;
}

export function IconList(p: IconProps) {
  return <IM {...p} paths={[
    "M9 6h11", "M9 12h11", "M9 18h11",
    "M5 6v.01", "M5 12v.01", "M5 18v.01",
  ]} />;
}

export function IconChevronRight(p: IconProps) {
  return <I {...p} d="M9 6l6 6l-6 6" />;
}

export function IconCode(p: IconProps) {
  return <IM {...p} paths={["M7 8l-4 4l4 4", "M17 8l4 4l-4 4", "M14 4l-4 16"]} />;
}

export function IconRepeat(p: IconProps) {
  return <IM {...p} paths={[
    "M4 12V9a3 3 0 0 1 3-3h13",
    "M17 10l3-4l-3-4",
    "M20 12v3a3 3 0 0 1-3 3H4",
    "M7 14l-3 4l3 4",
  ]} />;
}

export function IconAlertTriangle(p: IconProps) {
  return <IM {...p} paths={[
    "M12 9v4",
    "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87L13.637 3.59a1.914 1.914 0 0 0-3.274 0z",
    "M12 16h.01",
  ]} />;
}

export function IconVariable(p: IconProps) {
  return <IM {...p} paths={[
    "M5 4l-2 16", "M19 4l2 16",
    "M7 12h10",
    "M9.5 8l-1 8", "M14.5 8l1 8",
  ]} />;
}

export function IconBraces(p: IconProps) {
  return <IM {...p} paths={[
    "M7 4a2 2 0 0 0-2 2v3a2 3 0 0 1-2 3a2 3 0 0 1 2 3v3a2 2 0 0 0 2 2",
    "M17 4a2 2 0 0 1 2 2v3a2 3 0 0 0 2 3a2 3 0 0 0-2 3v3a2 2 0 0 1-2 2",
  ]} />;
}

// ---- Action / event specific icons ----

export function IconMessage(p: IconProps) {
  return <I {...p} d="M4 21v-13a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8l-4 4z" />;
}

export function IconUserPlus(p: IconProps) {
  return <IM {...p} paths={[
    "M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
    "M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
    "M16 11h6", "M19 8v6",
  ]} />;
}

export function IconUserCheck(p: IconProps) {
  return <IM {...p} paths={[
    "M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
    "M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
    "M16 11l2 2l4-4",
  ]} />;
}

export function IconShieldCheck(p: IconProps) {
  return <IM {...p} paths={[
    "M9 12l2 2l4-4",
    "M12 3a12 12 0 0 0 8.5 3A12 12 0 0 1 12 21A12 12 0 0 1 3.5 6A12 12 0 0 0 12 3",
  ]} />;
}

export function IconShieldOff(p: IconProps) {
  return <IM {...p} paths={[
    "M17.2 7A12 12 0 0 0 20.5 6A12 12 0 0 1 12 21A12 12 0 0 1 3.5 6a12 12 0 0 0 1.3.5",
    "M3 3l18 18",
  ]} />;
}

export function IconTag(p: IconProps) {
  return <IM {...p} paths={[
    "M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
    "M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592-5.592a2.41 2.41 0 0 0 0-3.408l-7.71-7.71A2 2 0 0 0 11.172 3H6a3 3 0 0 0-3 3z",
  ]} />;
}

export function IconTagOff(p: IconProps) {
  return <IM {...p} paths={[
    "M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
    "M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592-5.592a2.41 2.41 0 0 0 0-3.408l-7.71-7.71A2 2 0 0 0 11.172 3H6a3 3 0 0 0-3 3z",
    "M3 3l18 18",
  ]} />;
}

export function IconWorld(p: IconProps) {
  return <IM {...p} paths={[
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M3.6 9h16.8", "M3.6 15h16.8",
    "M11.5 3a17 17 0 0 0 0 18", "M12.5 3a17 17 0 0 1 0 18",
  ]} />;
}

/** A connection that is not there: the server stopped, or the network dropped. */
export function IconWifiOff(p: IconProps) {
  return <IM {...p} paths={[
    "M12 18.5h.01",
    "M9.2 15.4a4 4 0 0 1 5.6 0",
    "M6.1 12.2a8.5 8.5 0 0 1 2.6-1.6",
    "M18.4 12.6a8.5 8.5 0 0 0-2.4-1.6",
    "M4 4l16 16",
  ]} />;
}

export function IconFileText(p: IconProps) {
  return <IM {...p} paths={[
    "M14 3v4a1 1 0 0 0 1 1h4",
    "M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z",
    "M9 9h1", "M9 13h6", "M9 17h6",
  ]} />;
}

export function IconArrowRight(p: IconProps) {
  return <IM {...p} paths={["M5 12h14", "M12 5l7 7-7 7"]} />;
}
export function IconArrowDown(p: IconProps) {
  return <IM {...p} paths={["M12 5v14", "M19 12l-7 7-7-7"]} />;
}
export function IconArrowUp(p: IconProps) {
  return <IM {...p} paths={["M12 19V5", "M5 12l7-7 7 7"]} />;
}
/** A box with an arrow leaving it: open elsewhere (a new tab). */
export function IconExternalLink(p: IconProps) {
  return <IM {...p} paths={["M15 3h6v6", "M10 14L21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"]} />;
}

export function IconMaximize(p: IconProps) {
  return <IM {...p} paths={["M8 3H3v5", "M16 3h5v5", "M21 16v5h-5", "M3 16v5h5"]} />;
}

export function IconMinimize(p: IconProps) {
  return <IM {...p} paths={["M8 3v5H3", "M16 3v5h5", "M21 16h-5v5", "M3 16h5v5"]} />;
}
/** A window with its title bar: a new browser window. */
export function IconAppWindow(p: IconProps) {
  return <IM {...p} paths={["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M2 9h20", "M6 6.5h.01", "M9 6.5h.01"]} />;
}
/** Two opposite arrows: one of two alternatives (Either). */
export function IconArrowsLeftRight(p: IconProps) {
  return <IM {...p} paths={["M21 17H3", "M6 14l-3 3 3 3", "M3 7h18", "M18 4l3 3-3 3"]} />;
}
export function IconArrowLeft(p: IconProps) {
  return <IM {...p} paths={["M19 12H5", "M12 19l-7-7 7-7"]} />;
}

export function IconPencil(p: IconProps) {
  return <IM {...p} paths={[
    "M4 20h4l10.5-10.5a2.828 2.828 0 1 0-4-4L4 16v4z",
    "M13.5 6.5l4 4",
  ]} />;
}

// Behavioral flow node icons
export function IconEye(p: IconProps) {
  return <IM {...p} paths={[
    "M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
    "M21 12c-2.4 4-5.4 6-9 6c-3.6 0-6.6-2-9-6c2.4-4 5.4-6 9-6c3.6 0 6.6 2 9 6",
  ]} />;
}

export function IconEyeOff(p: IconProps) {
  return <IM {...p} paths={[
    "M10.585 10.587a2 2 0 0 0 2.829 2.828",
    "M16.681 16.673a8.717 8.717 0 0 1-4.681 1.327c-3.6 0-6.6-2-9-6c1.272-2.12 2.712-3.678 4.32-4.674m2.86-1.146a9.055 9.055 0 0 1 1.82-.18c3.6 0 6.6 2 9 6c-.666 1.11-1.379 2.067-2.138 2.87",
    "M3 3l18 18",
  ]} />;
}

export function IconCalculator(p: IconProps) {
  return <IM {...p} paths={[
    "M4 3m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z",
    "M8 7m0 1a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1z",
    "M8 14l0 .01", "M12 14l0 .01", "M16 14l0 .01",
    "M8 17l0 .01", "M12 17l0 .01", "M16 17l0 .01",
  ]} />;
}

export function IconAsterisk(p: IconProps) {
  return <IM {...p} paths={[
    "M12 6v12", "M17.196 9l-10.392 6", "M6.804 9l10.392 6",
  ]} />;
}

export function IconHash(p: IconProps) {
  return <IM {...p} paths={["M5 9h14", "M4 15h14", "M10 3L8 21", "M16 3l-2 18"]} />;
}

export function IconType(p: IconProps) {
  return <IM {...p} paths={["M4 7V5h16v2", "M12 5v14", "M9 19h6"]} />;
}

export function IconDivide(p: IconProps) {
  return <IM {...p} paths={["M5 12h14", "M12 6h.01", "M12 18h.01"]} />;
}

export function IconInfinity(p: IconProps) {
  return <IM {...p} paths={[
    "M9.5 9.5c-2.2-2.2-5.5-.6-5.5 2.5s3.3 4.7 5.5 2.5l5-5c2.2-2.2 5.5-.6 5.5 2.5s-3.3 4.7-5.5 2.5l-5-5",
  ]} />;
}

export function IconHelpCircle(p: IconProps) {
  return <IM {...p} paths={[
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M9.75 9a2.25 2.25 0 1 1 3.2 2.04c-.65.33-.95.74-.95 1.46",
    "M12 17h.01",
  ]} />;
}

export function IconMapPin(p: IconProps) {
  return <IM {...p} paths={[
    "M12 21s7-4.35 7-11a7 7 0 0 0-14 0c0 6.65 7 11 7 11z",
    "M12 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  ]} />;
}

export function IconFlag(p: IconProps) {
  return <IM {...p} paths={["M5 21V5", "M5 5h11l-1 4l1 4H5"]} />;
}

export function IconSeedling(p: IconProps) {
  return <IM {...p} paths={["M12 10a6 6 0 0 0-6-6H3v2a6 6 0 0 0 6 6h3", "M12 14a6 6 0 0 1 6-6h3v1a6 6 0 0 1-6 6h-3", "M12 20V10"]} />;
}

export function IconBookmark(p: IconProps) {
  return <I {...p} d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4l-6 4V4z" />;
}

export function IconKey(p: IconProps) {
  return <IM {...p} paths={[
    "M7 14a4 4 0 1 1 3-6.65L21 18v3h-3v-2h-2v-2h-2l-4.35-4.35A4 4 0 0 1 7 14z",
    "M7 10h.01",
  ]} />;
}

export function IconDollarSign(p: IconProps) {
  return <IM {...p} paths={["M12 3v18", "M17 7a4 4 0 0 0-4-2h-2a3 3 0 0 0 0 6h2a3 3 0 0 1 0 6h-2a4 4 0 0 1-4-2"]} />;
}

export function IconShapes(p: IconProps) {
  return <IM {...p} paths={[
    "M6 4m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
    "M16 3h5v5h-5z",
    "M5 14l4 7H1z",
    "M17.5 14l4.5 7h-9z",
  ]} />;
}

export function IconTypeSet(p: IconProps) {
  return <IM {...p} paths={[
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M8 10h.01", "M15 9h.01", "M12 16h.01",
  ]} />;
}

export function IconLanguages(p: IconProps) {
  return <IM {...p} paths={[
    "M5 8h9",
    "M7 4h1",
    "M9 4h1",
    "M8 4v4",
    "M6 12c3-1 5-3 6-8",
    "M11 12c-1.2-.5-2.3-1.4-3.2-2.4",
    "M13 21l4-9l4 9",
    "M14.5 18h5",
  ]} />;
}

export function IconCreditCard(p: IconProps) {
  return <IM {...p} paths={[
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
    "M2 10h20",
    "M6 15h2",
  ]} />;
}

export function IconShare2(p: IconProps) {
  return <IM {...p} paths={[
    "M18 8a3 3 0 1 0 0-6a3 3 0 0 0 0 6z",
    "M6 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z",
    "M18 22a3 3 0 1 0 0-6a3 3 0 0 0 0 6z",
    "M8.6 13.5l6.8 4",
    "M15.4 6.5l-6.8 4",
  ]} />;
}

export function IconAtSign(p: IconProps) {
  return <IM {...p} paths={[
    "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
    "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",
  ]} />;
}

export function IconRss(p: IconProps) {
  return <IM {...p} paths={["M5 19h.01", "M5 5a14 14 0 0 1 14 14", "M5 12a7 7 0 0 1 7 7"]} />;
}

export function IconTarget(p: IconProps) {
  return <IM {...p} paths={[
    "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0",
    "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
  ]} />;
}

export function IconImage(p: IconProps) {
  return <IM {...p} paths={[
    "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z",
    "M8.5 9.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
    "M4 17l4-4l3 3l3-4l6 6",
  ]} />;
}

export function IconPalette(p: IconProps) {
  return <IM {...p} paths={[
    "M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a1.5 1.5 0 0 1 0-3h1a8 8 0 0 0 8-8c0-1.1-4-2-9-2z",
    "M7.5 10.5h.01",
    "M9.5 7.5h.01",
    "M13.5 7.5h.01",
  ]} />;
}

export function IconToggleLeft(p: IconProps) {
  return <IM {...p} paths={[
    "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7z",
    "M7 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  ]} />;
}

export function IconLayers(p: IconProps) {
  return <IM {...p} paths={[
    "M12 3l9 5l-9 5l-9-5l9-5z",
    "M3 12l9 5l9-5",
    "M3 16l9 5l9-5",
  ]} />;
}

export function IconMonitor(p: IconProps) {
  return <IM {...p} paths={["M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M8 21h8", "M12 17v4"]} />;
}

// ---- Icon lookup maps for flow editor ----

export function IconSearch(p: IconProps) {
  return <IM {...p} paths={["M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M21 21l-6-6"]} />;
}

export const ACTION_STEP_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  send_email: IconMail,
  send_sms: IconMessage,
  send_notification: IconBell,
  create_profile: IconUserPlus,
  update_profile: IconUserCheck,
  grant_entitlement: IconShieldCheck,
  revoke_entitlement: IconShieldOff,
  assign_tag: IconTag,
  remove_tag: IconTagOff,
  webhook: IconWorld,
  log: IconFileText,
};

export const EVENT_STEP_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  submitted: IconClipboard,
  payment_completed: IconReceipt,
  payment_failed: IconAlertTriangle,
  page_visited: IconLink,
  link_clicked: IconLink,
  email_opened: IconMail,
  email_clicked: IconMail,
  tag_added: IconTag,
  tag_removed: IconTagOff,
  profile_created: IconUserPlus,
  profile_updated: IconUserCheck,
  entitlement_granted: IconShieldCheck,
  entitlement_expired: IconClock,
};

// ---- Lucide-named icons surfaced via the typeclass-based Iconable
// system (Iconable.icon stores a kebab-case name like "pin" / "bot" /
// "inbox" / "circle-stop"). The renderer resolves the name through
// LUCIDE_BY_NAME below.

export function IconPin(p: IconProps) {
  return <IM {...p} paths={[
    "M9 4h6v6l3 4v2H6v-2l3-4z",
    "M12 16v5",
  ]} />;
}

export function IconBot(p: IconProps) {
  return <IM {...p} paths={[
    "M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
    "M12 6V3",
    "M11 3h2",
    "M9 12v.01",
    "M15 12v.01",
    "M9 16h6",
  ]} />;
}

export function IconCircleStop(p: IconProps) {
  return <IM {...p} paths={[
    "M12 21a9 9 0 1 1 0-18a9 9 0 0 1 0 18z",
    "M9 9h6v6H9z",
  ]} />;
}

export function IconCopy(p: IconProps) {
  return <IM {...p} paths={[
    "M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z",
    "M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1",
  ]} />;
}

export function IconInbox(p: IconProps) {
  return <IM {...p} paths={[
    "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
    "M3 13h4l2 3h6l2-3h4",
  ]} />;
}

/** Map kebab-case lucide-style names → SVG icon component. Names match
 *  the values stored in `Iconable.icon` typeclass instances (registered
 *  via `defineFunction(..., { icon: "pin" })` and entity definitions in
 *  `system-entities.ts`). Add new entries when introducing a function
 *  whose icon name isn't yet wired to a renderable component. */
export const LUCIDE_BY_NAME: Record<string, (p: IconProps) => JSX.Element> = {
  "monitor": IconMonitor,
  // Existing function / op icons (migrated from emoji-as-icon)
  "pin": IconPin,
  "bot": IconBot,
  "circle-stop": IconCircleStop,
  "inbox": IconInbox,
  "copy": IconCopy,
  "duplicate": IconCopy,
  // App/navigation/data icons already defined in this local icon set.
  "layout-dashboard": IconLayoutDashboard,
  "layout-grid": IconLayoutGrid,
  "layout-canvas": IconLayoutCanvas,
  "grip-vertical": IconGripVertical,
  "panels-top-left": IconPanelsTopLeft,
  "table": IconTable,
  "list-details": IconListDetails,
  "dashboard": IconLayoutDashboard,
  "users": IconUsers,
  "folder": IconFolder,
  "layers": IconLayers,
  "activity": IconActivity,
  "package": IconPackage,
  "receipt": IconReceipt,
  "shopping-cart": IconShoppingCart,
  "archive": IconArchive,
  "clipboard": IconClipboard,
  "link": IconLink,
  "phone": IconPhone,
  "user": IconUser,
  "circle-check": IconCircleCheck,
  "check-circle": IconCircleCheck,
  "check": IconCheck,
  "circle-x": IconCircleX,
  "mail": IconMail,
  "route": IconRoute,
  "plug-connected": IconPlugConnected,
  "plug": IconPlugConnected,
  "settings": IconSettings,
  "info": IconInfoCircle,
  "info-circle": IconInfoCircle,
  "help-circle": IconHelpCircle,
  "telegram": IconBrandTelegram,
  "stack": IconStack,
  "menu": IconMenu2,
  "ellipsis": IconEllipsis,
  "x": IconX,
  "plus": IconPlus,
  "trash": IconTrash,
  "trash-2": IconTrash,
  "chevron-down": IconChevronDown,
  "bolt": IconBolt,
  "zap": IconBolt,
  "clock": IconClock,
  "bell": IconBell,
  "calendar": IconCalendar,
  "git-branch": IconGitBranch,
  "lightbulb": IconLightbulb,
  "bulb": IconLightbulb,
  "workflow": IconWorkflow,
  "function": IconFunction,
  "utensils": IconUtensils,
  "git-merge": IconGitBranch,
  "split": IconGitBranch,
  "list-check": IconListCheck,
  "play": IconPlayerPlay,
  "binary-tree": IconBinaryTree,
  "folder-tree": IconBinaryTree,
  "list": IconList,
  "chevron-right": IconChevronRight,
  "code": IconCode,
  "code-xml": IconCode,
  "repeat": IconRepeat,
  "alert-triangle": IconAlertTriangle,
  "variable": IconVariable,
  "braces": IconBraces,
  "message-circle": IconMessage,
  "message-square": IconMessage,
  "user-plus": IconUserPlus,
  "user-check": IconUserCheck,
  "shield": IconShieldCheck,
  "shield-check": IconShieldCheck,
  "shield-off": IconShieldOff,
  "tag": IconTag,
  "tag-off": IconTagOff,
  "globe": IconWorld,
  "world": IconWorld,
  "languages": IconLanguages,
  "file-text": IconFileText,
  "arrow-right": IconArrowRight,
  "arrow-down": IconArrowDown,
  "arrow-up": IconArrowUp,
  "arrow-left": IconArrowLeft,
  "arrows-left-right": IconArrowsLeftRight,
  "external-link": IconExternalLink,
  "maximize": IconMaximize,
  "minimize": IconMinimize,
  "app-window": IconAppWindow,
  "edit": IconPencil,
  "pencil": IconPencil,
  "eye": IconEye,
  "eye-off": IconEyeOff,
  "calculator": IconCalculator,
  "asterisk": IconAsterisk,
  "hash": IconHash,
  "type": IconType,
  "image": IconImage,
  "palette": IconPalette,
  "toggle-left": IconToggleLeft,
  "divide": IconDivide,
  "infinity": IconInfinity,
  "map-pin": IconMapPin,
  "flag": IconFlag,
  "seedling": IconSeedling,
  "sprout": IconSeedling,
  "bookmark": IconBookmark,
  "key": IconKey,
  "dollar-sign": IconDollarSign,
  "shapes": IconShapes,
  "type-set": IconTypeSet,
  "credit-card": IconCreditCard,
  "share-2": IconShare2,
  "at-sign": IconAtSign,
  "rss": IconRss,
  "target": IconTarget,
  "search": IconSearch,
  // Aliases / synonyms commonly produced by user-typed names
  "robot": IconBot,
  "stop": IconCircleStop,
  "stop-circle": IconCircleStop,
};

// Consulted only when the type carries no Iconable instance of its own.
// Pure menu/layout projections share this static asset without importing SVG.
export const TYPE_ICON_FALLBACKS: Record<string, string> = typeIconFallbacks;

/** Render a lucide-style icon by name. Returns the matched SVG when
 *  registered in LUCIDE_BY_NAME, otherwise undefined so callers can
 *  decide on a fallback (typically the emoji from Emojiable). */
export function IconByName(props: { name?: string | undefined; size?: number; class?: string }) {
  const component = createMemo(() => props.name ? LUCIDE_BY_NAME[props.name] : undefined);
  return <Show when={component()}>{(icon) => <Dynamic component={icon()} size={props.size} class={props.class} />}</Show>;
}
