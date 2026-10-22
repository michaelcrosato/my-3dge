/**
 * @file Tests for projectile patterns (engine/world/patterns.ts): each pattern's volley (a fan across its spread, a
 * ring from its turn, a spiral turned on by each volley, random volleys drawn from the stream given and the same for
 * the same stream, aimed at a target's heading and rise); the emitter's timing (the delay, the interval, a burst's
 * pause, the clock held at the delay out of range, at most `MOST_VOLLEYS` a step); the shots `loose` makes; and the
 * Done-when's bound: no pattern's shot tunnels, every one of 60 m/s shots stopping on the thin post across its way.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { SHOT_EMITTER, headingTo, loose, MOST_VOLLEYS, stepVolleys, volley, type ShotEmitter } from './patterns';
import { stepProjectiles, type HurtCapsule, type HurtSet, type Projectile } from './projectiles';
import { SpatialHash } from './spatial';

/** An emitter with `fields` over the defaults. */
const emitter = (fields: Partial<ShotEmitter> = {}): ShotEmitter => ({ ...SHOT_EMITTER, ...fields });
/** A direction's heading in whole degrees. */
const degrees = ([x, , z]: readonly number[]) => Math.round((Math.atan2(x, z) * 180) / Math.PI);

describe('volleys', () => {
  it('fans forward and aimed volleys across their spread, rings from their turn and turns spirals on', () => {
    expect(volley(emitter({ count: 3, spread: Math.PI / 2 }), 0).map(degrees)).toEqual([-45, 0, 45]);
    expect(volley(emitter({ count: 1, spread: 1 }), Math.PI / 2).map(degrees)).toEqual([90]); // one shot: no fan
    expect(volley(emitter({ pattern: 'ring', count: 4 }), 0).map(degrees)).toEqual([0, 90, 180, -90]);
    expect(volley(emitter({ pattern: 'ring', count: 4, turn: Math.PI / 4 }), 0).map(degrees)).toEqual([45, 135, -135, -45]); // prettier-ignore
    const spiral = emitter({ pattern: 'spiral', count: 2, spin: Math.PI / 6 });
    const at = { x: 0, y: 1, z: 0 };
    const headings = [0, 1, 2].map(() => loose(spiral, at, 0).map((s) => degrees([s.vx, s.vy, s.vz])));
    expect(headings).toEqual([[0, 180], [30, -150], [60, -120]]); // prettier-ignore
    for (const d of volley(emitter({ count: 5, spread: 1, pitch: 0.3 }), 0)) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 12); // unit directions
      expect(d[1]).toBeCloseTo(Math.sin(0.3), 12); // rising at the pitch
    }
  });

  it('draws a random volley from the stream given, within its spread, the same for the same stream', () => {
    const random = emitter({ pattern: 'random', count: 6, spread: Math.PI / 3 });
    const a = volley(random, 0, { rng: new Rng(7) });
    expect(a).toEqual(volley(random, 0, { rng: new Rng(7) }));
    expect(a).not.toEqual(volley(random, 0, { rng: new Rng(8) }));
    for (const d of a) expect(Math.abs(degrees(d))).toBeLessThanOrEqual(30);
    const rng = new Rng(7);
    volley(random, 0, { rng });
    const twin = new Rng(7);
    for (let i = 0; i < 6; i++) twin.next();
    expect(rng.next()).toBe(twin.next()); // it drew exactly `count` numbers
    expect(() => volley(random, 0)).toThrow(/CORE_BAD_SPEC.*stream a random volley draws from/);
  });

  it('aims at a target’s heading and rise from where it stands, along its facing without one', () => {
    const from = { x: 0, y: 1, z: 0 };
    const target = { x: 3, y: 5, z: 4 }; // 5 m away across the ground, 4 m up
    const [d] = volley(emitter({ pattern: 'aimed' }), 0, { from, target });
    expect(d.map((v) => +v.toFixed(6))).toEqual([0.468521, 0.624695, 0.624695]); // toward (3, 4, 4)/√41
    expect(headingTo(from, target).map((v) => +v.toFixed(6))).toEqual([0.643501, 0.674741]);
    expect(volley(emitter({ pattern: 'aimed' }), Math.PI, { from, target: null }).map(degrees)).toEqual([180]);
    expect(() => volley(emitter({ pattern: 'spray' as never }), 0)).toThrow(/CORE_BAD_SPEC.*aimed, forward, ring/);
  });
});

describe('an emitter’s timing', () => {
  /** The steps (from 1) of each volley over `steps` steps of 1/60 s, in range throughout unless `out(step)`. */
  function times(e: ShotEmitter, steps: number, out: (step: number) => boolean = () => false): number[] {
    const at: number[] = [];
    for (let k = 1; k <= steps; k++) for (let n = stepVolleys(e, 1 / 60, !out(k)); n > 0; n--) at.push(k);
    return at;
  }

  it('waits its delay, then looses at once and every interval, resting a pause after each burst', () => {
    // volleys fall at the delay and whole intervals after it (0, 0.25, 0.5 s…), each on the step that reaches it
    expect(times(emitter({ interval: 0.25 }), 60)).toEqual([1, 15, 30, 45, 60]);
    expect(times(emitter({ delay: 0.5, interval: 0.25 }), 60)).toEqual([30, 45, 60]);
    expect(times(emitter({ interval: 0.1, burst: 3, pause: 0.5 }), 120)).toEqual([1, 6, 12, 48, 54, 60, 96, 102, 108]);
  });

  it('holds its clock at the delay while its target is out of range, and looses an interval after he is back', () => {
    const e = emitter({ delay: 0.25, interval: 0.5 });
    expect(times(e, 120, (k) => k > 20 && k <= 80)).toEqual([15, 110]); // back at 81: 0.25 s + 0.5 s later
    expect(e.clock).toBeLessThan(e.delay + e.interval);
  });

  it('keeps its rhythm whatever the step, and looses at most MOST_VOLLEYS in one', () => {
    const fine = times(emitter({ interval: 0.2 }), 120);
    const coarse: number[] = [];
    const e = emitter({ interval: 0.2 });
    for (let k = 1; k <= 30; k++) for (let n = stepVolleys(e, 4 / 60, true); n > 0; n--) coarse.push(k * 4);
    expect(coarse.length).toBe(fine.length); // 10 volleys in 2 s at either step
    expect(stepVolleys(emitter({ interval: 0.001 }), 1, true)).toBe(MOST_VOLLEYS);
    expect(() => stepVolleys(emitter(), -1, true)).toThrow(/CORE_BAD_SPEC.*0 seconds or more/);
  });
});

describe('shots', () => {
  it('looses its volley’s shots out of the muzzle at its speed, with its numbers and its source', () => {
    const e = emitter({ pattern: 'ring', count: 4, speed: 30, muzzle: 0.5, radius: 0.1, life: 2, gravity: 9.81, pierce: 1, kind: 'bolt', team: 'turret' }); // prettier-ignore
    const shots = loose(e, { x: 1, y: 2, z: 3 }, 0, { source: 9 });
    expect(shots.length).toBe(4);
    expect([shots[0].x, shots[0].y, shots[0].z, shots[0].vz]).toEqual([1, 2, 3.5, 30]);
    expect(shots.every((s) => s.kind === 'bolt' && s.team === 'turret' && s.source === 9 && s.state === 'flying')).toBe(true); // prettier-ignore
    expect([shots[1].radius, shots[1].life, shots[1].gravity, shots[1].pierce, shots[1].age]).toEqual([0.1, 2, 9.81, 1, 0]); // prettier-ignore
    shots[0].hit.push(4);
    expect(shots[1].hit).toEqual([]); // each its own
  });

  it('never tunnels: every shot of every pattern stops on the thin post across its way, at 60 m/s', () => {
    const rng = new Rng(3);
    const from = { x: 0, y: 1, z: 0 };
    const target = { x: 7, y: 1, z: 7 };
    const patterns = [
      emitter({ pattern: 'aimed', count: 7, spread: 1.2 }),
      emitter({ pattern: 'forward', count: 5, spread: 2 }),
      emitter({ pattern: 'ring', count: 24 }),
      emitter({ pattern: 'spiral', count: 12, spin: 0.37 }),
      emitter({ pattern: 'random', count: 16, spread: 2 * Math.PI }),
    ];
    for (const e of patterns) {
      for (let volleyNo = 0; volleyNo < 3; volleyNo++) {
        const shots: Projectile[] = loose({ ...e, speed: 60, radius: 0.04 }, from, 0.4, { target, rng });
        // a 4 cm post 5.5 m out across each shot's way, the move 1 m a step: the post sits inside one step's move
        const posts: HurtCapsule[] = shots.map((s) => ({ x: (s.vx / 60) * 5.5, y: 0, z: (s.vz / 60) * 5.5, radius: 0.04, height: 1.92 })); // prettier-ignore
        const hash = new SpatialHash({ cell: 2 });
        posts.forEach((p, i) => hash.add(i + 1, p.x, p.z));
        const targets: HurtSet = { hash, hurt: (id) => posts[id - 1], margin: 0.1 };
        for (let step = 0; step < 12; step++) stepProjectiles(shots, { dt: 1 / 60, targets });
        for (const s of shots) {
          expect([s.state, s.hit.length]).toEqual(['hit', 1]); // a post stopped it (a random one's neighbour may)
          expect(Math.hypot(s.x - from.x, s.z - from.z)).toBeLessThan(5.5); // at it, never past
        }
      }
    }
  });
});
