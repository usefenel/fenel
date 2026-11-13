// An address may say which inspection panels a lens opens with:
// `/demo/People and projects?panels=dependencies` opens that collection with
// its Dependencies panel (its linked-data graph) and nothing else, so one
// address shows the graph. Only the panels' own names count, in their order;
// anything else is ignored and the lens opens as usual.
import type { DataInspectionPanel } from "./DataInspectionDialog";

const PANELS: readonly DataInspectionPanel[] = ["suggestions", "data", "expression", "code", "dependencies"];

export function addressInspectionPanels(search: string): DataInspectionPanel[] | undefined {
  let asked: string | null;
  try { asked = new URLSearchParams(search).get("panels"); } catch { return undefined; }
  if (!asked) return undefined;
  const names = new Set(asked.split(",").map(name => name.trim().toLowerCase()));
  const panels = PANELS.filter(panel => names.has(panel));
  return panels.length ? panels : undefined;
}
