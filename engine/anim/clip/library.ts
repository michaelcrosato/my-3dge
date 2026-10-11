/**
 * @file The clip library (PLAN.md §10, WP 8.4; ADR-0010): a set of readable clips loaded for playing. It keeps
 * my-3d2dge's `Mocap.load` API (`my-3d2dge:src/mocap/mocap.js`: `clip`, `sample`, `moveAt`, `text`, `replace`,
 * `restore`, `origin`) and adds what the runtime needs: `bake` (lazy, cached rotation tracks, bake.ts), mirrored
 * clips, and each clip's strike time. Two of shardfall's rules live here as plain functions
 * (`shardfall:crates/pav_core/src/clips.rs:441-550`): playing a loop at the character's ground speed, with the
 * walk–run switch, and the strike time.
 *
 * - **Ground speed.** A loop with a `speed` (how fast its capture travelled, % of standing hip height a second)
 *   travels `speed` / 100 × the build's standing hip height a second: its pace. Played at a ground speed, its rate is
 *   ground speed / pace, kept within 0.4–2.5 (`walkRate`). Between a walk and a run, the run plays above √(w·r) ×
 *   1.15 and the walk again below √(w·r) × 0.87 (`runOverWalk`), w and r their paces (1.4 and 4 hip heights a
 *   second for a clip that does not say), so a speed near the line never flickers; below 0.1 m/s the body idles.
 * - **Strike time.** The moment a clip's fist reaches furthest ahead of the hips (the blade's tip, 1.19 standing hip
 *   heights along the blade, for a clip that holds one; an ankle, for a clip tagged `kick`), sampled at 60 Hz and
 *   measured once a clip. A clip played as an attack lands its hit there unless it has a `hit` event (layer.ts).
 *
 * Invariants: a clip is decoded and baked on its own source's rest body (`set.sources[clip.src].rest`), as the
 * reference decodes are (ADR-0010 amendment 1). `replace` keeps the original for `restore`, and forgets the bakes.
 * Names are the set's own; an unknown one throws `ANIM_UNKNOWN_CLIP` with the closest names.
 *
 * @example
 * import { REST, standing } from '../../../tests/unit/anim/clip-fixtures';
 * const library = loadClipLibrary({ set: 'TEST', sources: { A: { rest: REST } },
 *   clips: { Stand: { src: 'A', dur: 1, keys: [standing(0), standing(1)] } } });
 * library.bake('Stand').frames; // 31
 * walkRate(1.2, 1.8); // 1.5: the loop plays half as fast again
 * runOverWalk(1.2, 3.6, 2.4, false, 0.9); // true: past √(1.2 × 3.6) × 1.15 ≈ 2.39 m/s
 * @see engine/anim/clip/library.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../../core/log';
import { bakeClip, type BakedClip } from './bake';
import { clipText } from './lens';
import { mirrorClip } from './mirror';
import { decodePose, keyAt, moveAt, POINT_INDEX, samplePose, type Clip } from './readable';
import { parseClip, parseClipSet, type ClipSet, type RestBody } from './validate';

/** The codes this module raises, with their fixes. */
export const LIBRARY_CODES = defineCodes('anim', {
  ANIM_UNKNOWN_CLIP: {
    template: 'set {set} has no clip {name}{suggestion}',
    fix: "use one of its clips (library.names lists them; a page's library may need that set loaded)",
    doc: 'Raised by the clip library and the clip layer (engine/anim/clip/library.ts, layer.ts) for a clip name the loaded sets lack. The message names the closest names.',
  },
  ANIM_NO_REST: {
    template: 'set {set} has no rest body for clip {name} (source {src})',
    fix: 'give the set a sources entry for that source, with the rest body its importer measured',
    doc: 'Raised by the clip library (engine/anim/clip/library.ts) when a clip names a source the set lacks, or the set has no sources: a clip decodes only on the rest body it was measured on.',
  },
});

/** shardfall's ground-speed numbers (`clips.rs:441-476`). */
export const GROUND_SPEED = {
  /** The rate a loop plays at is kept within these. */
  minRate: 0.4,
  maxRate: 2.5,
  /** A walk's and a run's pace when the clip has no `speed`, standing hip heights a second. */
  walk: 1.4,
  run: 4,
  /** The run plays above √(w·r) times `up`, and the walk again below √(w·r) times `down`. */
  up: 1.15,
  down: 0.87,
  /** Below this ground speed (m/s) the body idles. */
  idle: 0.1,
} as const;

/** Strike-time sampling (shardfall's `clips.rs:478-550`): the rate, and the blade's reach in standing hip heights. */
export const STRIKE = { rate: 60, blade: 1.19 } as const;

/** A clip's pace on a body whose standing hip height is `hipHeight` metres: m/s, or null when it has no `speed`. */
export function clipPace(clip: Pick<Clip, 'speed'>, hipHeight: number): number | null {
  return clip.speed !== undefined && clip.speed > 1 ? (clip.speed / 100) * hipHeight : null;
}

/** The rate that plays a loop of `pace` m/s at `groundSpeed` m/s: within 0.4–2.5; 1 without a pace. */
export function walkRate(pace: number | null, groundSpeed: number): number {
  if (!pace) return 1;
  return Math.min(GROUND_SPEED.maxRate, Math.max(GROUND_SPEED.minRate, groundSpeed / pace));
}

/**
 * Whether the run, not the walk, keeps pace with `groundSpeed` (m/s): above √(w·r) × 1.15, or × 0.87 while the run
 * is `running`. `walk` and `run` are their paces (m/s), or null for the defaults at standing hip height `hipHeight`.
 */
export function runOverWalk(
  walk: number | null,
  run: number | null,
  groundSpeed: number,
  running: boolean,
  hipHeight: number,
): boolean {
  const [w, r] = [walk ?? GROUND_SPEED.walk * hipHeight, run ?? GROUND_SPEED.run * hipHeight];
  return groundSpeed > Math.sqrt(w * r) * (running ? GROUND_SPEED.down : GROUND_SPEED.up);
}

/** When `clip`'s strike lands, seconds from its start, decoded on rest body `R` (see the file comment). */
export function strikeTime(clip: Clip, R: RestBody): number {
  const kick = clip.tags?.includes('kick') ?? false;
  const blade = clip.keys.some((k) => k.blade);
  const ends = kick ? ['ankleL', 'ankleR'] : ['fistL', 'fistR'];
  const f = (p: string) => points[POINT_INDEX[p] * 3];
  const n = Math.max(1, Math.ceil(clip.dur * STRIKE.rate));
  let [best, at] = [-Infinity, 0];
  for (let i = 0; i <= n; i++) {
    const t = (clip.dur * i) / n;
    decodePose(R, keyAt(clip, t), points);
    let reach = Math.max(...ends.map(f)) - f('pelvis');
    if (blade) {
      const [x, y, z] = [0, 1, 2].map((c) => points[POINT_INDEX.indexR * 3 + c] - points[POINT_INDEX.pinkyR * 3 + c]);
      reach = Math.max(reach, f('fistR') + (x / (Math.hypot(x, y, z) || 1)) * STRIKE.blade * R.H0 - f('pelvis'));
    }
    if (reach > best) [best, at] = [reach, t];
  }
  return at;
}
const points = new Float64Array(108);

/** Where a clip came from: its library's label, origin and license, and the clip or take it was made from. */
export interface ClipOrigin {
  set: string;
  src: string;
  label: string;
  origin: string;
  license: string;
  url: string;
  orig: string | null;
  take: string | null;
}

/** A loaded set (see the file comment). */
export interface ClipLibrary {
  /** The set as loaded (edits through `replace` change only the library's own clips). */
  readonly set: ClipSet;
  /** The set's name, `QUATERNIUS`. */
  readonly name: string;
  /** Its clips' names, in the set's order. */
  readonly names: readonly string[];
  has(name: string): boolean;
  /** The clip `name`. Throws `ANIM_UNKNOWN_CLIP`. */
  clip(name: string): Clip;
  /** The rest body clip `name` was measured on. Throws `ANIM_UNKNOWN_CLIP`, `ANIM_NO_REST`. */
  rest(name: string): RestBody;
  /** Its 36 decoded body points at `t` seconds (mm, rig frame; readable.ts `samplePose`). */
  sample(name: string, t: number, out?: Float32Array): Float32Array;
  /** How far it has carried the body at `t`, `[forward, right]` mm; null when it does not travel. */
  moveAt(name: string, t: number): [number, number] | null;
  /** Its rotation tracks, baked once (mirrored: the clip played on the other side). */
  bake(name: string, mirror?: boolean): BakedClip;
  /** When its strike lands, seconds (measured once). */
  strikeTime(name: string): number;
  /** The clip as the text an agent reads (lens.ts `clipText`). */
  text(name: string): string;
  /** Swaps in an edited clip (text or object; its header over the original's); `restore` brings the original back. */
  replace(name: string, edited: string | object): Clip;
  restore(name: string): Clip;
  /** Whether `replace` changed it. */
  edited(name: string): boolean;
  origin(name: string): ClipOrigin;
}

/** Loads a set (its text or object, read by validate.ts `parseClipSet`, which throws its `ANIM_CLIP_*` codes). */
export function loadClipLibrary(input: ClipSet | string | object): ClipLibrary {
  const set = parseClipSet(input);
  const clips = { ...set.clips };
  const originals: Record<string, Clip> = {};
  const bakes = new Map<string, BakedClip>();
  const strikes = new Map<string, number>();
  const names = Object.keys(clips);
  const clip = (name: string): Clip => {
    if (Object.hasOwn(clips, name)) return clips[name];
    throw codeError('ANIM_UNKNOWN_CLIP', {
      set: set.set,
      name: JSON.stringify(name),
      suggestion: didYouMean(name, names),
    });
  };
  const rest = (name: string): RestBody => {
    const src = clip(name).src ?? Object.keys(set.sources ?? {})[0];
    const found = src !== undefined ? set.sources?.[src]?.rest : undefined;
    if (!found) throw codeError('ANIM_NO_REST', { set: set.set, name: JSON.stringify(name), src: String(src) });
    return found;
  };
  const forget = (name: string) => {
    for (const key of [name, `${name}|mirror`]) [bakes, strikes].forEach((cache) => cache.delete(key));
  };
  return {
    set,
    name: set.set,
    names,
    has: (name) => Object.hasOwn(clips, name),
    clip,
    rest,
    sample: (name, t, out) => samplePose(rest(name), clip(name), t, out),
    moveAt: (name, t) => moveAt(rest(name), clip(name), t),
    bake(name, mirror = false) {
      const key = mirror ? `${name}|mirror` : name;
      let baked = bakes.get(key);
      if (!baked) bakes.set(key, (baked = bakeClip(mirror ? mirrorClip(clip(name)) : clip(name), rest(name), name)));
      return baked;
    },
    strikeTime(name) {
      let t = strikes.get(name);
      if (t === undefined) strikes.set(name, (t = strikeTime(clip(name), rest(name))));
      return t;
    },
    text: (name) => clipText(clip(name)),
    replace(name, edited) {
      const original = (originals[name] ??= clip(name));
      const parsed = parseClip(edited, `${set.set}/${name}`);
      forget(name);
      return (clips[name] = { ...original, ...parsed, keys: parsed.keys });
    },
    restore(name) {
      if (originals[name]) {
        clips[name] = originals[name];
        delete originals[name];
        forget(name);
      }
      return clip(name);
    },
    edited: (name) => Object.hasOwn(originals, name),
    origin(name) {
      const c = clip(name);
      const s = (c.src !== undefined ? set.sources?.[c.src] : undefined) ?? {};
      const text = (key: 'label' | 'origin' | 'license' | 'url') => (s as Record<string, string | undefined>)[key];
      const label = text('label') ?? c.src ?? '';
      return { set: set.set, src: c.src ?? '', label, origin: text('origin') ?? '', license: text('license') ?? '',
        url: text('url') ?? '', orig: c.orig ?? null, take: c.take ?? null }; // prettier-ignore
    },
  };
}
