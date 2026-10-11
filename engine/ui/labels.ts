/**
 * @file The overlay's world-anchored elements (PLAN.md §6.7, WP 6.5; doctrine: WebGPU only): labels that follow a
 * point in the world and damage numbers, HTML placed each frame from projected coordinates, as three.js's
 * `CSS2DRenderer` places its `CSS2DObject`s. engine/ui/overlay.ts owns the layer and calls `place` once per frame.
 *
 * Placing: a point goes through the camera's `matrixWorldInverse`, then its `projectionMatrix` (so a height boost,
 * engine/gfx/cameras/boost.ts, moves the label where the picture draws the point), to CSS px from the overlay's top
 * left, which every element carries as `--ui-x` and `--ui-y` (its centre, by the overlay's `.ui-at` rule). A point
 * nearer than the camera's `near` or beyond its `far` hides its element (`CSS2DRenderer`'s cull), as does one under
 * the touch buttons (`blocked`). The nearer of two elements draws on top (`z-index` by depth).
 *
 * Damage numbers, carried as behaviour: each rises `DAMAGE_NUMBERS.rise` m/s, slowing by `slow` m/s², for `life`
 * seconds, popping in and blinking twice in its last quarter (CSS keyframes, driven by the overlay's clock through
 * `--ui-age`), and is gone after `life` s. A number within `stackRadius` m across the floor of the last one and less
 * than `stackTime` s after it joins that one's column: it rises from the column's anchor, one number's height above
 * the one before on screen (`--ui-slot`), cycling through `stackSlots` slots (`stackDamage`). The prototype stacked
 * 0.5 m apart in the world, which at a far zoom overlaps; a slot on screen never does at any zoom. They are pooled:
 * at most `pool` elements; a new number past that takes the oldest's element.
 *
 * Invariants: presentation only: nothing here reaches the sim, reads a wall clock or keeps module state but scratch
 * vectors; an element is marked `data-ui` only while it shows something, so DOM queries never find a pooled one.
 *
 * Carried from `my-3d2dge:src/stress-world/35-effects.js:133-149` (the overlay's numbers) and
 * `my-3d2dge:src/stress-world/20-sim.js:320-323` (`damageNumber`'s stacking), with
 * `my-3d2dge:engine/my-3d2dge.js:1011` (`text`: 38 units/s up, 40 units/s² slowing, 0.8 s), at 16 units per metre
 * (PLAN.md Appendix C).
 *
 * @example
 * const first = stackDamage(null, [2, 1.8, 0], 0); // a new column at [2, 1.8, 0], slot 0
 * stackDamage(first.column, [2.5, 1.8, 0], 0.05).slot; // 1: one number's height above the first
 * damageRise(0.8); // 1.1 m above its anchor at the end of its life
 * @see engine/ui/labels.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import { Vector3, type Matrix4 } from '../core/math';

/** The error codes of the world-anchored elements. */
export const LABEL_CODES = defineCodes('ui', {
  UI_BAD_POINT: {
    template: '{what} is {got}, not a point in the world',
    fix: 'pass [x, y, z] in metres, a Vector3 or { x, y, z }, or a function returning one',
  },
});

/** A point in the world, m: three.js's `Vector3`, `{ x, y, z }` or `[x, y, z]` (physics' `Vec3Like`). */
export type WorldPoint = Readonly<{ x: number; y: number; z: number }> | readonly [number, number, number];

/** Where a label is: a point read every frame (a `Vector3` the caller moves follows), or a function giving one. */
export type Anchor = WorldPoint | (() => WorldPoint);

/** What the overlay reads of a camera: any three.js camera (without `near` and `far`, it culls only behind it). */
export interface OverlayCamera {
  readonly matrixWorldInverse: Matrix4;
  readonly projectionMatrix: Matrix4;
  readonly near?: number;
  readonly far?: number;
  readonly parent?: unknown;
  readonly matrixWorldAutoUpdate?: boolean;
  updateMatrixWorld?(): void;
}

/** The damage numbers' behaviour (see the file comment); seconds and metres. */
export const DAMAGE_NUMBERS = Object.freeze({
  life: 0.8,
  rise: 2.375,
  slow: 2.5,
  stackTime: 0.12,
  stackRadius: 1.75,
  stackSlots: 5,
  pool: 48,
});

/** How far above its anchor a damage number is `age` seconds after it appeared, m. */
export function damageRise(age: number): number {
  return DAMAGE_NUMBERS.rise * age - (DAMAGE_NUMBERS.slow * age * age) / 2;
}

/** The last damage number's column: its anchor (m), when its latest number came (s) and how many it holds. */
export interface DamageColumn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  t: number;
  n: number;
}

/**
 * Where a damage number at `point` goes at `time` (s), after the column `last`: in it when near enough and soon
 * enough (`last` is then updated), else in a new column at `point`. Returns the column, whose anchor the number rises
 * from, and its slot: how many numbers' heights above the anchor it shows.
 */
export function stackDamage(
  last: DamageColumn | null,
  point: readonly [number, number, number],
  time: number,
): { column: DamageColumn; slot: number } {
  const { stackTime, stackRadius, stackSlots } = DAMAGE_NUMBERS;
  const near =
    last !== null && time - last.t < stackTime && Math.hypot(point[0] - last.x, point[2] - last.z) < stackRadius;
  const column = near ? last : { x: point[0], y: point[1], z: point[2], t: time, n: 0 };
  column.t = time;
  return { column, slot: column.n++ % stackSlots };
}

/** `point` as `[x, y, z]`, or `UI_BAD_POINT` naming `what`. */
export function worldPoint(point: unknown, what: string): [number, number, number] {
  const p = point as Partial<Record<'x' | 'y' | 'z' | 0 | 1 | 2, unknown>> | null | undefined;
  const xyz = Array.isArray(p) ? [p[0], p[1], p[2]] : [p?.x, p?.y, p?.z];
  if (!xyz.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    const got = typeof point === 'object' && point !== null ? JSON.stringify(point) : String(point);
    throw codeError('UI_BAD_POINT', { what, got });
  }
  return xyz as [number, number, number];
}

/** Scratch for `projectToOverlay`. */
const _p = new Vector3();

/**
 * Where the point (x, y, z) shows on an overlay `width` × `height` CSS px over `camera`'s picture: writes its centre
 * (px from the top left) and its depth (m in front of the camera) into `out`, or returns false, writing nothing, when
 * it is nearer than `near` or beyond `far`. The camera's matrices must be current, as after drawing a frame.
 */
export function projectToOverlay(
  camera: OverlayCamera,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  out: number[],
): boolean {
  _p.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  const depth = -_p.z;
  if (!(depth >= (camera.near ?? 0) && depth <= (camera.far ?? Infinity))) return false;
  _p.applyMatrix4(camera.projectionMatrix);
  out[0] = ((_p.x + 1) * width) / 2;
  out[1] = ((1 - _p.y) * height) / 2;
  out[2] = depth;
  return true;
}

/** How a label is made. */
export interface LabelOptions {
  /** Where it is (see `Anchor`). */
  at: Anchor;
  /** Its `data-id`, for DOM queries and `ui.state()` (`label:<n>` by default). */
  id?: string;
  /** Its text colour (CSS). */
  color?: string;
}

/** A world-anchored label: change its text, anchor or visibility at any time; it shows them at the next frame. */
export interface Label {
  readonly id: string;
  readonly element: HTMLElement;
  text: string;
  at: Anchor;
  /** Whether it may show (true); it still hides behind the camera, past `far` and under the touch buttons. */
  visible: boolean;
  /** Takes it off the overlay. */
  remove(): void;
}

/** How a damage number is shown. */
export interface DamageOptions {
  /** Where it appears, m: usually just above the head of whoever was hit. */
  at: WorldPoint;
  /** Its colour (CSS; `#fff2c4`, the prototype's). */
  color?: string;
  /** Its size against the normal one (1). */
  scale?: number;
  /** Whether it stacks with the last one (true). */
  stack?: boolean;
}

/** What one frame places by. */
export interface WorldFrame {
  camera: OverlayCamera;
  /** The overlay's size, CSS px. */
  width: number;
  height: number;
  /** Seconds since the last frame. */
  dt: number;
  /** Whether a point on the overlay (CSS px) is under the touch buttons; null off touch screens. */
  blocked: ((x: number, y: number) => boolean) | null;
}

/** The labels and damage numbers of one overlay. */
export interface WorldLayer {
  label(text: string, options: LabelOptions): Label;
  damage(value: number | string, options: DamageOptions): void;
  /** Ages the numbers by `frame.dt`, then places everything for the frame. */
  place(frame: WorldFrame): void;
}

/** One placed element and what it last wrote, so unchanged values are never written again. */
interface Placed {
  el: HTMLElement;
  shown: boolean;
  x: string;
  y: string;
  z: number;
  depth: number;
}

/** A pooled damage number. */
interface Pooled extends Placed {
  readonly span: HTMLElement;
  live: boolean;
  age: number;
  point: [number, number, number];
}

/** A label's own state. */
interface Held extends Placed {
  label: Label;
}

/** Writes `--name: value` on `el` when it changed; returns the value. */
function write(el: HTMLElement, name: string, value: string, last: string): string {
  if (value !== last) el.style.setProperty(name, value);
  return value;
}

/** A number as a short CSS value: two decimals. */
const css = (v: number) => String(Math.round(v * 100) / 100);

/** Builds the world layer: labels in `labels`, damage numbers in `numbers` (two sibling layers, numbers on top). */
export function createWorldLayer(labels: HTMLElement, numbers: HTMLElement): WorldLayer {
  const doc = labels.ownerDocument;
  const held: Held[] = [];
  const pool: Pooled[] = [];
  const at: number[] = [0, 0, 0];
  let time = 0;
  let column: DamageColumn | null = null;
  let made = 0;

  const show = (item: Placed, shown: boolean) => {
    if (item.shown !== shown) item.el.hidden = !(item.shown = shown);
  };
  /** Places `item` at the world point (x, y, z), or hides it. */
  const put = (item: Placed, frame: WorldFrame, x: number, y: number, z: number, may: boolean) => {
    const seen = may && projectToOverlay(frame.camera, x, y, z, frame.width, frame.height, at);
    const shown = seen && !frame.blocked?.(at[0], at[1]);
    show(item, shown);
    if (!shown) return;
    item.x = write(item.el, '--ui-x', css(at[0]), item.x);
    item.y = write(item.el, '--ui-y', css(at[1]), item.y);
    item.depth = at[2];
  };
  /** Nearer elements on top: `z-index` by depth among the shown ones. */
  const stack = (items: readonly Placed[]) => {
    const shown = items.filter((item) => item.shown).sort((a, b) => b.depth - a.depth);
    shown.forEach((item, i) => {
      if (item.z !== i + 1) item.el.style.zIndex = String((item.z = i + 1));
    });
  };
  const element = (className: string) => {
    const el = doc.createElement('div');
    el.className = className;
    el.hidden = true;
    return el;
  };

  return {
    label(text, options) {
      const el = element('ui-label ui-at');
      const id = options.id ?? `label:${++made}`;
      el.dataset.ui = 'label';
      el.dataset.id = id;
      el.textContent = text;
      if (options.color !== undefined) el.style.color = options.color;
      if (typeof options.at !== 'function') worldPoint(options.at, `label "${id}"'s at`);
      let anchor = options.at;
      let visible = true;
      const label: Label = {
        id,
        element: el,
        get text() {
          return el.textContent ?? '';
        },
        set text(value) {
          if (value !== el.textContent) el.textContent = value;
        },
        get at() {
          return anchor;
        },
        set at(value) {
          if (typeof value !== 'function') worldPoint(value, `label "${id}"'s at`);
          anchor = value;
        },
        get visible() {
          return visible;
        },
        set visible(value) {
          visible = value;
        },
        remove() {
          const i = held.findIndex((item) => item.label === label);
          if (i >= 0) held.splice(i, 1);
          el.remove();
        },
      };
      held.push({ el, label, shown: false, x: '', y: '', z: 0, depth: 0 });
      labels.append(el);
      return label;
    },

    damage(value, options) {
      const text = String(value);
      const point = worldPoint(options.at, 'damage at');
      let item = pool.find((candidate) => !candidate.live);
      if (!item && pool.length < DAMAGE_NUMBERS.pool) {
        const el = element('ui-damage ui-at');
        const span = doc.createElement('span');
        el.append(span);
        numbers.append(el);
        pool.push((item = { el, span, live: false, age: 0, point, shown: false, x: '', y: '', z: 0, depth: 0 }));
      }
      item ??= pool.reduce((oldest, candidate) => (candidate.age > oldest.age ? candidate : oldest));
      let slot = 0;
      if (options.stack !== false) {
        const stacked = stackDamage(column, point, time);
        column = stacked.column;
        point.splice(0, 3, column.x, column.y, column.z);
        slot = stacked.slot;
      }
      Object.assign(item, { live: true, age: 0, point });
      const { el, span } = item;
      el.dataset.ui = 'damage';
      el.dataset.value = text;
      span.textContent = text;
      el.style.color = options.color ?? '';
      el.style.setProperty('--ui-scale', String(options.scale ?? 1));
      el.style.setProperty('--ui-life', String(DAMAGE_NUMBERS.life));
      el.style.setProperty('--ui-age', '0');
      el.style.setProperty('--ui-slot', String(slot));
      show(item, false); // shown by the next frame, which places it
    },

    place(frame) {
      time += frame.dt;
      for (const item of held) {
        const { label } = item;
        const point = typeof label.at === 'function' ? label.at() : label.at;
        const [x, y, z] = worldPoint(point, `label "${label.id}"'s at`);
        put(item, frame, x, y, z, label.visible);
      }
      for (const item of pool) {
        if (!item.live) continue;
        item.age += frame.dt;
        if (item.age >= DAMAGE_NUMBERS.life) {
          item.live = false;
          show(item, false);
          delete item.el.dataset.ui;
          delete item.el.dataset.value;
          continue;
        }
        item.el.style.setProperty('--ui-age', css(item.age));
        const [x, y, z] = item.point;
        put(item, frame, x, y + damageRise(item.age), z, true);
      }
      stack(held);
      stack(pool);
    },
  };
}
