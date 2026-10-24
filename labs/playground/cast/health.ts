/**
 * @file The cast's hit points (docs/PLAYGROUND.md §7.3, §7.4; PLAN.md WP 10.2, WP 13.21): the component `health` the
 * ring's sparring partners and the neighbours carry, which melee and shots take from (engine/sim/damage.ts). Neither
 * dies: their hit points come back at every blow (`CAST_HP`), so a blow only flinches one or knocks it down.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * // spawnActor(w, { …, components: { health: castHealth() } });
 * castHealth().hp; // 1000
 * @see labs/playground/cast/partners.test.ts
 */
import { defineComponent, HEALTH_FIELDS, type Health } from '../../../engine/sim-api';

/** As many hit points as one of the cast ever needs: given back at every blow. */
export const CAST_HP = 1000;

defineComponent('health', { description: 'Hit points (the ring’s partners and the neighbours, WPs 10.2 and 13.21): melee and shots take from them.', fields: HEALTH_FIELDS }); // prettier-ignore

/** A cast member's `health`: full, never hit. */
export const castHealth = (): Health => ({ hp: CAST_HP, hitAt: -1, hitBy: -1 });
