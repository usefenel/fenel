// ---------------------------------------------------------------------------
// MediaTimeline — playhead + scrub control for media (audio / video / animation).
//
// A horizontal time axis from 0 to `duration` (in seconds), with a draggable
// playhead at `currentTime`. Click anywhere on the axis to seek; drag the
// playhead to scrub. Optional play/pause transport. Optional lanes
// underneath for visualisation (waveforms, frame thumbnails) — each lane
// renders its own content given the lane's pixel size.
//
// This is a separate component from the calendar-style `home-timeline` in
// dashboard/home.tsx. That one places event items on a date axis (months /
// days). This one is media-oriented: continuous seconds, playhead, seek.
//
// Usage:
//   const [t, setT] = createSignal(0);
//   const [playing, setPlaying] = createSignal(false);
//   <MediaTimeline
//     duration={10}
//     currentTime={t()}
//     onSeek={setT}
//     fps={30}
//     isPlaying={playing()}
//     onPlayPause={() => setPlaying(p => !p)}
//     lanes={[
//       { label: "video", render: (w, h) => <FrameStrip width={w} height={h} /> },
//       { label: "audio", render: (w, h) => <Waveform width={w} height={h} /> },
//     ]}
//   />
// ---------------------------------------------------------------------------

import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";

export interface TimelineLane {
  /** Short label shown to the left of the lane. */
  label?: string;
  /** Render the lane's content. Receives the lane's drawable width and
   *  height in pixels. The component lays out the surrounding chrome. */
  render: (width: number, height: number) => JSX.Element;
  /** Pixel height of this lane. Default 32. */
  height?: number;
}

export interface MediaTimelineProps {
  /** Total duration in seconds. Anchors the right edge of the axis. */
  duration: number;
  /** Current playback position in seconds (controlled). */
  currentTime: number;
  /** Called when the user clicks or drags to a new time (clamped to [0, duration]). */
  onSeek: (t: number) => void;
  /** Optional fps — when present, seek values snap to the nearest frame. */
  fps?: number;
  /** Optional transport play state. Drives the play/pause icon. */
  isPlaying?: boolean;
  /** Optional transport callback. When provided, a play/pause button is shown. */
  onPlayPause?: () => void;
  /** Track height in px (the axis + playhead area). Default 48. */
  axisHeight?: number;
  /** Optional content lanes rendered below the time axis. */
  lanes?: TimelineLane[];
  /** Number of evenly-spaced tick marks on the time axis. Default 10. */
  tickCount?: number;
}

/** Format seconds as `MM:SS.t` for display. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00.0";
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  const remaining = s - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(1).padStart(4, "0")}`;
}

/** Snap a seek time to the nearest frame when fps is provided. */
function snap(t: number, fps?: number): number {
  if (!fps || fps <= 0) return t;
  return Math.round(t * fps) / fps;
}

export function MediaTimeline(props: MediaTimelineProps) {
  const axisH = () => props.axisHeight ?? 48;
  const tickCount = () => props.tickCount ?? 10;
  const lanes = () => props.lanes ?? [];
  const duration = () => Math.max(0.001, props.duration);

  let surface: HTMLDivElement | undefined;
  const [scrubbing, setScrubbing] = createSignal(false);

  // Convert a clientX to a time value, clamped to [0, duration].
  function clientXToTime(clientX: number): number {
    if (!surface) return 0;
    const rect = surface.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, frac));
    return snap(clamped * duration(), props.fps);
  }

  function onPointerDown(e: PointerEvent) {
    setScrubbing(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    props.onSeek(clientXToTime(e.clientX));
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!scrubbing()) return;
    props.onSeek(clientXToTime(e.clientX));
  }

  function onPointerUp(e: PointerEvent) {
    setScrubbing(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  // Tick marks at evenly-spaced fractions of duration.
  const ticks = createMemo(() => {
    const n = tickCount();
    const out: { t: number; pct: number; label: string }[] = [];
    for (let i = 0; i <= n; i++) {
      const pct = (i * 100) / n;
      const t = (i / n) * duration();
      out.push({ t, pct, label: formatTime(t) });
    }
    return out;
  });

  const playheadPct = createMemo(() => {
    const t = Math.max(0, Math.min(duration(), props.currentTime));
    return (t / duration()) * 100;
  });

  return (
    <div class="media-timeline" style={`
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-family: system-ui, sans-serif;
      font-size: 11px;
      color: #333;
      user-select: none;
    `}>
      {/* Transport row */}
      <div class="media-timeline__transport" style={`
        display: flex;
        align-items: center;
        gap: 8px;
        height: 24px;
      `}>
        <Show when={props.onPlayPause}>
          <button
            type="button"
            onClick={() => props.onPlayPause?.()}
            data-tooltip={props.isPlaying ? "Pause" : "Play"}
            style={`
              width: 28px;
              height: 24px;
              border: 1px solid #ccc;
              border-radius: 3px;
              background: #fff;
              cursor: pointer;
              font-size: 12px;
            `}
          >
            {props.isPlaying ? "⏸" : "▶"}
          </button>
        </Show>
        <span class="mono" style="font-variant-numeric: tabular-nums; min-width: 70px;">
          {formatTime(props.currentTime)}
        </span>
        <span style="color: #999;">/</span>
        <span class="mono" style="font-variant-numeric: tabular-nums; color: #666;">
          {formatTime(duration())}
        </span>
        <Show when={props.fps}>
          <span style="color: #999; margin-left: auto;">{props.fps} fps</span>
        </Show>
      </div>

      {/* Axis + playhead */}
      <div
        ref={surface}
        class="media-timeline__axis"
        style={`
          position: relative;
          height: ${axisH()}px;
          background: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 3px;
          cursor: ${scrubbing() ? "grabbing" : "pointer"};
          touch-action: none;
        `}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <For each={ticks()}>
          {(tick, i) => {
            const isMajor = i() % 2 === 0;
            return (
              <>
                <div style={`
                  position: absolute;
                  left: ${tick.pct.toFixed(2)}%;
                  top: 0;
                  bottom: 0;
                  width: 1px;
                  background: ${isMajor ? "#bbb" : "#ddd"};
                  pointer-events: none;
                `} />
                <Show when={isMajor}>
                  <span style={`
                    position: absolute;
                    left: ${tick.pct.toFixed(2)}%;
                    bottom: 2px;
                    transform: translateX(-50%);
                    color: #888;
                    font-size: 9px;
                    pointer-events: none;
                    font-variant-numeric: tabular-nums;
                  `}>{tick.label}</span>
                </Show>
              </>
            );
          }}
        </For>

        {/* Playhead */}
        <div style={`
          position: absolute;
          left: ${playheadPct().toFixed(3)}%;
          top: 0;
          bottom: 0;
          width: 2px;
          background: #ef4444;
          pointer-events: none;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8);
        `} />
        <div style={`
          position: absolute;
          left: ${playheadPct().toFixed(3)}%;
          top: -2px;
          width: 10px;
          height: 10px;
          background: #ef4444;
          border-radius: 50%;
          transform: translateX(-50%);
          pointer-events: none;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8);
        `} />
      </div>

      {/* Optional lanes */}
      <For each={lanes()}>
        {(lane) => (
          <TimelineLaneStrip
            lane={lane}
            playheadPct={playheadPct()}
          />
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimelineLaneStrip — a labelled lane below the main axis. Calls the lane's
// render function to populate the drawable area; overlays the same playhead
// as the main axis so visual sync stays obvious. The strip measures its
// own width via a ResizeObserver-equivalent (clientWidth poll) so lane
// renderers can lay out canvas / SVG content at the right pixel size.
// ---------------------------------------------------------------------------

function TimelineLaneStrip(props: { lane: TimelineLane; playheadPct: number }) {
  const h = () => props.lane.height ?? 32;
  let drawArea: HTMLDivElement | undefined;
  const [width, setWidth] = createSignal(0);

  // Poll the draw-area width once after mount and on each pass; for v1 a
  // single ResizeObserver subscription would be cleaner, kept simple here.
  const measure = () => {
    if (drawArea) setWidth(drawArea.clientWidth);
  };

  return (
    <div
      class="media-timeline__lane"
      style={`
        display: flex;
        align-items: center;
        gap: 6px;
        height: ${h()}px;
      `}
    >
      <Show when={props.lane.label}>
        <span style={`
          width: 60px;
          color: #666;
          font-size: 10px;
          text-align: right;
          padding-right: 4px;
        `}>{props.lane.label}</span>
      </Show>
      <div
        ref={(el) => { drawArea = el; queueMicrotask(measure); }}
        style={`
          flex: 1;
          height: 100%;
          position: relative;
          background: #fff;
          border: 1px solid #e5e5e5;
          border-radius: 3px;
          overflow: hidden;
        `}
      >
        <Show when={width() > 0}>
          {props.lane.render(width(), h())}
        </Show>
        <div style={`
          position: absolute;
          left: ${props.playheadPct.toFixed(3)}%;
          top: 0;
          bottom: 0;
          width: 1px;
          background: rgba(239, 68, 68, 0.6);
          pointer-events: none;
        `} />
      </div>
    </div>
  );
}
