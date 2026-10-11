/**
 * @file Unit tests for the blob rig (engine/anim/blob.ts), PLAN.md WP 5.3's Done when: the differential test against
 * my-3d2dge's reference vectors (tests/baselines/port/blob.json, converted to SI by Appendix C) puts the skeleton's
 * points within 1 cm on average, every exception listed with its reason; the squash preserves volume; every pose is
 * finite. Also: the moves as data, the fixed step, a pose read from the state alone.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import {
  Blob,
  BLOB,
  BLOB_JOINTS,
  BLOB_LEAP,
  BLOB_MOVES,
  blobMove,
  blobMoveTimes,
  type BlobInput,
  type BlobJoint,
  type BlobMoveName,
} from './blob';

/** One reference script (tools/cmd/port.ts `blobScript`). */
interface Script {
  script: string;
  segments: { steps: number; kick?: number; input: { squash?: number; look?: number[]; squint?: boolean; flap?: number } }[]; // prettier-ignore
  samples: number[][];
}
const REF = JSON.parse(readFileSync('tests/baselines/port/blob.json', 'utf8')) as { R: number; scripts: Script[] };
/** The reference step (tools/cmd/port.ts `DT`). */
const DT = 1 / 120;
/** The reference radius, metres. */
const R = REF.R / 16;
const TAU = Math.PI * 2;

/** An input of the source's `update`, in the engine's terms: a look (x, y) → (x, 0, y) / 16 (Appendix C). */
const inputOf = ({ look, ...rest }: Script['segments'][number]['input']): BlobInput => ({
  ...rest,
  ...(look && { look: new Vector3(look[0] / 16, 0, look[1] / 16) }),
});

/** A point through a joint's matrix. */
const at = (blob: Blob, joint: BlobJoint, x = 0, y = 0, z = 0) => new Vector3(x, y, z).applyMatrix4(blob.joints[joint]);

/**
 * The source's points for one sample, in metres in the engine's frame, as its drawing places them on its update's
 * numbers (`slimeParts`): the body R(1 − 0.55 sq) wide and R(1 + sq) tall about its centre, the eyes 0.42 rad off the
 * look, the wings beside the centre, their tips out by the span and up by the rise.
 */
function sourcePoints(sq: number, lookX: number, lookY: number, flap: number, beat: number): Map<string, Vector3> {
  const [a, h] = [1 - 0.55 * sq, 1 + sq];
  const centre = new Vector3(0, R * h, 0);
  const forward = new Vector3(lookX, 0, lookY).normalize();
  const left = new Vector3(forward.z, 0, -forward.x); // right = forward × up
  const up = new Vector3(0, 1, 0);
  const f = Math.sin(beat) * 0.5 + 0.5;
  const fold = Math.min(1, flap * 2);
  const [span, rise] = [R * (0.8 + (0.9 + f * 0.5) * fold), (1.2 - f * 1.3) * fold * R * 0.6];
  const points = new Map([
    ['centre', centre.clone()],
    ['top', centre.clone().addScaledVector(up, R * h)],
    ['front', centre.clone().addScaledVector(forward, R * a)],
  ]);
  for (const [side, s] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const out = left.clone().multiplyScalar(s);
    points.set(`side${side}`, centre.clone().addScaledVector(out, R * a));
    const eye = forward.clone().multiplyScalar(Math.cos(0.42)).addScaledVector(out, Math.sin(0.42));
    points.set(
      `eye${side}`,
      centre
        .clone()
        .addScaledVector(eye, R * a * 0.86)
        .addScaledVector(up, R * h * 0.2),
    );
    const root = centre.clone().addScaledVector(out, R * a * 0.6);
    points.set(`wing${side}`, root);
    points.set(`wingTip${side}`, root.clone().addScaledVector(out, span).addScaledVector(up, rise));
  }
  return points;
}

/** The same points on the new skeleton. */
function rigPoints(blob: Blob): Map<string, Vector3> {
  const points = new Map([
    ['centre', at(blob, 'body')],
    ['top', at(blob, 'body', 0, 1, 0)],
    ['front', at(blob, 'body', 0, 0, 1)],
  ]);
  for (const [side, s] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    points.set(`side${side}`, at(blob, 'body', s, 0, 0));
    points.set(`eye${side}`, at(blob, `eye${side}`));
    points.set(`wing${side}`, at(blob, `wing${side}`));
    points.set(`wingTip${side}`, at(blob, `wing${side}`, 0, 1, 0));
  }
  return points;
}

/**
 * Points allowed past 1 cm, each with its reason, and the share of the radius's change that moves it: the volume fix
 * makes the body R / √(1 + sq) wide where the source's was R(1 − 0.55 sq), so whatever sits at the body's width
 * moves by that share of R |(1 − 0.55 sq) − 1 / √(1 + sq)|, 4.1 cm at sq = −0.45. Nothing else differs.
 */
const EXCEPTIONS: Readonly<Record<string, { share: number; reason: string }>> = {
  front: { share: 1, reason: 'the body’s front is at its width, which preserves volume' },
  sideL: { share: 1, reason: 'the body’s side is at its width, which preserves volume' },
  sideR: { share: 1, reason: 'the body’s side is at its width, which preserves volume' },
  eyeL: { share: 0.86, reason: 'the eyes sit at 0.86 of the width, which preserves volume' },
  eyeR: { share: 0.86, reason: 'the eyes sit at 0.86 of the width, which preserves volume' },
  wingL: { share: 0.6, reason: 'the wing roots sit at 0.6 of the width, which preserves volume' },
  wingR: { share: 0.6, reason: 'the wing roots sit at 0.6 of the width, which preserves volume' },
  wingTipL: { share: 0.6, reason: 'the wing tips are out from the roots, which sit at 0.6 of the width' },
  wingTipR: { share: 0.6, reason: 'the wing tips are out from the roots, which sit at 0.6 of the width' },
};

/** Runs every reference script: the state's largest differences, and every point's error and unexplained error. */
function differential() {
  const state = { squash: 0, squashSpeed: 0, look: 0, flap: 0, beat: 0 };
  const errors = new Map<string, number[]>();
  let unexplained = 0;
  for (const { segments, samples } of REF.scripts) {
    const blob = new Blob({ radius: R, yaw: Math.PI / 2, dt: DT }); // the source looks east, φ = 0: ψ = π/2
    let n = 0;
    for (const { steps, kick, input } of segments) {
      if (kick) blob.kick(kick);
      for (let i = 0; i < steps; i++) {
        const [step, sq, sqV, lookX, lookY, flap, flapP] = samples[n++];
        expect(step).toBe(n);
        const s = blob.step(inputOf(input)).state;
        state.squash = Math.max(state.squash, Math.abs(s.squash - sq));
        state.squashSpeed = Math.max(state.squashSpeed, Math.abs(s.squashSpeed - sqV));
        state.look = Math.max(state.look, Math.abs(s.lookX - lookX), Math.abs(s.lookZ - lookY));
        state.flap = Math.max(state.flap, Math.abs(s.flap - flap));
        state.beat = Math.max(state.beat, Math.abs(s.beat - (flapP % TAU)));
        const want = sourcePoints(sq, lookX, lookY, flap, flapP);
        const widthChange = R * Math.abs(1 - 0.55 * sq - 1 / Math.sqrt(1 + sq));
        blob.pose();
        for (const [name, got] of rigPoints(blob)) {
          const error = got.distanceTo(want.get(name)!);
          if (!errors.has(name)) errors.set(name, []);
          errors.get(name)!.push(error);
          unexplained = Math.max(unexplained, Math.abs(error - (EXCEPTIONS[name]?.share ?? 0) * widthChange));
        }
      }
    }
    expect(n).toBe(samples.length);
  }
  return { state, errors, unexplained };
}

describe('the differential test against my-3d2dge (WP 5.3 Done when)', () => {
  const { state, errors, unexplained } = differential();

  it('follows the source’s update to rounding: the spring, the look and the beat', () => {
    expect(state.squash).toBeLessThan(1e-13);
    expect(state.squashSpeed).toBeLessThan(1e-12);
    expect(state.look).toBeLessThan(1e-13);
    expect(state.flap).toBe(0);
    expect(state.beat).toBeLessThan(1e-12);
  });

  it('puts the skeleton’s points within 1 cm on average, every one past 1 cm listed with its reason', () => {
    const all = [...errors.values()].flat();
    expect(all.length).toBe(3 * 120 * 11); // 3 scripts of 120 steps, 11 points
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean).toBeLessThan(0.01);
    expect(mean).toBeLessThan(0.004); // measured 3.7 mm: 0 at the centre and the top, 5.8 mm at the width
    const worst = [...errors].map(([name, list]) => [name, Math.max(...list)] as const).sort((a, b) => b[1] - a[1]);
    expect(worst.filter(([name, e]) => e > 0.01 && !EXCEPTIONS[name])).toEqual([]);
    expect(worst[0][1]).toBeLessThan(0.037); // measured 3.66 cm: the front and the sides at the hop's deepest squash
  });

  it('differs only by the volume fix: each error is its point’s share of the width’s change, to rounding', () => {
    expect(unexplained).toBeLessThan(1e-12);
    for (const name of ['centre', 'top']) expect(Math.max(...errors.get(name)!), name).toBeLessThan(1e-15);
  });
});

/** Steps `blob` `steps` times with `input`. */
function run(blob: Blob, input: BlobInput, steps: number): Blob {
  for (let i = 0; i < steps; i++) blob.step(input);
  return blob;
}

describe('the squash', () => {
  it('preserves volume: the body’s radii multiply to R³ at every squash', () => {
    const blob = new Blob();
    for (let i = 0; i <= 90; i++) {
      blob.state.squash = -BLOB.limit + (i / 90) * 2 * BLOB.limit;
      const det = blob.pose().body.determinant();
      expect(det / Math.pow(BLOB.radius, 3)).toBeCloseTo(1, 12);
    }
  });

  it('keeps volume through kicks and moves, and stays within its bounds', () => {
    const blob = new Blob({ radius: 0.3 });
    for (const [kick, move] of [
      [40, 'pounce'],
      [-40, 'spit'],
      [3, 'bite'],
    ] as const) {
      // prettier-ignore
      blob.kick(kick);
      for (let t = 0; t < 0.8; t += SIM_DT) {
        blob.step({ move: { name: move, time: t } });
        expect(Math.abs(blob.state.squash)).toBeLessThanOrEqual(BLOB.limit);
        expect(blob.pose().body.determinant() / Math.pow(0.3, 3)).toBeCloseTo(1, 12);
      }
    }
  });

  it('rests on the ground point: the bottom stays on it as it squashes; hanging, the body hangs from 2R above it', () => {
    const blob = new Blob({ yaw: 1 });
    const ground = new Vector3(2, 0.5, -3);
    blob.kick(-6).step({ position: ground }).pose();
    expect(at(blob, 'body', 0, -1, 0).distanceTo(ground)).toBeLessThan(1e-15);
    expect(at(blob, 'body', 0, 1, 0).y - ground.y).toBeCloseTo(2 * BLOB.radius * (1 + blob.state.squash), 15);
    blob.step({ hang: true }).pose();
    expect(at(blob, 'body', 0, -1, 0).distanceTo(ground.clone().setY(ground.y + 2 * BLOB.radius))).toBeLessThan(1e-15); // prettier-ignore
  });
});

describe('the moves, as data', () => {
  const { back, reach, height } = BLOB_LEAP;
  const times = (name: BlobMoveName) => BLOB_MOVES[name].time;
  /** Move `name` at clock k (0–1 wind, 1–2 active, 2–3 recover). */
  const atK = (name: BlobMoveName, k: number, leap = BLOB_LEAP) => {
    const { wind, active, recover } = times(name);
    return blobMove(name, k < 1 ? k * wind : k < 2 ? wind + (k - 1) * active : wind + active + (k - 2) * recover, leap);
  };

  it('leaps: gathers back and down, launches, tops out at the height, lands at the reach, backs off', () => {
    expect(atK('leap', 0.25)).toEqual({ forward: -back / 2, lift: 0, squash: -0.15 });
    const top = atK('leap', 1.25);
    expect(top.forward).toBeCloseTo(-back + (reach + back) * 0.75, 12);
    expect(top.lift).toBeCloseTo(height, 12);
    expect(top.squash).toBe(BLOB_LEAP.air);
    expect(atK('leap', 1.99).squash).toBe(BLOB_LEAP.land);
    expect(atK('leap', 2).forward).toBeCloseTo(reach, 12);
    expect(atK('leap', 3)).toEqual({ forward: 0, lift: 0, squash: -0 });
  });

  it('bites short and low, pounces high, spits without leaving the ground; a negative height dives', () => {
    expect(atK('bite', 2).forward).toBeCloseTo(0.6 * reach, 12);
    expect(atK('bite', 1.25).lift).toBeCloseTo(0.3 * height, 12);
    expect(atK('pounce', 1.25).lift).toBeCloseTo(1.5 * height, 12);
    for (let k = 0; k <= 3; k += 0.05) expect(atK('spit', k).lift).toBe(0);
    expect(atK('spit', 1).forward).toBe(-0.125);
    expect(atK('spit', 2).forward).toBeCloseTo(0.125, 12);
    expect(atK('spit', 0.5).squash).toBe(-0.25);
    const bat = { back: 0.25, reach: 0.875, height: -0.5625, air: -0.15, land: 0.25, hit: 0.5 };
    expect(atK('leap', 1.25, bat).lift).toBeCloseTo(-0.5625, 12);
  });

  it('hits at the leap’s share of the strike; the spit as its strike ends', () => {
    expect(blobMoveTimes('leap')).toEqual({ hit: 0.08 + 0.9 * 0.1, end: 0.08 + 0.1 + 0.22 });
    expect(blobMoveTimes('spit').hit).toBeCloseTo(0.22 + 0.12, 15);
    expect(blobMoveTimes('bite', { ...BLOB_LEAP, hit: 0.5 }).hit).toBeCloseTo(0.035 + 0.03, 15);
    expect(blobMove('pounce', -1)).toEqual(blobMove('pounce', 0));
    expect(blobMove('pounce', 99)).toEqual(blobMove('pounce', blobMoveTimes('pounce').end));
  });

  it('moves the body along its look by the move’s offset, and squashes toward the move’s target', () => {
    const blob = new Blob({ yaw: Math.PI / 2 }); // looking along +X
    const t = times('leap').wind + 0.25 * times('leap').active;
    blob.step({ move: { name: 'leap', time: t } }).pose();
    expect(at(blob, 'root').x).toBeCloseTo(blobMove('leap', t).forward, 12);
    expect(at(blob, 'root').y).toBeCloseTo(height, 12);
    expect(blob.state.squashSpeed).toBeGreaterThan(0); // toward the air's 0.25
    blob.step().pose();
    expect(at(blob, 'root').length()).toBeLessThan(1e-15);
  });
});

describe('the look, the step and the pose', () => {
  it('turns the look smoothly toward a direction, and keeps it for a look under 0.6 mm', () => {
    const blob = run(new Blob(), { look: new Vector3(3, 7, 0) }, 60);
    expect(blob.state.lookX).toBeCloseTo(1, 3);
    expect(Math.abs(blob.state.lookZ)).toBeLessThan(1e-3);
    const before = { ...blob.state };
    run(blob, { look: new Vector3(0, 0, -BLOB.lookMin / 2) }, 10);
    expect([blob.state.lookX, blob.state.lookZ]).toEqual([before.lookX, before.lookZ]);
    blob.pose();
    expect(at(blob, 'eyeL').z).toBeLessThan(0); // looking along +X, its left is −Z
    expect(at(blob, 'eyeR').z).toBeGreaterThan(0);
  });

  it('steps at SIM_DT by default, and gives the same bits for the same inputs', () => {
    expect(new Blob().dt).toBe(SIM_DT);
    const make = () =>
      run(new Blob().kick(3), { look: new Vector3(1, 0, 2), squash: 0.2, flap: 0.4, position: new Vector3(1, 2, 3) }, 90); // prettier-ignore
    const [a, b] = [make(), make()];
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.pose().body.elements).toEqual(b.pose().body.elements);
  });

  it('poses from the state alone: a copy of the state and position gives the same matrices', () => {
    const blob = run(new Blob(), { look: new Vector3(-1, 0, 0.3), flap: 0.6, move: { name: 'pounce', time: 0.2 } }, 7);
    const copy = new Blob();
    Object.assign(copy.state, structuredClone(blob.state));
    copy.position.copy(blob.position);
    for (const joint of Object.keys(BLOB_JOINTS) as BlobJoint[]) {
      expect(copy.pose()[joint].elements).toEqual(blob.pose()[joint].elements);
    }
  });

  it('gives finite matrices in every pose: kicks, moves, wings, hanging, a zero look', () => {
    const inputs: BlobInput[] = [
      {},
      { look: new Vector3() },
      { look: new Vector3(0, 5, 0), squint: true },
      { squash: 0.45, flap: 0 },
      { squash: -0.45, hang: true, flap: 1 },
      ...Object.keys(BLOB_MOVES).flatMap((name) => [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1].map((time) => ({ move: { name, time } }) as BlobInput)), // prettier-ignore
    ];
    const inverse = new Matrix4();
    for (const radius of [0.05, BLOB.radius, 2]) {
      for (const kick of [-1e4, 0, 1e4]) {
        const blob = new Blob({ radius }).kick(kick);
        for (const input of inputs) {
          const pose = run(blob, input, 5).pose();
          for (const joint of Object.keys(BLOB_JOINTS) as BlobJoint[]) {
            expect(pose[joint].elements.every(Number.isFinite), joint).toBe(true);
            expect(inverse.copy(pose[joint]).determinant(), joint).toBeGreaterThan(0); // never mirrored or flat
          }
        }
      }
    }
  });
});
