/**
 * @file Unit tests for ACTIONS (engine/anim/actions.ts), PLAN.md WP 8.7's Done when: every action of
 * data/anim/actions/ has a check that plays each of its beats to the end, and passes `animCheckBody` (finite values,
 * bone lengths, feet on the floor, sockets in reach, the same hash twice, 1/60 s against 1/120 s) on a heroic body
 * with a sword; the motion metrics run in the `anim` QA (`node x qa anim --only action:`). Also the player: beats exact
 * in ticks with the leftover carried, events in order, holds, `go`, loops, `finish`, cancel windows, flags, the clip
 * calls, a pair in lockstep, channels that never pop, save and load mid-beat, and a view that leaves the sim's state
 * alone; and the kind's checks.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSet } from '../../tools/anim/repack';
import { createRegistry } from '../core/registry';
import { SIM_DT } from '../core/time';
import { ACTION, actionCheck, Actions, CHANNELS, EFFECTORS, defineAction, getAction, loadActions, type ActionSpec } from './actions'; // prettier-ignore
import { Animator } from './character';
import { animCheckBody, STATE_MATRIX } from './check';
import { ClipLayer } from './clip/layer';
import { loadClipLibrary } from './clip/library';
import { forwardKinematics, socketPosition, tipPosition } from './fk';
import { JOINTS, SOCKETS } from './skeleton';

const DIR = join(import.meta.dirname, '../../data/anim/actions');
const FILES = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .sort();
const DATA = FILES.map((file) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, unknown>);
const ACTIONS = loadActions(DATA);
const LIBRARIES = ['quaternius', 'mesh2motion'].map((set) => loadClipLibrary(readSet(set)));
const hero = (dt = SIM_DT) => new Animator({ build: 'build:heroic', weapon: 'sword', clock: 1, dt });
const ticks = (seconds: number) => Math.round(seconds / SIM_DT);

/** A registry with one action, `action:test`, of `beats` and the rest of `spec`. */
function only(beats: ActionSpec['beats'], spec: Partial<ActionSpec> = {}) {
  const registry = createRegistry();
  defineAction('action:test', { desc: 'A test.', beats, ...spec }, registry);
  return registry;
}

/** Steps `acts` (and `animator`, told its body) `n` ticks; returns every event's type, `beat:type` when asked. */
function run(acts: Actions, n: number, animator?: Animator, tagged = false): string[] {
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    seen.push(...acts.step().map((e) => (tagged ? `${e.phase}:${e.type}` : e.type)));
    animator?.update(acts.body);
  }
  return seen;
}

describe('the first set (data/anim/actions/)', () => {
  it('holds one action per file, named as its file, the set PLAN.md WP 8.7 names', () => {
    expect(DATA.map((d) => `${String(d.action)}.json`)).toEqual(FILES);
    const ids = ACTIONS.map((a) => a.id);
    for (const family of ['jump', 'hurt', 'dizzy', 'roll', 'backflip', 'deathSpin', 'charge', 'itemGet', 'ledgeHang']) {
      expect(ids).toContain(`action:${family}`);
    }
    for (const family of ['wallSlide', 'grab', 'grabbed', 'getUp', 'bored']) expect(ids).toContain(`action:${family}`);
    expect(getAction('grab').pair).toBe('action:grabbed');
  });

  it.each(ACTIONS.map((a) => a.id))('%s: its check plays every beat to the end', (id) => {
    const animator = hero();
    const play = actionCheck(id, { libraries: LIBRARIES }).script!(animator, 0);
    const begun = new Set<string>();
    const steps = ticks(actionCheck(id).seconds) + ticks(STATE_MATRIX.after);
    for (let i = 0; i < steps; i++) {
      animator.update(play(SIM_DT));
      const acts = animator.layer('actions') as Actions;
      for (const e of acts.events) if (e.type === e.phase) begun.add(e.type);
    }
    expect([...begun].sort()).toEqual(
      getAction(id)
        .beats.map((b) => b.name)
        .sort(),
    );
    expect((animator.layer('actions') as Actions).state.playing).toBe('');
  });

  // the floor and the rate are the anim QA's, against its baseline: the body's own crouch and kneel sinks (ADR-0009
  // amendment 3), the die pose's drift and the clips' are not the action's
  it.each(ACTIONS.map((a) => a.id))('%s: passes animCheckBody on a heroic body with a sword', (id) => {
    const report = animCheckBody(hero, { states: { [id]: actionCheck(id, { libraries: LIBRARIES }) } });
    expect(report.problems.filter((p) => p.check !== 'floor' && p.check !== 'rate').map((p) => p.message)).toEqual([]);
  });

  it('a pair has the same beats as its partner, so they step in lockstep', () => {
    for (const action of ACTIONS.filter((a) => a.pair)) {
      const partner = getAction(action.pair);
      expect(partner.beats.map((b) => [b.name, b.seconds, b.until])).toEqual(action.beats.map((b) => [b.name, b.seconds, b.until])); // prettier-ignore
    }
    const [attacker, victim] = [new Actions(), new Actions()];
    attacker.play('grab', victim);
    for (let i = 0; i < 90; i++) {
      if (i === 30) [attacker, victim].forEach((a) => a.next());
      attacker.step();
      victim.step();
      expect(victim.beat).toBe(attacker.beat);
    }
  });
});

describe('the player', () => {
  const beats: ActionSpec['beats'] = [
    { name: 'a', seconds: 0.1, events: [{ type: 'mid', at: 0.5 }] },
    { name: 'b', seconds: 0.05, until: 'next', flags: ['invulnerable'] },
    { name: 'c', seconds: 0.1, cancel: { by: ['walk'], after: 0.5 } },
  ];
  const held = { check: { signals: [{ at: 1, do: 'next' }] } };

  it('plays beats exact in ticks, events in order, and holds a beat until next', () => {
    const acts = new Actions({ registry: only(beats, held) });
    expect(acts.play('test').events.map((e) => e.type)).toEqual(['a']);
    expect(run(acts, 6)).toEqual(['a', 'mid', 'b']); // the next step keeps play's events; 0.1 s is exactly 6 ticks
    expect(run(acts, 60)).toEqual([]);
    expect([acts.beat, acts.flag('invulnerable')]).toEqual(['b', true]);
    expect(acts.next().events.map((e) => e.type)).toEqual(['c']);
    expect(run(acts, 6)).toEqual(['c', 'end']);
    expect([acts.beat, acts.state.playing, acts.flag('invulnerable')]).toEqual([undefined, '', false]);
  });

  it('carries the time left over into the next beats, each event saying how late it is', () => {
    const acts = new Actions({ registry: only(beats, held), dt: 0.13 }).play('test');
    const events = acts.step();
    expect(events.map((e) => e.type)).toEqual(['a', 'mid', 'b']);
    expect(events[2].late).toBeCloseTo(0.03, 9);
  });

  it('goes to a beat, loops by then, finishes to its exit, and names a beat it lacks', () => {
    const loop = only([
      { name: 'in', seconds: 0.05 },
      { name: 'x', seconds: 0.05 },
      { name: 'y', seconds: 0.05, then: 'x' },
      { name: 'out', seconds: 0.05 },
    ], { exit: 'out', check: { signals: [{ at: 1, do: 'finish' }] } }); // prettier-ignore
    const acts = new Actions({ registry: loop }).play('test');
    expect(run(acts, 30).join(' ')).toBe('in x y x y x y x y x y');
    expect(acts.finish().beat).toBe('out');
    expect(run(acts, 3)).toEqual(['out', 'end']);
    expect(() => acts.play('test').go('z')).toThrow(/ANIM_UNKNOWN_BEAT.*no beat "z"/);
    expect(acts.go('y').beat).toBe('y');
    expect(acts.stop().state.playing).toBe('');
  });

  it('opens its cancel window from its share on, for what it names', () => {
    const acts = new Actions({ registry: only(beats, held) }).play('test');
    expect(acts.cancels('walk')).toBe(false);
    acts.go('c');
    run(acts, 2);
    expect([acts.cancels('walk'), acts.cancel('walk')]).toEqual([false, false]);
    run(acts, 1);
    expect([acts.cancels('move'), acts.cancel('walk'), acts.state.playing]).toEqual([false, true, '']);
    expect(acts.cancel('anything')).toBe(true); // nothing plays
  });

  it('tells the humanoid its body states, its motion eased, or its move at the beat share', () => {
    const acts = new Actions({ registry: only([
      { name: 'down', seconds: 0.1, body: { down: 1, pose: 'kneel' }, motion: { lean: 0.5 } },
      { name: 'swing', seconds: 0.1, move: { id: 'move:slash', phase: 'active', u: [0, 1] } },
    ]) }).play('test'); // prettier-ignore
    expect(acts.body).toEqual({ down: 1, pose: 'kneel' }); // the motion starts at rest
    run(acts, 3);
    expect((acts.body.body as { lean: number }).lean).toBeCloseTo(0.25, 9); // smoothstep at half the beat
    run(acts, 6);
    expect(acts.body).toEqual({ body: { move: 'move:slash', phase: 'active', u: 0.5 } });
  });

  it('eases its channels without a jump, from where they were, and back to rest after it', () => {
    const acts = new Actions({ registry: only([
      { name: 'up', seconds: 0.2, effectors: { handR: [0.1, 0.2, 0.5] }, scale: [1, 0.5, 1] },
      { name: 'flip', seconds: 0.3, flip: { turns: 1, axis: 'back' } },
    ]) }).play('test'); // prettier-ignore
    let last = acts.channels();
    let worst = 0;
    const turn = (a: number) => Math.abs(a - 2 * Math.PI * Math.round(a / (2 * Math.PI)));
    for (let i = 0; i < 60; i++) {
      if (i === 20) acts.stop(); // mid-flip
      acts.step();
      const now = acts.channels();
      const jumps = now.map((x, k) => (k === CHANNELS.flip ? turn(x - last[k]) : Math.abs(x - last[k])));
      worst = Math.max(worst, ...jumps.filter((_, k) => k !== CHANNELS.flip + 1)); // the axis: an index
      last = now;
    }
    expect(worst).toBeLessThan((1.5 * 2 * Math.PI) / 0.3 / 60 + 1e-9); // the fastest: the flip's, smoothstep's 1.5 × its mean
    const meaningful = (ch: number[]) => [...ch.slice(0, 5), ...EFFECTORS.map((_, k) => ch[CHANNELS.effectors + 4 * k + 3]), ch[CHANNELS.flip], ...ch.slice(CHANNELS.scale)]; // prettier-ignore
    expect(meaningful(last)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]); // motion, weights, angle, scale
    expect(acts.state.t).toBe(ACTION.out);
  });

  it('saves and loads mid-beat, and goes on the same', () => {
    const registry = only(beats, held);
    const a = new Actions({ registry }).play('test');
    run(a, 4);
    const b = new Actions({ registry }).load(a.save());
    expect(run(a, 10, undefined, true)).toEqual(run(b, 10, undefined, true));
    expect(b.save()).toEqual(a.save());
  });

  it('posing the body never changes its state: the view reads it, the sim steps it', () => {
    const [posed, bare] = [hero(), hero()];
    const [a, b] = [new Actions().attach(posed).play('roll'), new Actions().play('roll')];
    for (let i = 0; i < 40; i++) {
      a.step();
      b.step();
      posed.update(a.body);
      bare.step(b.body);
    }
    expect(a.save()).toEqual(b.save());
  });

  it('rolls a body on its ground point; one flipping in the air rides the arc the game makes', () => {
    for (const [id, ground] of [
      ['roll', true],
      ['backflip', false],
    ] as const) {
      const animator = hero();
      const acts = new Actions().attach(animator).play(id);
      for (let i = 0; i < 40; i++) {
        acts.step();
        animator.update(acts.body);
        const turning = Math.abs(acts.channels()[CHANNELS.flip]) > 1e-9; // (at rest, the body is the humanoid's)
        if (acts.beat !== (ground ? 'roll' : 'flip') || acts.u >= 1 || !(turning || ground)) continue;
        const { skeleton, pose } = animator.body;
        const world = forwardKinematics(skeleton, pose);
        const tips = JOINTS.map((_, j) => Math.min(world.positions[j * 3 + 1], tipPosition(skeleton, world, j).y));
        const low = Math.min(...tips, ...SOCKETS.map((socket) => socketPosition(skeleton, world, socket).y));
        if (ground) expect(low).toBeCloseTo(0, 6);
        else expect(animator.body.pose.rootPos.y).toBeLessThan(2); // not lifted off: a backflip turns about its pivot
      }
    }
  });

  it('plays its clip beats on the clip layer, keeps a clip across beats that name it, and fades it after', () => {
    expect(() => new Actions().play('dizzy')).toThrow(/ANIM_ACTION_NO_CLIPS.*MESH2MOTION\/Dizzy/);
    const clips = new ClipLayer({ library: LIBRARIES, build: 'build:heroic' });
    const acts = new Actions({ clips }).play('deathSink');
    for (let i = 0; i < ticks(3.3); i++) {
      acts.step();
      clips.step();
    }
    expect([acts.beat, clips.current?.clip, acts.state.clip]).toEqual(['dead', 'MESH2MOTION/Death_A', 'MESH2MOTION/Death_A']); // prettier-ignore
    expect(clips.current!.t).toBeGreaterThan(3); // one slot all along: its time ran on
    acts.stop();
    expect([clips.current?.stopping, acts.state.clip]).toEqual([0.2, '']);
  });
});

describe('the kind', () => {
  it('names what is wrong with an action', () => {
    const bad = (spec: Partial<ActionSpec>) => () =>
      defineAction('action:bad', { desc: 'Bad.', beats: [{ name: 'a', seconds: 0.1 }], ...spec }, createRegistry());
    expect(bad({ beats: [] })).toThrow(/it has no beats/);
    expect(bad({ beats: [{ name: 'a', seconds: 0.1 }, { name: 'a', seconds: 0.1 }] })).toThrow(/two beats are named "a"/); // prettier-ignore
    expect(bad({ exit: 'b' })).toThrow(/exit "b" is unknown \(did you mean "a"\?\)/);
    expect(bad({ beats: [{ name: 'a', seconds: 0.1, body: { psoe: 'kneel' } }] })).toThrow(/body state "psoe" is unknown \(did you mean "pose"\?\)/); // prettier-ignore
    expect(bad({ beats: [{ name: 'a', seconds: 0.1, until: 'next' }] })).toThrow(/check.signals must say when/);
    expect(bad({ beats: [{ name: 'a', seconds: 0.1, motion: {}, move: { id: 'jab', phase: 'wind' } }] })).toThrow(/a move and a motion/); // prettier-ignore
    expect(bad({ beats: [{ name: 'a', seconds: 0.1, effectors: { handL: [1, 2] } }] })).toThrow(/not 3 numbers/);
    expect(bad({ beats: [{ name: 'a', secs: 0.1 } as never] })).toThrow(/unknown key "secs"/);
  });

  it('loads a file once: the same spec again is kept, another one is a duplicate, one without a name is refused', () => {
    const registry = createRegistry();
    const file = { action: 'wave', desc: 'A wave.', beats: [{ name: 'up', seconds: 0.2 }] };
    const [first] = loadActions([file], registry);
    expect(loadActions([structuredClone(file)], registry)[0]).toBe(first);
    expect(() => loadActions([{ ...file, desc: 'Another.' }], registry)).toThrow(/CORE_DUPLICATE_ID/);
    expect(() => loadActions([{ desc: 'No name.' }], registry)).toThrow(/no "action" name/);
  });
});
