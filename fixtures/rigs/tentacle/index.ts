/**
 * @file A tentacled creature (PLAN.md WP 10.1; fixtures/rigs/README.md): an octopus of the procedural blocks alone
 * (engine/sim-api.ts). Its body rides a spring over its crawl (`Spring3`), so it surges and settles; its four
 * tentacles are verlet strands (`Chain`, the engine's strand: gravity, drag, a rest shape out and down, the floor)
 * hung clear of the floor from its rim, trailing as it moves; a fifth, raised, beats up and down when it waves
 * (`SwayChain`), its tip trailing (`TipTrail`); its head sac swings behind it on a lagging part (`LagPart`). `TENTACLE`
 * is its rig (engine/anim/proc/rig.ts): rest, crawl and wave.
 *
 * Invariants: metres, seconds, +Y up, facing +Z; a fixed step; nothing random.
 *
 * @example
 * import { Vector3 } from '../../../engine/sim-api';
 * const octopus = new Tentacled();
 * for (let i = 0; i < 60; i++) octopus.step({ velocity: new Vector3(0, 0, 0.5) });
 * octopus.points().every((p) => p.y >= 0); // true: on and over the floor
 * @see fixtures/rigs/tentacle/index.test.ts
 */
import { Chain, LagPart, Quaternion, Spring3, SwayChain, TipTrail, Vector3, type ProcRig } from '../../../engine/sim-api'; // prettier-ignore

/** Its sizes, m: its body's height, its rim, its tentacles' links. */
export const TENTACLE_SIZE = { height: 0.3, rim: 0.12, link: 0.05, links: 4 } as const;

const UP = new Vector3(0, 1, 0);
/** The rim's four anchors (its frame), each tentacle's rest out from its body and down. */
const RIM = [0.8, 2.4, 3.9, 5.5].map((a) => new Vector3(Math.sin(a), 0, Math.cos(a)));

/** The tentacled creature (see the file comment). */
export class Tentacled {
  readonly root = new Vector3();
  readonly turn: Quaternion;
  readonly body = new Spring3({ frequency: 7, damping: 0.6, value: new Vector3(0, TENTACLE_SIZE.height, 0) });
  readonly arms = RIM.map((out) => new Chain({ n: TENTACLE_SIZE.links + 1, seg: TENTACLE_SIZE.link, rest: out.clone().multiplyScalar(0.6).add(new Vector3(0, -0.8, 0)), stiffness: 2, gravity: 9.81, drag: 4 })); // prettier-ignore
  readonly waver = new SwayChain({ count: 4, length: TENTACLE_SIZE.link, amplitude: 0.9, frequency: 6, lag: 0.6, axis: 'up' }); // prettier-ignore
  readonly sac = new LagPart({ length: 0.16, rest: new Vector3(0, 0.6, -1), frequency: 6, damping: 0.5, limit: 0.6 });
  readonly trail = new TipTrail({ life: 0.15 });
  readonly dt: number;
  #points: Vector3[] = [];

  /** A creature at the origin facing `yaw`, stepped every `dt` s. */
  constructor(options: { yaw?: number; dt?: number } = {}) {
    this.dt = options.dt ?? 1 / 60;
    this.turn = new Quaternion().setFromAxisAngle(UP, options.yaw ?? 0);
    for (const arm of this.arms) arm.floor = 0;
  }

  /** One step: crawling at `velocity`, waving its raised arm or not. */
  step(input: { velocity?: Vector3; wave?: boolean } = {}): this {
    const dt = this.dt;
    this.root.addScaledVector(input.velocity ?? new Vector3(), dt);
    const core = this.body.step(dt, this.root.clone().addScaledVector(UP, TENTACLE_SIZE.height)).clone();
    const arms = this.arms.flatMap((arm, i) => {
      const anchor = RIM[i].clone().multiplyScalar(TENTACLE_SIZE.rim).applyQuaternion(this.turn).add(core).addScaledVector(UP, -0.08); // prettier-ignore
      return arm.step(dt, anchor, this.turn).points.map((p) => p.clone());
    });
    const shoulder = new Vector3(0, 0.02, TENTACLE_SIZE.rim).applyQuaternion(this.turn).add(core);
    const raised = this.turn.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI * 0.85)); // its rest up and ahead
    const waver = this.waver.step(dt, shoulder, raised, input.wave ? 1 : 0.1, input.wave ? 1 : 0.3).map((p) => p.clone()); // prettier-ignore
    this.trail.step(dt, waver[waver.length - 1], waver[waver.length - 2], input.wave === true);
    const sac = this.sac.step(dt, core, this.turn).clone();
    this.#points = [this.root.clone(), core, sac, ...waver, ...arms];
    return this;
  }

  /** Its points, in `TENTACLE.names`' order (after a step). */
  points(): Vector3[] {
    return this.#points;
  }
}

const ARM_NAMES = RIM.flatMap((_, i) => Array.from({ length: TENTACLE_SIZE.links + 1 }, (__, k) => `arm${i} ${k}`));

/** The creature's rig: its points, its sac and its raised arm's links as bones, and its states. */
export const TENTACLE: ProcRig = {
  id: 'rig:tentacle',
  names: ['root', 'core', 'sac', ...[0, 1, 2, 3, 4].map((k) => `waver ${k}`), ...ARM_NAMES],
  bones: [['core', 'sac'], ...[0, 1, 2, 3].map((k) => [`waver ${k}`, `waver ${k + 1}`] as [string, string])],
  states: { rest: 1, crawl: 2, wave: 1.5 },
  make(state, facing, dt) {
    const octopus = new Tentacled({ yaw: facing, dt });
    const ahead = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    return {
      step: (time) => octopus.step({ velocity: ahead.clone().multiplyScalar(time !== undefined && state === 'crawl' ? 0.5 : 0), wave: time !== undefined && state === 'wave' }).root, // prettier-ignore
      points: () => octopus.points(),
    };
  },
};
