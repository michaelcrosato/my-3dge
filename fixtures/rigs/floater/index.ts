/**
 * @file A floater (PLAN.md WP 10.1; fixtures/rigs/README.md): a ghost of the procedural blocks alone (engine/sim-api.ts).
 * It hovers over its floor, bobbing, banks into a sideways drift, leans back into a glide and folds its limbs in
 * (`Hover`); three motes orbit it, spinning up at a spin and out at a flare (`Orbiters`); its hands float free at its
 * sides with no arms, trailing as it moves (`DetachedPart`); it turns on a spring (`SpringQuat`) to a heading it is
 * given; its eyes blink (`Blink`, its own stream). `FLOATER` is its rig (engine/anim/proc/rig.ts): rest, drift (to its
 * right), glide (ahead), fold, spin and turn.
 *
 * Invariants: metres, seconds, +Y up, facing +Z; a fixed step; its blink from `Rng(seed)`, nothing else random.
 *
 * @example
 * import { Vector3 } from '../../../engine/sim-api';
 * const ghost = new FloaterRig();
 * for (let i = 0; i < 60; i++) ghost.step({ velocity: new Vector3(-2, 0, 0) });
 * ghost.hover.bank > 0.1; // true: banked into its drift
 * @see fixtures/rigs/floater/index.test.ts
 */
import { Blink, DetachedPart, Hover, Orbiters, Quaternion, Rng, SpringQuat, Vector3, type ProcRig } from '../../../engine/sim-api'; // prettier-ignore

const UP = new Vector3(0, 1, 0);

/** What it is told each step: how it moves, how far it folds, how fast its motes spin, and where it turns to. */
export interface FloaterInput {
  readonly velocity?: Vector3;
  readonly fold?: number;
  readonly spin?: number;
  readonly flare?: number;
  readonly yaw?: number;
}

/** The floater (see the file comment). */
export class FloaterRig {
  readonly root = new Vector3();
  readonly hover = new Hover({ height: 0.9, bob: 0.05, pivot: 0.5, frequency: 12 });
  readonly motes = new Orbiters({ count: 3, radius: 0.45, rate: 0.9, bob: 0.08 });
  readonly hands = [new DetachedPart({ frequency: 14, damping: 0.8, sway: 0.03 }), new DetachedPart({ frequency: 14, damping: 0.8, sway: 0.03, swayRate: 1.9 })]; // prettier-ignore
  readonly heading: SpringQuat;
  readonly blink: Blink;
  readonly dt: number;
  readonly #facing: number;
  #points: Vector3[] = [];

  /** A floater over the origin facing `yaw`, stepped every `dt` s, blinking from stream `seed`. */
  constructor(options: { yaw?: number; dt?: number; seed?: number } = {}) {
    [this.#facing, this.dt] = [options.yaw ?? 0, options.dt ?? 1 / 60];
    const turn = new Quaternion().setFromAxisAngle(UP, this.#facing);
    this.heading = new SpringQuat({ frequency: 12, value: turn, target: turn });
    this.blink = new Blink(new Rng(options.seed ?? 2), { every: [2, 4] });
  }

  /** One step of what `input` tells it. */
  step(input: FloaterInput = {}): this {
    const dt = this.dt;
    const velocity = input.velocity ?? new Vector3();
    this.root.addScaledVector(velocity, dt);
    const turn = this.heading.step(dt, new Quaternion().setFromAxisAngle(UP, input.yaw ?? this.#facing));
    const ahead = new Vector3(0, 0, 1).applyQuaternion(turn);
    const yaw = Math.atan2(ahead.x, ahead.z);
    this.hover.step(dt, velocity, yaw, input.fold ?? 0);
    const place = (x: number, y: number, z: number) => this.hover.place(new Vector3(x, y, z), this.root, yaw);
    const [core, top] = [place(0, 0, 0), place(0, 0.35, 0)];
    const eyes = [place(0.07, 0.18, 0.12), place(-0.07, 0.18, 0.12)];
    const hands = [0.28, -0.28].map((x, i) => this.hands[i].step(dt, place(x, -0.05, 0.1)).clone());
    const frame = this.hover.frame(yaw);
    const motes = this.motes.step(dt, core, frame, input.spin ?? 0.9, 0.45 + 0.25 * (input.flare ?? 0)).map((p) => p.clone()); // prettier-ignore
    this.blink.step(dt);
    this.#points = [this.root.clone(), core, top, ...eyes, ...hands, ...motes];
    return this;
  }

  /** Its points, in `FLOATER.names`' order (after a step). */
  points(): Vector3[] {
    return this.#points;
  }
}

/** The floater's rig: its points and its states. */
export const FLOATER: ProcRig = {
  id: 'rig:floater',
  names: ['root', 'core', 'top', 'eyeL', 'eyeR', 'handL', 'handR', 'mote0', 'mote1', 'mote2'],
  bones: [], // its fold draws every part in toward its core: no two points keep their distance
  closed: 7,
  states: { rest: 1, drift: 1.5, glide: 1.5, fold: 1, spin: 1, turn: 1.5 },
  make(state, facing, dt) {
    const ghost = new FloaterRig({ yaw: facing, dt });
    const [ahead, right] = [new Vector3(Math.sin(facing), 0, Math.cos(facing)), new Vector3(-Math.cos(facing), 0, Math.sin(facing))]; // prettier-ignore
    return {
      step(time) {
        const on = time !== undefined;
        const velocity = on && state === 'drift' ? right.clone().multiplyScalar(2) : on && state === 'glide' ? ahead.clone().multiplyScalar(4) : new Vector3(); // prettier-ignore
        const spinning = on && state === 'spin';
        return ghost.step({ velocity, fold: on && state === 'fold' ? 1 : 0, spin: spinning ? 9 : 0.9, flare: spinning ? 1 : 0, yaw: on && state === 'turn' ? facing + 1 : facing }).root; // prettier-ignore
      },
      points: () => ghost.points(),
    };
  },
};
