/**
 * @file Tests for the character controller (engine/physics/character.ts) on the steps fixture's course
 * (fixtures/scenes/steps): WP 3.2's Done-when numbers (the feel meter's are in feel.test.ts): every tick keeps ≥ 95%
 * of its move across a one-box floor and a floor of merged boxes, it climbs steps up to its configured height and no
 * higher, walks up slopes to 50°, peaks at v²/2g, dashes speed × duration and waits for its cooldown, pushes a 20 kg
 * crate off with shared momentum, keeps coyote time and the jump buffer to the tick, and never flickers out of grounded
 * walking on the flat. Then the rest of its wiring: moving floors, one-way platforms, the wall jump, the variable jump,
 * idling, `rapierOf` after a restore, and bad arguments.
 */
import { describe, expect, it } from 'vitest';
import { buildCourse, HERO, SLOPE_ANGLES, STEP_HEIGHTS, type Course } from '../../fixtures/scenes/steps';
import {
  addCharacter,
  createCharacter,
  createCharacterState,
  feetOf,
  moveCharacter,
  stepCharacter,
  type Character,
  type CharacterInput,
  type CharacterStep,
} from './character';
import { createPhysics, rapierOf } from './world';

const DT = 1 / 60;
/** The sim stand-in `step` reads: the world's gravity. */
const SETTINGS = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };

/** One tick's record: what the step did, and where the feet are after the world stepped. */
type Tick = CharacterStep & { x: number; y: number; z: number; grounded: boolean; vx: number; vz: number };

/** A character on the course at `at`, settled; `tick` steps it and the world once. */
function rig(character: Character, at: readonly [number, number, number], oneWay?: ReadonlySet<number>) {
  const physics = createPhysics();
  const course = buildCourse(physics);
  physics.step({ dt: DT, settings: SETTINGS });
  const body = addCharacter(physics, character, at);
  const state = createCharacterState();
  const log: Tick[] = [];
  const tick = (input: CharacterInput = {}): Tick => {
    const step = stepCharacter(physics, body, character, state, input, { dt: DT, gravity: 32, oneWay });
    physics.step({ dt: DT, settings: SETTINGS });
    const { x, y, z } = feetOf(physics, body, character);
    const record = { ...step, x, y, z, grounded: state.grounded, vx: state.vx, vz: state.vz };
    log.push(record);
    return record;
  };
  const run = (ticks: number, input: CharacterInput = {}) => Array.from({ length: ticks }, () => tick(input));
  run(10);
  return { physics, course, body, state, tick, run, log };
}

/** The share of the move across it asked for that a tick made. */
const share = (t: CharacterStep) => Math.hypot(t.moved.x, t.moved.z) / Math.hypot(t.desired.x, t.desired.z);

describe('walking across level ground', () => {
  it('keeps at least 95% of every tick’s move on a one-box floor and on merged boxes, and stays grounded', () => {
    for (const lane of ['oneBox', 'merged'] as const) {
      for (const [x0, dir] of [
        [2, 1],
        [78, -1],
      ] as const) {
        const c = rig(createCharacter(), [x0, 0, lane === 'oneBox' ? 2 : 6]);
        const walk = c.run(600, { move: [dir, 0] });
        const turn = [...c.run(30, { move: [-dir, 0] }), ...c.run(30), ...c.run(30, { move: [dir, 0.3] })];
        expect(Math.abs(walk.at(-1)!.x - x0), `${lane} ${dir}`).toBeGreaterThan(59);
        expect(Math.min(...walk.filter((t) => t.desired.length() > 1e-3).map(share)), `${lane} ${dir}`).toBeGreaterThan(
          0.95,
        );
        expect([...walk, ...turn].every((t) => t.grounded && Math.abs(t.y) < 1e-3)).toBe(true);
      }
    }
  });

  it('keeps at least 95% under the usual downward pushes, 1 mm to 2 cm a tick, moved directly', () => {
    for (const push of [0.001, 0.0044, 0.01, 0.02]) {
      for (const z of [2, 6]) {
        const c = rig(createCharacter(), [2, 0, z]);
        let worst = 1;
        for (let i = 0; i < 400; i++) {
          const { moved, grounded } = moveCharacter(c.physics, c.body, createCharacter(), [0.1, -push, 0], {
            grounded: true,
          });
          worst = Math.min(worst, Math.hypot(moved.x, moved.z) / 0.1);
          expect(grounded).toBe(true);
          c.physics.setBody(c.body, { velocity: [moved.x / DT, moved.y / DT, moved.z / DT] });
          c.physics.step({ dt: DT, settings: SETTINGS });
        }
        expect(worst, `push ${push} at z ${z}`).toBeGreaterThan(0.95);
      }
    }
  });
});

/** Walks a lane east for `ticks`: the highest the feet got past `x`, and how far east it got. */
function walkLane(character: Character, lane: (course: Course) => { x0: number; z: number }, ticks: number, x = 6.5) {
  const physics = createPhysics();
  const at = lane(buildCourse(physics));
  physics.dispose();
  const c = rig(character, [at.x0, 0, at.z]);
  const walk = c.run(ticks, { move: [1, 0] });
  return { top: Math.max(0, ...walk.filter((t) => t.x > x).map((t) => t.y)), east: Math.max(...walk.map((t) => t.x)) };
}

describe('steps', () => {
  it('climbs every step up to its autostep height and refuses every higher one: the setting is the measured height', () => {
    for (const height of [0.3, 0.25]) {
      const character = createCharacter({ autostep: { height } });
      STEP_HEIGHTS.forEach((step, i) => {
        const { top, east } = walkLane(character, (course) => course.steps[i], 120);
        const climbs = step <= height + 1e-9;
        expect(climbs ? top : east, `${step} m against ${height} m`).toBeGreaterThan(climbs ? step - 0.01 : 0);
        if (!climbs) expect(east, `${step} m against ${height} m`).toBeLessThan(5.8);
      });
    }
  });

  it('climbs 5 cm under its height and refuses 5 cm over it, for the box hero too', () => {
    for (const character of [createCharacter(), HERO]) {
      const height = character.autostep.height;
      const below = STEP_HEIGHTS.findIndex((h) => Math.abs(h - (height - 0.05)) < 1e-9);
      const above = STEP_HEIGHTS.findIndex((h) => Math.abs(h - (height + 0.05)) < 1e-9);
      expect(walkLane(character, (course) => course.steps[below], 120).top).toBeGreaterThan(height - 0.06);
      expect(walkLane(character, (course) => course.steps[above], 120).east).toBeLessThan(5.8);
    }
  });
});

describe('slopes', () => {
  it('walks up slopes to 50° and not steeper', () => {
    SLOPE_ANGLES.forEach((degrees, j) => {
      const rise = 2 * Math.tan((degrees * Math.PI) / 180);
      const { top, east } = walkLane(createCharacter(), (course) => course.slopes[j], 240, 8.2);
      if (degrees <= 50) expect(top, `${degrees}°`).toBeGreaterThan(rise - 0.02);
      else expect(east, `${degrees}°`).toBeLessThan(6.5);
    });
  });
});

describe('jumping', () => {
  it('peaks at jumpSpeed²/2g within 2 cm, for the configured jump speed and characterGravity', () => {
    const cases: [Character, number][] = [
      [createCharacter(), 32],
      [HERO, 30],
      [createCharacter({ jumpSpeed: 5, characterGravity: 9.81 }), 9.81],
      [createCharacter({ jumpSpeed: 12, characterGravity: 50 }), 50],
    ];
    for (const [character, g] of cases) {
      const c = rig(character, [40, 0, 30]);
      const start = c.log.at(-1)!.y;
      const air = [c.tick({ jump: true, jumpPressed: true }), ...c.run(5, { jump: true })];
      while (!c.log.at(-1)!.grounded) air.push(c.tick({ jump: true }));
      const apex = Math.max(...air.map((t) => t.y)) - start;
      expect(air[0].jumped).toBe(true);
      expect(Math.abs(apex - character.jumpSpeed ** 2 / (2 * g)), `${character.jumpSpeed} m/s at ${g}`).toBeLessThan(
        0.02,
      );
    }
  });

  it('rises less when jump is let go early (variableJump), and not at all with variableJump 1', () => {
    const apex = (character: Character, held: number) => {
      const c = rig(character, [40, 0, 30]);
      c.tick({ jump: true, jumpPressed: true });
      c.run(held, { jump: true });
      c.run(60);
      return Math.max(...c.log.map((t) => t.y));
    };
    expect(apex(createCharacter(), 2)).toBeLessThan(apex(createCharacter(), 60) * 0.5);
    const full = createCharacter({ feel: { variableJump: 1 } });
    expect(apex(full, 2)).toBeCloseTo(apex(full, 60), 6);
  });

  it('still jumps up to coyote ticks after walking off a ledge, and not one tick later', () => {
    const coyote = Math.round(createCharacter().feel.coyote / DT);
    expect(coyote).toBe(6);
    const off = () => {
      const c = rig(createCharacter(), [3, 1.5, 66]);
      while (c.tick({ move: [1, 0] }).grounded);
      return c;
    };
    for (let after = 1; after <= coyote + 1; after++) {
      const c = off();
      c.run(after - 1, { move: [1, 0] });
      const press = c.tick({ move: [1, 0], jump: true, jumpPressed: true });
      expect(press.jumped, `${after} ticks after`).toBe(after <= coyote);
    }
  });

  it('jumps on landing for a press up to buffer ticks before it, and not one tick earlier', () => {
    const buffer = Math.round(createCharacter().feel.buffer / DT);
    expect(buffer).toBe(7);
    const drop = () => rig(createCharacter(), [40, 2, 30]);
    const probe = drop();
    while (!probe.tick().grounded);
    const landing = probe.log.length; // the tick (1-based) that ends on the ground: the next one starts there
    for (let before = 0; before <= buffer + 1; before++) {
      const c = drop();
      const press = landing + 1 - before;
      let jumped = false;
      while (c.log.length < landing + 1) {
        const t = c.tick({ jump: c.log.length + 1 >= press, jumpPressed: c.log.length + 1 === press });
        if (c.log.length === landing + 1) jumped = t.jumped;
      }
      expect(jumped, `pressed ${before} ticks before the first tick on the ground`).toBe(before <= buffer);
    }
  });
});

describe('the dash', () => {
  it('covers its speed × duration within 2 cm', () => {
    const cases = [createCharacter(), HERO, createCharacter({ feel: { dash: { speed: 10, duration: 0.25 } } })];
    for (const character of cases) {
      const c = rig(character, [40, 0, 30]);
      const from = c.log.at(-1)!;
      const first = c.tick({ dashPressed: true });
      while (c.state.dash > 0) c.tick();
      const to = c.log.at(-1)!;
      const { speed, duration } = character.feel.dash;
      expect(first.dashed).toBe(true);
      expect(Math.abs(Math.hypot(to.x - from.x, to.z - from.z) - speed * duration)).toBeLessThan(0.02);
    }
  });

  it('waits for its cooldown, counted from the dash’s start', () => {
    const cooldown = Math.round(createCharacter().feel.dash.cooldown / DT);
    for (const [after, dashes] of [
      [cooldown - 1, false],
      [cooldown, true],
    ] as const) {
      const c = rig(createCharacter(), [40, 0, 30]);
      c.tick({ dashPressed: true });
      c.run(after - 1);
      expect(c.tick({ dashPressed: true }).dashed, `${after} ticks after`).toBe(dashes);
    }
  });
});

describe('pushing', () => {
  it('pushes a 20 kg crate, which moves off with the momentum they share and slides along', () => {
    const c = rig(createCharacter(), [2, 0, 76]);
    const crate = () => c.physics.readBody(c.course.crate.body);
    expect(crate().mass).toBeCloseTo(20, 4);
    let contact = c.tick({ move: [1, 0] });
    while (crate().velocity.x < 0.5) contact = c.tick({ move: [1, 0] });
    const shared = (70 * 6) / (70 + 20);
    expect(contact.vx).toBeCloseTo(shared, 6);
    expect(Math.abs(crate().velocity.x - shared)).toBeLessThan(0.2);
    const x0 = crate().position.x;
    c.run(60, { move: [1, 0] });
    expect(crate().position.x - x0).toBeGreaterThan(4);
    expect(crate().position.y).toBeCloseTo(0.3, 2); // pushed level with its centre: it slides, never tips
    expect(crate().position.x - c.log.at(-1)!.x).toBeLessThan(0.3 + 0.28125 + 0.02 + 0.15);
  });
});

describe('the rest of the wiring', () => {
  it('rides a moving floor', () => {
    const c = rig(createCharacter(), [4, 0.4, 82]);
    const from = c.log.at(-1)!;
    const ride = c.run(60);
    expect(ride.at(-1)!.x - from.x).toBeCloseTo(2, 1);
    expect(ride.every((t) => t.grounded && Math.abs(t.y - 0.4) < 0.01)).toBe(true);
  });

  it('jumps up through a one-way platform and stands on it; a solid one bumps its head', () => {
    const jump = (oneWay: boolean, character = createCharacter(), at: [number, number, number] = [8, 0, 71]) => {
      const physics = createPhysics();
      const platform = buildCourse(physics).oneWay.body;
      physics.dispose();
      const c = rig(character, at, oneWay ? new Set([platform]) : undefined);
      c.tick({ jump: true, jumpPressed: true });
      c.run(90, { jump: true });
      return { top: Math.max(...c.log.map((t) => t.y)), end: c.log.at(-1)! };
    };
    expect(jump(true).top).toBeGreaterThan(1.3);
    expect(jump(false).top).toBeLessThan(0.15);
    const high = jump(true, createCharacter({ jumpSpeed: 12 }));
    expect(high.end.grounded).toBe(true);
    expect(high.end.y).toBeCloseTo(2, 2);
    expect(jump(true, createCharacter(), [8, 2.5, 71]).end.y).toBeCloseTo(2, 2);
  });

  it('kicks off a wall with wallJump, and not without it', () => {
    const kick = (wallJump: boolean) => {
      const c = rig(createCharacter({ feel: { wallJump } }), [6, 0, 88]);
      c.run(20, { move: [1, 0] });
      c.tick({ move: [1, 0], jump: true, jumpPressed: true });
      c.run(8, { move: [1, 0], jump: true });
      c.tick({ move: [1, 0] });
      return c.tick({ move: [1, 0], jump: true, jumpPressed: true });
    };
    const kicked = kick(true);
    expect(kicked.jumped).toBe(true);
    expect(kicked.vx).toBeLessThan(-6);
    expect(kick(false).jumped).toBe(false);
  });

  it('skips the controller standing idle on fixed ground, and wakes for any move', () => {
    const c = rig(createCharacter(), [40, 0, 30]);
    expect(c.log.at(-1)!.moving).toBe(false);
    expect(c.tick({ move: [0, 1] }).moving).toBe(true);
  });

  it('follows a restored physics world: rapierOf gives the new Rapier world, and the character moves on', () => {
    const c = rig(createCharacter(), [40, 0, 30]);
    const before = rapierOf(c.physics);
    c.physics.restore(c.physics.capture());
    expect(rapierOf(c.physics)).not.toBe(before);
    const walk = c.run(30, { move: [1, 0] });
    expect(walk.at(-1)!.x).toBeGreaterThan(41.5);
    expect(() => rapierOf({} as never)).toThrow(/PHYSICS_NONE/);
  });

  it('names bad arguments', () => {
    const c = rig(createCharacter(), [40, 0, 30]);
    const step = (input: CharacterInput, dt = DT, body = c.body) =>
      stepCharacter(c.physics, body, createCharacter(), c.state, input, { dt, gravity: 32 });
    expect(() => step({}, 0)).toThrow(/PHYSICS_BAD_ARGUMENT.*dt/);
    expect(() => step({ move: [Number.NaN, 0] })).toThrow(/PHYSICS_BAD_ARGUMENT.*move/);
    expect(() => step({}, DT, 0)).toThrow(/PHYSICS_BAD_ARGUMENT.*character’s body/);
    expect(() => createCharacter({ sped: 5 })).toThrow(/CORE_BAD_SPEC.*did you mean "speed"/);
    expect(() => createCharacter({ autostep: { height: -1 } })).toThrow(/CORE_BAD_SPEC.*autostep.height/);
    expect(createCharacter().feel.dash).toEqual({ speed: 16.25, duration: 0.2, cooldown: 0.45 });
    expect(Object.isFrozen(createCharacter().capsule)).toBe(true);
    expect(feetOf(c.physics, c.body, createCharacter()).y).toBeCloseTo(0, 3);
  });
});
