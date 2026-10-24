/**
 * @file Floor rings (PLAN.md WP 6.4): a burst's shockwave or a laid decal, a band on the floor growing out and fading
 * over its life (eased out: fast, then slow), drawn each frame through the decals (engine/gfx/fx/decals.ts) as a whole
 * circle. engine/gfx/fx/effects.ts lays them (`lay`) and draws them (`draw`); split from it to keep it under 400 lines
 * (WP 11.3).
 *
 * Invariants: presentation only; at most `capacity` at once, past it a ring is not laid; one with no outer radius
 * is never laid.
 *
 * @example
 * const rings = createRings(8);
 * rings.lay([0, 0, 0], { radius: [0.2, 2], width: 0.1, color: '#ffe0a0', alpha: 1, life: 0.35 }, 1);
 * rings.count; // 1
 * @see engine/gfx/fx/effects.test.ts
 */
import { toLinear } from '../../core/color';
import type { Decals } from './decals';
import type { Emitter } from './emitters';

/** A floor ring growing and fading. */
interface Ring {
  at: [number, number, number];
  r0: number;
  r1: number;
  width: number;
  rgb: number[];
  alpha: number;
  life: number;
  age: number;
}

/** The floor rings (see the file comment). */
export interface Rings {
  /** Rings laid and not yet done. */
  readonly count: number;
  /** Lays a timed ring at `at` (on the floor), its lengths scaled by `size`, within the capacity. */
  lay(at: [number, number, number], ring: Emitter['ring'], size: number): void;
  /** Ages every ring `dt` s, drops those done (all of them unless `keep`), and draws the rest into `decals`. */
  draw(dt: number, decals: Pick<Decals, 'sector'>, keep: boolean): void;
  clear(): void;
}

/** Makes the rings: at most `capacity` at once. */
export function createRings(capacity: number): Rings {
  const rings: Ring[] = [];
  return {
    get count() {
      return rings.length;
    },
    lay(at, ring, size) {
      if (!(ring.radius[1] > 0) || rings.length >= capacity) return;
      const [r0, r1, width] = [ring.radius[0] * size, ring.radius[1] * size, ring.width * size];
      rings.push({ at, r0, r1, width, rgb: toLinear(ring.color), alpha: ring.alpha, life: ring.life, age: 0 });
    },
    draw(dt, decals, keep) {
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.age += dt;
        if (ring.age >= ring.life || !keep) rings.splice(i, 1);
      }
      for (const ring of rings) {
        const u = ring.age / ring.life;
        const r = ring.r0 + (ring.r1 - ring.r0) * (1 - (1 - u) * (1 - u));
        const [inner, outer] = [Math.max(0, r - ring.width / 2), r + ring.width / 2];
        decals.sector(ring.at, 0, inner, outer, Math.PI, outer, ring.rgb, ring.alpha * (1 - u), 0);
      }
    },
    clear() {
      rings.length = 0;
    },
  };
}
