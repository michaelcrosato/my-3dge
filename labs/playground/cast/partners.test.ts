/**
 * @file Unit tests for the ring's sparring partners (labs/playground/cast/partners.ts, PLAN.md WP 10.2): two stand on
 * the canvas's south corners, turned toward the steps; the player's punch flinches one along the blow, its hit points
 * back; his kick from a jump hands it off to its ragdoll, which flies off along the blow, lies still and gets up the
 * way it lies, its hit points back again: it never dies.
 * @see labs/playground/cast/partners.ts
 */
import { describe, expect, it } from 'vitest';
import type { RagdollState } from '../../../engine/sim-api';
import type { ReactionState } from '../../../engine/anim/reactions';
import { createSession } from '../../../engine/sim/session';
import '../bodies/player';
import { SITE_SCENES } from '../scenes/site';
import { RING_PARTNERS } from './partners';

type Partner = { id: number; actor: { x: number; y: number; z: number }; health: { hp: number }; reactions?: ReactionState; ragdoll?: RagdollState }; // prettier-ignore

/** The ring's scene stepped once, and its west partner with the player 1.4 m north-east of it, facing it. */
function facingWest() {
  const session = createSession(SITE_SCENES.ring, { seed: 1 });
  session.step({});
  const [west] = session.world.query('sparringPartner') as unknown as Partner[];
  const [x, z] = [west.actor.x + 0.9, west.actor.z - 1.05];
  const along = [west.actor.x - x, west.actor.z - z].map((v) => v / Math.hypot(0.9, 1.05));
  const look = [Math.atan2(along[0], along[1]), 0];
  session.act('place', { at: [x, 1, z], yaw: look[0] });
  return { session, west, look, along };
}

describe('the ring’s sparring partners', () => {
  it('stand two on the canvas’s south corners, turned toward the steps', () => {
    const session = createSession(SITE_SCENES.ring, { seed: 1 });
    session.step({});
    const stood = (session.world.query('sparringPartner') as unknown as Partner[]).map((p) => [p.actor.x, p.actor.y, p.actor.z].map((v) => Math.round(v * 100) / 100)); // prettier-ignore
    expect(stood).toEqual(RING_PARTNERS.map(({ at }) => [...at]));
  }, 120_000);

  it('flinch at a punch, their hit points back', () => {
    const { session, west, look } = facingWest();
    for (let k = 0; k < 10; k++) session.step({ look }); // on his feet: a punch, not a kick
    session.step({ look, b: ['melee'] });
    let flinched = false;
    for (let k = 0; k < 40 && !flinched; k++) {
      session.step({ look });
      flinched = west.reactions?.flinch.some((f) => f !== 0) ?? false;
    }
    expect([flinched, west.ragdoll, west.health.hp]).toEqual([true, undefined, 1000]);
  }, 120_000);

  it('fly off along a kick from a jump, lie still and get up the way they lie, never dying', () => {
    const { session, west, look, along } = facingWest();
    session.step({ look, b: ['jump'] });
    for (let k = 0; k < 8; k++) session.step({ look });
    session.step({ look, b: ['melee'] }); // in the air: the kick
    let k = 0;
    for (; k < 120 && !west.ragdoll; k++) session.step({ look });
    expect(west.ragdoll).toBeDefined(); // handed off
    const [x0, z0] = [west.ragdoll!.poses[0], west.ragdoll!.poses[2]];
    let farthest = 0;
    for (k = 0; k < 600 && west.ragdoll!.rise < 0; k++) {
      session.step({});
      farthest = Math.max(
        farthest,
        (west.ragdoll!.poses[0] - x0) * along[0] + (west.ragdoll!.poses[2] - z0) * along[1],
      );
    }
    expect(farthest).toBeGreaterThan(0.5); // along the blow
    expect(west.ragdoll!.rise).toBeGreaterThan(0); // up again, the way it lies
    expect(west.reactions!.playing).toBe(west.ragdoll!.lying === 'up' ? 'getUpBack' : 'getUpFront');
    expect(west.health.hp).toBe(1000);
  }, 120_000);
});
