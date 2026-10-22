/**
 * @file Unit tests for the range (labs/playground/weapons/range.ts, guns.ts, hud.ts; PLAN.md WP 13.20): its nine
 * targets stand down its three lanes facing the bench, pop-ups at 10 and 25 m and movers at 50 m; the site's player
 * carries the pistol and the rifle holstered, draws the pistol with 1 and, down its sights, puts the 10 m target of
 * the middle lane down with one shot, the hit counted: the target falls back away from the bench and pops up again
 * 2.5 s later; a mover slides across its lane at 1 m/s and turns back at its end; the HUD's line names the weapon out,
 * its rounds, the hits and the accuracy, and the crosshair shows only while the screen's centre aims a weapon. Its
 * replay (tests/replays/playground-range.replay.json) plays the range's story in order: the pistol drawn, each lane's
 * 10 m pop-up put down down the sights, the middle lane's 25 m one and the mover behind it from the hip and a round
 * into the backstop; the rifle drawn, a burst at the north lane's 25 m pop-up, the outer movers each downed by a led
 * round; a reload; a burst down the middle through the pop-ups standing again and into the backstop; holstered, half
 * of its 20 rounds hits, and every target up again at its end.
 * @see labs/playground/weapons/range.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playReplay } from '../../../engine/sim/replay';
import { createSession, type Session } from '../../../engine/sim/session';
import type { WeaponsState } from '../../../engine/sim/weapons';
import '../bodies/player';
import { SITE_SCENES } from '../scenes/site';
import { PISTOL, PLAYGROUND_WEAPONS, RIFLE } from './guns';
import { showsCrosshair, weaponLine } from './hud';
import { FALL, MOVER, POPPER, RANGE_TARGETS, type Popup } from './range';

type Target = { id: number; popup: Popup; thing: { thing: string; state: string; x0: number; z0: number; hits: number }; sceneProp: { x: number; z: number } }; // prettier-ignore

/** The range's scene, stepped once, and its targets. */
function range() {
  const session = createSession(SITE_SCENES.range, { seed: 1 });
  session.step({});
  return { session, targets: () => session.world.query('popup') as unknown as Target[] };
}

/** The player's weapons. */
const weapons = (session: Session) => (session.world.get(1) as unknown as { weapons: WeaponsState }).weapons;

describe('the range', () => {
  it('stands its nine targets down its lanes, facing the bench: pop-ups at 10 and 25 m, movers at 50 m', () => {
    const { targets } = range();
    const stood = targets().map((t) => [t.thing.thing, t.thing.x0, t.thing.z0]);
    expect(stood).toEqual(RANGE_TARGETS.map(({ kind, at }) => [kind, at[0], at[2]]));
    expect(new Set(stood.map(([kind]) => kind))).toEqual(new Set([POPPER.id, MOVER.id]));
    for (const t of targets()) expect([t.popup.tilt, t.popup.yaw, t.thing.state]).toEqual([0, -Math.PI / 2, 'up']);
  }, 120_000);

  it('puts the 10 m target down with a shot down the sights, counts the hit, and pops it up 2.5 s later', () => {
    const { session, targets } = range();
    expect([weapons(session).slots, weapons(session).slot]).toEqual([[...PLAYGROUND_WEAPONS], -1]); // holstered
    session.step({ b: ['weapon1'] });
    const [eye, target] = [
      [4.2, 1.52, 6],
      [14, 1.3, 6],
    ] as const; // the bench's eye, lane 2's 10 m plate
    const look = [Math.atan2(target[0] - eye[0], target[2] - eye[2]), Math.atan2(target[1] - eye[1], target[0] - eye[0])]; // prettier-ignore
    const steady = { look, aim: [...target], b: ['aim'] };
    for (let k = 0; k < 30; k++) session.step(steady); // drawn, the sights up
    expect([weapons(session).slot, weapons(session).aim]).toEqual([0, 1]);
    session.step({ ...steady, b: ['aim', 'fire'] });
    const middle = targets().find((t) => t.thing.x0 === 14 && t.thing.z0 === 6)!;
    expect([middle.thing.state, middle.thing.hits, weapons(session).shots, weapons(session).hits]).toEqual(['down', 1, 1, 1]); // prettier-ignore
    for (let k = 0; k < 30; k++) session.step(steady);
    expect(middle.popup.tilt).toBe(FALL.down); // lying back
    expect(middle.sceneProp.x).toBeGreaterThan(14.3); // its middle away from the bench
    for (let k = 0; k < 150; k++) session.step(steady); // 2.5 s after the shot, and its rise
    expect([middle.thing.state, middle.popup.tilt]).toEqual(['up', 0]);
    expect(Math.abs(middle.sceneProp.x - 14)).toBeLessThan(1e-3); // upright on its base again
  }, 120_000);

  it('slides a mover 2 m across its lane at 1 m/s, turning back at its end', () => {
    const { session, targets } = range();
    const mover = targets().find((t) => t.thing.thing === MOVER.id && t.thing.z0 === 5)!;
    const z0 = mover.sceneProp.z;
    for (let k = 0; k < 60; k++) session.step({});
    expect(mover.sceneProp.z - z0).toBeCloseTo(1, 1);
    for (let k = 0; k < 90; k++) session.step({}); // to its end at 2 m, and half a metre back
    expect(mover.sceneProp.z - z0).toBeCloseTo(1.5, 1);
  }, 120_000);

  it("plays its replay's story in order: every kind of target down, the backstop struck, all up again", () => {
    const replay = JSON.parse(readFileSync(join(process.cwd(), 'tests/replays/playground-range.replay.json'), 'utf8'));
    const { session } = playReplay(replay);
    const { world } = session;
    const targets = world.query('popup') as unknown as Target[];
    const lanes = ['north', 'middle', 'south'];
    const named = (id: number) => {
      const t = targets.find((each) => each.id === id)!;
      return `${lanes[Math.round((t.thing.z0 - 3) / 3 + (t.thing.thing === MOVER.id ? 1 / 3 : 0))]} ${t.thing.x0 - 4} m`;
    };
    const story = world.events
      .trace()
      .filter((e) => ['draw', 'holster', 'reload', 'thingDown', 'gunshot'].includes(e.type))
      .flatMap((e) => {
        const p = e.payload as { weapon?: string; id: number; body?: number; target?: number };
        if (e.type === 'thingDown') return [`down: ${named(p.id)}`];
        if (e.type === 'gunshot') return p.target! < 0 && p.body! >= 0 ? ['the backstop'] : [];
        return [`${e.type} ${p.weapon === PISTOL.id ? 'pistol' : 'rifle'}`];
      });
    expect(story).toEqual([
      'draw pistol',
      'down: north 10 m', // down the sights
      'down: middle 10 m',
      'down: south 10 m',
      'down: middle 25 m', // from the hip
      'down: middle 50 m', // the mover behind it
      'the backstop',
      'draw rifle',
      'down: north 25 m', // the rest of the burst climbing high, past the backstop's end
      'down: north 50 m', // a led round at each outer mover
      'down: south 50 m',
      'reload rifle',
      'down: middle 10 m', // the last burst: the pop-up standing in its way
      'down: middle 25 m',
      'the backstop',
      'the backstop',
      'the backstop',
      'holster rifle',
    ]);
    expect([weapons(session).shots, weapons(session).hits]).toEqual([20, 10]); // half its rounds struck
    for (const t of targets) expect([t.thing.state, t.popup.tilt], named(t.id)).toEqual(['up', 0]);
  }, 120_000);

  it('shows the weapon out, its rounds, the hits and the accuracy, and the crosshair only while the centre aims one', () => {
    const base = { slots: [PISTOL.id, RIFLE.id], mags: [8, 18], reload: -1, shots: 4, hits: 3, aim: 0 };
    expect(weaponLine({ ...base, slot: 0 })).toBe('Pistol 8/10 · Hits 3 of 4 (75%)');
    expect(weaponLine({ ...base, slot: 1, reload: 2.4 })).toBe('Rifle reloading · Hits 3 of 4 (75%)');
    expect(weaponLine({ ...base, slot: -1, shots: 0, hits: 0 })).toBe('Holstered: 1 2 draw');
    expect([showsCrosshair({ ...base, slot: 0 }, true), showsCrosshair({ ...base, slot: 0, aim: 1 }, true)]).toEqual([true, false]); // prettier-ignore
    expect([showsCrosshair({ ...base, slot: -1 }, true), showsCrosshair({ ...base, slot: 0 }, false), showsCrosshair(undefined, true)]).toEqual([false, false, false]); // prettier-ignore
  });
});
