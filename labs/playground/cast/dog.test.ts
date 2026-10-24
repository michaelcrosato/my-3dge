/**
 * @file Unit tests for the dog (labs/playground/cast/dog.ts, PLAN.md WP 13.21), on the street's scene: it stands
 * beside the player's spawn facing him, its ball before its paws, and sits once he has stood still; it trots after
 * him when he is off, and runs when he is far; it fetches the ball he throws (chases it, picks it up, brings it back
 * and lets it fall by him), its story told by its events, and plays the street replay's
 * (tests/replays/playground-street.replay.json); and boxed in, it backs out, then waits, then tries again.
 * @see labs/playground/cast/dog.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { physicsOf } from '../../../engine/sim-api';
import { playReplay } from '../../../engine/sim/replay';
import { createSession } from '../../../engine/sim/session';
import '../bodies/player';
import { SITE_SCENES } from '../scenes/site';
import { DOG } from './dog';

type Body = { x: number; y: number; z: number; vx: number; vz: number; yaw: number; player?: boolean };
type Entity = { id: number; actor: Body; dog?: { mode: string; ball: number } };

/** The street's scene, stepped once: its session and readers for the player, the dog and the ball. */
function street() {
  const session = createSession(SITE_SCENES.street, { seed: 1 });
  session.step({});
  const actors = () => session.world.query('actor') as unknown as Entity[];
  const player = () => actors().find((e) => e.actor.player)!.actor;
  const dog = () => actors().find((e) => e.dog)!;
  const ball = () => (session.world.get(dog().dog!.ball) as unknown as { sceneProp: Body }).sceneProp;
  const apart = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.z - b.z);
  const story = () => session.world.events.trace().filter((e) => e.type === 'dog').map((e) => (e.payload as { what: string }).what); // prettier-ignore
  return { session, player, dog, ball, apart, story };
}

describe('the dog', () => {
  it('stands beside the player’s spawn facing him, its ball before its paws, and sits once he has stood still', () => {
    const { session, player, dog, ball, apart, story } = street();
    const [me, him] = [dog().actor, player()];
    expect(apart(me, him)).toBeLessThan(DOG.near);
    expect(me.yaw).toBeCloseTo(Math.atan2(him.x - me.x, him.z - me.z), 5); // facing him from the first (as settled)
    const [x, z] = [ball().x - me.x, ball().z - me.z];
    expect(x * Math.sin(me.yaw) + z * Math.cos(me.yaw)).toBeCloseTo(DOG.ball[0], 4); // before its paws (0.23 m ahead)
    expect(x * Math.cos(me.yaw) - z * Math.sin(me.yaw)).toBeCloseTo(0, 4);
    for (let k = 0; k < 75; k++) session.step({});
    expect([dog().dog!.mode, story()]).toEqual(['sit', ['sit']]);
  }, 120_000);

  it('trots after him when he is off, and runs when he is far', () => {
    const { session, player, dog, apart } = street();
    const at = player();
    session.act('place', { at: [at.x + 5, at.y, at.z], yaw: Math.PI / 2 }); // 5 m east along the sidewalk
    let trot = 0;
    for (let k = 0; k < 40; k++, session.step({})) trot = Math.max(trot, Math.hypot(dog().actor.vx, dog().actor.vz));
    expect(trot).toBeCloseTo(DOG.speed * DOG.trot, 1);
    session.act('place', { at: [at.x + 20, at.y, at.z], yaw: Math.PI / 2 });
    let run = 0;
    for (let k = 0; k < 60; k++, session.step({})) run = Math.max(run, Math.hypot(dog().actor.vx, dog().actor.vz));
    expect(run).toBeCloseTo(DOG.speed, 1);
    for (let k = 0; k < 300; k++) session.step({});
    expect(apart(dog().actor, player())).toBeLessThan(DOG.near + 0.1); // it caught him up
  }, 120_000);

  it('fetches the ball he throws: chases it, picks it up, brings it back and lets it fall by him', () => {
    const { session, player, ball, apart, story } = street();
    for (let k = 0; k < 90; k++) session.step({});
    const at = ball();
    session.act('place', { at: [at.x, player().y, at.z + 0.7], yaw: Math.PI }); // up to it on the kerb, before its paws
    const down: [number, number] = [Math.PI, Math.atan2(at.y - player().y - 1.52, 0.7)]; // his eye at the ball
    for (let k = 0; k < 10; k++) session.step({ look: down });
    session.step({ look: down, b: ['interact'], p: ['interact'] }); // picks it up
    for (let k = 0; k < 20; k++) session.step({ look: [Math.PI / 2, 0.25] });
    session.step({ look: [Math.PI / 2, 0.25], b: ['interact'], p: ['interact'] }); // throws it east
    let far = 0;
    for (let k = 0; k < 600; k++) {
      session.step({ look: [Math.PI / 2, 0] });
      far = Math.max(far, apart(ball(), player()));
    }
    expect(story()).toEqual(['sit', 'chase', 'fetch', 'drop', 'sit']);
    expect(far).toBeGreaterThan(6); // it went a good way
    expect(apart(ball(), player())).toBeLessThan(DOG.drop);
    expect(ball().y - player().y).toBeLessThan(0.1); // on the ground by him
  }, 120_000);

  it("plays the street replay's story in order: it sits, follows him to its ball, chases his throw, fetches it, sits", () => {
    const replay = JSON.parse(readFileSync(join(process.cwd(), 'tests/replays/playground-street.replay.json'), 'utf8'));
    const { session } = playReplay(replay);
    const story = session.world.events.trace().filter((e) => ['dog', 'pickup', 'throw'].includes(e.type)).map((e) => (e.type === 'dog' ? (e.payload as { what: string }).what : e.type)); // prettier-ignore
    expect(story).toEqual(['sit', 'follow', 'pickup', 'sit', 'throw', 'chase', 'fetch', 'drop', 'sit']);
  }, 300_000);

  it('boxed in, backs out, then waits, and then tries again', () => {
    const { session, player, dog, story } = street();
    const { x, y, z } = dog().actor;
    const wall = (dx: number, dz: number, size: [number, number, number]) => ({ shape: { type: 'box' as const, size }, position: [x + dx, y + 0.5, z + dz] as [number, number, number] }); // prettier-ignore
    physicsOf(session.world).addBody({
      type: 'fixed',
      colliders: [
        wall(0.3, 0, [0.1, 1, 0.7]),
        wall(-0.3, 0, [0.1, 1, 0.7]),
        wall(0, 0.3, [0.7, 1, 0.1]),
        wall(0, -0.3, [0.7, 1, 0.1]),
      ],
    }); // a box it can neither turn round in nor back out of, its capsule 0.4 m across
    const at = player();
    session.act('place', { at: [at.x + 8, at.y, at.z], yaw: Math.PI / 2 });
    for (let k = 0; k < Math.round((DOG.stall + 0.5) * 60); k++) session.step({});
    expect([dog().dog!.mode, story()]).toEqual(['follow', []]); // held once: it backs out the freest way
    for (let k = 0; k < Math.round(DOG.stall * 60); k++) session.step({});
    expect(dog().dog!.mode).toBe('wait'); // held again
    for (let k = 0; k < Math.round(DOG.wait * 60); k++) session.step({});
    expect(story().slice(0, 2)).toEqual(['wait', 'follow']); // it tried again
  }, 120_000);
});
