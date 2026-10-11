/**
 * @file Unit tests for reactions (engine/anim/reactions.ts), PLAN.md WP 6.2's Done when: the correct get-up is
 * chosen, face up or face down, for every facing and every direction a body is knocked down or killed from (read
 * from the posed body), and from a measured chest (the ragdoll hand-off). Also: the directional flinch and its spring
 * back, the timelines exact in ticks (fall, lie, get up; stagger, buckle, topple, dead), save and load, and the
 * layers as view state only, shown on a fixture hero (the box rule).
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { SIM_DT } from '../core/time';
import { Animator } from './character';
import { jointPosition, jointRotation } from './fk';
import { lyingOf, REACTION, REACTIONS, Reactions, type Lying } from './reactions';
import type { AnimatorInput } from './states';

const ticks = (seconds: number) => Math.round(seconds / SIM_DT);
const hero = () => new Animator({ build: 'build:heroic', weapon: 'sword', rng: new Rng(4) });
const along = (angle: number) => new Vector3(Math.sin(angle), 0, Math.cos(angle));

/** One tick: the reactions step, the body is told them over `states`, the view poses it. Returns the events' types. */
function tick(animator: Animator, react: Reactions, states: AnimatorInput = {}): string[] {
  const events = react.step().map((e) => e.type);
  animator.step({ ...states, ...react.body }).pose();
  return events;
}

/** How the posed body lies: face up when the chest's front looks up. */
function measured(animator: Animator): Lying {
  const front = new Vector3(0, 0, 1).applyQuaternion(jointRotation(animator.body.world, 'chest'));
  expect(Math.abs(front.y)).toBeGreaterThan(0.9); // flat on the floor, either way
  return front.y > 0 ? 'up' : 'down';
}

describe('the get-up is chosen by how the body lies', () => {
  const YAWS = [0, 0.7, Math.PI / 2, Math.PI, -2.2];
  const HITS = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6 + 0.1);

  it.each(YAWS)('knocked down from any side, facing %f: it lies the way it was pushed and gets up that way', (yaw) => {
    for (const hitAngle of HITS) {
      const [animator, react] = [hero(), new Reactions()];
      react.attach(animator);
      animator.update({ yaw });
      const push = along(hitAngle);
      react.knockDown(push, yaw);
      const events: string[] = [];
      for (let t = 0; t < ticks(REACTION.fall + REACTION.lie); t++) events.push(...tick(animator, react, { yaw }));
      const forward = push.dot(along(yaw)) > 0;
      expect(measured(animator)).toBe(forward ? 'down' : 'up');
      expect(react.lying).toBe(measured(animator));
      expect(react.playing).toBe(forward ? 'getUpFront' : 'getUpBack');
      expect(events.slice(-2)).toEqual(['end', forward ? 'pushUp' : 'sitUp']);
    }
  });

  it.each(YAWS)('killed from behind it lies on its face, else on its back, facing %f', (yaw) => {
    for (const [push, lying] of [
      [along(yaw), 'down'],
      [along(yaw + Math.PI), 'up'],
      [undefined, 'up'],
    ] as const) {
      const [animator, react] = [hero(), new Reactions()];
      react.attach(animator);
      animator.update({ yaw });
      react.die(push, yaw);
      for (let t = 0; t < ticks(1.5); t++) tick(animator, react, { yaw });
      expect([measured(animator), react.lying, react.phase]).toEqual([lying, lying, 'dead']);
    }
  });

  it('gets up the way a measured chest lies: the ragdoll hand-off', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 200; i++) {
      const axis = new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      const chest = new Quaternion().setFromAxisAngle(axis, rng.range(-Math.PI, Math.PI));
      const lying = new Vector3(0, 0, 1).applyQuaternion(chest).y >= 0 ? 'up' : 'down';
      expect(lyingOf(chest)).toBe(lying);
      const react = new Reactions().getUp(chest);
      expect(react.playing).toBe(lying === 'up' ? 'getUpBack' : 'getUpFront');
    }
  });

  it('keeps lying as it lies when knocked down again, and a dead body stays dead', () => {
    const react = new Reactions().knockDown(along(Math.PI), 0);
    react.step();
    react.knockDown(along(0), 0);
    expect([react.lying, react.phase]).toEqual(['up', 'fall']);
    react.die(along(0), 0).knockDown(along(0), 0);
    expect([react.lying, react.playing]).toEqual(['up', 'die']);
    expect(react.getUp().playing).toBe('getUpBack');
  });
});

describe('timelines, exact in ticks', () => {
  it('falls, lies 0.8 s, then gets up: each phase on its tick, the body down and up again', () => {
    const [animator, react] = [hero(), new Reactions().knockDown(along(Math.PI), 0)];
    react.attach(animator);
    const at: Record<string, number> = { fall: 0 };
    let downAtLie = 0;
    for (let t = 1; t <= 120; t++) {
      for (const type of tick(animator, react)) at[type === 'end' ? `end@${t}` : type] = t;
      if (react.phase === 'lie') downAtLie = animator.body.state.weights.down;
    }
    expect(at).toEqual({ fall: 0, lie: 12, 'end@60': 60, sitUp: 60, kneel: 75, rise: 93, 'end@105': 105 });
    expect(downAtLie).toBe(1);
    expect(react.playing).toBeUndefined();
    expect(react.body).toEqual({});
    expect(animator.body.state.weights.down).toBe(0);
    expect(jointPosition(animator.body.world, 'head').y).toBeGreaterThan(1.5);
  });

  it('lies until told when its lie is endless, and saves that as −1', () => {
    const react = new Reactions().knockDown(along(0), 0, Infinity);
    for (let t = 0; t < 600; t++) react.step();
    expect([react.phase, react.save().lie]).toEqual(['lie', -1]);
    react.getUp();
    expect([react.playing, react.phase, react.events.map((e) => e.type)]).toEqual(['getUpFront', 'pushUp', ['pushUp']]);
    for (let t = 0; t < ticks(0.8); t++) react.step();
    expect([react.playing, react.lying]).toEqual([undefined, 'up']); // on its feet again
  });

  it('dies at the die pose’s own times, and stays dead', () => {
    const [animator, react] = [hero(), new Reactions().die()];
    react.attach(animator);
    const at: Record<string, number> = { stagger: 0 };
    let downAtDead = 0;
    for (let t = 1; t <= ticks(10); t++) {
      for (const type of tick(animator, react)) at[type] = t;
      if (at.dead === t) downAtDead = animator.body.state.weights.down;
    }
    expect(at).toEqual({ stagger: 0, buckle: 12, topple: 27, dead: 39 });
    expect(downAtDead).toBe(1);
    expect([react.phase, react.body]).toEqual(['dead', { pose: 'die' }]);
    expect(REACTIONS.die.map((p) => p.duration)).toEqual([0.2, 0.25, 0.2, Infinity]);
  });

  it('saves and loads as plain data: a copy continues exactly', () => {
    const react = new Reactions().knockDown(along(0.3), 0.3, 0.5).hit(along(2), 0.3, 2);
    for (let t = 0; t < 50; t++) react.step();
    const copy = new Reactions().load(JSON.parse(JSON.stringify(react.save())));
    expect(copy.save()).toEqual(react.save());
    for (let t = 0; t < 60; t++) {
      expect(copy.step()).toEqual(react.step());
      expect([copy.body, copy.flinch, copy.phase]).toEqual([react.body, react.flinch, react.phase]);
    }
    expect(new Reactions().load({ ...react.save(), playing: 'nap' as 'die' }).playing).toBeUndefined();
  });
});

describe('the directional flinch', () => {
  it.each([0, 1, Math.PI / 2, -2.4])('leans along the hit’s travel and springs back, facing %f', (yaw) => {
    const right = new Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    for (const [push, side, forward] of [
      [along(yaw), 0, 1],
      [right, 1, 0],
      [right.clone().negate(), -1, 0],
    ] as const) {
      const react = new Reactions().hit(push, yaw);
      let peak = 0;
      for (let t = 0; t < 60; t++) {
        react.step();
        peak = Math.max(peak, Math.abs(react.flinch.side), Math.abs(react.flinch.forward));
        if (t !== 5) continue;
        expect(Math.sign(Math.round(react.flinch.side * 1e9))).toBe(side);
        expect(Math.sign(Math.round(react.flinch.forward * 1e9))).toBe(forward);
      }
      expect(peak).toBeGreaterThan(0.3);
      expect(peak).toBeLessThan(REACTION.limit);
      expect(Math.abs(react.flinch.side) + Math.abs(react.flinch.forward)).toBeLessThan(0.02);
    }
  });

  it('kicks by its strength within bounds, and pushes back when the hit has no direction', () => {
    const kick = (strength: number) => new Reactions().hit(along(0), 0, strength).flinch.forwardSpeed;
    expect([kick(1), kick(10), kick(0)]).toEqual([7, 21, 7 * 0.2].map((x) => expect.closeTo(x, 12)));
    expect(new Reactions().hit(new Vector3(0, -1, 0), 0).flinch.forwardSpeed).toBeCloseTo(-7, 12);
  });

  it('bends the posed spine and head toward the hit; the sim state never sees it', () => {
    const [plain, struck] = [hero(), hero()];
    const react = new Reactions().attach(struck);
    react.hit(new Vector3(1, 0, 0), 0); // travelling to the hero's left (+X)
    for (let t = 0; t < 8; t++) {
      plain.update();
      tick(struck, react);
    }
    const head = (a: Animator) => jointPosition(a.body.world, 'head');
    expect(head(struck).x - head(plain).x).toBeGreaterThan(0.05);
    expect(JSON.stringify(struck.body.state)).toBe(JSON.stringify(plain.body.state));
    const report = struck.inspect().layers;
    expect(report.find((l) => l.slot === 'additive')).toMatchObject({ layers: [{ name: 'reactions', lying: 'up' }] });
    expect(report.find((l) => l.slot === 'physics')).toMatchObject({ layers: [{ name: 'reactions:lying' }] });
  });
});
