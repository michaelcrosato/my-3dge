/**
 * @file Tests the Animation Lab's lineup (labs/anim/scenes/lineup.ts, WP 10.8) headless: a figure per registered build
 * in a row; a move swung on every figure in step, held at a time for scrubbing exactly as an attack updated that long;
 * a pose told to all; a walk that is put back where it started; and the same hashes run after run.
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine';
import { Attack } from '../../../engine/sim-api';
import { startScene } from '../../../engine/sim/scene';
import { LINEUP_AT, LINEUP_BUILDS, LINEUP_GAP, LINEUP_STATES, lineup } from './lineup';

type Figure = {
  id: number;
  actor: { x: number; z: number };
  labFigure: { x: number };
  animator: { build: string; states: { body?: { move: string; phase: string; u: number }; pose?: string } };
};

/** The scene started with `settings`, stepped by `step(n)`, and its figures. */
function started(settings: Record<string, unknown> = {}) {
  const { world } = startScene(lineup, { settings } as never);
  const figures = () => world.query('labFigure') as unknown as Figure[];
  const step = (n: number) => {
    for (let i = 0; i < n; i++) world.step({});
  };
  return { world, figures, step };
}

describe('lab:lineup', () => {
  it('stands a figure on each registered build, a gap apart, round the stage’s middle', () => {
    const { figures } = started();
    const xs = figures().map((f) => f.labFigure.x);
    expect(xs).toHaveLength(LINEUP_BUILDS.length - 1); // the mannequin's only with lab.anim.mannequin
    xs.slice(1).forEach((x, i) => expect(x - xs[i]).toBeCloseTo(LINEUP_GAP, 9));
    expect((xs[0] + xs[xs.length - 1]) / 2).toBeCloseTo(LINEUP_AT[0], 9);
    expect(LINEUP_STATES).toEqual(expect.arrayContaining(['walk', 'run', 'idle', 'cheer']));
  });

  it('swings a move on every figure in step, and holds it where the timeline is scrubbed to', () => {
    const run = started({ 'lab.anim.play': 'move:jab' });
    run.step(9);
    const bodies = run.figures().map((f) => f.animator.states.body);
    expect(bodies.every((b) => b?.move === 'move:jab')).toBe(true);
    expect(new Set(bodies.map((b) => `${b?.phase}:${b?.u}`)).size).toBe(1);
    const held = started({ 'lab.anim.play': 'move:jab', 'lab.anim.time': 0.2 });
    held.step(3);
    const first = held.figures()[0].animator.states.body;
    held.step(5);
    expect(held.figures()[0].animator.states.body).toEqual(first); // held: scrubbing shows one moment
    const jab = new Attack('move:jab');
    jab.start();
    jab.update(0.2);
    expect([first?.phase, first?.u]).toEqual([jab.body?.phase, jab.body?.u]);
  });

  it('tells every figure a pose, and puts a walking figure back once it has walked its span', () => {
    const posed = started({ 'lab.anim.play': 'cheer' });
    posed.step(2);
    expect(posed.figures().every((f) => f.animator.states.pose === 'cheer')).toBe(true);
    const walking = started({ 'lab.anim.play': 'run' });
    let farthest = 0;
    for (let i = 0; i < 240; i++) {
      walking.step(1);
      farthest = Math.max(farthest, walking.figures()[0].actor.z - LINEUP_AT[2]);
    }
    expect(farthest).toBeGreaterThan(1);
    expect(farthest).toBeLessThan(4);
  });

  it('gives the same hash run after run', async () => {
    const hashes = async () => {
      const engine = await createHeadless({ scene: lineup, settings: { 'lab.anim.play': 'move:slash' } });
      return [60, 120].map(() => (engine.step(60), engine.hash()));
    };
    expect(await hashes()).toEqual(await hashes());
  });
});
