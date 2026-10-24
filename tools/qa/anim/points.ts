/**
 * @file The `anim` QA family's point rigs (PLAN.md §8.6, WP 6.6, WP 10.1): the bodies that are not a humanoid, each a
 * procedural rig (engine/anim/proc/rig.ts `ProcRig`): the blob and the wisp (engine/anim/blob.ts, floater.ts; their QA
 * ids are their states', `blob:<state>`, `floater:<state>`), the quadruped (engine/anim/quadruped.ts, WP 13.21:
 * `rig:quadruped/<state>`) and, where the checkout has fixtures/rigs/ (the engine's repository; a game has no
 * fixtures/), its six rigs (WP 10.1; `<rig id>/<state>`, `rig:biped/walk`), imported at run time by `pointRigs`, so no
 * file a game gets imports the engine's fixtures. `checkPointRig` drives each state at both facings (`driveRig`), from rest
 * and back to rest, and reports their points not finite (`nan`) or under the floor (`underFloor`), their bones off
 * their length (`stretch`), the motion metrics (`pop`, `footSlide` for the feet a rig names, `loopClosure` for the
 * first points it closes, `rigClosed`), another run giving other points (`unstableHash`) and points straying at half
 * the step (`rateDrift`).
 *
 * Split from tools/qa/anim.ts to keep each under 400 lines (ADR-0014 amendment 16).
 *
 * @example
 * POINT_RIGS.map(({ rig }) => rig.id); // ['rig:blob', 'rig:floater (the wisp)', 'rig:quadruped']
 * import { ROOT } from '../../x';
 * (await pointRigs(ROOT)).map(({ rig }) => rig.id).includes('rig:biped'); // true
 * @see tools/qa/anim.test.ts
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Fnv64 } from '../../../engine/core/hash';
import { Vector3 } from '../../../engine/core/math';
import { Blob, BLOB_MOVES, blobMoveTimes, type BlobInput } from '../../../engine/anim/blob';
import { Floater, FLOATER } from '../../../engine/anim/floater';
import { QUADRUPED_RIG } from '../../../engine/anim/quadruped';
import { driveRig, rigClosed, type ProcRig } from '../../../engine/anim/proc/rig';
import { rateDrift, STATE_MATRIX } from '../../../engine/anim/stateMatrix';
import { closure, footSlide, m, motionTrack, pops, worse, type Found, type Track } from './metrics';

export const [AHEAD, BEHIND, LEFT] = [new Vector3(0, 0, 1), new Vector3(0, 0, -1), new Vector3(1, 0, 0)];
/** A direction in the body's frame, turned to its facing. */
export const facingTurn = (direction: Vector3, facing: number) =>
  direction.clone().applyAxisAngle(new Vector3(0, 1, 0), facing);

/** Adds what a finding says to the violations, keeping the worst per id and metric. */
export type Report = (id: string, metric: string, found: Found) => void;

/** The blob's states: what it is told, at rest (time undefined) and while it holds the state. */
const BLOB_TELLS: Readonly<Record<string, (facing: number, blob: Blob, time?: number) => BlobInput>> = {
  rest: () => ({}),
  stretch: (_, __, time) => ({ squash: time === undefined ? 0 : 0.45 }),
  flatten: (_, __, time) => ({ squash: time === undefined ? 0 : -0.45 }),
  turn: (facing, _, time) => ({ look: facingTurn(time === undefined ? AHEAD : LEFT, facing) }),
  hang: () => ({ hang: true }), // a roost is held from the start: hanging is a switch, not a motion
  fold: (_, __, time) => (time === undefined ? {} : { flap: 0, squint: true }),
  kick: (_, blob, time) => (time === 0 && blob.kick(5), {}),
};

/** The blob rig: its body, eyes, mouth and wings, rest-closed. */
const BLOB_RIG: ProcRig = {
  id: 'rig:blob',
  names: ['root', 'centre', 'top', 'bottom', 'eyeL', 'eyeR', 'mouth', 'wingL', 'wingL tip', 'wingR', 'wingR tip'],
  closed: 7,
  states: {
    ...Object.fromEntries(Object.keys(BLOB_TELLS).map((name) => [`blob:${name}`, 0.6])),
    ...Object.fromEntries(Object.keys(BLOB_MOVES).map((name) => [`blob:${name}`, blobMoveTimes(name as never).end])),
  },
  make(state, facing, dt) {
    const blob = new Blob({ yaw: facing, dt });
    const name = state.slice('blob:'.length);
    const tell = BLOB_TELLS[name] ?? ((_, __, time) => (time === undefined ? {} : { move: { name, time } }));
    return {
      step: (time) => blob.step(tell(facing, blob, time)).position,
      points() {
        const J = blob.pose();
        const at = (matrix: (typeof J)['root'], x = 0, y = 0) => new Vector3(x, y, 0).applyMatrix4(matrix);
        return [at(J.root), at(J.body), at(J.body, 0, 1), at(J.body, 0, -1), at(J.eyeL), at(J.eyeR), at(J.mouth), at(J.wingL), at(J.wingL, 0, 1), at(J.wingR), at(J.wingR, 0, 1)]; // prettier-ignore
      },
    };
  },
};

/** The floater rig: its core, its axes at the motes' orbit and its motes, hovering on its own over the floor. */
const FLOATER_RIG: ProcRig = {
  id: 'rig:floater (the wisp)',
  names: ['core', 'nose', 'side', 'top', 'mote0', 'mote1', 'mote2'],
  closed: 4,
  states: { 'floater:rest': 1, 'floater:travel': 1, 'floater:turn': 1.5, 'floater:swell': 1 }, // a swell held 1 s
  make(state, facing, dt) {
    const wisp = new Floater({ yaw: facing, clock: 0, dt });
    const at = new Vector3(0, FLOATER.height, 0);
    return {
      step(time) {
        const ahead = facingTurn(AHEAD, facing + (state === 'floater:turn' ? 2 * (time ?? 0) : 0)).multiplyScalar(4);
        const moving = time !== undefined && (state === 'floater:travel' || state === 'floater:turn');
        const velocity = moving ? ahead : new Vector3();
        // a charge builds and is spent within the hold: the caller eases the swell, the floater shows it
        const swell = time !== undefined && state === 'floater:swell' ? Math.sin(Math.PI * time) : 0;
        wisp.step({ position: at, velocity, swell, yaw: moving ? undefined : facing });
        const placed = at.clone();
        at.addScaledVector(velocity, dt).y += wisp.hover(at.y, 0) * dt;
        return placed;
      },
      points() {
        const J = wisp.pose();
        const axes = [AHEAD, LEFT, new Vector3(0, 1, 0)].map((axis) => axis.clone().multiplyScalar(FLOATER.orbit).applyMatrix4(J.core)); // prettier-ignore
        return [new Vector3().setFromMatrixPosition(J.core), ...axes, ...J.motes.map((mote) => mote.clone())];
      },
    };
  },
};

/** A point rig's run as a track (engine/anim/proc/rig.ts `driveRig`): from rest and back, or at rest throughout. */
function drive(rig: ProcRig, state: string, facing: number, dt: number, rest = false): Track {
  const { world, positions, held } = driveRig(rig, state, facing, dt, rest);
  const feet = (rig.feet ?? []).map((name) => rig.names.indexOf(name));
  return motionTrack({ where: `facing ${facing}`, dt, names: rig.names, world, positions, held, feet });
}

/** A track's digest over every point of every step. */
const hashTrack = (t: Track) => t.world.reduce((h, points) => points.reduce((g, p) => g.numbers(p.toArray()), h), new Fnv64()).hex(); // prettier-ignore

/** Where a point rig's points are not finite or sink below the floor. */
function pointProblems(t: Track): { nan: Found; floor: Found } {
  let [nan, floor]: Found[] = [undefined, undefined];
  t.world.forEach((points, i) =>
    points.forEach((p, k) => {
      const at = `${t.where}: at frame ${i}, ${t.names[k]}`;
      if (![p.x, p.y, p.z].every(Number.isFinite)) nan ??= { value: 1, message: `${at} is not a finite point` };
      else if (p.y < -0.001) floor = worse(floor, { value: -p.y, message: `${at} is ${m(-p.y)} m below the floor` });
    }),
  );
  return { nan, floor };
}

/** A point rig's states, each reported as `prefix` and its name: its own checks, the motion, the hash and the rate. */
export function checkPointRig(rig: ProcRig, prefix: string, keep: (id: string) => boolean, report: Report): void {
  for (const name of Object.keys(rig.states)) {
    const state = prefix + name;
    if (!keep(state)) continue;
    for (const facing of STATE_MATRIX.facings) {
      const t = drive(rig, name, facing, 1 / 60);
      const { nan, floor } = pointProblems(t);
      report(state, 'nan', nan);
      report(state, 'underFloor', floor);
      report(state, 'stretch', stretch(rig, t));
      report(state, 'pop', pops(t));
      report(state, 'footSlide', footSlide(t));
      report(state, 'loopClosure', closure(t, drive(rig, name, facing, 1 / 60, true), rigClosed(rig, name)));
      if (hashTrack(drive(rig, name, facing, 1 / 60)) !== hashTrack(t)) {
        report(state, 'unstableHash', { value: 1, message: `${t.where}: running it again gave other points; look for module state` }); // prettier-ignore
      }
      const { worst, frame, point } = rateDrift(t.local, drive(rig, name, facing, 1 / 120).local);
      if (worst > STATE_MATRIX.rate) {
        report(state, 'rateDrift', { value: worst, message: `${t.where}: at frame ${frame}, ${t.names[point]} is ${m(worst)} m from where half steps put it (over ${STATE_MATRIX.rate} m); scale each step's change by dt` }); // prettier-ignore
      }
    }
  }
}

/** The farthest a rig's bone strays from the length it gives, or else its length in the first frame, past 1 mm. */
function stretch(rig: ProcRig, t: Track): Found {
  let found: Found;
  for (const [a, b, given] of rig.bones ?? []) {
    const [i, j] = [rig.names.indexOf(a), rig.names.indexOf(b)];
    const length = given ?? t.world[0][i].distanceTo(t.world[0][j]);
    t.world.forEach((points, k) => {
      const off = Math.abs(points[i].distanceTo(points[j]) - length);
      if (off > 0.001) found = worse(found, { value: off, message: `${t.where}: at frame ${k}, the bone ${a}–${b} is ${m(off)} m off its length` }); // prettier-ignore
    });
  }
  return found;
}

/** A rig the family drives, and the prefix of its QA ids (none for the blob's and the wisp's own). */
export interface PointRig {
  readonly rig: ProcRig;
  readonly prefix: string;
}

/** The engine's point rigs, which every checkout has. */
export const POINT_RIGS: readonly PointRig[] = [
  { rig: BLOB_RIG, prefix: '' },
  { rig: FLOATER_RIG, prefix: '' },
  { rig: QUADRUPED_RIG, prefix: `${QUADRUPED_RIG.id}/` },
];

/** The fixture rigs of fixtures/rigs/ (WP 10.1), each a folder's index.ts and the rig it exports, in the family's order. */
export const FIXTURE_RIGS = [
  ['biped', 'BIPED'],
  ['hexapod', 'HEXAPOD'],
  ['serpent', 'SERPENT'],
  ['floater', 'FLOATER'],
  ['multiarm', 'MULTIARM'],
  ['tentacle', 'TENTACLE'],
] as const;

/**
 * The point rigs under `root`: `POINT_RIGS`, then `FIXTURE_RIGS` where `root` has fixtures/rigs/, imported here at run
 * time by path, since a game gets tools/ but never the engine's fixtures/.
 */
export async function pointRigs(root: string): Promise<PointRig[]> {
  const dir = join(root, 'fixtures', 'rigs');
  if (!existsSync(dir)) return [...POINT_RIGS];
  const load = async ([folder, name]: (typeof FIXTURE_RIGS)[number]) =>
    ((await import(pathToFileURL(join(dir, folder, 'index.ts')).href)) as Record<string, ProcRig>)[name];
  const fixtures = await Promise.all(FIXTURE_RIGS.map(load));
  return [...POINT_RIGS, ...fixtures.map((rig) => ({ rig, prefix: `${rig.id}/` }))];
}
