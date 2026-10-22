/**
 * @file The engine's emitters (PLAN.md WP 6.4, §5.8), as plain `emitter` specs (engine/gfx/fx/emitters.ts declares
 * the kind and registers these with it):
 * - **Shardfall's 13 presets**, its tuned numbers as they are (it uses the engine's axes and units): smoke, steam,
 *   sparks, embers, fountain, snow, rain, fireflies, magic, dust, bubbles, confetti and fire, each with its rate.
 *   Its linear colours are written as a hex colour and a brightness (the largest channel when above 1: sparks are
 *   `#ffc171` at 6). A preset lands on the floor where shardfall's did (streaks, and bouncing falls). Its `count`, a
 *   burst's size, is new: shardfall's presets had none.
 * - **The 2D engine's particle kinds** that the presets lack, in metres (16 units to the metre, gravity −480 u/s²
 *   becoming 30 m/s²): `bits` (debris that bounces), `impact` (a hit's star) and `glints` (twinkles).
 * - **Event effects**, answering event types: shardfall's event bursts (hit, explosion, slain, slam, block, shot,
 *   destroyed, land), with the 2D engine's star, debris, shockwave ring and camera shake (`hitFx` and `explosion`:
 *   1.5 to 3 units of shake, 0.0125 m a unit as the Stress test's camera moved). An event's `size` scales them: an
 *   explosion's radius, a body's size (engine/gfx/fx/effects.ts). The house's breaks (WP 13.16, engine/sim/
 *   breakables.ts): `glass` (a pane's shards fall and glint, landing nowhere: a window's sill is no floor),
 *   `splinters` (a door's) and `shatter`, landing on the floor the event names (`ground`).
 * The 2D engine's `text` particles are the overlay's damage numbers (engine/ui, WP 6.5), never particles here.
 *
 * Carried from `shardfall:crates/pav_view/src/fx.rs:13-229` (`preset`), `:264-276` (`light`'s flicker and pulse:
 * the fire's light) and `:290-480` (`event_bursts`), and `my-3d2dge:engine/my-3d2dge.js:937-1035` (`Particles`: dust,
 * spark, bit, ember, ring, text; `explosion`, `fire`, `smoke`) with `:1569-1580` (`hitFx`).
 *
 * Invariants: plain data (the kind's fields only), ids `emitter:<name>`; a layer names an emitter defined here.
 *
 * @example
 * BUILT_IN_EMITTERS['emitter:sparks'].rate; // 40: shardfall's sparks, per second
 * @see engine/gfx/fx/emitters.test.ts
 */
import type { EmitterSpec } from './emitters';

/** Shardfall's 13 presets: see the file comment. */
const PRESETS = {
  'emitter:smoke': {
    description: 'Rising smoke that darkens, spreads and fades (shardfall).',
    ...{ area: [0.2, 0.05, 0.2], velocity: [0, 0.9, 0], spread: 0.3, gravity: -0.3, drag: 0.6, turbulence: 1 },
    ...{ life: [2.2, 3.6], size: [0.15, 0.75], color: ['#818186', '#b3b3b8'], alpha: [0.55, 0], additive: false },
    ...{ rate: 14, count: 6 },
  },
  'emitter:steam': {
    description: 'White steam rising fast and thinning out (shardfall).',
    ...{ area: [0.15, 0.02, 0.15], velocity: [0, 1.6, 0], spread: 0.4, gravity: -0.5, drag: 1, turbulence: 1.5 },
    ...{ life: [1, 1.8], size: [0.1, 0.6], color: ['#f3f6f9', '#ffffff'], alpha: [0.45, 0], additive: false },
    ...{ rate: 20, count: 8 },
  },
  'emitter:sparks': {
    description: 'Hot sparks streaking out, falling and bouncing on the floor (shardfall).',
    ...{ velocity: [0, 3.5, 0], spread: 3, gravity: 9.8, drag: 0.3, life: [0.4, 1], size: [0.05, 0.015] },
    ...{ color: ['#ffc171', '#ff7c3f'], brightness: [6, 2], alpha: [1, 0], stretch: true, lands: true, bounce: 0.35 },
    ...{ rate: 40, count: 16 },
  },
  'emitter:embers': {
    description: 'Glowing embers drifting up and swirling, shrinking as they cool (shardfall).',
    ...{ area: [0.3, 0.05, 0.3], velocity: [0, 1.2, 0], spread: 0.6, gravity: -0.4, drag: 0.5, turbulence: 2.5 },
    ...{ life: [1.5, 3], size: [0.035, 0], color: ['#ff9945', '#ff5900'], brightness: [5, 1.5], alpha: [1, 0] },
    ...{ rate: 12, count: 8 },
  },
  'emitter:fountain': {
    description: 'A jet of water arcing up and falling back (shardfall).',
    ...{
      area: [0.05, 0, 0.05],
      velocity: [0, 6.5, 0],
      spread: 0.9,
      gravity: 9.8,
      life: [1.3, 1.7],
      size: [0.09, 0.06],
    },
    ...{ color: ['#bcdbff', '#b3d3ff'], brightness: [1.1, 1], alpha: [0.85, 0], additive: false, stretch: true },
    ...{ lands: true, bounce: 0.1, rate: 90, count: 40 },
  },
  'emitter:snow': {
    description: 'Snow drifting down over a 12 m square (shardfall).',
    ...{ area: [6, 0, 6], velocity: [0, -1, 0], spread: 0.25, turbulence: 0.8, life: [6, 8], size: [0.05, 0.05] },
    ...{ color: ['#ffffff', '#ffffff'], alpha: [0.95, 0.4], additive: false, bounce: 0, rate: 60, prewarm: 6 },
  },
  'emitter:rain': {
    description: 'Rain streaking down over a 12 m square (shardfall).',
    ...{ area: [6, 0, 6], velocity: [0.3, -14, 0], spread: 0.3, life: [0.8, 1], size: [0.02, 0.02] },
    ...{ color: ['#dae7ff', '#dae7ff'], alpha: [0.55, 0.35], additive: false, stretch: true, lands: true },
    ...{ bounce: 0, rate: 300, prewarm: 1 },
  },
  'emitter:fireflies': {
    description: 'Fireflies wandering over a 6 m square, glowing and fading (shardfall).',
    ...{ area: [3, 1, 3], spread: 0.3, turbulence: 2.2, life: [3, 6], size: [0.08, 0.06] },
    ...{ color: ['#f8ff89', '#e3ff6d'], brightness: [3.2, 2.6], alpha: [1, 0], rate: 6, prewarm: 6 },
  },
  'emitter:magic': {
    description: 'Violet sparkles rising and swirling, turning blue (shardfall).',
    ...{ area: [0.3, 0.1, 0.3], velocity: [0, 1, 0], spread: 1.4, gravity: -0.6, drag: 0.8, turbulence: 3 },
    ...{ life: [0.8, 1.5], size: [0.08, 0], color: ['#bc81ff', '#5995ff'], brightness: [3.2, 3], alpha: [1, 0] },
    ...{ rate: 40, count: 14 },
  },
  'emitter:dust': {
    description: 'A puff of dust that billows and settles (shardfall).',
    ...{ area: [0.3, 0.02, 0.3], velocity: [0, 0.4, 0], spread: 1.2, gravity: 0.5, drag: 2, life: [0.6, 1.2] },
    ...{ size: [0.1, 0.35], color: ['#e1d7c8', '#e7e1d7'], alpha: [0.5, 0], additive: false, lands: true },
    ...{ rate: 20, count: 12 },
  },
  'emitter:bubbles': {
    description: 'Bubbles wobbling up (shardfall).',
    ...{ area: [0.4, 0.05, 0.4], velocity: [0, 1, 0], spread: 0.2, gravity: -0.8, drag: 0.8, turbulence: 1.5 },
    ...{ life: [1.5, 2.5], size: [0.05, 0.08], color: ['#d5e6ff', '#e1ebff'], brightness: [1.2, 1.2] },
    ...{ alpha: [0.5, 0], additive: false, rate: 15, count: 10 },
  },
  'emitter:confetti': {
    description: 'Confetti thrown up, fluttering down pink to gold (shardfall).',
    ...{ velocity: [0, 6, 0], spread: 3.5, gravity: 4, drag: 1.2, turbulence: 2, life: [2.5, 3.5] },
    ...{ size: [0.06, 0.06], color: ['#ffaacb', '#ffe795'], alpha: [1, 0.8], additive: false, bounce: 0 },
    ...{ rate: 30, count: 40 },
  },
  'emitter:fire': {
    description: 'Flames licking up, white-hot to red, with a flickering light (shardfall).',
    ...{ area: [0.22, 0.05, 0.22], velocity: [0, 1.5, 0], spread: 0.45, gravity: -1.5, drag: 1, turbulence: 1.5 },
    ...{ life: [0.45, 0.9], size: [0.3, 0.04], color: ['#ffae5e', '#ff713a'], brightness: [4, 1.2] },
    ...{ alpha: [0.9, 0], rate: 70, count: 12 },
    light: { color: '#ffb070', intensity: 30, distance: 10, offset: [0, 0.4, 0], flicker: 0.6 },
  },
} satisfies Record<string, EmitterSpec>;

/** The 2D engine's particle kinds the presets lack: see the file comment. */
const KINDS = {
  'emitter:bits': {
    description: 'Debris chips thrown up and out, bouncing on the floor (the 2D engine’s bits).',
    ...{ area: [0.1, 0.2, 0.1], velocity: [0, 7.5, 0], spread: 4.7, gravity: 26.25, drag: 0.8, life: [0.7, 1.3] },
    ...{ size: [0.06, 0.06], color: ['#6a5a4a', '#3a3438'], alpha: [1, 1], additive: false, lands: true },
    ...{ bounce: 0.45, count: 8 },
  },
  'emitter:impact': {
    description: 'The star where a hit lands: a white pop turning gold (the 2D engine’s impact).',
    ...{ spread: 0, life: [0.16, 0.16], size: [0.375, 0.15], color: ['#ffffff', '#ffe070'], brightness: [2, 1.5] },
    ...{ alpha: [1, 0.4], count: 1 },
  },
  'emitter:glints': {
    description: 'Pale gold twinkles for magic, treasure and pickups (the 2D engine’s glints).',
    ...{ area: [0.3, 0.3, 0.3], velocity: [0, 0.375, 0], spread: 0.1, life: [0.35, 0.75], size: [0.1, 0] },
    ...{ color: ['#fff6c0', '#fff6c0'], brightness: [2, 1], alpha: [1, 0], count: 5 },
  },
} satisfies Record<string, EmitterSpec>;

/** Event effects: see the file comment. */
const EVENTS = {
  'emitter:hit': {
    description: 'A hit: sparks flying from where it lands, a white star, a little shake.',
    ...{ events: ['hit'], shake: 0.03 },
    layers: [
      { emitter: 'emitter:sparks', count: 16, set: { spread: 3.5, velocity: [0, 1, 0], life: [0.2, 0.45] } },
      { emitter: 'emitter:impact', count: 1 },
    ],
  },
  'emitter:explosion': {
    description: 'An explosion: a fireball, sparks, smoke and debris, a shockwave ring on the floor, a shake.',
    ...{ events: ['explosion'], shake: 0.03 },
    ring: { radius: [0.19, 1.6], width: 0.12, color: '#ffe0a0', alpha: 0.9, life: 0.4 },
    layers: [
      { emitter: 'emitter:sparks', count: 70, set: { spread: 7, velocity: [0, 2, 0], floor: -0.3 } },
      {
        emitter: 'emitter:fire',
        count: 45,
        set: { area: [0.4, 0.4, 0.4], spread: 2.5, size: [0.35, 0.05], life: [0.25, 0.55] },
      },
      {
        emitter: 'emitter:smoke',
        count: 22,
        offset: [0, 0.3, 0],
        set: { area: [0.5, 0.5, 0.5], spread: 1.2, size: [0.3, 1.1] },
      },
      { emitter: 'emitter:bits', count: 8, set: { color: ['#6a5a4a', '#ffb040'] } },
    ],
  },
  'emitter:slain': {
    description: 'A body falls: dust billowing round it and pale embers rising.',
    events: ['slain'],
    layers: [
      {
        emitter: 'emitter:dust',
        count: 14,
        offset: [0, 0.2, 0],
        set: { area: [0.5, 0.2, 0.5], spread: 1.6, size: [0.175, 0.45] },
      },
      {
        emitter: 'emitter:embers',
        count: 14,
        offset: [0, 0.6, 0],
        set: { velocity: [0, 2.2, 0], spread: 1.2, color: ['#ffedcb', '#ff5900'], brightness: [1.3, 1.5] },
      },
    ],
  },
  'emitter:slam': {
    description: 'A slam on the floor: a ring of dust and sparks skipping off the floor.',
    ...{ events: ['slam'], shake: 0.04 },
    ring: { radius: [0.3, 1.5], width: 0.15, color: '#e1d7c8', alpha: 0.6, life: 0.35 },
    layers: [
      {
        emitter: 'emitter:dust',
        count: 18,
        offset: [0, 0.15, 0],
        set: { area: [0.6, 0.05, 0.6], spread: 3, velocity: [0, 0.8, 0], size: [0.4, 1.2] },
      },
      { emitter: 'emitter:sparks', count: 20, offset: [0, 0.2, 0], set: { spread: 5, velocity: [0, 3, 0] } },
    ],
  },
  'emitter:block': {
    description: 'A blocked blow: cold blue-white sparks a metre up.',
    events: ['block'],
    layers: [
      {
        emitter: 'emitter:sparks',
        count: 18,
        offset: [0, 1, 0],
        set: { spread: 3, color: ['#e7f3ff', '#ff7c3f'], brightness: [1.5, 2] },
      },
    ],
  },
  'emitter:shot': {
    description: 'A shot leaving: a brief cyan flash of sparks that never land.',
    events: ['shot'],
    layers: [
      {
        emitter: 'emitter:sparks',
        count: 3,
        set: {
          spread: 1,
          velocity: [0, 0, 0],
          life: [0.05, 0.12],
          color: ['#a5e1ff', '#ff7c3f'],
          brightness: [4, 2],
          lands: false,
        },
      },
    ],
  },
  'emitter:destroyed': {
    description: 'Something blown apart: a burst of sparks and flame.',
    ...{ events: ['destroyed'], shake: 0.02 },
    layers: [
      { emitter: 'emitter:sparks', count: 40, set: { spread: 6, velocity: [0, 0, 0], lands: false } },
      {
        emitter: 'emitter:fire',
        count: 30,
        set: { area: [0.5, 0.5, 0.5], spread: 2, size: [0.3, 0.05], life: [0.25, 0.6] },
      },
      { emitter: 'emitter:bits', count: 10 },
    ],
  },
  'emitter:land': {
    description: 'A hard landing: a puff of dust at the feet.',
    events: ['land'],
    layers: [{ emitter: 'emitter:dust', count: 12, set: { spread: 2 } }],
  },
  'emitter:glass': {
    description: 'A pane breaking: pale shards falling and fading, and twinkles where it stood.',
    events: ['glass'],
    layers: [
      {
        emitter: 'emitter:bits',
        count: 26,
        set: {
          ...{ area: [0.25, 0.6, 0.05], velocity: [0, 1.5, 0], spread: 3, gravity: 9.8, life: [0.4, 0.7] },
          ...{ size: [0.05, 0.03], color: ['#e6f4fb', '#9cc3d6'], lands: false },
        },
      },
      { emitter: 'emitter:glints', count: 8, set: { area: [0.25, 0.6, 0.1] } },
    ],
  },
  'emitter:splinters': {
    description: 'Wood breaking: splinters and chips thrown out, bouncing on the floor, and a puff of dust.',
    ...{ events: ['splinters'], shake: 0.02 },
    layers: [
      {
        emitter: 'emitter:bits',
        count: 18,
        set: { area: [0.4, 0.9, 0.1], size: [0.07, 0.05], color: ['#a8794a', '#5c3b22'] },
      },
      { emitter: 'emitter:dust', count: 10, set: { area: [0.4, 0.8, 0.2], spread: 1.2 } },
    ],
  },
  'emitter:shatter': {
    description: 'Something breaking: debris bouncing on the floor and a puff of dust.',
    events: ['shatter'],
    layers: [
      { emitter: 'emitter:bits', count: 12 },
      { emitter: 'emitter:dust', count: 8, set: { spread: 1.5 } },
    ],
  },
} satisfies Record<string, EmitterSpec>;

/** The engine's emitters, by id. */
export const BUILT_IN_EMITTERS: Record<string, EmitterSpec> = { ...PRESETS, ...KINDS, ...EVENTS };
