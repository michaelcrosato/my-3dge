/**
 * @file Unit tests for actions on actors (engine/sim/actorActions.ts, WP 13.11): `actOn` gives an actor the component
 * `actions` at rest and plays on it; `actors.anim` steps it before the animator, telling the body what the beat says
 * and emitting each event as `action`; every one of the engine's 28 actions plays on an actor to its end (or its
 * stop), signalled as its check says, its clip beats on the actor's clip layer; a capture taken mid-action restores to the same
 * hashes, and one taken right after a game system plays an action in its step, its events counted into a component,
 * goes on to the same hash and the same events, restored into a fresh world or the same one; a call that changes
 * nothing adds nothing; an action that plays clips is refused on an actor without them, naming the fix.
 */
import { describe, expect, it } from 'vitest';
import { getAction } from '../anim/actions-data';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { registry } from '../core/registry';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { defineActions, defineLibrary } from '../../tools/anim/library';
import { actOn, ACTIONS_FIELDS, type ActionComponents } from './actorActions';
import { spawnActor, type ActorComponents } from './actors';
import type { WorldCapture } from './capture';
import { defineScene, startScene } from './scene';
import { defineComponent } from './state';
import type { World } from './world';

defineLibrary();
const ACTIONS = defineActions();

/** A floor and the adult at the origin, with the clip sets the actions' clip beats play from unless `clips` is false. */
function yard(clips = true): World {
  const scene = defineScene(`test:actor-actions-${Math.random()}`, {
    physics: true,
    setup(w) {
      const floor = { shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] } as const;
      physicsOf(w).addBody({ type: 'fixed', colliders: [floor] });
      const sets = { sets: ['clipset:quaternius', 'clipset:mesh2motion'] };
      spawnActor(w, { at: [0, 0, 0], character: createCharacter(), anim: { build: 'build:adult' }, ...(clips ? { clips: sets } : {}) }); // prettier-ignore
    },
  });
  return startScene(scene).world;
}

type Hero = ActorComponents & Partial<ActionComponents>;
const hero = (w: World) => w.get(1) as unknown as Hero;

/** Plays action `id` on the yard's actor to its end, as its check signals; the events in order and the steps taken. */
function playThrough(w: World, id: string) {
  const action = getAction(id);
  const events: string[] = [];
  w.events.on('action', (e) => void events.push(`${(e as { type: string }).type}`));
  actOn(w, 1, (a) => a.play(id));
  const signals = [...action.check.signals];
  let steps = 0;
  for (; steps < 60 * 10 && !events.includes('end'); steps++) {
    const t = steps * w.dt;
    while (signals.length && signals[0].at <= t + 1e-9) {
      const { do: what } = signals.shift()!;
      actOn(w, 1, (a) => (what === 'next' ? a.next() : what === 'finish' ? a.finish() : what === 'stop' ? a.stop() : a.go(what))); // prettier-ignore
    }
    w.step({});
  }
  return { events, steps };
}

describe('actions on actors', () => {
  it('gives an actor its actions at rest, then plays one: its beats as action events, its body told, at rest after', () => {
    const w = yard();
    expect(hero(w).actions).toBeUndefined();
    const state = actOn(w, 1, (a) => a.play('roll'));
    expect(state).toBe(hero(w).actions);
    expect(state.playing).toBe('action:roll');
    expect(Object.keys(ACTIONS_FIELDS)).toEqual(Object.keys(state));
    const seen: { id: number; type: string }[] = [];
    w.events.on('action', (e) => void seen.push(e as { id: number; type: string }));
    const crouched: number[] = [];
    for (let k = 0; k < 90; k++) {
      w.step({});
      crouched.push(hero(w).animator.state.body.crouch);
    }
    expect(seen.every((e) => e.id === 1)).toBe(true);
    expect(seen.map((e) => e.type)).toContain('end');
    expect(Math.max(...crouched)).toBeGreaterThan(0.3); // the roll's tuck reached the humanoid
    expect(hero(w).actions!.playing).toBe('');
  });

  it('plays every one of the engine’s actions to its end, each signalled as its check says', () => {
    expect(ACTIONS).toHaveLength(28);
    for (const action of ACTIONS) {
      const w = yard();
      const { events } = playThrough(w, action.id);
      const stopped = action.check.signals.at(-1)?.do === 'stop'; // a held death, let go: stop fires nothing
      if (!stopped) expect([action.id, events.at(-1)]).toEqual([action.id, 'end']);
      expect(events[0]).toBe(action.beats[0].name); // its first beat's name as it begins
      for (let k = 0; k < 30; k++) w.step({}); // the channels ease back to rest
      expect([action.id, hero(w).actions!.playing, hero(w).actions!.beat]).toEqual([action.id, '', -1]);
    }
  });

  it('restores a capture taken mid-action and goes on to the same hashes', () => {
    const w = yard();
    actOn(w, 1, (a) => a.play('ledgeHang'));
    for (let k = 0; k < 20; k++) w.step({});
    const capture = deserialize(serialize(w.capture() as unknown as Canonical)) as unknown as WorldCapture;
    const run = () => {
      for (let k = 0; k < 10; k++) w.step({});
      actOn(w, 1, (a) => a.next()); // up from the hang
      for (let k = 0; k < 60; k++) w.step({});
      return w.hash();
    };
    const first = run();
    w.restore(capture);
    expect(run()).toBe(first);
  });

  it('restores every capture, even one taken right after a game system plays an action in its step', () => {
    if (!registry.has('component', 'testActionsSeen')) defineComponent('testActionsSeen', { description: 'Action events seen.', fields: { n: { type: 'integer', default: 0, description: 'How many.' } } }); // prettier-ignore
    const scene = defineScene(`test:actor-actions-rules-${Math.random()}`, {
      physics: true,
      setup(w) {
        physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] }); // prettier-ignore
        spawnActor(w, { at: [0, 0, 0], character: createCharacter(), anim: { build: 'build:adult' } });
        w.spawn({ testActionsSeen: { n: 0 } });
        w.events.on('action', () => {
          for (const e of w.query('testActionsSeen')) (e['testActionsSeen'] as { n: number }).n += 1;
        });
        w.systems.add('test.roll', (ww: World) => void (ww.tick === 3 && actOn(ww, 1, (a) => a.play('roll')))); // the default phase, after anim
      },
    });
    const seen = (w: World) => (w.query('testActionsSeen')[0]['testActionsSeen'] as { n: number }).n;
    const run = startScene(scene).world;
    const captures: WorldCapture[] = [];
    for (let k = 0; k < 40; k++) {
      run.step({});
      captures.push(deserialize(serialize(run.capture() as unknown as Canonical)) as unknown as WorldCapture);
    }
    const want = [run.hash(), seen(run)];
    expect(want[1]).toBeGreaterThan(2); // the roll's beats and its end were heard
    for (const [k, capture] of captures.entries()) {
      for (const w of [startScene(scene).world, run]) {
        w.restore(capture);
        for (let j = k + 1; j < 40; j++) w.step({});
        expect([k, w.hash(), seen(w)]).toEqual([k, ...want]);
      }
    }
  });

  it('adds nothing for a call that changes nothing', () => {
    const w = yard();
    const before = w.hash();
    expect(actOn(w, 1, (a) => a.inspect()).playing).toBe(''); // only looked
    expect([hero(w).actions, w.hash()]).toEqual([undefined, before]);
  });

  it('refuses an action that plays clips on an actor without them, naming the fix', () => {
    const w = yard(false);
    expect(() => actOn(w, 1, (a) => a.play('ledgeHang'))).toThrow(/SIM_ACTION_NO_CLIPS.*addClips/);
    expect(() => actOn(w, 1, (a) => a.play('roll'))).not.toThrow(); // no clip beats: any animated actor plays it
    expect(() => actOn(w, 99, (a) => a.play('roll'))).toThrow(/SIM_BAD_ARGUMENT/);
  });
});
