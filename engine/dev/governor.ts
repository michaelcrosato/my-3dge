/**
 * @file The performance governor (PLAN.md WP 7.5; the mechanism of `my-3d2dge:src/emberdeep/95-perf.js`, and
 * `shardfall:crates/pav_app/src/quality.rs:89-113`'s dynamic scale): while the view setting `quality` is `auto`, it
 * moves the page between the quality tiers (engine/gfx/quality.ts) as the frame rate asks, with hysteresis, and on a
 * touch screen scales the resolution as well. The page feeds it every drawn frame's real time (`frame(ms)`) and reads
 * the budget it affords (`budget(setting, touch)`) where it read `qualityBudget` before (engine/app/drawing.ts).
 *
 * It judges a second at a time (`GOVERNOR.window`): a second whose frames average slower than `slowMs` (under 50
 * frames a second) is bad, one faster than `fastMs` (over 57) good, any other neither. `drop` bad seconds in a row
 * demote a tier (high to medium to low); `calm` good ones in a row promote one, never above where `auto` starts (high,
 * or medium on a touch screen). A demotion within `relapse` seconds of a promotion doubles `calm` (from `calmStart`
 * up to `calmMax`), so a machine on the edge settles on the lower tier instead of flickering between two. On a touch
 * screen each bad second also shrinks the drawn pixels' scale by `scale.down` (to `scale.min`), and `scale.calm` good
 * seconds in a row grow it by `scale.up` (to 1), shardfall's dynamic resolution.
 *
 * Invariants: presentation only: it reads frame times and hands the view a budget; it never touches the sim, a
 * setting or the hash (the quality's tiers are view settings' effects). A tier set by hand (`quality` other than
 * `auto`) is kept as set, and the governor rests and starts again from `auto`'s tier when `auto` comes back.
 * `freeze(true)` holds it (a reproducible run: the page freezes it while a replay plays, and while the view setting
 * `gfx.governor` is false; the tools' virtual clock gives it even frames, so it never moves under them). Each move is logged once as advice, `GFX_GOVERNOR`, naming
 * the tier and why.
 *
 * @example
 * const governor = createGovernor({ log: { warnOnce: () => true } as never });
 * governor.budget('auto', false).tier; // 'high': where auto starts on a desktop
 * for (let i = 0; i < 4 * 25; i++) governor.frame(40); // four seconds at 25 frames a second
 * governor.budget('auto', false).tier; // 'medium'
 * governor.budget('high', false).tier; // 'high': a tier set by hand is kept
 * @see engine/dev/governor.test.ts
 */
import { defineCodes, log as sharedLog, type Log } from '../core/log';
import type { Field } from '../core/schema';
import { defineSettings } from '../core/settings';
import {
  qualityBudget,
  resolveQuality,
  type QualityBudget,
  type QualitySetting,
  type QualityTier,
} from '../gfx/quality';

/** Its advice code. */
export const GOVERNOR_CODES = defineCodes('gfx', {
  GFX_GOVERNOR: {
    template: 'the frame rate moved quality auto to {tier}: {reason}',
    fix: 'nothing to do for play; set quality to a tier (low, medium, high) to hold one, or gfx.governor to false',
    doc: 'Advice from the performance governor (engine/dev/governor.ts) when it moves the `auto` quality a tier.',
  },
});

/** Its view setting: whether it may move `auto`'s tier at all (a page that compares frames turns it off). */
export const GOVERNOR_SETTINGS = {
  'gfx.governor': {
    type: 'boolean',
    default: true,
    view: true,
    description:
      'Whether the performance governor may move quality auto between its tiers as the frame rate asks (engine/dev/governor.ts); a tier set by hand is kept either way.',
  },
} as const satisfies Record<string, Field>;
defineSettings(GOVERNOR_SETTINGS);

/** The governor's numbers (see the file comment): seconds, milliseconds a frame, and the scale's steps. */
export const GOVERNOR = {
  window: 1,
  slowMs: 20,
  fastMs: 17.6,
  drop: 3,
  calmStart: 10,
  calmMax: 80,
  relapse: 25,
  scale: { down: 0.88, up: 1.06, min: 0.6, calm: 4 },
} as const;

/** The tiers, best first. */
const TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

/** What the governor holds now. */
export interface GovernorState {
  /** The tier `auto` stands at, or null while `quality` is set by hand. */
  tier: QualityTier | null;
  /** The drawn pixels' scale on a touch screen (1 elsewhere). */
  scale: number;
  /** Good seconds needed in a row before a promotion. */
  calm: number;
  /** Bad and good seconds in a row, so far. */
  bad: number;
  good: number;
  /** Seconds it has run, and how often it moved. */
  seconds: number;
  moves: number;
  frozen: boolean;
}

/** The governor (see the file comment). */
export interface Governor {
  /** A drawn frame took `ms` of real time. */
  frame(ms: number): void;
  /** The budget `setting` affords now, on a touch screen (`touch`) or elsewhere. */
  budget(setting: QualitySetting, touch: boolean): QualityBudget;
  /** Holds it (true) or lets it run (false). */
  freeze(frozen: boolean): void;
  /** What it holds, as plain data. */
  state(): GovernorState;
}

/** Makes a governor; `log` takes its advice (the shared log by default). */
export function createGovernor(options: { log?: Pick<Log, 'warnOnce'> } = {}): Governor {
  const log = options.log ?? sharedLog;
  const s = { tier: null as QualityTier | null, start: 'high' as QualityTier, scale: 1, scaleCalm: 0, calm: GOVERNOR.calmStart as number, bad: 0, good: 0, seconds: 0, moves: 0, frozen: false, promoted: -Infinity }; // prettier-ignore
  let touch = false;
  let [ms, frames] = [0, 0];
  const move = (to: QualityTier, reason: string) => {
    s.tier = to;
    s.moves++;
    log.warnOnce('GFX_GOVERNOR', { tier: to, reason }, `${to}:${s.moves}`);
  };
  /** Judges one second whose frames averaged `mean` ms. */
  const second = (mean: number) => {
    s.seconds += GOVERNOR.window;
    const slow = mean > GOVERNOR.slowMs;
    const fast = mean < GOVERNOR.fastMs;
    [s.bad, s.good] = [slow ? s.bad + 1 : 0, fast ? s.good + 1 : 0];
    if (touch) {
      if (slow) [s.scale, s.scaleCalm] = [Math.max(GOVERNOR.scale.min, s.scale * GOVERNOR.scale.down), 0];
      else if (fast && ++s.scaleCalm >= GOVERNOR.scale.calm)
        [s.scale, s.scaleCalm] = [Math.min(1, s.scale * GOVERNOR.scale.up), 0]; // prettier-ignore
      else if (!fast) s.scaleCalm = 0;
    }
    const at = TIERS.indexOf(s.tier!);
    if (s.bad >= GOVERNOR.drop && at < TIERS.length - 1) {
      if (s.seconds - s.promoted < GOVERNOR.relapse) s.calm = Math.min(GOVERNOR.calmMax, s.calm * 2);
      move(TIERS[at + 1], `${s.bad} s under ${Math.round(1000 / GOVERNOR.slowMs)} frames a second`);
      s.bad = 0;
    } else if (s.good >= s.calm && at > TIERS.indexOf(s.start)) {
      move(TIERS[at - 1], `${s.good} s over ${Math.round(1000 / GOVERNOR.fastMs)} frames a second`);
      [s.good, s.promoted] = [0, s.seconds];
    }
  };
  return {
    frame(frameMs) {
      if (s.frozen || s.tier === null || !(frameMs > 0)) return;
      [ms, frames] = [ms + frameMs, frames + 1];
      if (ms < GOVERNOR.window * 1000 - 1e-6) return; // a second's frames, summed to rounding
      second(ms / frames);
      [ms, frames] = [0, 0];
    },
    budget(setting, onTouch) {
      if (setting !== 'auto') {
        [s.tier, s.scale, ms, frames] = [null, 1, 0, 0]; // at rest: `auto` starts again from its own tier
        return qualityBudget(setting, onTouch);
      }
      touch = onTouch;
      if (s.tier === null) [s.tier, s.start, s.bad, s.good] = [resolveQuality('auto', onTouch), resolveQuality('auto', onTouch), 0, 0]; // prettier-ignore
      const budget = qualityBudget(s.tier, onTouch);
      if (!onTouch || s.scale === 1) return budget;
      return {
        ...budget,
        maxPixels: budget.maxPixels === null ? null : budget.maxPixels * s.scale * s.scale,
        maxPixelRatio: budget.maxPixelRatio === null ? null : budget.maxPixelRatio * s.scale,
      };
    },
    freeze(frozen) {
      [s.frozen, ms, frames] = [frozen, 0, 0];
    },
    state() {
      const { tier, scale, calm, bad, good, seconds, moves, frozen } = s;
      return { tier, scale, calm, bad, good, seconds, moves, frozen };
    },
  };
}
