/**
 * @file Unit tests for the character animator (engine/anim/character.ts) and its place in the sim
 * (engine/sim/actors.ts), PLAN.md WP 3.7's Done when: `inspect()` snapshot tests (every sample state, and a strike
 * with a trail), unknown body states warn with a suggestion, and the sim hash is identical whether or not poses are
 * evaluated. Also: footsteps as the gait puts a foot down, the trail (spans, ages, a new ribbon after a jump), layers
 * faded by their weight, the detail levels, save and load, the pool, and a restore that continues exactly.
 */
import { describe, expect, it } from 'vitest';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { createLog } from '../core/log';
import { Quaternion, Vector3 } from '../core/math';
import { createRegistry } from '../core/registry';
import { Rng } from '../core/rng';
import { parse } from '../core/schema';
import { SIM_DT } from '../core/time';
import type { Intents } from '../input/intents';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/world';
import { defineActorKinds, spawnActor, type ActorComponents } from '../sim/actors';
import type { WorldCapture } from '../sim/capture';
import { defineScene, startScene } from '../sim/scene';
import type { World } from '../sim/world';
import { Animator, ANIMATOR_FIELDS, AnimatorPool, FOOTSTEP, TRAIL, type AnimatorData } from './character';
import { jointPosition, socketPosition } from './fk';
import { Humanoid } from './humanoid';
import { SAMPLE_STATES, type AnimatorInput, type SampleState } from './states';
import type { AnimLayer, LayerSlot } from './weights';

const hero = (options = {}) => new Animator({ build: 'build:heroic', weapon: 'sword', rng: new Rng(11), ...options });
const ticks = (seconds: number) => Math.round(seconds / SIM_DT);
const walk = (speed = 5): AnimatorInput => ({ velocity: new Vector3(0, 0, speed) });

describe('inspect()', () => {
  const cases: Record<string, SampleState> = {
    ...SAMPLE_STATES,
    strike: { states: { velocity: new Vector3(0, 0, 4), stance: 'ready', trail: 'blade' }, seconds: 0.5 },
  };
  it.each(Object.keys(cases))('reports %s as plain JSON, as recorded', (name) => {
    const animator = hero();
    const { states, seconds } = cases[name];
    for (let t = 0; t < ticks(seconds); t++) animator.update(states);
    const report = animator.inspect();
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    const grip = animator.socket('weaponR').toArray();
    report.sockets.weaponR.forEach((x, i) => expect(x).toBeCloseTo(grip[i], 4));
    expect(report).toMatchSnapshot();
  });

  it('lists the body states it ignored: unknown body states warn with a suggestion', () => {
    const printed: string[] = [];
    const log = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
    const animator = hero({ log });
    animator.update({ psoe: 'cheer', dash: 'yes' } as unknown as AnimatorInput);
    expect(printed).toEqual([
      expect.stringMatching(/^\[ANIM_UNKNOWN_STATE\] "psoe" is not a body state \(did you mean "pose"\?\)/),
      expect.stringMatching(/^\[ANIM_BAD_STATE\] body state dash is "yes", not true or false/),
    ]);
    expect(animator.inspect().ignored).toEqual(['dash', 'psoe']);
    expect(animator.body.state.weights.dash).toBe(0);
  });
});

describe('step', () => {
  it('lists a footstep as the gait puts each foot down, left then right', () => {
    const animator = hero();
    const sides: string[] = [];
    let lifts = { L: 0, R: 0 };
    for (let t = 0; t < 120; t++) {
      animator.update(walk());
      const { feet } = animator.body.effectors;
      for (const event of animator.events) {
        sides.push(event.side);
        expect([lifts[event.side] > 0, feet[event.side].y], `tick ${t}`).toEqual([true, 0]);
      }
      lifts = { L: feet.L.y, R: feet.R.y };
    }
    const landed = Math.floor((animator.body.state.phase - Math.PI / 2) / Math.PI) + 1;
    expect(sides).toHaveLength(landed);
    expect(sides.length).toBeGreaterThan(5); // 7 in 2 s at 5 m/s
    expect(sides).toEqual(sides.map((_, i) => (i % 2 ? 'R' : 'L')));
  });

  it('lists no footstep in the air, standing, or barely moving', () => {
    const animator = hero();
    for (let t = 0; t < 60; t++) expect(animator.step({ ...walk(), air: true }).events).toEqual([]);
    for (let t = 0; t < 60; t++) expect(animator.step({}).events).toEqual([]);
    const slow = (FOOTSTEP.minSpeed / 2) * animator.body.build.speedRef;
    for (let t = 0; t < 600; t++) expect(animator.step(walk(slow)).events).toEqual([]);
  });
});

describe('pose', () => {
  it('samples the trail once a tick while a part trails, ages it out, and starts a new ribbon after a jump', () => {
    const animator = hero();
    for (let t = 0; t < 20; t++) animator.update({ trail: 'blade' });
    expect(animator.pose().pose().trail).toHaveLength(9); // 0.14 s of samples, 8 ticks back
    const last = animator.trail[8];
    const size = animator.body.build.size;
    expect(last.base.distanceTo(last.tip)).toBeCloseTo((TRAIL.bladeTip - TRAIL.bladeBase) * size, 6);
    expect(last.weight).toBe(TRAIL.blade);
    for (let t = 0; t < 4; t++) animator.update({});
    expect(animator.trail).toHaveLength(1); // 0.07 s once it stops
    animator.update({});
    expect(animator.trail).toHaveLength(0);
    animator.update({ trail: 'kick' });
    animator.update({ trail: 'kick', position: new Vector3(5, 0, 0) });
    expect(animator.trail).toHaveLength(1);
    const { skeleton, world } = animator.body;
    expect(animator.trail[0].base).toEqual(jointPosition(world, 'shinR'));
    expect(animator.trail[0].tip).toEqual(socketPosition(skeleton, world, 'contactR'));
    expect(animator.trail[0].weight).toBe(TRAIL.limb);
    const fists = hero({ weapon: 'none' }).update({ trail: 'blade' });
    expect(fists.trail[0].tip).toEqual(jointPosition(fists.body.world, 'handR'));
  });

  it('runs each layer at full strength, fades it by its weight, and skips it at 0', () => {
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1);
    let applied = 0;
    const nod: AnimLayer = {
      name: 'nod',
      weight: 1,
      apply({ body }) {
        applied++;
        body.pose.setRotation('head', tilt);
      },
    };
    const animator = hero().use('additive', nod);
    animator.update({});
    expect(Math.abs(animator.body.pose.getRotation('head').dot(tilt))).toBeCloseTo(1, 7); // float32 storage
    const solved = hero().update({}).update({}).body.pose.getRotation('head');
    nod.weight = 0.5;
    animator.update({});
    const half = animator.body.pose.getRotation('head');
    expect(half.angleTo(tilt)).toBeCloseTo(solved.angleTo(tilt) / 2, 6);
    nod.weight = 0;
    animator.update({});
    expect(applied).toBe(2);
    expect(animator.inspect().layers[5]).toEqual({ slot: 'additive', layers: [{ name: 'nod', weight: 0 }] });
    expect(() => animator.use('solve' as LayerSlot, { ...nod, name: 'x' })).toThrow(/ANIM_BAD_LAYER.*takes no layers/);
    expect(() => animator.use('clips', nod)).toThrow(/ANIM_BAD_LAYER.*the name is in use/);
    expect(animator.drop('nod').layer('nod')).toBeUndefined();
  });

  it('re-solves once a tick at full detail, less often at lower ones, and moves the last pose between ticks', () => {
    const counter = { name: 'count', weight: 1, applied: 0, apply: () => counter.applied++ };
    const animator = hero().use('clips', counter);
    const runs = [0, 2, 3, 1].map((lod) => {
      counter.applied = 0;
      for (let t = 0; t < 8; t++) animator.update(walk(), { lod });
      return counter.applied;
    });
    expect(runs).toEqual([8, 4, 0, 8]);
    expect(animator.inspect().lod).toBe(1);
    const head = jointPosition(animator.body.world, 'head');
    const at = animator.body.position.clone().add(new Vector3(0.3, 0.1, -0.2));
    animator.pose({ at });
    expect(counter.applied).toBe(8);
    expect(
      jointPosition(animator.body.world, 'head')
        .sub(head)
        .distanceTo(new Vector3(0.3, 0.1, -0.2)),
    ).toBeLessThan(1e-12);
  });
});

describe('save and load', () => {
  it('write what step changed as plain data, read it back, and never share it', () => {
    const data = parse(ANIMATOR_FIELDS, { weapon: 'sword', preciseHits: true }) as unknown as AnimatorData;
    const first = hero({ preciseHits: true });
    for (let t = 0; t < 30; t++) first.update({ ...walk(), pose: 'cheer', trail: 'fistL' });
    first.save(data);
    expect(data.trail).toHaveLength(9 * 8);
    expect(data.trailing).toBe('fistL');
    const copy = structuredClone(data);
    const second = hero({ preciseHits: true, clock: 0 }).load(data);
    expect(second.pose().inspect()).toEqual({ ...first.inspect(), events: [] });
    second.step({ dash: true, trail: 'kick' }).pose();
    expect(data).toEqual(copy);
  });

  it('keep an animator per entity in a pool, made again when its make changes', () => {
    const pool = new AnimatorPool();
    const data = parse(ANIMATOR_FIELDS, {}) as unknown as AnimatorData;
    const [one, two] = [pool.get(1, data), pool.get(2, data)];
    expect(pool.get(1, data)).toBe(one);
    pool.prune((id) => id !== 1);
    expect(pool.get(2, data)).toBe(two);
    expect(pool.get(1, data)).not.toBe(one);
    expect(pool.get(2, { ...data, weapon: 'staff' }).body.weapon).toBe('staff');
  });
});

/** A registry with a scene `arena`: a floor, an animated player, an animated AI with preciseHits, a plain AI. */
function arena() {
  const registry = createRegistry();
  defineActorKinds(registry);
  const floor = { type: 'box', size: [60, 1, 60] } as const;
  defineScene(
    'arena',
    {
      physics: true,
      setup(w) {
        physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: floor, position: [0, -0.5, 0] }] });
        spawnActor(w, {
          at: [0, 0, 0],
          character: createCharacter(),
          anim: { build: 'build:heroic', weapon: 'sword' },
        });
        const anim = { build: 'build:chibi', weapon: 'sword', preciseHits: true } as const;
        spawnActor(w, { at: [4, 0, 0], character: createCharacter(), player: false, anim });
        spawnActor(w, { at: [-4, 0, 0], character: createCharacter(), player: false });
      },
    },
    registry,
  );
  return registry;
}

type Animated = ActorComponents & { id: number };
/** The player's intents at tick `k`: walk, dash, turn, jump, stand. */
const script = (k: number): Intents =>
  k < 50
    ? { move: [1, 0.3] }
    : k === 50
      ? { move: [1, 0], p: ['dash'] }
      : k < 80
        ? { move: [0, 1] }
        : k < 90
          ? { b: ['jump'], p: k === 80 ? ['jump'] : [] }
          : {};
/** Game code before tick `k`: the AI walks south, holding a guard and trailing its blade for a while. */
function play(world: World, k: number): void {
  const ai = (world.query('actor', 'animator') as unknown as Animated[]).find((e) => !e.actor.player);
  if (!ai) return;
  ai.actor.intents = { move: [0, -1] };
  ai.animator.states = k >= 30 && k < 60 ? { stance: 'guard', trail: 'blade' } : k > 100 ? { pose: 'wave' } : {};
}

/** A view-side layer that turns the head a little: presentation state only. */
const glance = (): AnimLayer => ({
  name: 'glance',
  weight: 0.5,
  apply: ({ body }) => void body.pose.setRotation('head', new Quaternion(0, 0.2, 0, 1).normalize()),
});

describe('in the sim', () => {
  const registry = arena();
  const run = (view: boolean, from = 0, to = 160, start?: WorldCapture) => {
    const { world } = startScene('arena', { registry, seed: 9 });
    if (start) world.restore(start);
    const pool = new AnimatorPool();
    const hashes: string[] = [];
    let posed = 0;
    for (let k = from; k < to; k++) {
      play(world, k);
      world.step(script(k));
      hashes.push(world.hash());
      if (!view) continue;
      for (const { id, actor, animator: data } of world.query('actor', 'animator') as unknown as Animated[]) {
        const animator = pool.get(id, data);
        if (!animator.layer('glance')) animator.use('additive', glance());
        for (const alpha of [0.3, 0.7]) {
          const at = new Vector3(actor.x + alpha * actor.vx * SIM_DT, actor.y, actor.z + alpha * actor.vz * SIM_DT);
          animator.pose({ at, yaw: actor.yaw, lod: k % 4 }).inspect();
          posed++;
        }
      }
    }
    return { world, hashes, posed };
  };

  it('gives the same hash whether or not poses are evaluated', () => {
    const blind = run(false);
    const drawn = run(true);
    expect(drawn.posed).toBe(160 * 2 * 2);
    expect(drawn.hashes).toEqual(blind.hashes);
    const types = blind.world.events.trace().map((record) => record.type);
    expect(types.filter((type) => type === 'footstep').length).toBeGreaterThan(10);
    expect(run(false).hashes).toEqual(blind.hashes);
  });

  it('keeps the animator in the component: precise trails, the first breathing phase, a restore from text', () => {
    const fresh = startScene('arena', { registry, seed: 9 }).world;
    const twin = startScene('arena', { registry, seed: 9 }).world;
    const [player, ai] = fresh.query('actor', 'animator') as unknown as Animated[];
    const clock = new Humanoid({ rng: twin.rng.entity(player.id, 'anim') }).state.clock;
    fresh.step({});
    expect(player.animator.state.clock).toBe(clock + SIM_DT);
    expect(player.animator.started).toBe(true);
    for (let k = 0; k < 45; k++) {
      play(fresh, k);
      fresh.step(script(k));
    }
    expect(ai.animator.trailing).toBe('blade');
    expect(ai.animator.trail.length).toBeGreaterThan(8 * 4);
    expect(player.animator.trail).toEqual([]);
    const golden = run(false).hashes;
    const half = run(false, 0, 70);
    const text = serialize(half.world.capture() as unknown as Canonical);
    expect(run(true, 70, 160, deserialize(text) as unknown as WorldCapture).hashes).toEqual(golden.slice(70));
  });
});
