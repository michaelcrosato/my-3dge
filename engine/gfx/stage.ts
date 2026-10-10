/**
 * @file The stage (PLAN.md §6.4's view, §9.0, WP 2.7): a running scene's presentation graph, built from plain data
 * with no GPU, so a page draws it and a headless engine dumps it (`createHeadless({ view: true })`). `createStage`
 * makes a three.js `Scene` with a sky colour, the stage's ground (a textured plane under the level reaching well past
 * it, `stage/ground`), a hemisphere light and one shadow-casting sun fitted to the level, the level's meshes (engine/gfx/level/meshes.ts) and one stand-in per placeable entity.
 *
 * Level meshes: each block descriptor is split into its runs (its merged rectangles), so the ID pass names every
 * wall run on its own (`level:room/wall@0,0-15,0`: tiles from column 0, row 0 to column 15, row 0); a run costs its
 * two draw groups, in colour and in each shadow map. The floor stays one surface.
 *
 * Stand-ins: until actors and props draw themselves (WPs 3.8, 4.5), an entity is drawn as a box when one of its
 * components declares `x` and `z` as numbers in metres (`placeableKinds`: asked of the component entries, never of
 * a name). The first such component in registry order places it: `x`, `y` (the box's bottom, 0 by default) and `z`,
 * `yaw` (rad), `size` (the box's side, m; 0.5 by default) and `material` (an id from the material library;
 * `material:default` otherwise). A stand-in is named `<component>#<id>` and carries `userData.entity`, so the ID pass
 * and the inspector say which entity it is. `capture(entities)` after each sim step keeps the last two places;
 * `draw(alpha)` puts every stand-in `alpha` of the way from the one before to the last (the frame's interpolation,
 * §6.4; the shorter way round for yaw).
 *
 * Warm-up: `register(warmup)` registers the ground, the level meshes and the stand-ins, and adds the stand-ins' looks (side and
 * material) to the shader key, so a stand-in in a new look makes the next frame warm up first instead of stalling.
 *
 * Invariants: presentation only: it reads sim data and never writes it (doctrine: WebGPU only); every object it
 * makes is under `scene`; equal inputs make equal graphs; materials belong to the library and are never disposed here.
 *
 * @example
 * // const stage = createStage({ level: getLevel('level:room'), materials: createMaterialLibrary() });
 * // stage.capture(world.query('mover'));
 * // stage.draw(0.5); // halfway between the last two steps
 * // renderer.render(stage.scene, camera);
 * @see engine/gfx/stage.test.ts
 */
import {
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PlaneGeometry,
  Scene,
  type Material,
  type Object3D,
} from 'three/webgpu';
import type { Log } from '../core/log';
import type { Registry } from '../core/registry';
import type { Field } from '../core/schema';
import type { EntityData } from '../sim/state';
import type { CompiledLevel, MeshDescriptor, TileRect } from '../world/level/types';
import { boxGeometry } from './geometry/box';
import { createLevelMeshes, type LevelMeshes } from './level/meshes';
import type { Warmup } from './warmup';

/** What a stage is made of: the level (none for an empty stage), where materials come from, and its registry. */
export interface StageOptions {
  /** The compiled level to draw, or null. */
  level: CompiledLevel | null;
  /** The materials by id: the page's material library (engine/gfx/materials/library.ts). */
  materials: { get(id: string): Material };
  /** Where the component kinds are declared: which ones place an entity (the shared registry by default). */
  registry: Registry;
  /** Where advice goes. */
  log?: Log;
}

/** Where a stand-in stands and how it looks, read from its entity's placing component. */
export interface StandInPlace {
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  material: string;
}

/** A running scene's presentation graph (see the file comment). */
export interface Stage {
  /** The scene to draw: background, lights, level, stand-ins. */
  readonly scene: Scene;
  /** The level's meshes, or null. */
  readonly level: LevelMeshes | null;
  /** The point a following camera looks at: the level's middle, on the floor. */
  readonly centre: readonly [number, number, number];
  /** The component kinds that place an entity, in registry order. */
  readonly kinds: readonly string[];
  /** The stand-ins, by entity id. */
  readonly standIns: ReadonlyMap<number, Mesh>;
  /** Reads where the entities are after a sim step (keeps the place before for `draw`); adds and removes stand-ins. */
  capture(entities: Iterable<EntityData>): void;
  /** Puts every stand-in `alpha` (0 to 1) of the way from its place a step ago to its last. */
  draw(alpha: number): void;
  /** Registers the level and the stand-ins with `warmup` (see the file comment); `dispose()` undoes it. */
  register(warmup: Pick<Warmup, 'register' | 'keyPart'>): { dispose(): void };
  /** Frees the geometries it made and empties the scene. */
  dispose(): void;
}

/** The sky behind everything (sRGB): what a camera sees above the ground's far edge. */
const SKY = '#2a3140';
/** How far the ground reaches beyond the level on every side, m: past what any view frames at zoom 0.5. */
const GROUND_MARGIN = 60;
/** The ground's material, from the library: textured, so the field round a level is never one flat colour. */
const GROUND_MATERIAL = 'material:stone';

/** A side for a stand-in that declares none, m. */
const DEFAULT_SIZE = 0.5;

/** The component kinds whose entities stand somewhere: they declare `x` and `z` as numbers in metres. */
export function placeableKinds(registry: Registry): string[] {
  if (!registry.kinds().includes('component')) return [];
  const metres = (field: unknown) => {
    const f = field as Field | undefined;
    return f?.type === 'number' && f.unit === 'm';
  };
  return registry
    .list('component')
    .filter((entry) => {
      const fields = entry.fields as Record<string, unknown>;
      return metres(fields.x) && metres(fields.z);
    })
    .map((entry) => entry.id);
}

/** A number field of `data`, or `fallback` when it holds none. */
const numberOf = (data: Record<string, unknown>, key: string, fallback: number) =>
  typeof data[key] === 'number' && Number.isFinite(data[key]) ? (data[key] as number) : fallback;

/** Where `entity` stands, from the first of `kinds` it holds; undefined when it holds none. */
export function placeOf(
  entity: EntityData,
  kinds: readonly string[],
): { kind: string; place: StandInPlace } | undefined {
  for (const kind of kinds) {
    const data = entity[kind] as Record<string, unknown> | undefined;
    if (!data) continue;
    const size = numberOf(data, 'size', DEFAULT_SIZE);
    const place = {
      x: numberOf(data, 'x', 0),
      y: numberOf(data, 'y', 0),
      z: numberOf(data, 'z', 0),
      yaw: numberOf(data, 'yaw', 0),
      size: size > 0 ? size : DEFAULT_SIZE,
      material: typeof data.material === 'string' ? data.material : 'material:default',
    };
    return { kind, place };
  }
  return undefined;
}

/** `rect` holds `piece` whole. */
const holds = (rect: TileRect, piece: TileRect) =>
  piece[0] >= rect[0] && piece[2] <= rect[2] && piece[1] >= rect[1] && piece[3] <= rect[3];

/**
 * The level with each block descriptor split into one descriptor per run (merged rectangle), surfaces whole, and for
 * each descriptor the run it draws (null for one that was not split).
 */
export function splitRuns(level: CompiledLevel): { level: CompiledLevel; runs: (TileRect | null)[] } {
  const runs: (TileRect | null)[] = [];
  const meshes = level.meshes.flatMap((descriptor): MeshDescriptor[] => {
    if (descriptor.top - descriptor.bottom <= 0 || descriptor.rects.length < 2) {
      runs.push(null);
      return [descriptor];
    }
    return descriptor.rects.map((rect) => {
      runs.push(rect);
      return { ...descriptor, pieces: descriptor.pieces.filter((piece) => holds(rect, piece)), rects: [rect] };
    });
  });
  return { level: { ...level, meshes }, runs };
}

/** The shorter way from angle `a` to `b`, `k` of the way. */
function lerpAngle(a: number, b: number, k: number): number {
  const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + turn * k;
}

/** The level's meshes, each run named by its tiles: `level:room/wall@0,0-15,0`. */
function levelMeshes(level: CompiledLevel, options: StageOptions): LevelMeshes {
  const split = splitRuns(level);
  const meshes = createLevelMeshes(split.level, { materials: options.materials, log: options.log });
  split.runs.forEach((run, i) => {
    if (!run) return;
    const [c0, r0, c1, r1] = run;
    meshes.parts[i].mesh.name = `level:${level.name}/${meshes.parts[i].recipe}@${c0},${r0}-${c1},${r1}`;
  });
  return meshes;
}

/** The stage's ground: a plane just under the level's floor reaching `GROUND_MARGIN` past it, UVs in metres. */
function groundMesh(width: number, depth: number, material: Material): Mesh {
  const [w, d] = [width + 2 * GROUND_MARGIN, depth + 2 * GROUND_MARGIN];
  const geometry = new PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(width / 2, -0.02, depth / 2);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  const ground = new Mesh(geometry, material);
  Object.assign(ground, { name: 'stage/ground', receiveShadow: true });
  return ground;
}

/** Builds a stage (see the file comment). */
export function createStage(options: StageOptions): Stage {
  const scene = new Scene();
  scene.name = options.level ? `stage:${options.level.name}` : 'stage';
  scene.background = new Color(SKY);
  const sky = new HemisphereLight('#c8d4ff', '#4a3f30', 1.6);
  sky.name = 'light:sky';
  const sun = new DirectionalLight('#fff0d8', 2.6);
  sun.name = 'light:sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.target.name = 'light:sun/target';
  scene.add(sky, sun, sun.target);

  const { level } = options;
  const [w, d] = level ? [level.cols * level.tile, level.rows * level.tile] : [16, 16];
  const centre = [w / 2, 0, d / 2] as const;
  sun.position.set(centre[0] - w * 0.4, 14, centre[2] - d * 0.6);
  sun.target.position.set(centre[0], 0, centre[2]);
  const half = Math.hypot(w, d) / 2 + 2;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: 60 });
  sun.shadow.camera.updateProjectionMatrix();

  const ground = groundMesh(w, d, options.materials.get(GROUND_MATERIAL));
  scene.add(ground);
  const meshes = level ? levelMeshes(level, options) : null;
  if (meshes) scene.add(meshes.root);
  const actors = new Group();
  actors.name = 'stand-ins';
  scene.add(actors);

  const kinds = placeableKinds(options.registry);
  const geometries = new Map<number, BufferGeometry>();
  const standIns = new Map<number, Mesh>();
  const places = new Map<number, { before: StandInPlace; after: StandInPlace }>();
  const looks = new Set<string>();
  const geometryOf = (size: number) => {
    let geometry = geometries.get(size);
    if (!geometry) geometries.set(size, (geometry = boxGeometry({ width: size, height: size, depth: size })));
    return geometry;
  };

  const stage: Stage = {
    scene,
    level: meshes,
    centre,
    kinds,
    standIns,
    capture(entities) {
      const seen = new Set<number>();
      for (const entity of entities) {
        const placed = placeOf(entity, kinds);
        if (!placed || seen.has(entity.id)) continue;
        seen.add(entity.id);
        const { kind, place } = placed;
        const last = places.get(entity.id);
        places.set(entity.id, { before: last ? last.after : place, after: place });
        let mesh = standIns.get(entity.id);
        const look = `${place.size}|${place.material}`;
        if (!mesh || mesh.userData.look !== look) {
          mesh?.removeFromParent();
          mesh = new Mesh(geometryOf(place.size), options.materials.get(place.material));
          Object.assign(mesh, { name: `${kind}#${entity.id}`, castShadow: true, receiveShadow: true });
          Object.assign(mesh.userData, { entity: entity.id, component: kind, look });
          actors.add(mesh);
          standIns.set(entity.id, mesh);
          looks.add(look);
        }
      }
      for (const [id, mesh] of standIns) {
        if (seen.has(id)) continue;
        mesh.removeFromParent();
        standIns.delete(id);
        places.delete(id);
      }
    },
    draw(alpha) {
      const k = Math.min(1, Math.max(0, alpha));
      for (const [id, mesh] of standIns) {
        const place = places.get(id);
        if (!place) continue;
        const { before: a, after: b } = place;
        mesh.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        mesh.rotation.set(0, lerpAngle(a.yaw, b.yaw, k), 0);
      }
      actors.updateMatrixWorld(true);
    },
    register(warmup) {
      const registrations = [
        warmup.register('stage:ground', { objects: () => [ground] }),
        ...(meshes ? [meshes.register(warmup, 'stage:level')] : []),
        warmup.register('stage:stand-ins', { objects: (): Object3D[] => [...standIns.values()] }),
        warmup.keyPart('stage:stand-ins', () => [...looks].sort().join(';')),
      ];
      return { dispose: () => registrations.forEach((registration) => registration.dispose()) };
    },
    dispose() {
      meshes?.dispose();
      ground.geometry.dispose();
      for (const geometry of geometries.values()) geometry.dispose();
      geometries.clear();
      standIns.clear();
      places.clear();
      scene.clear();
    },
  };
  return stage;
}
