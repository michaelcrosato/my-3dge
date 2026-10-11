/**
 * @file What an event carries for its effects (PLAN.md WP 6.4): `FxEventPayload`, the keys engine/gfx/fx/effects.ts
 * reads of a sim event's payload, and how they become a burst. `eventPosition(payload)` is where it happens: its
 * `position` (a point), else its `x`, `y` (0 when left out) and `z`, else nowhere (null: no burst).
 * `eventOptions(payload)` is the burst's `velocity`, colours (its `color`, hex, at birth and at death) and `ground`.
 * Any other key is left alone, so a game's events carry what its rules need beside these.
 *
 * Invariants: pure: it reads the payload and never keeps or changes it (the sim's own object, from its trace).
 *
 * @example
 * eventPosition({ position: [1, 2, 3] }); // [1, 2, 3]
 * eventPosition({ x: 4, z: 5, damage: 12 }); // [4, 0, 5]
 * eventOptions({ color: '#ff0000' }).color; // [[1, 0, 0], [1, 0, 0]]
 * @see engine/gfx/fx/effects.test.ts
 */
import { toLinear } from '../../core/color';
import { pointOf, type PointLike } from '../../world/telegraphs';
import type { BurstOptions } from './particles';

/** What an event carries for its effects (any other keys are left alone). Shake and rings scale with the size too. */
export interface FxEventPayload {
  /** Where it happens (m), or its `x`, `y`, `z`. */
  position?: PointLike;
  x?: number;
  y?: number;
  z?: number;
  /** Scales the burst: an explosion's radius, a body's size (1). */
  size?: number;
  /** Added to the particles' velocity (m/s). */
  velocity?: PointLike;
  /** Replaces the particles' colours, hex. */
  color?: string;
  /** The floor's height landing particles bounce on (the position's height). */
  ground?: number;
}

/** Where an event happens (see the file comment), or null. */
export function eventPosition(payload: unknown): [number, number, number] | null {
  if (!payload || typeof payload !== 'object') return null;
  const { position, x, y, z } = payload as FxEventPayload;
  if (position) return pointOf(position);
  return typeof x === 'number' && typeof z === 'number' ? [x, typeof y === 'number' ? y : 0, z] : null;
}

/** The burst options an event's payload asks for (see the file comment). */
export function eventOptions(payload: FxEventPayload): BurstOptions {
  const options: BurstOptions = {};
  if (payload.velocity) options.velocity = pointOf(payload.velocity);
  if (payload.color) options.color = [toLinear(payload.color), toLinear(payload.color)];
  if (typeof payload.ground === 'number') options.ground = payload.ground;
  return options;
}
