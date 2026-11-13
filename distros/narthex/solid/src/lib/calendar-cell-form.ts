/**
 * Which presentation a calendar day uses for its items (owner review, Nov 11).
 *
 * "regular": the item body at the list row's size (3rem collection circles,
 * the ordinary count and text size). "compact": the small chips (1.75rem
 * circles) a day keeps when it has no room: a phone-width column, or more
 * items than the day's height holds. Pure, so the rule is unit-tested; the
 * calendar measures its grid and passes the cell room in.
 */
export type CalendarCellForm = "regular" | "compact";

export interface CalendarCellRoom { width: number; height: number }

/** Grid rows and columns: a month is always 6 weeks of 7 days. */
const COLUMNS = 7;
const ROWS = 6;
/** The day cell's own chrome: 0.3rem padding above and below, the day
 *  number's line (line-height 1 at 0.78rem) and the 0.25rem gap below it. */
export const CALENDAR_CELL_CHROME_HEIGHT = 27;
/** The list row's collection strip height (`.locus-previews` min-height 3rem). */
export const CALENDAR_REGULAR_ITEM_HEIGHT = 48;
/** A pinned item's caption line above its body. */
export const CALENDAR_ITEM_CAPTION_HEIGHT = 18;
/** `.home-calendar__day-items` gap (0.35rem). */
export const CALENDAR_ITEM_GAP = 6;
/** Two regular circles side by side and a short count need this much width. */
export const CALENDAR_REGULAR_MIN_WIDTH = 120;

/** One cell's room, from the grid's measured content box and its gap. */
export function calendarCellRoom(grid: { gridWidth: number; gridHeight: number; gap: number }): CalendarCellRoom {
  const width = (grid.gridWidth - grid.gap * (COLUMNS - 1)) / COLUMNS;
  const height = (grid.gridHeight - grid.gap * (ROWS - 1)) / ROWS;
  return { width: width > 0 ? width : 0, height: height > 0 ? height : 0 };
}

export function calendarCellForm(room: CalendarCellRoom, itemCount: number, options: { captioned?: boolean } = {}): CalendarCellForm {
  if (itemCount <= 0) return "compact";
  if (!(room.width >= CALENDAR_REGULAR_MIN_WIDTH)) return "compact";
  const perItem = CALENDAR_REGULAR_ITEM_HEIGHT + (options.captioned ? CALENDAR_ITEM_CAPTION_HEIGHT : 0);
  const needed = itemCount * perItem + (itemCount - 1) * CALENDAR_ITEM_GAP;
  return needed <= room.height - CALENDAR_CELL_CHROME_HEIGHT ? "regular" : "compact";
}
