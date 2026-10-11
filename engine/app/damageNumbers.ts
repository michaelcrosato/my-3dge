/**
 * @file Damage numbers from the sim (PLAN.md §6.7: game UI in HTML/CSS; WP 6.5's numbers shown in the box, WP 6.7
 * core proposal, ADR-0008 amendment 7): `createDamageNumbers(ui)` reads a sim world's event trace once per rendered
 * frame, without listening, and shows each new `damage` event (engine/sim/damage.ts) that took hit points as a damage
 * number `DAMAGE_RISE` m above where it struck (engine/ui/labels.ts: it rises, stacks and is pooled), so a page shows
 * the hits of any scene that lands them through `damage`. The page (engine/app/engine.ts) calls `frame` after drawing,
 * then the overlay's `update`.
 *
 * Invariants: presentation only: it reads the trace (history, never hashed or restored) and writes only the overlay;
 * each event is shown once, by its `seq`; a new world (the run started again) is read from its first event.
 *
 * @example
 * // const numbers = createDamageNumbers(ui);
 * // numbers.frame(session.world); // after drawing: one number per new hit
 * // ui.update(camera, dt);
 * @see engine/app/damageNumbers.test.ts
 */
import type { TraceRecord } from '../core/events';
import type { DamageEvent } from '../sim/damage';
import type { DamageOptions } from '../ui/labels';

/** How far above where a hit struck its number appears, m: about a head above a body's middle. */
export const DAMAGE_RISE = 0.6;

/** What the numbers read: a world's event trace. */
export interface TracedWorld {
  readonly events: { trace(): readonly TraceRecord[] };
}

/** Damage numbers from a world's trace (see the file comment). */
export interface DamageNumbers {
  /** Shows the `damage` events of `world` since the last frame; returns how many it showed. */
  frame(world: TracedWorld): number;
}

/** Makes the damage numbers of an overlay `ui` (engine/ui/overlay.ts). */
export function createDamageNumbers(ui: { damage(value: number, options: DamageOptions): void }): DamageNumbers {
  let read: TracedWorld | null = null;
  let seen = -Infinity;
  return {
    frame(world) {
      if (world !== read) [read, seen] = [world, -Infinity];
      let shown = 0;
      for (const record of world.events.trace()) {
        if (record.seq <= seen) continue;
        seen = record.seq;
        if (record.type !== 'damage') continue;
        const hit = record.payload as DamageEvent;
        if (!(hit.amount > 0)) continue;
        ui.damage(hit.amount, { at: [hit.at[0], hit.at[1] + DAMAGE_RISE, hit.at[2]] });
        shown++;
      }
      return shown;
    },
  };
}
