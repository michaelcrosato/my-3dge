/**
 * @file A serpent (PLAN.md WP 10.1; fixtures/rigs/README.md): a snake of the procedural blocks alone
 * (engine/sim-api.ts). Its body is a path chain (`PathChain`): ten segments following the way its head went, so it
 * winds where its head wound; its head rises like a cobra's on a spring (`Spring1`) and lowers again, its neck curling
 * up behind it (a lift fading down its first six segments, as the source's curl, never written into the path, so its
 * body lies back down where it lay); its head flinches back along its body on a spring a hit kicks; its eye looks where
 * it is told within bounds (`LookAt`); a crest of three spines stands along its back, each leaning back the way its
 * body runs there (`along`, `alongDirection`); and its tail's tip leaves a trail (`TipTrail`) while it moves. `SERPENT`
 * is its rig (engine/anim/proc/rig.ts): rest, slither (winding ahead at 1.4 m/s), rise and flinch.
 *
 * Invariants: metres, seconds, +Y up, facing +Z; a fixed step; nothing random.
 *
 * @example
 * import { Vector3 } from '../../../engine/sim-api';
 * const snake = new Serpent();
 * for (let i = 0; i < 60; i++) snake.step({ velocity: new Vector3(0, 0, 1.4) });
 * snake.points()[1].z > 0.8; // true: its head gone on, its body after it
 * @see fixtures/rigs/serpent/index.test.ts
 */
import { along, alongDirection, LookAt, PathChain, Quaternion, Spring1, TipTrail, Vector3, type ProcRig } from '../../../engine/sim-api'; // prettier-ignore

/** Its sizes, m: its segments' gap, its head's height lying and risen, its eye; how many segments its rise lifts;
 * where along its body its crest's spines stand, and how tall. */
export const SERPENT_SIZE = { gap: 0.18, count: 10, low: 0.08, high: 0.45, eye: 0.05, curl: 6, crest: [0.25, 0.4, 0.55], spine: 0.06 } as const; // prettier-ignore

const UP = new Vector3(0, 1, 0);

/** What it is told each step: how its head moves over the ground, how high it holds it (0 to 1), what it looks at. */
export interface SerpentInput {
  readonly velocity?: Vector3;
  readonly rise?: number;
  readonly look?: Vector3 | null;
  /** A hit this step: how hard its head flinches back, m/s. */
  readonly flinch?: number;
}

/** The serpent (see the file comment). */
export class Serpent {
  /** Where its head is over the ground. */
  readonly root = new Vector3();
  readonly body: PathChain;
  readonly lift = new Spring1({ frequency: 12 });
  readonly flinch = new Spring1({ frequency: 12, damping: 0.47 });
  readonly look = new LookAt({ rate: 6, yaw: 1, pitch: 0.8 });
  readonly trail = new TipTrail({ life: 0.25 });
  readonly turn = new Quaternion();
  readonly dt: number;
  #points: Vector3[] = [];

  /** A serpent lying along −Z behind its head at the origin, turned `yaw`, stepped every `dt` s. */
  constructor(options: { yaw?: number; dt?: number } = {}) {
    this.dt = options.dt ?? 1 / 60;
    this.turn.setFromAxisAngle(UP, options.yaw ?? 0);
    const back = new Vector3(0, 0, -1).applyQuaternion(this.turn);
    this.body = new PathChain({ count: SERPENT_SIZE.count, gap: SERPENT_SIZE.gap }).reset(new Vector3(0, SERPENT_SIZE.low, 0), back); // prettier-ignore
  }

  /** One step of what `input` tells it. */
  step(input: SerpentInput = {}): this {
    const dt = this.dt;
    const velocity = input.velocity ?? new Vector3();
    this.root.addScaledVector(velocity, dt);
    if (input.flinch) this.flinch.kick(input.flinch);
    const rise = (SERPENT_SIZE.high - SERPENT_SIZE.low) * this.lift.step(dt, input.rise ?? 0);
    this.body.step(this.root.clone().setY(SERPENT_SIZE.low)); // its path along the ground: the rise no part of it
    const curl = this.body.points.map((p, k) => {
      const share = Math.max(0, 1 - k / SERPENT_SIZE.curl);
      return p.clone().addScaledVector(UP, rise * share * share);
    });
    const tangent = this.body.tangents[0];
    const head = curl[0].clone().addScaledVector(tangent, -Math.max(0, this.flinch.step(dt, 0)) * 0.3);
    head.y = Math.max(head.y, SERPENT_SIZE.low);
    const flat = tangent.clone().setY(0);
    if (flat.lengthSq() > 1e-4) this.turn.setFromUnitVectors(new Vector3(0, 0, 1), flat.normalize()); // its neck upright: as it was
    const eye = head.clone().addScaledVector(this.look.step(dt, head, input.look ?? null, this.turn), SERPENT_SIZE.eye);
    const tail = this.body.points[SERPENT_SIZE.count - 1];
    this.trail.step(dt, tail, tail, velocity.lengthSq() > 0.01);
    const crest = SERPENT_SIZE.crest.map((t) => along(curl, t).addScaledVector(UP, SERPENT_SIZE.spine).addScaledVector(alongDirection(curl, t), -0.03)); // prettier-ignore
    this.#points = [this.root.clone(), head, eye, ...curl.slice(1), ...crest];
    return this;
  }

  /** Its points, in `SERPENT.names`' order (after a step). */
  points(): Vector3[] {
    return this.#points;
  }
}

/** The serpent's rig: its points, its eye on its head, and its states. */
export const SERPENT: ProcRig = {
  id: 'rig:serpent',
  names: ['root', 'head', 'eye', ...Array.from({ length: SERPENT_SIZE.count - 1 }, (_, k) => `segment${k + 1}`), 'spine0', 'spine1', 'spine2'], // prettier-ignore
  bones: [['head', 'eye']],
  closed: { slither: 3 }, // slithered, its body lies along the way it went; every other state lies back where it lay
  states: { rest: 1, slither: 2, rise: 1.5, flinch: 0.6 },
  make(state, facing, dt) {
    const snake = new Serpent({ yaw: facing, dt });
    const [ahead, side] = [new Vector3(Math.sin(facing), 0, Math.cos(facing)), new Vector3(Math.cos(facing), 0, -Math.sin(facing))]; // prettier-ignore
    return {
      step(time) {
        const on = time !== undefined;
        const wind = on && state === 'slither' ? ahead.clone().multiplyScalar(1.4).addScaledVector(side, 0.6 * Math.cos(2.5 * time)) : new Vector3(); // prettier-ignore
        const rise = on && state === 'rise' ? 1 : 0;
        const look = rise ? snake.root.clone().addScaledVector(ahead, 1).setY(1) : null;
        return snake.step({ velocity: wind, rise, look, flinch: on && state === 'flinch' && time === 0 ? 2 : 0 }).root;
      },
      points: () => snake.points(),
    };
  },
};
