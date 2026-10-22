/**
 * @file Unit tests for the cutaway (engine/gfx/cutaway.ts), in Node on the hall (labs/box/levels/hall.txt) with the
 * engine's own cameras: which walls and pillars cut for a given camera pose. The iso view from the south-east cuts
 * the south and east walls (105 tiles: every one but the north-east and south-west corners, which face across the
 * view) and stumps the pillar between it and the hero; turned 180° it cuts the north and west walls; from straight
 * above, from inside the hall and for a camera the walls face away from, it cuts none; a perspective camera outside
 * the south wall cuts the south walls round it; the height boost decides in the picture's heights. Then the meshes:
 * the twins, pieces moving between a part and its twin, the draw calls, `clear`, the warm-up and `dispose`. The fade
 * (WP 13.8): the pieces a line to the hero's head or chest crosses, and the objects, leave the picture with `fade` and
 * come back without. `either` (WP 13.18): a piece facing the camera, or between it and the focus. The GPU half (0 pipelines while the camera turns, the draw-call budget) is
 * tests/e2e/hall.spec.ts.
 * @see engine/gfx/cutaway.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type InstancedMesh, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { compileLevel } from '../world/level/compile';
import { createCamera } from './cameras/place';
import { makePose, type CameraPose, type Vec3 } from './cameras/pose';
import { CUT_AIMS, FADE_AIMS, FADE_THIN, createCutaway, cutawayAims, planCutaway, planFade, segmentHitsBox, type CutTarget } from './cutaway'; // prettier-ignore
import { instancePath } from './instancing';
import { createLevelMeshes } from './level/meshes';
import type { Warmup } from './warmup';

const ROOT = join(import.meta.dirname, '..', '..');
const hall = compileLevel(readFileSync(join(ROOT, 'labs', 'box', 'levels', 'hall.txt'), 'utf8'), { file: 'hall.txt' });
const hero = hall.spawns.find((spawn) => spawn.id === 'spawn:hero')!.position;

/** The hall's meshes with one stand-in material, and their cutaway. */
function build() {
  const material = new MeshBasicMaterial();
  const meshes = createLevelMeshes(hall, { materials: { get: () => material } });
  return { meshes, cutaway: createCutaway(meshes) };
}

/** A view camera's pose (a camera code), following the hero. */
const view = (code: string): CameraPose => createCamera(code).update({ follow: hero });

/** Tiles as `col,row` text, sorted, for comparing sets. */
const keys = (tiles: readonly (readonly number[])[]) => tiles.map(([c, r]) => `${c},${r}`).sort();

/** The wall tiles of the hall on its south row and east column (south-east view), corners as the rule says. */
function wallTiles(test: (col: number, row: number) => boolean): string[] {
  const out: number[][] = [];
  for (let row = 0; row < hall.rows; row++) {
    for (let col = 0; col < hall.cols; col++)
      if (hall.tiles[row * hall.cols + col] === '#' && test(col, row)) out.push([col, row]);
  }
  return keys(out);
}

describe('planCutaway on the hall', () => {
  const { cutaway } = build();

  it('the iso view from the south-east cuts the south and east walls and stumps the pillar beside the hero', () => {
    const pose = view('cam=iso');
    expect(pose.projection).toBe('orthographic');
    cutaway.update(pose, hero);
    const cut = cutaway.cut();
    const [south, east] = [hall.rows - 1, hall.cols - 1];
    // Walls whose outward direction is within 72.5° of the way back to the camera (cos > 0.3): south (0, 1) and east
    // (1, 0) at 45° both; the south-west and north-east corners face across the view (90°), the south-east one at it.
    const expected = wallTiles((col, row) => (row === south && col > 0) || (col === east && row > 0));
    expect(keys(cut['level:hall/wall'])).toEqual(expected);
    expect(expected.length).toBe(105);
    // From the floor 2.5 m east of the hero (35, 24.5) back toward the camera, the line of sight rises tan 30° per
    // metre: it crosses the pillar at columns 37–38, rows 27–28 (widened by 0.25 m) about 1.8 m up, below its 3.5 m.
    expect(keys(cut['level:hall/pillar'])).toContain('37,27');
    for (const [col, row] of cut['level:hall/pillar']) {
      // Every stump stands between the hero and the camera: south-east of him.
      expect(col + 1 - hero[0] + (row + 1 - hero[2]), `${col},${row}`).toBeGreaterThan(0);
    }
  });

  it('turned 180°, it cuts the north and west walls instead', () => {
    cutaway.update(view('cam=iso,180,1'), hero);
    const cut = cutaway.cut();
    expect(keys(cut['level:hall/wall'])).toEqual(
      wallTiles((col, row) => (row === 0 && col < hall.cols - 1) || (col === 0 && row < hall.rows - 1)),
    );
    expect(cut['level:hall/pillar'].every(([col, row]) => col + 1 - hero[0] + (row + 1 - hero[2]) < 0)).toBe(true);
  });

  it('cuts no wall from straight above, from inside the hall, or for a camera the walls face away from', () => {
    const above = makePose({
      position: [32, 60, 22],
      yaw: 0,
      pitch: -88 * (Math.PI / 180),
      projection: 'orthographic',
    });
    cutaway.update(above, hero);
    expect(cutaway.cut()['level:hall/wall']).toEqual([]);
    // A chase camera behind the hero, inside the hall.
    const inside = makePose({ position: [hero[0], 3, hero[2] + 5], yaw: Math.PI, pitch: -0.3 });
    cutaway.update(inside, hero);
    expect(cutaway.cut()['level:hall/wall']).toEqual([]);
  });

  it('a perspective camera outside the south wall cuts the south walls before it, not those far off to the side', () => {
    const outside = makePose({ position: [32, 8, 50], yaw: Math.PI, pitch: -0.4 });
    cutaway.update(outside, hero);
    const walls = cutaway.cut()['level:hall/wall'];
    expect(walls.length).toBeGreaterThan(30);
    expect(walls.every(([, row]) => row === hall.rows - 1)).toBe(true);
    // (5, 43): 27 m west and 6.5 m south of the camera's foot: the way to the camera leans 76° off the wall's out.
    expect(keys(walls)).toContain('32,43');
    expect(keys(walls)).not.toContain('5,43');
  });

  it('aims at the head and feet, and at the floor round the hero unless it looks down 60° or more', () => {
    expect(cutawayAims([1, 0, 2], -0.5)).toEqual([
      [1, CUT_AIMS.head, 2],
      [1, CUT_AIMS.feet, 2],
      [1 + CUT_AIMS.around, CUT_AIMS.feet, 2],
      [1 - CUT_AIMS.around, CUT_AIMS.feet, 2],
      [1, CUT_AIMS.feet, 2 + CUT_AIMS.around],
      [1, CUT_AIMS.feet, 2 - CUT_AIMS.around],
    ]);
    expect(cutawayAims([1, 0, 2], -Math.PI / 3)).toHaveLength(2);
  });

  it("decides in the picture's heights: a boosted view sees over less", () => {
    // A 5 m pillar 4 m north of the focus, an orthographic camera to the north looking down 60° (so only the head and
    // feet are aimed at). From the feet (0.125 m) the line rises tan 60° · 3.25 m = 5.63 m to the pillar's near face:
    // 5.76 m, over its top. Boosted by 1.35, the feet are 0.17 m and the top 6.75 m in the picture: 5.80 m < 6.75 m.
    const pillar: CutTarget = {
      when: 'blocking',
      bottom: 0,
      top: 5,
      cells: [{ centre: [0, 0, -4], size: [1, 1], out: [0, -1] }],
    };
    const pitch = -Math.PI / 3;
    const plan = (boost: number) =>
      planCutaway(
        [pillar],
        makePose({ position: [0, 52, -30], yaw: 0, pitch, projection: 'orthographic', boost }),
        [0, 0, 0],
      );
    expect(plan(1)).toEqual([[false]]);
    expect(plan(1.35)).toEqual([[true]]);
  });

  it('cuts a piece under `either` when it faces the camera or stands between it and the focus (WP 13.18)', () => {
    // A wall 4 m north of the focus facing north (away from a camera to the south), then one facing the camera.
    const wall = (when: CutTarget['when'], out: [number, number]): CutTarget => ({ when, bottom: 0, top: 3, cells: [{ centre: [0, 0, -4], size: [1, 1], out }] }); // prettier-ignore
    const pose = makePose({ position: [0, 30, -60], yaw: 0, pitch: -Math.PI / 6, projection: 'orthographic' }); // north of it, looking south
    const plan = (when: CutTarget['when'], out: [number, number]) => planCutaway([wall(when, out)], pose, [0, 0, 0])[0][0]; // prettier-ignore
    expect([plan('facing', [0, 1]), plan('blocking', [0, 1]), plan('either', [0, 1])]).toEqual([false, true, true]); // between them, facing away
    expect([plan('either', [0, -1]), plan('facing', [0, -1])]).toEqual([true, true]); // facing the camera
  });

  it('tests a segment against a box by slabs, as the prototype did', () => {
    const min: Vec3 = [0, 0, 0];
    const max: Vec3 = [1, 1, 1];
    expect(segmentHitsBox([-1, 0.5, 0.5], [2, 0.5, 0.5], min, max)).toBe(true);
    expect(segmentHitsBox([-1, 1.5, 0.5], [2, 1.5, 0.5], min, max)).toBe(false);
    expect(segmentHitsBox([-1, 0.5, 0.5], [-0.1, 0.5, 0.5], min, max)).toBe(false);
    expect(segmentHitsBox([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], min, max)).toBe(true);
  });
});

describe('createCutaway', () => {
  it('gives each cutting part a twin and moves pieces between them, costing draw calls only while they have pieces', () => {
    const { meshes, cutaway } = build();
    expect(cutaway.twins.map((twin) => [twin.name, twin.parent?.name, twin.count])).toEqual([
      ['level:hall/pillar:cut', 'level:hall', 0],
      ['level:hall/wall:cut', 'level:hall', 0],
    ]);
    const [pillarTwin, wallTwin] = cutaway.twins;
    // The twins: a stump of plinth and shaft foot (0.875 m), a wall cut to 0.4375 m.
    wallTwin.geometry.computeBoundingBox();
    pillarTwin.geometry.computeBoundingBox();
    expect(wallTwin.geometry.boundingBox!.max.toArray()).toEqual([0.5, 0.4375, 0.5]);
    expect(pillarTwin.geometry.boundingBox!.max.toArray()).toEqual([1.0625, 0.875, 1.0625]);
    expect(wallTwin.userData).toMatchObject({ level: 'hall', recipe: 'wall', cut: 0.4375 });
    // A page's slots, as its part has, so the twins share their shader (engine/gfx/level/shapes.ts).
    expect(cutaway.twins.map((twin) => instancePath(twin.instanceMatrix.count))).toEqual(['attribute', 'attribute']);
    expect(cutaway.drawCalls(1)).toBe(0);

    const wall = meshes.parts.find((part) => part.recipe === 'wall')!.mesh as InstancedMesh;
    const first = cutaway.update(view('cam=iso'), hero);
    expect(first.changed).toBe(true);
    const walls = first.parts.find((part) => part.name === 'level:hall/wall')!;
    expect(walls).toEqual({ name: 'level:hall/wall', cut: 105, of: 212 });
    expect([wall.count, wallTwin.count]).toEqual([212 - 105, 105]);
    expect(pillarTwin.count).toBeGreaterThan(0);
    // Each twin with pieces: two groups, in colour and into one shadow map.
    expect(cutaway.drawCalls(1)).toBe(8);
    expect(meshes.drawCalls(1)).toBe(24);
    // A cut wall stands where its tile is: the south-east corner, at (63.5, 0, 43.5), is among the twin's.
    const at = new Set<string>();
    for (let i = 0; i < wallTwin.count; i++) {
      const matrix = wallTwin.instanceMatrix.array.slice(i * 16 + 12, i * 16 + 15);
      at.add(Array.from(matrix).join(','));
    }
    expect(at.has('63.5,0,43.5')).toBe(true);
    wallTwin.computeBoundingBox();
    expect([wallTwin.boundingBox!.min.toArray(), wallTwin.boundingBox!.max.toArray()]).toEqual([
      [1, 0, 1],
      [64, 0.4375, 44],
    ]);

    expect(cutaway.update(view('cam=iso'), hero).changed).toBe(false);
    const cleared = cutaway.clear();
    expect([cleared.changed, wall.count, wallTwin.count, cutaway.drawCalls(1)]).toEqual([true, 212, 0, 0]);
  });

  it('registers the twins with the warm-up; dispose puts every piece back and removes the twins', () => {
    const { meshes, cutaway } = build();
    const entries = new Map<string, () => readonly Object3D[]>();
    const warmup = {
      register: (id: string, entry: { objects(): readonly Object3D[] }) => {
        entries.set(id, entry.objects);
        return { dispose: () => void entries.delete(id) };
      },
    } as unknown as Warmup;
    cutaway.register(warmup);
    expect(entries.get('level:hall:cutaway')!().map((object) => object.name)).toEqual([
      'level:hall/pillar:cut',
      'level:hall/wall:cut',
    ]);
    cutaway.update(view('cam=iso'), hero);
    const disposed: string[] = [];
    for (const twin of cutaway.twins) twin.geometry.addEventListener('dispose', () => disposed.push(twin.name));
    cutaway.dispose();
    expect(entries.size).toBe(0);
    expect(disposed).toEqual(['level:hall/pillar:cut', 'level:hall/wall:cut']);
    expect(meshes.root.children.map((child) => child.name)).not.toContain('level:hall/wall:cut');
    expect(meshes.parts.map((part) => (part.mesh as InstancedMesh).count ?? 1)).toEqual(
      meshes.parts.map((part) => (part.cells.length ? part.cells.length : 1)),
    );
  });

  it('defaults the focus to the pose’s target, and leaves a level without cutting parts alone', () => {
    const { cutaway } = build();
    const pose = view('cam=iso');
    expect(cutaway.update(pose).parts.find((part) => part.name === 'level:hall/wall')!.cut).toBe(105);
    const material = new MeshBasicMaterial();
    const open = compileLevel('.....\n.@...\n.....\n', { file: 'open.txt' });
    const none = createCutaway(createLevelMeshes(open, { materials: { get: () => material } }));
    expect([none.twins.length, none.update(pose).changed, none.drawCalls(1)]).toEqual([0, false, 0]);
  });
});

describe('the occluder fade', () => {
  /** An open floor with the hero's spawn and one low wall piece, 0.75 m high at (3.5, 3.5). */
  function low() {
    const material = new MeshBasicMaterial();
    const level = compileLevel('.......\n.@.....\n.......\n...w...\n.......\n.......\n', { file: 'low.txt' });
    const meshes = createLevelMeshes(level, { materials: { get: () => material } });
    const wall = meshes.parts.find((part) => part.cells.length === 1)!;
    return { meshes, wall: wall.mesh as InstancedMesh, name: wall.name };
  }
  const focus: Vec3 = [1.5, 0, 1.5];
  const below = makePose({ position: [5.5, 0.2, 5.5], yaw: -0.75 * Math.PI, pitch: 0 }); // the wall between, low

  it('plans the pieces a line to the head or the chest crosses, inside their box by its inset', () => {
    const cell = { centre: [3.5, 0, 3.5], size: [1, 1], out: [0, 0] } as unknown as CutTarget['cells'][number];
    const target = { cells: [cell], bottom: 0, top: 0.75 };
    expect(planFade([target], below, focus)).toEqual([[true]]);
    expect(planFade([target], makePose({ position: [5.5, 3, 5.5], yaw: -0.75 * Math.PI }), focus)).toEqual([[false]]); // over it
    expect(planFade([{ ...target, top: 0.5 }], below, focus)).toEqual([[false]]); // the line passes above a lower piece
    expect(FADE_AIMS.head).toBeGreaterThan(FADE_AIMS.chest);
  });

  it('takes a piece and an object’s mesh out of the picture with fade, never a thin one, and puts them back without', () => {
    const { meshes, wall, name } = low();
    const ride = new Group();
    const pad = new Mesh(new BoxGeometry(1, 1, 1));
    const pole = new Mesh(new BoxGeometry(FADE_THIN - 0.05, 3, FADE_THIN - 0.05)); // on the same line: too thin to hide him
    pad.position.set(4.5, 1, 4.5);
    pole.position.set(4.5, 1.5, 4.5);
    [pad.name, pole.name] = ['pad', 'pole'];
    ride.add(pad, pole);
    ride.updateMatrixWorld(true);
    const cutaway = createCutaway(meshes, { objects: () => [ride] });
    expect(cutaway.update(below, focus).faded).toEqual({ parts: {}, objects: [] }); // no fade asked
    const faded = cutaway.update(below, focus, { fade: true });
    expect(faded).toMatchObject({ changed: true, faded: { parts: { [name]: 1 }, objects: ['pad'] } });
    expect([wall.count, pad.visible, pole.visible]).toEqual([0, false, true]);
    expect(cutaway.update(below, focus, { fade: true }).changed).toBe(false);
    cutaway.update(below, focus);
    expect([wall.count, pad.visible]).toEqual([1, true]);
  });
});
