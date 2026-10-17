/**
 * @file Unit tests for the feel kit's animation metrics (engine/dev/feel/anim.ts): an adult standing still slides and
 * pops nothing; on a run the track reads the foot slide and the pops over the frames asked, the same twice; the hands'
 * gap grows with a point's distance; and posing never changes the run's hash.
 * @see engine/dev/feel/anim.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { createCharacter } from '../../physics/character';
import { physicsOf } from '../../physics/binding';
import { defineActorKinds, spawnActor, type ActorComponents } from '../../sim/actors';
import { defineScene, startScene } from '../../sim/scene';
import type { World } from '../../sim/world';
import { createAnimTrack } from './anim';

/** A registry with a scene `yard`: a 200 m floor and an animated adult at the origin, running at 5 m/s when told. */
function yard() {
  const registry = createRegistry();
  defineActorKinds(registry);
  const setup = (w: World) => {
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [200, 1, 200] }, position: [0, -0.5, 0] }] }); // prettier-ignore
    spawnActor(w, { at: [0, 0, 0], character: createCharacter({ speed: 5 }), anim: { build: 'build:adult' } });
  };
  defineScene('yard', { physics: true, setup }, registry);
  return registry;
}

/** Runs `yard` for `n` steps with `move`, posing the actor after each into a track; returns the track and the hash. */
function run(move: readonly [number, number] | undefined, n: number, pose = true) {
  const { world } = startScene('yard', { registry: yard() });
  const track = createAnimTrack('test');
  for (let k = 0; k < n; k++) {
    world.step(move ? { move } : {});
    const [e] = world.query('actor') as unknown as (ActorComponents & { id: number })[];
    if (pose) track.frame(e.id, e.animator, [e.actor.x, e.actor.y, e.actor.z], e.actor.yaw, world.dt);
  }
  return { track, hash: world.hash() };
}

describe('animation metrics', () => {
  it('find nothing on an adult standing still', () => {
    const { track } = run(undefined, 90);
    expect(track.length).toBe(90);
    expect(track.footSlide(10, 89)).toBeLessThan(0.005);
    expect(track.pop(10, 89)).toBe(0);
  });

  it('read a run’s foot slide and pops over the frames asked, the same twice, and never change the hash', () => {
    const a = run([1, 0], 150);
    const b = run([1, 0], 150);
    expect([a.track.footSlide(30, 149), a.track.pop(30, 149)]).toEqual([b.track.footSlide(30, 149), b.track.pop(30, 149)]); // prettier-ignore
    expect(Number.isFinite(a.track.footSlide(30, 149))).toBe(true);
    expect(a.track.footSlide(30, 30)).toBe(0); // one frame: no contact to slide in
    expect(run([1, 0], 150, false).hash).toBe(a.hash);
  });

  it('measure the closest a hand comes to a point', () => {
    const { track } = run(undefined, 30);
    const near = track.handGap([0, 0.9, 0], 0, 29);
    expect(near).toBeLessThan(0.5); // the hands hang by the hips
    expect(track.handGap([0, 0.9, 10], 0, 29)).toBeGreaterThan(near + 9);
    expect(track.handGap([0, 0.9, 0], 30, 40)).toBe(Infinity); // no frames there
  });
});
