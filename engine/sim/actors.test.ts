/**
 * @file Tests for actors (engine/sim/actors.ts): a player actor walks, jumps and dashes by the step's intents and
 * emits `jump`, `land` and `dash`; an AI actor by the intents written into its component, presses taken from the edges
 * of `b`; the systems run in their phases (`anim` before `physics`, then `readback`); the same run gives the same hash;
 * a capture taken mid-jump restores (from text too) and continues with the uninterrupted run's hashes, Rapier's
 * controller rebuilt; `oneWay` entities make one-way platforms; `removeActor` removes body and entity; `measureFeel`
 * is the same number for number on every run and `__engine.feel()` reports it. On the shooter model (WP 13.3): an
 * actor holds `motion`, holstered unless spawned armed, reads `sprint`, `walk` and `crouch` as its buttons and `look`
 * as the sprint's view, faces the aim point, else the look, takes its keys' frame from `cam`, else `look` (so a turning
 * view never lurches), and `__engine.feel()` measures it holstered or armed as it is; WP 13.9: a player's sprint and
 * crouch follow the recorded settings `input.sprint` (Apex's sticky sprint, or held) and `input.crouch` (held, or
 * toggled), and the AI keeps Apex's.
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../app/headless';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { createRegistry } from '../core/registry';
import type { Intents } from '../input/intents';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { defineActorKinds, removeActor, spawnActor, type ActorComponents } from './actors';
import { measureFeel } from './feelCourse';
import { defineScene, startScene } from './scene';
import type { WorldCapture } from './capture';
import type { World } from './world';

/** A registry with the actor kinds and a scene `yard`: a 60 × 60 m floor, a player at the origin, an AI at x 5. */
function yard() {
  const registry = createRegistry();
  defineActorKinds(registry);
  defineScene(
    'yard',
    {
      physics: true,
      setup(w) {
        physicsOf(w).addBody({
          type: 'fixed',
          colliders: [{ shape: { type: 'box', size: [60, 1, 60] }, position: [0, -0.5, 0] }],
        });
        physicsOf(w).addBody({
          type: 'fixed',
          colliders: [{ shape: { type: 'box', size: [4, 0.2, 4] }, position: [0, 1.1, 10] }],
        });
        spawnActor(w, { at: [0, 0, 0], character: createCharacter() });
        spawnActor(w, { at: [5, 0, 0], character: createCharacter(), player: false });
        w.spawn({ oneWay: { body: 1 } });
      },
    },
    registry,
  );
  return registry;
}

/** The actors of a world, by id. */
const actors = (w: { query(name: string): unknown[] }) => w.query('actor') as (ActorComponents & { id: number })[];

describe('actors', () => {
  it('move by the step’s intents (player) or their own (AI), in the phases anim and readback, with events', () => {
    const { world } = startScene('yard', { registry: yard() });
    expect(world.systems.list().map((s) => `${s.phase}:${s.name}`)).toEqual([
      'intents:scene',
      'anim:actors',
      'physics:physics',
      'readback:actors.readback',
    ]);
    const [player, ai] = actors(world);
    for (let i = 0; i < 10; i++) world.step({});
    for (let i = 0; i < 60; i++) world.step({ move: [1, 0] });
    expect(player.actor.x).toBeGreaterThan(5);
    expect(ai.actor.x).toBeCloseTo(5, 3);
    ai.actor.intents = { move: [0, 1], b: ['jump'] };
    world.step({ b: ['jump'], p: ['jump', 'dash'] }); // a bare world: presses are given (a session adds the edges)
    const types = world.events.trace().map((record) => record.type);
    expect(types.filter((type) => type === 'jump')).toHaveLength(2);
    expect(types).toContain('dash');
    expect(ai.actor.held).toEqual(['jump']);
    world.step({});
    expect(ai.actor.jumpAge).toBe(-1); // held, not pressed again: no second buffered press
    for (let i = 0; i < 60; i++) world.step({});
    expect(world.events.trace().filter((record) => record.type === 'land')).toHaveLength(2);
    expect(ai.actor.z).toBeGreaterThan(1);
  });

  it('give the same hash on every run, and continue exactly after a restore taken mid-jump, from text too', () => {
    const registry = yard();
    const script = (k: number) =>
      k < 40
        ? { move: [1, 0.5] }
        : k < 50
          ? { b: ['jump'], p: k === 40 ? ['jump'] : [] }
          : { move: [-1, 0], p: ['dash'] };
    const run = () => {
      const { world } = startScene('yard', { registry, seed: 4 });
      const hashes: string[] = [];
      for (let k = 0; k < 120; k++) {
        world.step(script(k) as never);
        hashes.push(world.hash());
      }
      return hashes;
    };
    const golden = run();
    expect(run()).toEqual(golden);
    const { world } = startScene('yard', { registry, seed: 4 });
    for (let k = 0; k < 45; k++) world.step(script(k) as never);
    expect(actors(world)[0].actor.grounded).toBe(false);
    const capture = world.capture();
    const text = serialize(capture as unknown as Canonical);
    for (let k = 45; k < 90; k++) world.step(script(k) as never);
    for (const restore of [capture, deserialize(text) as unknown as WorldCapture]) {
      world.restore(restore);
      for (let k = 45; k < 120; k++) {
        world.step(script(k) as never);
        expect(world.hash(), `step ${k + 1}`).toBe(golden[k]);
      }
    }
  });

  it('make a body a one-way platform with the component oneWay, and remove body and entity together', () => {
    const { world } = startScene('yard', { registry: yard() });
    const [player] = actors(world);
    const body = player.actor.body;
    for (let i = 0; i < 200 && player.actor.z < 7; i++) world.step({ move: [0, 1] });
    world.step({ move: [0, 1], b: ['jump'], p: ['jump'] });
    for (let i = 0; i < 30; i++) world.step({ move: [0, 1], b: ['jump'] });
    for (let i = 0; i < 30; i++) world.step({});
    expect(player.actor.y).toBeCloseTo(1.2, 2); // up through the platform's edge at z 8, then on it
    removeActor(world, player.id);
    world.step({});
    expect(world.has(player.id)).toBe(false);
    expect(physicsOf(world).hasBody(body)).toBe(false);
    expect(() => removeActor(world, player.id)).toThrow(/SIM_BAD_ARGUMENT/);
  });
});

describe('the feel', () => {
  it('is measured the same on every run, and __engine.feel() reports it', async () => {
    const character = createCharacter({ speed: 5 });
    const feel = measureFeel(character, { gravity: 32 });
    expect(measureFeel(character, { gravity: 32 })).toEqual(feel);
    const engine = await createHeadless({ scene: 'yard', registry: yard() });
    const report = (engine as unknown as { feel(id?: number): unknown }).feel();
    expect(report).toEqual(measureFeel(createCharacter(), { gravity: 32 }));
    expect(() => (engine as unknown as { feel(id?: number): unknown }).feel(9)).toThrow(/SIM_BAD_ARGUMENT.*1, 2/);
  });
});

/**
 * A registry with the actor kinds and a scene `track`: a 400 × 60 m floor, a `movement:apex` player at the origin
 * (holstered) and an armed one 20 m south, an AI.
 */
function track() {
  const registry = createRegistry();
  defineActorKinds(registry);
  const apex = createCharacter({ movement: 'movement:apex' });
  const floor = { type: 'fixed', colliders: [{ shape: { type: 'box', size: [400, 1, 60] }, position: [0, -0.5, 0] }] } as const; // prettier-ignore
  const setup = (w: World) => {
    physicsOf(w).addBody(floor);
    spawnActor(w, { at: [0, 0, 0], character: apex });
    spawnActor(w, { at: [0, 0, 20], character: apex, player: false, holstered: false });
  };
  defineScene('track', { physics: true, setup }, registry);
  return registry;
}

/** Steps `track` `n` times with `intents`, the AI wanting the same, under `settings`; returns the world and its two actors. */ // prettier-ignore
function onTrack(intents: Intents, n: number, settings: Record<string, unknown> = {}) {
  const { world } = startScene('track', { registry: track(), settings });
  const [player, ai] = actors(world);
  for (let i = 0; i < n; i++) {
    ai.actor.intents = { ...intents };
    world.step(intents);
  }
  return { world, player, ai };
}

/** An actor's speed across the ground. */
const speed = (e: ActorComponents) => Math.hypot(e.actor.vx, e.actor.vz);

describe('actors on the shooter model', () => {
  it('hold its state, holstered unless armed, and read sprint, walk and crouch as its buttons, look as the view', () => {
    const east = { move: [1, 0], look: [Math.PI / 2, 0] } as const;
    const sprinting = onTrack({ ...east, b: ['sprint'] }, 300);
    expect(sprinting.player.motion).toMatchObject({ holstered: true, gait: 'sprint', sprinting: true });
    expect(speed(sprinting.player)).toBeCloseTo(6.604 * 1.15, 2); // the holstered sprint, 7.59 m/s
    expect(sprinting.ai.motion.holstered).toBe(false);
    expect(speed(sprinting.ai)).toBeCloseTo(6.604, 2); // armed
    expect(speed(onTrack({ ...east, b: ['walk'] }, 120).player)).toBeCloseTo(2.2035 * 1.15, 2);
    expect(speed(onTrack({ ...east, b: ['crouch'] }, 120).player)).toBeCloseTo(2.032 * 1.15, 2);
    const across = onTrack({ ...east, look: [0, 0], b: ['sprint'] }, 300); // looking south, moving east: no sprint
    expect(across.player.motion.gait).toBe('run');
    expect(speed(across.player)).toBeCloseTo(4.4069 * 1.15, 2);
  });

  it('face the aim point, else the look, at 720°/s, and take their keys’ frame from cam, else look', () => {
    expect(Math.abs(onTrack({ aim: [0, 0, -10] }, 60).player.actor.yaw)).toBeCloseTo(Math.PI, 6); // north of it
    expect(onTrack({ look: [Math.PI / 2, 0] }, 60).player.actor.yaw).toBeCloseTo(Math.PI / 2, 6);
    const turn = (frame: (yaw: number) => Intents) => {
      const { world, player } = onTrack({ move: [1, 0], ...frame(Math.PI / 2), b: ['sprint'] }, 120);
      world.step({ move: [1, 0], ...frame(Math.PI / 2), b: ['jump'], p: ['jump'] });
      world.step({ move: [1, 0], ...frame(Math.PI / 2) });
      const before = Math.atan2(player.actor.vx, player.actor.vz);
      const yaw = Math.PI / 2 - Math.PI / 6; // W held as the view turns 30° in one step
      world.step({ move: [Math.sin(yaw), Math.cos(yaw)], ...frame(yaw) });
      return Math.abs(Math.atan2(player.actor.vx, player.actor.vz) - before);
    };
    expect(turn((yaw) => ({ cam: yaw }))).toBeLessThan(0.01);
    expect(turn((yaw) => ({ look: [yaw, 0] }))).toBeLessThan(0.01);
    expect(turn(() => ({}))).toBeGreaterThan(0.3); // no frame: a 30° turn of the move is a new key, a lurch
  });

  it('sprint and crouch as the player’s recorded settings say: held, or kept by a press; the AI as Apex', () => {
    const east = { move: [1, 0], look: [Math.PI / 2, 0] } as const;
    /** Runs east, presses `button` once at step 60, lets go, and gives the player and the AI 60 steps on. */
    const pressOnce = (button: string, settings: Record<string, unknown> = {}) => {
      const run = onTrack(east, 60, settings);
      run.ai.actor.intents = { ...east, b: [button], p: [button] };
      run.world.step({ ...east, b: [button], p: [button] });
      for (let i = 0; i < 60; i++) {
        run.ai.actor.intents = { ...east };
        run.world.step(east);
      }
      return run;
    };
    expect(pressOnce('sprint').player.motion.sprinting).toBe(true); // Apex's sticky sprint, the default
    const held = pressOnce('sprint', { 'input.sprint': 'hold' });
    expect([held.player.motion.sprinting, held.ai.motion.sprinting]).toEqual([false, true]); // the AI keeps Apex's
    expect(pressOnce('crouch').player.motion.duck).toBe('standing'); // held, the default: let go, it stands
    const toggled = pressOnce('crouch', { 'input.crouch': 'toggle' });
    expect([toggled.player.motion.duck, speed(toggled.player)]).toEqual(['ducked', expect.closeTo(2.032 * 1.15, 2)]);
    toggled.world.step({ ...east, b: ['crouch'], p: ['crouch'] }); // pressed again: up
    for (let i = 0; i < 30; i++) toggled.world.step(east);
    expect(toggled.player.motion.duck).toBe('standing');
  });

  it('are measured by __engine.feel() holstered or armed, as each is', async () => {
    const engine = (await createHeadless({ scene: 'track', registry: track() })) as unknown as { feel(id?: number): { topSpeed: number } }; // prettier-ignore
    expect(engine.feel().topSpeed).toBeCloseTo(4.4069 * 1.15, 2);
    expect(engine.feel(2).topSpeed).toBeCloseTo(4.4069, 2);
  });
});
