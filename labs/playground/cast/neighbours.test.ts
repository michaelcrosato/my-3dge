/**
 * @file Unit tests for the neighbours (labs/playground/cast/neighbours.ts, PLAN.md WP 13.21), each reaction on its
 * scripted event: the walker looks at the player as it comes near and steps aside where he stands in its way, and
 * gets by; it flinches when he runs into it; the street's neighbours startle at a shot they hear, the gardener too
 * far to; a punch flinches the walker and a kick from a jump puts it down, and it gets up and walks on; the gardener
 * sits on its bench and rises when its stay is over, then goes on its round.
 * @see labs/playground/cast/neighbours.ts
 */
import { describe, expect, it } from 'vitest';
import type { RagdollState } from '../../../engine/sim-api';
import { createSession } from '../../../engine/sim/session';
import '../bodies/player';
import { SITE_SCENES } from '../scenes/site';
import { NEIGHBOURS } from './neighbours';

type Body = { x: number; y: number; z: number; yaw: number; player?: boolean; intents?: { look?: number[] } };
type Entity = { id: number; actor: Body; neighbour?: { index: number }; ragdoll?: RagdollState };

/** The scene of `area`, stepped once: its session, and readers for the player, a neighbour by name, and the story. */
function onSite(area: 'street' | 'backyard') {
  const session = createSession(SITE_SCENES[area], { seed: 1 });
  session.step({});
  const actors = () => session.world.query('actor') as unknown as Entity[];
  const player = () => actors().find((e) => e.actor.player)!.actor;
  const named = (name: string) => actors().find((e) => e.neighbour && NEIGHBOURS[e.neighbour.index].name === name)!;
  const nameOf = (id: number) => NEIGHBOURS[(session.world.get(id) as unknown as Entity).neighbour!.index].name;
  const story = () => session.world.events.trace().filter((e) => e.type === 'neighbour').map((e) => { const p = e.payload as { id: number; what: string }; return `${nameOf(p.id)} ${p.what}`; }); // prettier-ignore
  return { session, player, named, story };
}

describe('the neighbours', () => {
  it('look at him as they come near, step aside where he stands in their way, and get by', () => {
    const { session, named, story } = onSite('street');
    const line = NEIGHBOURS.find((n) => n.name === 'walker')!.stops[0].at; // its way along the north sidewalk
    session.act('place', { at: [62, line[1], line[2]], yaw: -Math.PI / 2 }); // on it, facing it
    let looked = false;
    for (let k = 0; k < 22 * 60; k++) {
      session.step({});
      looked ||= named('walker').actor.intents?.look !== undefined;
    }
    expect(story().filter((line) => line.startsWith('walker'))).toEqual(expect.arrayContaining(['walker look', 'walker aside'])); // prettier-ignore
    expect(looked).toBe(true); // its head along it: engine/app/view.ts turns it
    expect(named('walker').actor.x).toBeGreaterThan(64); // past him, on its way east
  }, 300_000);

  it('flinch when he runs into them', () => {
    const { session, named, story } = onSite('street');
    const walker = named('walker').actor;
    session.act('place', { at: [walker.x + 3, walker.y, walker.z], yaw: -Math.PI / 2 });
    for (let k = 0; k < 60; k++) session.step({ move: [-1, 0] }); // west, at it
    expect(story()).toContain('walker shoved');
  }, 300_000);

  it('startle at a shot they hear, but not from beyond its carry', () => {
    const { session, story } = onSite('street');
    session.step({ b: ['weapon1'] });
    for (let k = 0; k < 40; k++) session.step({ look: [0, 0.8] });
    session.step({ look: [0, 0.8], b: ['fire'] }); // into the air
    for (let k = 0; k < 10; k++) session.step({ look: [0, 0.8] });
    const startled = story()
      .filter((line) => line.endsWith('startle'))
      .map((line) => line.split(' ')[0]);
    expect(startled.sort()).toEqual(['commuter', 'porch', 'walker']); // the gardener is 43 m off, the shot carries 40
  }, 300_000);

  it('flinch at a punch, fall to a kick from a jump, and get up and walk on', () => {
    const { session, named, story } = onSite('street');
    for (let k = 0; k < 60; k++) session.step({});
    const walker = named('walker');
    const facing = (at: Body) => [Math.atan2(walker.actor.x - at.x, walker.actor.z - at.z), 0] as [number, number];
    session.act('place', { at: [walker.actor.x + 0.9, walker.actor.y, walker.actor.z - 0.6], yaw: 0 });
    for (let k = 0; k < 6; k++) session.step({ look: facing(session.world.get(1)!.actor as unknown as Body) });
    const look = facing(session.world.get(1)!.actor as unknown as Body);
    session.step({ look, b: ['melee'] }); // a punch
    for (let k = 0; k < 50; k++) session.step({ look });
    expect(story()).toContain('walker flinch');
    session.act('place', { at: [walker.actor.x + 0.9, walker.actor.y, walker.actor.z - 0.6], yaw: 0 });
    const kick = facing(session.world.get(1)!.actor as unknown as Body);
    session.step({ look: kick, b: ['jump'] });
    for (let k = 0; k < 8; k++) session.step({ look: kick });
    session.step({ look: kick, b: ['melee'] }); // in the air: the kick
    let down = false;
    for (let k = 0; k < 600 && !(down && !walker.ragdoll); k++) {
      session.step({});
      down ||= walker.ragdoll !== undefined;
    }
    expect([story().includes('walker fall'), down, walker.ragdoll]).toEqual([true, true, undefined]); // up again
    const x = walker.actor.x;
    for (let k = 0; k < 120; k++) session.step({});
    expect(Math.abs(walker.actor.x - x)).toBeGreaterThan(1); // walking on
  }, 300_000);

  it('sit on their bench and rise when their stay is over, then go on their round', () => {
    const { session, named, story } = onSite('backyard');
    const stay = NEIGHBOURS.find((n) => n.name === 'gardener')!.stops[0].stay;
    for (let k = 0; k < 120; k++) session.step({});
    expect(story()).toContain('gardener sit');
    for (let k = 0; k < (stay + 1) * 60; k++) session.step({});
    expect(story()).toContain('gardener rise');
    const at = named('gardener').actor;
    expect(Math.hypot(at.x - 56.5, at.z - 41)).toBeGreaterThan(0.5); // off its bench, on its way
  }, 300_000);
});
