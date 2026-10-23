/**
 * @file A digitigrade biped (PLAN.md WP 10.1; fixtures/rigs/README.md): a small raptor made of the procedural blocks
 * alone (engine/sim-api.ts). Two legs on the planted gait (`LegGait`, a leg a group) stand on their toes
 * (`digitigrade`, the long foot leaning back more as it crouches); its weights ease (`StateWeights`: run, low); its
 * body bobs on a spring a footfall kicks (`Spring1`); its tail is a wave down five links (`SwayChain`), wider and
 * faster at a run; its head looks where it is told within bounds and blinks (`LookAt`, `Blink`, its own stream); its
 * small arms are a pose stack (`layerPose`: at rest, tucked at a run, reaching low) turned into directions
 * (`aimDirection`). `BIPED` is its rig (engine/anim/proc/rig.ts): rest, walk, run, crouch and look.
 *
 * Invariants: metres, seconds, +Y up, facing +Z; a fixed step; its blink from `Rng(seed)`, nothing else random.
 *
 * @example
 * import { Vector3 } from '../../../engine/sim-api';
 * const raptor = new Biped();
 * for (let i = 0; i < 60; i++) raptor.step({ velocity: new Vector3(0, 0, 1.2) });
 * raptor.points().length === BIPED.names.length; // true
 * @see fixtures/rigs/biped/index.test.ts
 */
import { aimDirection, Blink, digitigrade, layerPose, LegGait, LookAt, Quaternion, Rng, Spring1, StateWeights, SwayChain, Vector3, type ProcRig } from '../../../engine/sim-api'; // prettier-ignore

/** Its sizes, m: the hips' height, the legs' bones, the tail's links and the arm. */
export const BIPED_SIZE = { hips: 0.62, leg: { thigh: 0.28, shin: 0.32, foot: 0.2 }, link: 0.1, arm: 0.12 } as const;

const UP = new Vector3(0, 1, 0);
const at = (base: Vector3, turn: Quaternion, x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(turn).add(base); // prettier-ignore

/** What it is told each step: how it moves, how low it gets (0 to 1) and what it looks at. */
export interface BipedInput {
  readonly velocity?: Vector3;
  readonly low?: number;
  readonly look?: Vector3 | null;
}

/** The biped (see the file comment). */
export class Biped {
  readonly root = new Vector3();
  readonly turn = new Quaternion();
  readonly dt: number;
  readonly weights = new StateWeights({ run: 5, low: [6, 4] });
  readonly gait = new LegGait({ legs: [{ hip: [0.09, BIPED_SIZE.hips, 0], rest: [0.1, 0, 0.03], group: 0 }, { hip: [-0.09, BIPED_SIZE.hips, 0], rest: [-0.1, 0, 0.03], group: 1 }] }); // prettier-ignore
  readonly bob = new Spring1({ frequency: 12, damping: 0.5, limit: 0.05 });
  readonly tail = new SwayChain({ count: 5, length: BIPED_SIZE.link, amplitude: 0.35, frequency: 5, lag: 0.7, droop: 0.06 }); // prettier-ignore
  readonly look = new LookAt({ rate: 8, yaw: 1.2, pitch: 0.6 });
  readonly blink: Blink;
  #points: Vector3[] = [];
  #yaw: number;

  /** A biped at the origin facing `yaw`, stepped every `dt` s, blinking from stream `seed`. */
  constructor(options: { yaw?: number; dt?: number; seed?: number } = {}) {
    [this.#yaw, this.dt] = [options.yaw ?? 0, options.dt ?? 1 / 60];
    this.turn.setFromAxisAngle(UP, this.#yaw);
    this.blink = new Blink(new Rng(options.seed ?? 1));
  }

  /** One step of what `input` tells it. */
  step(input: BipedInput = {}): this {
    const dt = this.dt;
    const velocity = input.velocity ?? new Vector3();
    this.root.addScaledVector(velocity, dt);
    const speed = Math.hypot(velocity.x, velocity.z);
    this.weights.aim({ run: Math.min(1, speed / 3), low: input.low ?? 0 }).step(dt);
    const [run, low] = [this.weights.get('run'), this.weights.get('low')];
    const landing = this.gait.feet.map((foot) => foot.t >= 0);
    this.gait.step(dt, { position: this.root, yaw: this.#yaw, velocity });
    if (this.gait.feet.some((foot, i) => landing[i] && foot.t < 0)) this.bob.kick(-0.3); // a footfall
    const pelvis = at(this.root, this.turn, 0, BIPED_SIZE.hips * (1 - 0.25 * low) + this.bob.step(dt), 0);
    const chest = at(pelvis, this.turn, 0, 0.12, 0.12);
    const head = at(chest, this.turn, 0, 0.1, 0.16);
    const eye = head.clone().addScaledVector(this.look.step(dt, head, input.look ?? null, this.turn), 0.06);
    this.blink.step(dt);
    const legs = [1, -1].flatMap((side, i) => {
      const hip = at(pelvis, this.turn, 0.09 * side, 0, 0);
      const solve = digitigrade(hip, this.gait.feet[i].position, BIPED_SIZE.leg, { forward: at(new Vector3(), this.turn, 0, 0, 1) }, 0.58 + 0.38 * low); // prettier-ignore
      return [hip, solve.knee.clone(), solve.hock.clone(), solve.toe.clone()];
    });
    const tail = this.tail.step(dt, at(pelvis, this.turn, 0, 0, -0.08), this.turn, 1 + run, 1 + speed).map((p) => p.clone()); // prettier-ignore
    const [pitch, yaw] = layerPose([-0.6, 0.2], [{ values: [0.3, 0.1], weight: run }, { values: [-1.1, 0.4], weight: low }]); // prettier-ignore
    const arms = [1, -1].flatMap((side) => {
      const shoulder = at(chest, this.turn, 0.07 * side, -0.02, 0);
      return [shoulder, shoulder.clone().addScaledVector(aimDirection(pitch, yaw * side).applyQuaternion(this.turn), BIPED_SIZE.arm)]; // prettier-ignore
    });
    this.#points = [this.root.clone(), pelvis, chest, head, eye, ...legs, ...tail, ...arms];
    return this;
  }

  /** Its points, in `BIPED.names`' order (after a step). */
  points(): Vector3[] {
    return this.#points;
  }
}

const NAMES = ['root', 'pelvis', 'chest', 'head', 'eye', ...['L', 'R'].flatMap((s) => ['hip', 'knee', 'hock', 'toe'].map((j) => j + s)), ...[0, 1, 2, 3, 4, 5].map((i) => `tail${i}`), 'shoulderL', 'handL', 'shoulderR', 'handR']; // prettier-ignore

/** The biped's rig: its points, its bones, its toes as its feet, and its states. */
export const BIPED: ProcRig = {
  id: 'rig:biped',
  names: NAMES,
  bones: [['pelvis', 'chest'], ['chest', 'head'], ['head', 'eye'], ...['L', 'R'].flatMap((s) => [[`hip${s}`, `knee${s}`], [`knee${s}`, `hock${s}`], [`hock${s}`, `toe${s}`]] as [string, string][]), ...[0, 1, 2, 3, 4].map((i) => [`tail${i}`, `tail${i + 1}`] as [string, string]), ['shoulderL', 'handL'], ['shoulderR', 'handR']], // prettier-ignore
  feet: ['toeL', 'toeR'],
  closed: NAMES.indexOf('tail0'),
  states: { rest: 1, walk: 2, run: 2, crouch: 1, look: 1 },
  make(state, facing, dt) {
    const raptor = new Biped({ yaw: facing, dt });
    const ahead = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    return {
      step(time) {
        const on = time !== undefined;
        const speed = on && state === 'walk' ? 1.2 : on && state === 'run' ? 3 : 0;
        const look = on && state === 'look' ? at(raptor.root, raptor.turn, 1, 0.8, 1) : null;
        return raptor.step({ velocity: ahead.clone().multiplyScalar(speed), low: on && state === 'crouch' ? 1 : 0, look }).root; // prettier-ignore
      },
      points: () => raptor.points(),
    };
  },
};
