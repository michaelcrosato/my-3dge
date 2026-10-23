/**
 * @file The engine's foley as data (PLAN.md WP 13.22, docs/PLAYGROUND.md §8.1; doctrine: Assets): what a body, a
 * building and a gun sound like, as `sfx` entries (engine/audio/data/sfx.ts) the DSP renders, never sample files.
 * Beside the source's 33 chip effects (effects.ts), these aim at the real thing, each a few voices of filtered noise
 * and tones:
 * - footsteps on seven surfaces (`sfx:stepWood`, `stepTile`, `stepCarpet`, `stepConcrete`, `stepGrass`, `stepGravel`,
 *   `stepMetal`), which engine/world/footsteps.ts picks by a level's surface tag and the gait;
 * - movement: a slide, a body landing, a mantle, a climber's grip, a ladder's rung, a zipline's hook and its run (a
 *   loop), clothes as it crouches, a launch pad;
 * - doors and windows: a door opening, closing, rattled locked, kicked in; a window sliding, glass breaking, a switch;
 * - hands and blows: a grab, a swish through the air, a punch and a kick landing, a body falling;
 * - impacts by material (wood, metal, concrete, glass, a body, dirt), where a shot or a thrown thing strikes;
 * - guns: a pistol's and a rifle's shot, a reload, a dry fire, a gun drawn and put away;
 * - wind past the ears, a loop on the ambience bus that a page raises with speed.
 *
 * Invariants: ids start `sfx:` and meet none of the chip effects'; the often heard ones have variants (`vary` spreads
 * their pitch), so a hundred steps never repeat exactly; a loop names the pass it repeats (`loop`), its voices fading
 * in at its start and out past its end by as much, so played looped its tail folds over its start with no seam (a tone
 * in one turns a whole number of times a pass, so the fold adds it to itself in phase); each
 * stays below full scale on its own, loud ones (the shots) leaving room for a mix.
 *
 * @example
 * import { renderSfx } from './sfx';
 * renderSfx('sfx:stepWood', { variant: 1 }).length; // 4410: 0.1 s at 44,100 Hz
 * FOLEY['sfx:zipRun'].bus; // undefined: the effects bus, looped while it rides
 * @see engine/audio/data/foley.test.ts
 */
import type { SfxSpec } from './sfx';

/** A foley effect: `variants` versions (4), their pitch spread by `vary`, on the effects bus. */
const foley = (voices: SfxSpec['voices'], vary = 0.06, variants = 4): SfxSpec => ({ voices, variants, vary });

/** A filter round `freq` Hz, `q` wide (Web Audio's names). */
const band = (freq: number, q = 1) => ({ type: 'bandpass', freq, q }) as const;
const low = (freq: number, to?: number) => ({ type: 'lowpass', freq, ...(to ? { to } : {}) }) as const;
const high = (freq: number) => ({ type: 'highpass', freq }) as const;

/** The foley by id. */
export const FOLEY: Readonly<Record<string, SfxSpec>> = {
  // footsteps: a heel's strike and what the floor does with it
  'sfx:stepWood': foley([
    { wave: 'noise', dur: 0.1, vol: 0.34, filter: band(240, 2.2) }, // a hollow knock
    { wave: 'sine', freq: 185, to: 150, dur: 0.09, vol: 0.16 }, // the board's ring
    { wave: 'noise', dur: 0.016, vol: 0.09, filter: high(3500) }, // the heel's click
  ], 0.08), // prettier-ignore
  'sfx:stepTile': foley([
    { wave: 'noise', dur: 0.022, vol: 0.24, filter: high(4200) },
    { wave: 'triangle', freq: 2350, dur: 0.05, vol: 0.045 },
    { wave: 'sine', freq: 170, to: 105, dur: 0.05, vol: 0.15 },
  ]), // prettier-ignore
  'sfx:stepCarpet': foley([
    { wave: 'noise', dur: 0.1, vol: 0.2, filter: low(520, 260) },
    { wave: 'sine', freq: 100, to: 65, dur: 0.07, vol: 0.12 },
  ], 0.1), // prettier-ignore
  'sfx:stepConcrete': foley([
    { wave: 'noise', dur: 0.07, vol: 0.2, filter: low(1500, 600) }, // grit under the sole
    { wave: 'noise', dur: 0.02, vol: 0.07, filter: high(2600) },
    { wave: 'sine', freq: 150, to: 72, dur: 0.07, vol: 0.24 },
  ], 0.08), // prettier-ignore
  'sfx:stepGrass': foley([
    { wave: 'noise', dur: 0.15, vol: 0.09, attack: 0.025, filter: high(2300) }, // the blades' swish
    { wave: 'noise', dur: 0.06, vol: 0.08, filter: band(850, 1.4) },
    { wave: 'sine', freq: 95, to: 62, dur: 0.05, vol: 0.07 },
  ], 0.12), // prettier-ignore
  'sfx:stepGravel': foley([
    { wave: 'noise', dur: 0.11, vol: 0.13, filter: low(950) }, // the crunch, and the stones in a quick spill
    { wave: 'noise', dur: 0.014, vol: 0.16, filter: band(2900, 3) },
    { wave: 'noise', dur: 0.014, at: 0.013, vol: 0.11, filter: band(3600, 3) },
    { wave: 'noise', dur: 0.014, at: 0.028, vol: 0.13, filter: band(2500, 3) },
    { wave: 'noise', dur: 0.014, at: 0.044, vol: 0.09, filter: band(4100, 3) },
    { wave: 'noise', dur: 0.014, at: 0.063, vol: 0.08, filter: band(3100, 3) },
    { wave: 'noise', dur: 0.014, at: 0.085, vol: 0.05, filter: band(3800, 3) },
  ], 0.1), // prettier-ignore
  'sfx:stepMetal': foley([
    { wave: 'noise', dur: 0.025, vol: 0.14, filter: high(4000) }, // a tick, then a grate's inharmonic ring
    { wave: 'triangle', freq: 615, dur: 0.22, vol: 0.11 },
    { wave: 'triangle', freq: 1590, dur: 0.14, vol: 0.06 },
    { wave: 'sine', freq: 140, to: 82, dur: 0.06, vol: 0.14 },
  ], 0.05), // prettier-ignore

  // movement
  'sfx:slide': foley([
    { wave: 'noise', dur: 0.6, vol: 0.17, attack: 0.03, release: 0.3, filter: low(1900, 500) }, // cloth and sole
    { wave: 'noise', dur: 0.5, vol: 0.06, attack: 0.03, release: 0.25, filter: band(3300, 1.2) },
  ], 0.08, 3), // prettier-ignore
  'sfx:landBody': foley([
    { wave: 'sine', freq: 115, to: 45, dur: 0.2, vol: 0.42 }, // the body's weight coming down
    { wave: 'noise', dur: 0.12, vol: 0.24, filter: low(900, 200) },
    { wave: 'noise', dur: 0.04, vol: 0.07, filter: high(3000) }, // the clothes' slap
  ], 0.06, 3), // prettier-ignore
  'sfx:mantle': foley([
    { wave: 'noise', dur: 0.04, vol: 0.2, filter: band(1300, 1.5) }, // both hands on the ledge
    { wave: 'noise', dur: 0.04, at: 0.05, vol: 0.16, filter: band(1100, 1.5) },
    { wave: 'noise', dur: 0.32, at: 0.09, vol: 0.06, attack: 0.05, filter: band(2200, 0.8) }, // the pull's scrape
    { wave: 'saw', freq: 150, to: 118, dur: 0.17, at: 0.08, vol: 0.05, attack: 0.02, filter: band(650, 2) }, // effort
  ], 0.07, 3), // prettier-ignore
  'sfx:climbGrip': foley([
    { wave: 'noise', dur: 0.035, vol: 0.18, filter: band(1400, 1.6) }, // a hand slapped on the wall
    { wave: 'noise', dur: 0.08, at: 0.04, vol: 0.07, filter: band(2600) }, // a shoe's scuff
  ], 0.08), // prettier-ignore
  'sfx:ladderRung': foley([
    { wave: 'noise', dur: 0.02, vol: 0.12, filter: high(3500) },
    { wave: 'triangle', freq: 880, dur: 0.13, vol: 0.09 },
    { wave: 'triangle', freq: 2310, dur: 0.07, vol: 0.045 },
  ]), // prettier-ignore
  'sfx:zipAttach': foley([
    { wave: 'noise', dur: 0.015, vol: 0.12, filter: high(4000) }, // the hook clipping onto the cable
    { wave: 'triangle', freq: 2650, dur: 0.09, vol: 0.07 },
    { wave: 'triangle', freq: 3920, dur: 0.06, vol: 0.04 },
    { wave: 'sine', freq: 220, to: 160, dur: 0.06, vol: 0.08 },
  ], 0.04, 3), // prettier-ignore
  'sfx:zipRun': { ...foley([
    { wave: 'saw', freq: 190, dur: 2.25, vol: 0.05, attack: 0.25, release: 0.25, vib: [9, 0.012], filter: band(850, 3) },
    { wave: 'noise', dur: 2.25, vol: 0.06, attack: 0.25, release: 0.25, filter: band(1900) }, // the trolley's hiss
  ], 0, 1), loop: 2 }, // prettier-ignore
  'sfx:crouchCloth': foley([
    { wave: 'noise', dur: 0.16, vol: 0.07, attack: 0.03, filter: band(1800, 0.9) },
    { wave: 'noise', dur: 0.09, at: 0.04, vol: 0.04, filter: band(3200, 1.2) },
  ], 0.1, 3), // prettier-ignore
  'sfx:launch': foley([
    { wave: 'sine', freq: 90, to: 50, dur: 0.18, vol: 0.35 }, // the pad's pneumatic thump
    { wave: 'noise', dur: 0.45, vol: 0.14, attack: 0.02, filter: { type: 'bandpass', freq: 500, to: 2600, q: 1.2 } },
  ], 0.05, 3), // prettier-ignore

  // doors, windows and switches
  'sfx:doorOpen': foley([
    { wave: 'square', freq: 1900, dur: 0.012, vol: 0.06 }, // the latch
    { wave: 'noise', dur: 0.018, vol: 0.09, filter: high(3000) },
    { wave: 'saw', freq: 260, to: 390, dur: 0.42, at: 0.04, vol: 0.04, attack: 0.06, vib: [6, 0.02], filter: band(700, 4) },
  ], 0.08, 3), // prettier-ignore
  'sfx:doorClose': foley([
    { wave: 'sine', freq: 95, to: 52, dur: 0.16, vol: 0.32 }, // the leaf meeting its frame
    { wave: 'noise', dur: 0.1, vol: 0.18, filter: low(650) },
    { wave: 'square', freq: 1700, dur: 0.012, at: 0.05, vol: 0.05 }, // the latch catching
    { wave: 'noise', dur: 0.015, at: 0.05, vol: 0.07, filter: high(3000) },
  ], 0.06, 3), // prettier-ignore
  'sfx:doorLocked': foley([
    { wave: 'noise', dur: 0.03, vol: 0.12, filter: band(900, 1.5) }, // the latch knocking in its strike, thrice
    { wave: 'square', freq: 1450, dur: 0.012, vol: 0.05 },
    { wave: 'noise', dur: 0.03, at: 0.07, vol: 0.1, filter: band(950, 1.5) },
    { wave: 'square', freq: 1500, dur: 0.012, at: 0.07, vol: 0.04 },
    { wave: 'noise', dur: 0.03, at: 0.14, vol: 0.11, filter: band(880, 1.5) },
    { wave: 'square', freq: 1420, dur: 0.012, at: 0.14, vol: 0.045 },
  ], 0.04, 3), // prettier-ignore
  'sfx:doorBreak': foley([
    { wave: 'noise', dur: 0.12, vol: 0.4, filter: low(3200, 900) }, // the crack
    { wave: 'noise', dur: 0.02, at: 0.03, vol: 0.16, filter: band(2600, 3) }, // splinters
    { wave: 'noise', dur: 0.02, at: 0.06, vol: 0.12, filter: band(3300, 3) },
    { wave: 'noise', dur: 0.02, at: 0.1, vol: 0.09, filter: band(2200, 3) },
    { wave: 'sine', freq: 82, to: 40, dur: 0.3, at: 0.04, vol: 0.34 }, // the leaf's thud
  ], 0.05, 3), // prettier-ignore
  'sfx:windowSlide': foley([
    { wave: 'noise', dur: 0.38, vol: 0.09, attack: 0.05, filter: band(1200, 1.5) }, // the sash in its frame
    { wave: 'sine', freq: 140, to: 92, dur: 0.07, at: 0.36, vol: 0.14 }, // and its stop
    { wave: 'noise', dur: 0.02, at: 0.36, vol: 0.06, filter: high(2800) },
  ], 0.06, 3), // prettier-ignore
  'sfx:glassBreak': foley([
    { wave: 'noise', dur: 0.25, vol: 0.32, filter: high(2400) }, // the crash, then the pieces falling
    { wave: 'noise', dur: 0.08, vol: 0.18, filter: band(1200) },
    { wave: 'triangle', freq: 3150, dur: 0.07, at: 0.04, vol: 0.06 },
    { wave: 'triangle', freq: 4480, dur: 0.06, at: 0.09, vol: 0.05 },
    { wave: 'triangle', freq: 5230, dur: 0.05, at: 0.15, vol: 0.05 },
    { wave: 'triangle', freq: 3720, dur: 0.07, at: 0.22, vol: 0.04 },
    { wave: 'triangle', freq: 6080, dur: 0.05, at: 0.3, vol: 0.035 },
    { wave: 'triangle', freq: 4150, dur: 0.06, at: 0.38, vol: 0.03 },
  ], 0.05, 3), // prettier-ignore
  'sfx:switchClick': foley([
    { wave: 'square', freq: 2400, dur: 0.012, vol: 0.08 },
    { wave: 'noise', dur: 0.012, vol: 0.09, filter: high(3200) },
    { wave: 'square', freq: 1150, dur: 0.012, at: 0.028, vol: 0.05 }, // the rocker's clack
  ], 0.04, 3), // prettier-ignore

  // hands and blows
  'sfx:grab': foley([
    { wave: 'noise', dur: 0.06, vol: 0.12, filter: band(1500, 1.2) },
    { wave: 'sine', freq: 210, to: 150, dur: 0.04, vol: 0.08 },
  ], 0.08, 3), // prettier-ignore
  'sfx:swish': foley([
    { wave: 'noise', dur: 0.2, vol: 0.14, attack: 0.06, filter: { type: 'bandpass', freq: 650, to: 1900, q: 1.3 } },
  ], 0.1), // prettier-ignore
  'sfx:punchHit': foley([
    { wave: 'noise', dur: 0.03, vol: 0.3, filter: band(2200, 1.1) }, // a sharp smack over a dull thud
    { wave: 'sine', freq: 150, to: 72, dur: 0.1, vol: 0.36 },
    { wave: 'noise', dur: 0.07, vol: 0.16, filter: low(900) },
  ], 0.08), // prettier-ignore
  'sfx:kickHit': foley([
    { wave: 'noise', dur: 0.035, vol: 0.3, filter: band(1700, 1.1) }, // heavier, lower and longer
    { wave: 'sine', freq: 115, to: 50, dur: 0.16, vol: 0.42 },
    { wave: 'noise', dur: 0.1, vol: 0.18, filter: low(700) },
  ], 0.07), // prettier-ignore
  'sfx:bodyFall': foley([
    { wave: 'sine', freq: 95, to: 42, dur: 0.25, vol: 0.42 }, // the weight, a bounce, the clothes
    { wave: 'noise', dur: 0.14, vol: 0.2, filter: low(800, 200) },
    { wave: 'sine', freq: 85, to: 45, dur: 0.14, at: 0.16, vol: 0.2 },
    { wave: 'noise', dur: 0.18, at: 0.02, vol: 0.05, filter: band(2400, 0.9) },
  ], 0.06, 3), // prettier-ignore

  // impacts by material
  'sfx:impactWood': foley([
    { wave: 'noise', dur: 0.045, vol: 0.28, filter: band(1800) },
    { wave: 'noise', dur: 0.08, vol: 0.22, filter: band(380, 3) },
    { wave: 'sine', freq: 320, to: 230, dur: 0.06, vol: 0.14 },
  ], 0.08), // prettier-ignore
  'sfx:impactMetal': foley([
    { wave: 'noise', dur: 0.02, vol: 0.18, filter: high(3800) }, // a ping, and the plate ringing
    { wave: 'triangle', freq: 1760, dur: 0.32, vol: 0.11 },
    { wave: 'triangle', freq: 4310, dur: 0.16, vol: 0.05 },
    { wave: 'sine', freq: 905, dur: 0.22, vol: 0.05 },
  ], 0.05), // prettier-ignore
  'sfx:impactConcrete': foley([
    { wave: 'noise', dur: 0.03, vol: 0.3, filter: high(2500) }, // a crack, and grit sprayed
    { wave: 'noise', dur: 0.16, vol: 0.14, filter: low(1400, 450) },
  ], 0.08), // prettier-ignore
  'sfx:impactGlass': foley([
    { wave: 'noise', dur: 0.04, vol: 0.24, filter: high(3000) },
    { wave: 'triangle', freq: 3900, dur: 0.06, at: 0.02, vol: 0.05 },
    { wave: 'triangle', freq: 5400, dur: 0.05, at: 0.06, vol: 0.04 },
  ], 0.06), // prettier-ignore
  'sfx:impactBody': foley([
    { wave: 'sine', freq: 135, to: 70, dur: 0.09, vol: 0.34 },
    { wave: 'noise', dur: 0.05, vol: 0.2, filter: band(900, 1.2) },
  ], 0.08), // prettier-ignore
  'sfx:impactDirt': foley([
    { wave: 'sine', freq: 105, to: 60, dur: 0.08, vol: 0.2 },
    { wave: 'noise', dur: 0.16, vol: 0.14, attack: 0.008, filter: low(2100, 800) }, // earth thrown up
  ], 0.1), // prettier-ignore

  // guns
  'sfx:pistolShot': foley([
    { wave: 'noise', dur: 0.035, vol: 0.4, filter: high(1800) }, // the crack
    { wave: 'sine', freq: 160, to: 45, dur: 0.2, vol: 0.34 }, // the bang's body
    { wave: 'noise', dur: 0.5, vol: 0.13, filter: low(1000, 160) }, // its tail
    { wave: 'square', freq: 2100, dur: 0.012, at: 0.035, vol: 0.04 }, // the slide
  ], 0.04), // prettier-ignore
  'sfx:rifleShot': foley([
    { wave: 'noise', dur: 0.03, vol: 0.4, filter: high(2500) },
    { wave: 'sine', freq: 125, to: 36, dur: 0.3, vol: 0.36 },
    { wave: 'noise', dur: 0.9, vol: 0.14, filter: low(1300, 120) }, // a longer tail, rolling away
    { wave: 'square', freq: 1800, dur: 0.012, at: 0.05, vol: 0.04 },
  ], 0.03), // prettier-ignore
  'sfx:reload': foley([
    { wave: 'square', freq: 1300, dur: 0.012, vol: 0.05 }, // the magazine out,
    { wave: 'noise', dur: 0.03, vol: 0.1, filter: band(1500, 1.4) },
    { wave: 'square', freq: 900, dur: 0.015, at: 0.35, vol: 0.06 }, // the new one in,
    { wave: 'noise', dur: 0.04, at: 0.35, vol: 0.14, filter: band(1100, 1.2) },
    { wave: 'noise', dur: 0.08, at: 0.62, vol: 0.12, filter: band(2200) }, // the slide racked
    { wave: 'square', freq: 2000, dur: 0.012, at: 0.7, vol: 0.06 },
  ], 0.03, 3), // prettier-ignore
  'sfx:dryFire': foley([
    { wave: 'square', freq: 2600, dur: 0.012, vol: 0.08 },
    { wave: 'noise', dur: 0.012, vol: 0.07, filter: high(3500) },
  ], 0.04, 3), // prettier-ignore
  'sfx:drawGun': foley([
    { wave: 'noise', dur: 0.12, vol: 0.07, attack: 0.02, filter: band(1700) },
    { wave: 'square', freq: 1600, dur: 0.012, at: 0.11, vol: 0.05 },
  ], 0.05, 3), // prettier-ignore
  'sfx:holsterGun': foley([
    { wave: 'noise', dur: 0.14, vol: 0.06, attack: 0.03, filter: band(1500) },
    { wave: 'sine', freq: 180, to: 140, dur: 0.04, at: 0.12, vol: 0.06 },
  ], 0.05, 3), // prettier-ignore

  // the air
  'sfx:wind': {
    voices: [
      { wave: 'noise', dur: 4, vol: 0.12, attack: 1, release: 1, filter: band(420, 0.6) }, // gusts past the ears
      { wave: 'noise', dur: 4, vol: 0.05, attack: 1, release: 1, filter: { type: 'bandpass', freq: 1500, to: 1100, q: 1.5 } }, // prettier-ignore
    ],
    variants: 1,
    bus: 'ambience',
    loop: 3,
  },
};
