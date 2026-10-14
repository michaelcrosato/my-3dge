/**
 * @file Tests for the crowd-1000 fixture (PLAN.md WP 5.1's Done-when, Node's half; `node x replay
 * tests/replays/crowd-1000.replay.json --browser sim` is Chromium's, `node x perf fixtures/scenes/crowd-1000 --budget`
 * the budget's): one drive through the replay's inputs gives its goldens and shows the spawn queue (25 a step), the
 * crowd packing toward the centre, the blast's deaths and knockback, corpses settling and removed 1.6 s after their
 * deaths, `thin` through the despawn queue, replacements keeping the crowd at 1,000, and a whole-sim capture taken with
 * corpses in the air restoring exactly; a second run without the in-place physics restore gives the same goldens.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CrowdAgent } from '../../../engine/physics/crowd';
import { checkReplay, playReplay } from '../../../engine/sim/replay';
import { createSession, type Session } from '../../../engine/sim/session';
import { BLAST, CENTRE } from './index';

const REPLAY = checkReplay(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../tests/replays/crowd-1000.replay.json'), 'utf8')),
);
const PLATFORM = `${process.platform}-${process.arch}`;
const GOLDEN = REPLAY.hashes[PLATFORM];
const DUE = Math.round(1.6 * 60); // a corpse's 1.6 s, in steps

/** Every agent of a session, in id order. */
const agents = (session: Session) => session.world.query('pusher').map((e) => e.pusher as unknown as CrowdAgent);
/** How far an agent is from the centre, across the ground (m). */
const fromCentre = (a: CrowdAgent) =>
  Math.sqrt((a.x - CENTRE[0]) * (a.x - CENTRE[0]) + (a.z - CENTRE[1]) * (a.z - CENTRE[1]));
/** How many agents are in each state. */
const census = (session: Session) =>
  agents(session).reduce<Record<string, number>>((n, a) => ({ ...n, [a.state]: (n[a.state] ?? 0) + 1 }), {});

/** One step of the replay's inputs: the dev actions before it, the blasts' presses. */
function stepAt(session: Session, k: number): void {
  if (k === 200) session.act('roundtrip');
  if (k === 330) session.act('thin');
  session.step(k === 180 || k === 420 ? { b: ['blast'] } : {});
}

describe('the crowd-1000 fixture', () => {
  it('drives the replay to its goldens: the queue, the push, blasts, corpses on schedule, thin, a capture restored', () => {
    expect(GOLDEN, `goldens for ${PLATFORM}`).toBeDefined();
    const session = createSession('crowd-1000', { seed: REPLAY.seed });
    const w = session.world;
    const [killed, removed] = [new Map<number, number>(), new Map<number, number[]>()];
    w.events.on('killed', (e) => void killed.set((e as { body: number }).body, w.tick));
    w.events.on(
      'removed',
      (e) => void removed.set(w.tick, [...(removed.get(w.tick) ?? []), (e as { body: number }).body]),
    );
    const hashes: Record<number, string> = { 0: w.hash() };
    const entered: number[] = [];
    let [packed, settled, capture] = [0, true, null as ReturnType<Session['capture']> | null];
    for (let k = 0; k < 600; k++) {
      if (k === 210) capture = session.capture(); // corpses in the air, the crowd pushing
      const inWorld = () => agents(session).filter((a) => a.state !== 'queued').length;
      const before = k < 45 ? inWorld() : 0;
      stepAt(session, k);
      if (k < 45) entered.push(inWorld() - before);
      if (k + 1 === 180) packed = agents(session).filter((a) => fromCentre(a) < BLAST.reach).length;
      if (k + 1 === 180 + DUE - 2) {
        const corpses = agents(session).filter((a) => a.state === 'corpse');
        settled = corpses.length > 0 && corpses.every((a) => a.grounded && a.y < 0.01 && a.vx === 0 && a.vz === 0);
      }
      if ((k + 1) % 60 === 0) hashes[k + 1] = w.hash();
      expect(w.count).toBe(1000);
    }
    expect(hashes).toEqual(GOLDEN);
    expect(entered.slice(0, 40)).toEqual(Array(40).fill(25)); // the spawn queue: 25 a step
    expect(entered.slice(40)).toEqual([0, 0, 0, 0, 0]);
    expect(packed).toBeGreaterThan(200); // pushing toward the point: a quarter of the crowd within 5 m of it
    const blasts = [180, 420].map((at) => [...killed].filter(([, tick]) => tick === at + 1).map(([body]) => body));
    expect(blasts.map((bodies) => bodies.length)).toEqual([38, 65]);
    for (const [i, at] of [180, 420].entries()) {
      // killed in step at + 1 and removed 96 physics steps later: the steps at + 1 … at + 96
      expect(removed.get(at + DUE)).toEqual(blasts[i]);
    }
    expect(settled).toBe(true); // every corpse on the floor and still before it goes
    expect(removed.get(331)?.length).toBe(100); // thin: every tenth of the 1,000
    expect(census(session)).toEqual({ alive: 1000 });

    session.restore(capture!);
    expect(w.tick).toBe(210);
    for (let k = 210; k < 300; k++) stepAt(session, k);
    expect(w.hash()).toBe(GOLDEN[300]);
  });

  it('gives the same goldens without the in-place physics restore at step 200 (to step 300)', () => {
    const plain = { ...REPLAY, inputs: REPLAY.inputs.filter(([, change]) => change.dev !== 'roundtrip') };
    expect(REPLAY.inputs.some(([at, change]) => at === 200 && change.dev === 'roundtrip')).toBe(true);
    const upTo300 = Object.fromEntries(Object.entries(GOLDEN).filter(([k]) => +k <= 300));
    expect(playReplay(plain, { until: 300 }).hashes).toEqual(upTo300);
  });
});
