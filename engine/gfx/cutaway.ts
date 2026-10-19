/**
 * @file The cutaway (PLAN.md WP 4.4): what keeps a level's walls and pillars from hiding the play. `createCutaway(
 * meshes)` gives every level mesh part whose recipe cuts (engine/gfx/level/recipes.ts, `cut`) a twin, an instanced
 * mesh of its cut-down shape under the level's root with its part's slots (`instanceSlots`, which says why), and
 * `update(pose, focus)` moves each piece between the part and its twin as the camera needs (`planCutaway` says how,
 * pure and unit-tested): a wall facing the camera is cut low, a pillar between the camera and the hero becomes a
 * stump. A part's instances are its uncut cells, in order, and its twin's its cut ones, so each costs its draw groups
 * only while it has instances (`drawCalls`). Nothing changes on the GPU but instance matrices, and the twins are
 * registered with the warm-up (`register`), so turning the camera builds no pipeline.
 *
 * The prototype cut only for its classic views and never for its 3D cameras; this asks the geometry instead, so an
 * orbit camera outside the hall cuts the walls in front of it and a chase camera inside cuts none.
 *
 * The occluder fade (WP 13.8, docs/PLAYGROUND.md §4): for a camera that may stand behind a wall (`update`'s `fade`:
 * the shooter's and the platformer's, engine/gfx/cameras/collide.ts), every block piece of any part, and every object
 * `objects` gives (the stage's rides), whose box a line from the camera to the hero's head or chest (`FADE_AIMS`)
 * crosses is taken out of the picture until the line clears (`planFade`): a piece leaves its part's instances, an
 * object hides. A piece the cutaway cut stays as cut; a part drawn as one mesh (a ramp, a floor) is never faded, its
 * box no measure of its shape. It hides rather than drawing a see-through twin, so it adds no material and no pipeline
 * (ADR-0025 amendment 8).
 *
 * Carried from `my-3d2dge:src/stress-world/40-cameras.js:166-181` (`placeCut`: walls by their outward direction
 * against the view's, `> .3`, none from above 85°; pillars on the lines from the camera to the hero's head and feet
 * and, below 60°, four points 40 units round him, the pillar's box widened by 4 units) and `10-hall.js:302-370`
 * (`placeWalls`, the cut twins, `placePillars`, `segBox`), in metres.
 *
 * Invariants: presentation only, never read by the sim; pure decisions (equal poses give equal cuts and fades);
 * `update` writes instances only when a cut or a fade changes; `dispose` puts every piece back and removes the twins.
 *
 * @example
 * // const cutaway = createCutaway(meshes);
 * // cutaway.register(gfx.warmup);
 * // each frame: cutaway.update(camera.pose(), hero.position);
 * import { makePose } from './cameras/pose';
 * const cells = [{ centre: [0.5, 0, 9.5], size: [1, 1], out: [0, 1] }] as const; // a wall tile facing south
 * const pose = makePose({ position: [0.5, 8, 20], yaw: Math.PI, pitch: -0.5 }); // south of it, looking north
 * planCutaway([{ when: 'facing', bottom: 0, top: 3, cells }], pose, [0.5, 0, 5]); // [[true]]
 * @see engine/gfx/cutaway.test.ts
 * @see tests/e2e/hall.spec.ts
 */
import { Box3, InstancedMesh, type Object3D } from 'three/webgpu';
import { poseForward, poseTarget, type CameraPose, type Vec3 } from './cameras/pose';
import type { LevelCell } from './level/cells';
import { meshDrawCalls, type LevelMeshes, type LevelMeshPart } from './level/meshes';
import type { CutWhen } from './level/recipes';
import { instanceSlots, placeInstances } from './level/shapes';
import type { Warmup } from './warmup';

/** A wall is cut when the cosine between its outward direction and the way to the camera is above this. */
export const CUT_FACING = 0.3;
/** Looking down steeper than this (rad, 85°), the camera sees over every wall: none is cut. */
export const CUT_STEEP = (85 * Math.PI) / 180;
/** Looking down at least this steeply (rad, 60°), only the hero's head and feet are aimed at, not the floor round him. */
export const AIM_STEEP = (60 * Math.PI) / 180;
/** How far round a blocking piece's box a line of sight still counts as through it (m): 4 prototype units. */
export const CUT_MARGIN = 0.25;
/** The points aimed at (m): the head and the feet above the focus, and the floor this far round it. */
export const CUT_AIMS = Object.freeze({ head: 1.625, feet: 0.125, around: 2.5 });
/** The points the fade keeps in sight above the focus (m), and how far inside a box a line must pass to fade it. */
export const FADE_AIMS = Object.freeze({ head: 1.5, chest: 1, inset: 0.05 });

/** What the cutaway decides over: the pieces of one part, how they cut, and their heights (m). */
export interface CutTarget {
  when: CutWhen;
  cells: readonly Pick<LevelCell, 'centre' | 'size' | 'out'>[];
  bottom: number;
  top: number;
}

/**
 * The points the camera must see, round `focus`, for a camera at `pitch` (rad): the hero's head and feet, and unless
 * it looks down `AIM_STEEP` or more, the floor `CUT_AIMS.around` metres round him, where the fight is.
 */
export function cutawayAims(focus: Vec3, pitch: number): Vec3[] {
  const [x, y, z] = focus;
  const { head, feet, around } = CUT_AIMS;
  const aims: Vec3[] = [
    [x, y + head, z],
    [x, y + feet, z],
  ];
  if (-pitch >= AIM_STEEP) return aims;
  return [
    ...aims,
    [x + around, y + feet, z],
    [x - around, y + feet, z],
    [x, y + feet, z + around],
    [x, y + feet, z - around],
  ];
}

/** Whether the segment `a` → `b` passes through the box `min`–`max` (slabs; the prototype's `segBox`). */
export function segmentHitsBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3): boolean {
  let [t0, t1] = [0, 1];
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) {
      if (a[k] < min[k] || a[k] > max[k]) return false;
      continue;
    }
    let [u, v] = [(min[k] - a[k]) / d, (max[k] - a[k]) / d];
    if (u > v) [u, v] = [v, u];
    [t0, t1] = [Math.max(t0, u), Math.min(t1, v)];
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * For each target, for each cell: whether `pose`, looking at `focus`, cuts it.
 * - `'facing'` (walls): when the camera stands on the side the cell faces out to (engine/gfx/level/cells.ts: `out`),
 *   by more than `CUT_FACING` (the cosine between `out` and the way to the camera, along the ground): an orthographic
 *   camera's way back along its view, a perspective camera's way from the cell to it. A camera inside the room is on
 *   the inner side of every wall, so nothing is cut for it; nor for one looking down steeper than `CUT_STEEP`.
 * - `'blocking'` (pillars): when a line of sight from the camera to the focus (`cutawayAims`) passes through the
 *   cell's box, widened by `CUT_MARGIN` all round (so a capital's overhang counts). An orthographic camera looks from
 *   its plane, back along its view; a perspective one from its position. The test runs in the picture's space,
 *   heights scaled by the pose's `boost` (engine/gfx/cameras/boost.ts), so it is what the frame shows.
 */
export function planCutaway(targets: readonly CutTarget[], pose: CameraPose, focus: Vec3): boolean[][] {
  const ortho = pose.projection === 'orthographic';
  const forward = poseForward(pose);
  const [px, py, pz] = pose.position;
  const k = pose.boost;
  const sights = cutawayAims(focus, pose.pitch).map(([x, y, z]): [Vec3, Vec3] => {
    const aim: Vec3 = [x, y * k, z];
    if (!ortho) return [aim, pose.position];
    // An orthographic camera sees from its plane: back along its view as far as its position stands.
    const back = Math.max(0, (aim[0] - px) * forward[0] + (aim[1] - py) * forward[1] + (aim[2] - pz) * forward[2]);
    return [aim, [aim[0] - forward[0] * back, aim[1] - forward[1] * back, aim[2] - forward[2] * back]];
  });
  const steep = -pose.pitch > CUT_STEEP;
  const facing = (cell: CutTarget['cells'][number]) => {
    if (steep) return false;
    const [dx, dz] = ortho ? [-forward[0], -forward[2]] : [px - cell.centre[0], pz - cell.centre[2]];
    const length = Math.hypot(dx, dz);
    return length > 1e-9 && (cell.out[0] * dx + cell.out[1] * dz) / length > CUT_FACING;
  };
  return targets.map(({ when, cells, bottom, top }) =>
    cells.map((cell) => {
      if (when === 'facing') return facing(cell);
      const [cx, , cz] = cell.centre;
      const [hx, hz] = [cell.size[0] / 2 + CUT_MARGIN, cell.size[1] / 2 + CUT_MARGIN];
      const min: Vec3 = [cx - hx, bottom * k, cz - hz];
      const max: Vec3 = [cx + hx, top * k, cz + hz];
      return sights.some(([aim, eye]) => segmentHitsBox(aim, eye, min, max));
    }),
  );
}

/**
 * For each target, for each cell, whether a line from `pose` to the head or the chest over `focus` (`FADE_AIMS`)
 * passes through the cell's box, shrunk by `FADE_AIMS.inset`: an orthographic camera looks from its plane, as in
 * `planCutaway`.
 */
export function planFade(targets: readonly Omit<CutTarget, 'when'>[], pose: CameraPose, focus: Vec3): boolean[][] {
  const [x, y, z] = focus;
  const lines = fadeLines(pose, [[x, y + FADE_AIMS.head, z], [x, y + FADE_AIMS.chest, z]]); // prettier-ignore
  const n = FADE_AIMS.inset;
  return targets.map(({ cells, bottom, top }) =>
    cells.map(({ centre: [cx, , cz], size: [w, d] }) => {
      const [min, max]: [Vec3, Vec3] = [[cx - w / 2 + n, bottom + n, cz - d / 2 + n], [cx + w / 2 - n, top - n, cz + d / 2 - n]]; // prettier-ignore
      return lines.some(([a, b]) => segmentHitsBox(a, b, min, max));
    }),
  );
}

/** The lines of sight from `pose` to each of `aims`: from its position, or back along an orthographic view. */
function fadeLines(pose: CameraPose, aims: readonly Vec3[]): [Vec3, Vec3][] {
  const f = poseForward(pose);
  const [px, py, pz] = pose.position;
  return aims.map((aim) => {
    if (pose.projection !== 'orthographic') return [aim, pose.position];
    const back = Math.max(0, (aim[0] - px) * f[0] + (aim[1] - py) * f[1] + (aim[2] - pz) * f[2]);
    return [aim, [aim[0] - f[0] * back, aim[1] - f[1] * back, aim[2] - f[2] * back]];
  });
}

/** How many of each cutting part's pieces are cut, after an `update`, and what the fade took out of the picture. */
export interface CutawayReport {
  /** Whether any piece moved between its part and its twin, or in or out of the picture. */
  changed: boolean;
  parts: { name: string; cut: number; of: number }[];
  /** The pieces faded, by part name, and the objects faded, by name. */
  faded: { parts: Record<string, number>; objects: string[] };
}

/** A level's cutaway (see the file comment). */
export interface Cutaway {
  /** The twins, one per part that cuts, in the parts' order: `<part name>:cut`. */
  readonly twins: readonly InstancedMesh[];
  /**
   * Cuts what `pose` needs cut to see `focus` (the pose's target by default), and with `fade` takes out of the picture
   * what still stands between them (see the file comment); says what is cut and faded.
   */
  update(pose: CameraPose, focus?: Vec3, options?: { fade?: boolean }): CutawayReport;
  /** Puts every piece back whole. */
  clear(): CutawayReport;
  /** The tiles of each part's cut pieces, by part name. */
  cut(): Record<string, LevelCell['tiles'][]>;
  /** Draw calls the twins cost a frame, as `LevelMeshes.drawCalls` counts them. */
  drawCalls(shadowMaps?: number): number;
  /** Registers the twins with `warmup` as `id` (`<root name>:cutaway` by default); `dispose()` unregisters. */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  /** Puts every piece back, removes and frees the twins, and unregisters. */
  dispose(): void;
}

/** One part whose pieces the cutaway or the fade moves: its twin (a cutting part's), what is cut and what faded. */
interface Entry {
  part: LevelMeshPart & { mesh: InstancedMesh };
  twin: InstancedMesh | null;
  cuts: boolean[];
  fades: boolean[];
}

/** What `createCutaway` takes beside the meshes. */
export interface CutawayOptions {
  /** More objects the fade hides when they stand in the way (the stage's rides), read each update. */
  objects?: () => readonly Object3D[];
}

/** Gives `meshes`' cutting parts their twins (see the file comment), and fades `options.objects` too. */
export function createCutaway(meshes: Pick<LevelMeshes, 'root' | 'parts'>, options: CutawayOptions = {}): Cutaway {
  const entries: Entry[] = meshes.parts
    .filter((part): part is Entry['part'] => (part.mesh as InstancedMesh).isInstancedMesh && part.cells.length > 0)
    .map((part) => {
      const none = part.cells.map(() => false);
      if (!part.cut) return { part, twin: null, cuts: none, fades: none };
      const twin = new InstancedMesh(part.cut.geometry(), part.mesh.material, instanceSlots(part.cells.length));
      twin.name = `${part.name}:cut`;
      twin.castShadow = part.mesh.castShadow;
      twin.receiveShadow = part.mesh.receiveShadow;
      Object.assign(twin.userData, part.mesh.userData, { cut: part.cut.height });
      placeInstances(twin, []);
      (part.mesh.parent ?? meshes.root).add(twin);
      return { part, twin, cuts: none, fades: none };
    });
  const cutting = entries.filter((entry) => entry.twin !== null);
  const targets: CutTarget[] = cutting.map(({ part }) => ({ ...part, when: part.cut!.when }));
  const boxes = new WeakMap<Object3D, Box3>();
  const hidden = new Set<Object3D>();
  const registrations = new Set<{ dispose(): void }>();
  const report = (changed: boolean): CutawayReport => ({
    changed,
    parts: cutting.map(({ part, cuts }) => ({ name: part.name, cut: cuts.filter(Boolean).length, of: cuts.length })),
    faded: {
      parts: Object.fromEntries(entries.filter((e) => e.fades.some(Boolean)).map((e) => [e.part.name, e.fades.filter(Boolean).length])), // prettier-ignore
      objects: [...hidden].map((object) => object.name),
    },
  });
  /** Places `entry`'s pieces: the part holds the whole ones, the twin the cut ones, and neither the faded. */
  const place = (entry: Entry) => {
    const { cells } = entry.part;
    placeInstances(
      entry.part.mesh,
      cells.filter((_, j) => !entry.cuts[j] && !entry.fades[j]),
    );
    if (entry.twin)
      placeInstances(
        entry.twin,
        cells.filter((_, j) => entry.cuts[j] && !entry.fades[j]),
      );
  };
  const apply = (
    cuts: readonly (readonly boolean[])[],
    fades: readonly (readonly boolean[])[],
    hide: ReadonlySet<Object3D>,
  ) => {
    // prettier-ignore
    let changed = false;
    entries.forEach((entry, i) => {
      const cut = entry.twin ? cuts[cutting.indexOf(entry)] : entry.cuts;
      const fade = fades[i].map((faded, j) => faded && !cut[j]); // a cut piece stays as cut
      if (cut.every((c, j) => c === entry.cuts[j]) && fade.every((f, j) => f === entry.fades[j])) return;
      changed = true;
      [entry.cuts, entry.fades] = [[...cut], fade];
      place(entry);
    });
    for (const object of [...hidden]) if (!hide.has(object)) [object.visible, changed] = [true, hidden.delete(object)];
    for (const object of hide) if (!hidden.has(object)) [object.visible, changed] = [false, !!hidden.add(object)];
    return report(changed);
  };
  const none = () => entries.map(({ part }) => part.cells.map(() => false));
  const clear = () =>
    apply(
      cutting.map(({ part }) => part.cells.map(() => false)),
      none(),
      new Set(),
    );
  /** The objects standing between `pose` and `focus` (their world boxes, as `planFade` tests a piece's). */
  const blocking = (pose: CameraPose, focus: Vec3): Set<Object3D> => {
    const [x, y, z] = focus;
    const lines = fadeLines(pose, [[x, y + FADE_AIMS.head, z], [x, y + FADE_AIMS.chest, z]]); // prettier-ignore
    const out = new Set<Object3D>();
    for (const object of options.objects?.() ?? []) {
      if (!boxes.has(object)) boxes.set(object, new Box3().setFromObject(object).expandByScalar(-FADE_AIMS.inset));
      const box = boxes.get(object)!;
      if (box.isEmpty()) continue;
      const [min, max]: [Vec3, Vec3] = [
        [box.min.x, box.min.y, box.min.z],
        [box.max.x, box.max.y, box.max.z],
      ];
      if (lines.some(([a, b]) => segmentHitsBox(a, b, min, max))) out.add(object);
    }
    return out;
  };
  return {
    twins: cutting.map(({ twin }) => twin!),
    update(pose, focus = poseTarget(pose), { fade = false } = {}) {
      const cuts = planCutaway(targets, pose, focus);
      if (!fade) return apply(cuts, none(), new Set());
      return apply(
        cuts,
        planFade(
          entries.map(({ part }) => part),
          pose,
          focus,
        ),
        blocking(pose, focus),
      );
    },
    clear,
    cut() {
      return Object.fromEntries(
        cutting.map(({ part, cuts }) => [part.name, part.cells.filter((_, j) => cuts[j]).map((cell) => cell.tiles)]),
      );
    },
    drawCalls(shadowMaps = 0) {
      return cutting.reduce((sum, { part, twin }) => sum + meshDrawCalls(twin!, part.castShadow, shadowMaps), 0);
    },
    register(warmup, id = `${meshes.root.name}:cutaway`) {
      const entry = warmup.register(id, { objects: () => cutting.map(({ twin }) => twin!) });
      const registration = {
        dispose() {
          registrations.delete(registration);
          entry.dispose();
        },
      };
      registrations.add(registration);
      return registration;
    },
    dispose() {
      for (const registration of [...registrations]) registration.dispose();
      clear();
      for (const { twin } of cutting) {
        twin!.removeFromParent();
        twin!.geometry.dispose();
      }
    },
  };
}
