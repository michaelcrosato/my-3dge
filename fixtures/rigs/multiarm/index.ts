/**
 * @file A multi-arm (PLAN.md WP 10.1; fixtures/rigs/README.md): a four-armed swordsman of the procedural blocks alone
 * (engine/sim-api.ts). Its upper arms reach for hand targets from a pose stack (`layerPose`: ready, a guard over it,
 * the swing's wind and strike over both) by weights eased up and down (`StateWeights`), each arm by two-bone IK
 * (`twoBone`); its lower arms replay what the upper ones did a moment later (`PoseHistory`, 0.07 and 0.15 s late); a
 * blade sits in every hand on a socket (`placeExtras`, by name); the swinging blade's tip leaves a trail (`TipTrail`);
 * and how far its swing reaches is measured off its own animation (`measureReach`: `swingReach`). `MULTIARM` is its rig
 * (engine/anim/proc/rig.ts): rest, guard and swing.
 *
 * Invariants: metres, seconds, +Y up, facing +Z; a fixed step; nothing random.
 *
 * @example
 * swingReach().reach > 1; // true: the right upper blade's tip, ahead of its feet at the strike
 * @see fixtures/rigs/multiarm/index.test.ts
 */
import { ease, layerPose, Matrix4, measureReach, placeExtras, PoseHistory, Quaternion, StateWeights, TipTrail, twoBone, Vector3, type ProcRig } from '../../../engine/sim-api'; // prettier-ignore

/** Its sizes, m: its hips' height, its arms' bones, its blades. */
export const MULTIARM_SIZE = { hips: 1, upper: 0.3, lower: 0.28, blade: 0.6 } as const;

/** Where the hands reach, in the chest's frame (x left, y up, z forward; the right hand's x, mirrored for the left). */
const HANDS = { ready: [-0.25, -0.25, 0.35], guard: [-0.15, 0.1, 0.3], wind: [-0.45, 0.25, -0.1], strike: [0.15, -0.05, 0.6] } as const; // prettier-ignore
const UP = new Vector3(0, 1, 0);
const ARMS = ['upperR', 'upperL', 'lowerR', 'lowerL'] as const;
/** A blade in each hand: on its grip, along its forearm (the grip's −Z). */
const BLADES = Object.fromEntries(ARMS.map((arm) => [arm, { on: arm, at: [0, 0, -MULTIARM_SIZE.blade] as const }])) as Record<(typeof ARMS)[number], { on: string; at: readonly [number, number, number] }>; // prettier-ignore

/** The swing's curve over its progress u: wound back (−1), struck through (+1), recovered (0). */
export function swingCurve(u: number): number {
  if (u < 0.3) return -ease.outQuad(u / 0.3);
  if (u < 0.55) return -1 + 2 * ease.outCubic((u - 0.3) / 0.25);
  return 1 - ease.inOut(Math.min(1, (u - 0.55) / 0.45));
}

/** The multi-arm (see the file comment). */
export class Multiarm {
  readonly root = new Vector3();
  readonly turn: Quaternion;
  readonly weights = new StateWeights({ guard: [9, 6] });
  readonly echo = new PoseHistory({ count: 2, keep: 0.3 });
  readonly trail = new TipTrail({ life: 0.12 });
  readonly dt: number;
  time = 0;
  #points: Vector3[] = [];

  /** A multi-arm at the origin facing `yaw`, stepped every `dt` s. */
  constructor(options: { yaw?: number; dt?: number } = {}) {
    this.dt = options.dt ?? 1 / 60;
    this.turn = new Quaternion().setFromAxisAngle(UP, options.yaw ?? 0);
  }

  /** One step: guarding or not, and `swing` its swing's progress (0 to 1) or none. */
  step(input: { guard?: boolean; swing?: number } = {}): this {
    this.time += this.dt;
    this.weights.aim({ guard: input.guard ? 1 : 0 }).step(this.dt);
    const sw = input.swing === undefined ? 0 : swingCurve(input.swing);
    const right = layerPose(HANDS.ready, [{ values: HANDS.guard, weight: this.weights.get('guard') }, { values: HANDS.wind, weight: -sw }, { values: HANDS.strike, weight: sw }]); // prettier-ignore
    const left = layerPose(HANDS.ready, [{ values: HANDS.guard, weight: this.weights.get('guard') }]).map((v, i) => (i === 0 ? -v : v)); // prettier-ignore
    const at = (x: number, y: number, z: number, from = this.root) => new Vector3(x, y, z).applyQuaternion(this.turn).add(from); // prettier-ignore
    const [pelvis, chest] = [at(0, MULTIARM_SIZE.hips, 0), at(0, MULTIARM_SIZE.hips + 0.45, 0)];
    const head = at(0, 0.25, 0.02, chest);
    this.echo.push(this.time, [new Vector3(...right), new Vector3(...left)]);
    const late = [0.07, 0.15].map((lag) => this.echo.at(lag, [new Vector3(), new Vector3()]));
    const grips: Record<string, Matrix4> = {};
    const limbs = (
      [
        [right, left],
        [late[0][0].toArray(), late[1][1].toArray()],
      ] as number[][][]
    ).flatMap((hands, tier) =>
      hands.map((hand, side) => {
        const x = (side === 0 ? -1 : 1) * (0.2 - 0.03 * tier);
        const shoulder = at(x, -0.25 * tier, 0, chest);
        const target = at(hand[0] * (1 - 0.1 * tier) + x * 0.1 * tier, hand[1] - 0.25 * tier, hand[2], chest);
        const pole = at(x * 2, -1, -1, new Vector3());
        const [elbow, wrist] = twoBone(shoulder, target, MULTIARM_SIZE.upper, MULTIARM_SIZE.lower, pole);
        grips[ARMS[tier * 2 + side]] = new Matrix4().lookAt(elbow, wrist, UP).setPosition(wrist); // −Z down the forearm
        return [shoulder, elbow.clone(), wrist.clone()];
      }),
    );
    const blades = placeExtras(grips, BLADES);
    const arms = limbs.flatMap((limb, k) => [...limb, new Vector3().setFromMatrixPosition(blades[ARMS[k]])]);
    this.trail.step(this.dt, arms[3], arms[2], input.swing !== undefined);
    this.#points = [this.root.clone(), pelvis, chest, head, ...arms];
    return this;
  }

  /** Its points, in `MULTIARM.names`' order (after a step). */
  points(): Vector3[] {
    return this.#points;
  }
}

/** How far the swing reaches, measured off the right upper blade's tip at eleven moments of it (`measureReach`). */
export function swingReach() {
  return measureReach((u) => {
    const pose = new Multiarm().step({ swing: u }).points();
    return { strike: pose[MULTIARM.names.indexOf('upperR tip')], head: pose[MULTIARM.names.indexOf('head')] };
  });
}

/** The multi-arm's rig: its points, its bones and blades, and its states. */
export const MULTIARM: ProcRig = {
  id: 'rig:multiarm',
  names: ['root', 'pelvis', 'chest', 'head', ...ARMS.flatMap((arm) => ['shoulder', 'elbow', 'hand', 'tip'].map((j) => `${arm} ${j}`))], // prettier-ignore
  bones: [['pelvis', 'chest'], ['chest', 'head'], ...ARMS.flatMap((arm) => [['chest', `${arm} shoulder`], [`${arm} shoulder`, `${arm} elbow`, MULTIARM_SIZE.upper], [`${arm} elbow`, `${arm} hand`, MULTIARM_SIZE.lower], [`${arm} hand`, `${arm} tip`, MULTIARM_SIZE.blade]] as [string, string, number?][])], // prettier-ignore
  closed: 20,
  states: { rest: 1, guard: 1, swing: 0.8 },
  make(state, facing, dt) {
    const fighter = new Multiarm({ yaw: facing, dt });
    return {
      step: (time) => fighter.step({ guard: time !== undefined && state === 'guard', swing: time !== undefined && state === 'swing' ? Math.min(1, time / 0.8) : undefined }).root, // prettier-ignore
      points: () => fighter.points(),
    };
  },
};
