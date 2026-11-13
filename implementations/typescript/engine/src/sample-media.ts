// ---------------------------------------------------------------------------
// Sample media — concrete Sound / Animation / Movie / Track / Event /
// Behavior values for the storybook surface.
//
// Same pattern as `sample-image-jojo.ts` and image-data's SAMPLE_IMAGES:
// pre-render every example to its concrete data shape (Buffer for Sound,
// Frames for Animation, Recorded for Movie) so the storybook widget reads
// pure data and doesn't need to call back into the engine to produce
// pixels / samples. The math used to generate each one is in the comment
// above each builder so a reader can see what the example is.
//
// Buffers are kept small (low sample rate, short duration) so the
// catalog ships with reasonable memory footprint. Audio is 4 kHz mono-
// stereo unless otherwise noted; animations are 16×16 pixels at 4 fps.
// ---------------------------------------------------------------------------

import type { RgbaPixelValue, ImageValue } from "./image-data";

// ---------------------------------------------------------------------------
// Types (mirror the runtime variant shapes — see modules/sound.ts etc.)
// ---------------------------------------------------------------------------

export type AmplitudeValue = { l: number; r: number };
export type AudioBufferValue = {
  sampleRate: number;
  channels: number;
  samples: AmplitudeValue[];
};
export type SoundValue =
  | { $tag: "Buffer"; _0: AudioBufferValue }
  | { $tag: "Wave"; _0: unknown };

export type FrameSequenceValue = { fps: number; frames: ImageValue[] };
export type AnimationValue =
  | { $tag: "Frames"; _0: FrameSequenceValue }
  | { $tag: "Animate"; _0: unknown };

export type RecordedMovieValue = {
  fps: number;
  width: number;
  height: number;
  frames: ImageValue[];
  audio: AudioBufferValue;
};
export type MovieValue =
  | { $tag: "Recorded"; _0: RecordedMovieValue }
  | { $tag: "MovieAt"; _0: unknown };

export type TrackEntryValue = { start: number; sound: SoundValue };
export type TrackValue = { entries: TrackEntryValue[] };

export type EventEntryValue = { timestamp: number; payload: unknown };
export type EventValue = { entries: EventEntryValue[] };

// ---------------------------------------------------------------------------
// Audio rendering helpers
// ---------------------------------------------------------------------------

const AUDIO_SR = 4000; // sample rate for storybook examples (4 kHz keeps buffers small)
const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;

// Portable sine/cosine. These samples are dispatch-pool data, and the pool
// digest keys the engine-body replay artifact recorded in Bun and replayed in
// the browser. `Math.sin` is implementation-approximated: Chrome and Bun
// differ in the last bits, so every replay key missed. Range reduction plus a
// Taylor polynomial use only IEEE-754 + - * / and Math.round, which are exact
// and identical on every engine. Within 4e-11 of Math.sin over these samples.
function portableSin(x: number): number {
  let r = x - Math.round(x / TWO_PI) * TWO_PI;
  if (r > HALF_PI) r = Math.PI - r;
  else if (r < -HALF_PI) r = -Math.PI - r;
  const r2 = r * r;
  let term = r;
  let sum = r;
  for (let n = 1; n <= 12; n++) {
    term *= -r2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

function portableCos(x: number): number {
  return portableSin(x + HALF_PI);
}

function clampAmp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return 1;
  if (n < -1) return -1;
  return n;
}

function makeWaveBuffer(
  duration: number,
  fn: (t: number) => number,
): AudioBufferValue {
  const total = Math.floor(duration * AUDIO_SR);
  const samples: AmplitudeValue[] = new Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / AUDIO_SR;
    const v = clampAmp(fn(t));
    samples[i] = { l: v, r: v };
  }
  return { sampleRate: AUDIO_SR, channels: 2, samples };
}

function bufferToSound(buf: AudioBufferValue): SoundValue {
  return { $tag: "Buffer", _0: buf };
}

// ---------------------------------------------------------------------------
// Sample sounds — math expressions live in the function bodies; the
// concrete buffers ship with the catalog for visualisation.
// ---------------------------------------------------------------------------

// 440 Hz sine — concert A. The reference pitch every musician tunes to.
const SINE_A4 = bufferToSound(makeWaveBuffer(0.5, (t) => portableSin(TWO_PI * 440 * t)));

// 261.63 Hz sine — middle C, an octave below treble C, the centre of a piano.
const SINE_C4 = bufferToSound(makeWaveBuffer(0.5, (t) => portableSin(TWO_PI * 261.63 * t)));

// Sawtooth at 220 Hz — A3. Linear ramp -1→+1 every 1/220 s.
const SAW_A3 = bufferToSound(
  makeWaveBuffer(0.5, (t) => 2 * (220 * t - Math.floor(220 * t)) - 1),
);

// Square wave at 220 Hz — A3 in classic chiptune tone.
const SQUARE_A3 = bufferToSound(
  makeWaveBuffer(0.5, (t) => (portableSin(TWO_PI * 220 * t) >= 0 ? 1 : -1)),
);

// A C major triad: C4 + E4 + G4 mixed (each at 0.3 amplitude so sum stays in range).
const CHORD_CMAJ = bufferToSound(
  makeWaveBuffer(0.5, (t) =>
    0.3 * portableSin(TWO_PI * 261.63 * t) +
    0.3 * portableSin(TWO_PI * 329.63 * t) +
    0.3 * portableSin(TWO_PI * 392.0 * t),
  ),
);

// 880 Hz with linear amplitude decay — pluck-like envelope.
const PLUCK_A5 = bufferToSound(
  makeWaveBuffer(0.5, (t) => Math.max(0, 1 - 2 * t) * portableSin(TWO_PI * 880 * t)),
);

export const SAMPLE_SOUNDS: SoundValue[] = [
  SINE_A4,       // 0
  SINE_C4,       // 1
  SAW_A3,        // 2
  SQUARE_A3,     // 3
  CHORD_CMAJ,    // 4
  PLUCK_A5,      // 5
];

// ---------------------------------------------------------------------------
// Animation rendering helpers
// ---------------------------------------------------------------------------

const ANIM_W = 16;
const ANIM_H = 16;
const ANIM_FPS = 4;

const RED: RgbaPixelValue = { r: 239, g: 68, b: 68, a: 255 };
const BLUE: RgbaPixelValue = { r: 59, g: 130, b: 246, a: 255 };
const GREEN: RgbaPixelValue = { r: 16, g: 185, b: 129, a: 255 };
const TRANSPARENT: RgbaPixelValue = { r: 0, g: 0, b: 0, a: 0 };

function renderFrame(
  fillFn: (x: number, y: number) => RgbaPixelValue,
): ImageValue {
  const pixels: RgbaPixelValue[] = new Array(ANIM_W * ANIM_H);
  for (let y = 0; y < ANIM_H; y++) {
    for (let x = 0; x < ANIM_W; x++) {
      pixels[y * ANIM_W + x] = fillFn(x, y);
    }
  }
  return { width: ANIM_W, height: ANIM_H, pixels };
}

function makeAnimation(
  duration: number,
  drawAtT: (t: number) => (x: number, y: number) => RgbaPixelValue,
): AnimationValue {
  const totalFrames = Math.floor(duration * ANIM_FPS);
  const frames: ImageValue[] = new Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    const t = i / ANIM_FPS;
    frames[i] = renderFrame(drawAtT(t));
  }
  return { $tag: "Frames", _0: { fps: ANIM_FPS, frames } };
}

// ---------------------------------------------------------------------------
// Sample animations
// ---------------------------------------------------------------------------

// Bouncing red circle: x oscillates 4..12 over time.
const BOUNCING_BALL = makeAnimation(2, (t) => {
  const cx = 8 + 4 * portableSin(TWO_PI * 0.5 * t);
  const cy = 8;
  const r = 3;
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r ? RED : TRANSPARENT;
  };
});

// Color-shifting square: cycles RED → BLUE → GREEN → RED.
const COLOR_PULSE = makeAnimation(2, (t) => {
  const phase = (t * 0.5) % 1; // 0..1 over 2s
  const c =
    phase < 1 / 3 ? RED :
    phase < 2 / 3 ? BLUE : GREEN;
  return (x, y) => {
    if (x >= 4 && x < 12 && y >= 4 && y < 12) return c;
    return TRANSPARENT;
  };
});

// Rectangle moving left to right.
const MOVING_RECT = makeAnimation(2, (t) => {
  const offset = Math.floor(((t * 4) % 1) * (ANIM_W - 4));
  return (x, y) => {
    if (y >= 6 && y <= 9 && x >= offset && x < offset + 4) return BLUE;
    return TRANSPARENT;
  };
});

// Circle orbiting the centre.
const ORBITING_DOT = makeAnimation(2, (t) => {
  const angle = TWO_PI * 0.5 * t;
  const cx = 8 + 4 * portableCos(angle);
  const cy = 8 + 4 * portableSin(angle);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= 4 ? GREEN : TRANSPARENT;
  };
});

export const SAMPLE_ANIMATIONS: AnimationValue[] = [
  BOUNCING_BALL,   // 0
  COLOR_PULSE,     // 1
  MOVING_RECT,     // 2
  ORBITING_DOT,    // 3
];

// ---------------------------------------------------------------------------
// Sample movies — reuse pre-rendered animations + a generated soundtrack.
// ---------------------------------------------------------------------------

function combineToMovie(
  anim: AnimationValue,
  audio: AudioBufferValue,
  width: number,
  height: number,
  fps: number,
): MovieValue {
  if (anim.$tag !== "Frames") {
    // The samples are all pre-rendered Frames; this branch is unreachable.
    return { $tag: "Recorded", _0: { fps, width, height, frames: [], audio } };
  }
  return {
    $tag: "Recorded",
    _0: {
      fps: anim._0.fps,
      width,
      height,
      frames: anim._0.frames,
      audio,
    },
  };
}

// Bouncing ball that bounces in time with a 1Hz sine — visual + audio sync.
const MOVIE_BALL_SINE = combineToMovie(
  BOUNCING_BALL,
  makeWaveBuffer(2, (t) => 0.5 * portableSin(TWO_PI * 1 * t)),
  ANIM_W,
  ANIM_H,
  ANIM_FPS,
);

// Color pulse with a chord — matched 0.5s pulse cycles to chord rhythm.
const MOVIE_PULSE_CHORD = combineToMovie(
  COLOR_PULSE,
  makeWaveBuffer(2, (t) =>
    0.2 *
    (portableSin(TWO_PI * 261.63 * t) +
      portableSin(TWO_PI * 329.63 * t) +
      portableSin(TWO_PI * 392.0 * t)),
  ),
  ANIM_W,
  ANIM_H,
  ANIM_FPS,
);

export const SAMPLE_MOVIES: MovieValue[] = [
  MOVIE_BALL_SINE,
  MOVIE_PULSE_CHORD,
];

// ---------------------------------------------------------------------------
// Sample tracks
// ---------------------------------------------------------------------------

// 4-note arpeggio: C4 E4 G4 C5 at 0, 0.25, 0.5, 0.75s.
const ARPEGGIO: TrackValue = {
  entries: [
    { start: 0, sound: SINE_C4 },
    { start: 0.25, sound: bufferToSound(makeWaveBuffer(0.5, (t) => portableSin(TWO_PI * 329.63 * t))) },
    { start: 0.5, sound: bufferToSound(makeWaveBuffer(0.5, (t) => portableSin(TWO_PI * 392.0 * t))) },
    { start: 0.75, sound: bufferToSound(makeWaveBuffer(0.5, (t) => portableSin(TWO_PI * 523.25 * t))) },
  ],
};

// Two simultaneous layers: bass (220 Hz) + lead (440 Hz).
const BASS_LEAD: TrackValue = {
  entries: [
    { start: 0, sound: bufferToSound(makeWaveBuffer(1, (t) => 0.4 * portableSin(TWO_PI * 220 * t))) },
    { start: 0, sound: bufferToSound(makeWaveBuffer(1, (t) => 0.4 * portableSin(TWO_PI * 440 * t))) },
  ],
};

export const SAMPLE_TRACKS: TrackValue[] = [
  ARPEGGIO,
  BASS_LEAD,
];

// ---------------------------------------------------------------------------
// Sample events
// ---------------------------------------------------------------------------

// 5 numeric position-update events (think: x-coordinate over time).
const POSITION_EVENTS: EventValue = {
  entries: [
    { timestamp: 0.5, payload: 4 },
    { timestamp: 1.0, payload: 6 },
    { timestamp: 1.5, payload: 8 },
    { timestamp: 2.0, payload: 6 },
    { timestamp: 2.5, payload: 4 },
  ],
};

// 3 string-payload events (think: chat messages).
const CHAT_EVENTS: EventValue = {
  entries: [
    { timestamp: 0, payload: "hello" },
    { timestamp: 1.2, payload: "world" },
    { timestamp: 2.5, payload: "👋" },
  ],
};

// Click-stream — just timestamps, payload is the click index.
const CLICK_EVENTS: EventValue = {
  entries: [
    { timestamp: 0.3, payload: 1 },
    { timestamp: 0.55, payload: 2 },
    { timestamp: 1.1, payload: 3 },
    { timestamp: 1.4, payload: 4 },
    { timestamp: 2.2, payload: 5 },
  ],
};

export const SAMPLE_EVENTS: EventValue[] = [
  POSITION_EVENTS,
  CHAT_EVENTS,
  CLICK_EVENTS,
];

// ---------------------------------------------------------------------------
// Sample games — Game records with closure-shaped update / view fields.
// At runtime the storybook calls `gameToAnim` then samples the resulting
// Animation per frame to visualise. The closures use std + picture
// functions so they evaluate via the same registry the storybook builds.
// ---------------------------------------------------------------------------

type FenelClosure = {
  __fenelFn: true;
  params: string[];
  body: unknown;
  closure: Record<string, unknown>;
};

function fn(params: string[], body: unknown): FenelClosure {
  return { __fenelFn: true, params, body, closure: {} };
}

export type GameValue = {
  initial: unknown;
  update: unknown;
  view: unknown;
  inputs: EventValue;
};

const RED_COLOR = { r: 239, g: 68, b: 68, a: 255 };
const BLUE_COLOR = { r: 59, g: 130, b: 246, a: 255 };

// Click counter: each event increments the state. View renders a red
// circle whose radius equals the current count, centred at (8, 8).
const COUNTER_GAME: GameValue = {
  initial: 1,
  update: fn(["state", "input"], { "+": [{ var: "state" }, 1] }),
  view: fn(
    ["state"],
    {
      call: [
        "circle",
        { call: ["point", 8, 8] },
        { var: "state" },
        RED_COLOR,
      ],
    },
  ),
  inputs: {
    entries: [
      { timestamp: 0.5, payload: "click" },
      { timestamp: 1.0, payload: "click" },
      { timestamp: 1.5, payload: "click" },
      { timestamp: 2.0, payload: "click" },
    ],
  },
};

// Paddle: state replaced by latest input. View renders a moving red
// circle at the input's x-coordinate.
const PADDLE_GAME: GameValue = {
  initial: 4,
  update: fn(["s", "x"], { var: "x" }),
  view: fn(
    ["s"],
    {
      call: [
        "circle",
        { call: ["point", { var: "s" }, 8] },
        2,
        RED_COLOR,
      ],
    },
  ),
  inputs: {
    entries: [
      { timestamp: 0.25, payload: 4 },
      { timestamp: 0.75, payload: 7 },
      { timestamp: 1.25, payload: 11 },
      { timestamp: 1.75, payload: 8 },
      { timestamp: 2.25, payload: 4 },
    ],
  },
};

// Ball-bounce: input events alternate between ±1 dx; state holds (x, dx)
// as a pair, encoded as a record. View renders ball at x.
// (Simplified: state is just x; update adds the latest input.)
const BOUNCE_GAME: GameValue = {
  initial: 8,
  update: fn(
    ["s", "dx"],
    { "+": [{ var: "s" }, { var: "dx" }] },
  ),
  view: fn(
    ["s"],
    {
      call: [
        "circle",
        { call: ["point", { var: "s" }, 8] },
        2,
        BLUE_COLOR,
      ],
    },
  ),
  inputs: {
    entries: [
      { timestamp: 0.2, payload: 1 },
      { timestamp: 0.4, payload: 1 },
      { timestamp: 0.6, payload: 1 },
      { timestamp: 0.8, payload: -1 },
      { timestamp: 1.0, payload: -1 },
      { timestamp: 1.2, payload: -1 },
      { timestamp: 1.4, payload: 1 },
      { timestamp: 1.6, payload: 1 },
      { timestamp: 1.8, payload: 1 },
    ],
  },
};

export const SAMPLE_GAMES: GameValue[] = [
  COUNTER_GAME,
  PADDLE_GAME,
  BOUNCE_GAME,
];
