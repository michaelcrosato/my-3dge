/**
 * @file The stage (PLAN.md §6.4's view, §9.0, WP 2.7): a running scene's presentation graph, built from plain data with
 * no GPU, so a page draws it and a headless engine dumps it (`createHeadless({ view: true })`). `createStage` makes a
 * three.js `Scene` with a sky colour, the stage's ground (engine/gfx/stageGround.ts: a textured plane under the level
 * reaching well past it, or a frame round a terrain, `stage/ground`), its lights (`sky`, engine/gfx/stageSky.ts: a
 * hemisphere light and a sun fitted to the level, or the sky a look names), the level's meshes by runs
 * (engine/gfx/level/runs.ts: `level:room/wall@0,0-15,0`, each wall run on its own in the ID pass, with the level's
 * swaps), the terrain's chunks (engine/gfx/terrain.ts, WP 10.5: they stand for the ground, and the sun fits them when
 * there is no level) and one stand-in per placeable entity.
 *
 * Actors with an animator draw themselves as puppets (engine/gfx/puppets/actors.ts, WP 3.10: `actors`), props standing
 * in the scene (`sceneProp`, engine/sim/props.ts) as their props (engine/gfx/stageProps.ts, WP 4.6: `props`), crowd
 * bodies (`crowdBody`) through a crowd (engine/gfx/stageCrowd.ts, WP 5.7: `crowd`), which the view draws once the
 * frame's camera is placed (`crowd.draw(alpha, camera)`), rides as themselves (engine/gfx/stageRides.ts, WP 13.7:
 * `rides`), and projectiles as bolts (engine/gfx/stageFx.ts, WP 6.7: `fx`, with telegraphs, trails and bursts, handed
 * each frame by the view). Stand-ins: any other entity is drawn as a box when one of its components declares `x` and
 * `z` as numbers in metres (`placeableKinds`: asked of the component entries, never of a name). The first such
 * component in registry order places it: `x`, `y` (the box's bottom, 0 by default) and `z`, `yaw` (rad), `size` (the
 * box's side, m; 0.5 by default) and `material` (an id from the material library; `material:default` otherwise). A
 * stand-in is named `<component>#<id>` and carries `userData.entity`, so the ID pass and the inspector say which entity
 * it is. `capture(entities, dt)` after each sim step keeps the last two places; `draw(alpha)` puts every stand-in,
 * puppet and prop `alpha` of the way from the one before to the last (§6.4's interpolation; yaw the shorter way).
 *
 * The level's cutaway (engine/gfx/cutaway.ts, its fade taking the rides too) is made when a player actor first stands
 * on it; the view runs it as it follows the player (`frame`), with the cut by storey in a classic view (storeyCut.ts),
 * and a site's per structure (engine/gfx/stageSite.ts). A stage with no player never has a cutaway.
 *
 * Warm-up: `register(warmup)` registers the ground, the level meshes, the terrain's every level of detail, the
 * cutaway's twins, the puppets, the props' and the crowd's batches and the stand-ins, and adds the stand-ins' looks
 * (side and material), the puppets' builds, the crowd's looks and whether there are a cutaway and props to the shader
 * key, so a new look makes the next frame warm up first instead of stalling.
 *
 * Invariants: presentation only: it reads sim data and never writes it (doctrine: WebGPU only); every object it makes
 * is under `scene`; equal inputs make equal graphs; materials belong to the library and are never disposed here.
 * @example
 * // const stage = createStage({ level: getLevel('level:room'), materials: createMaterialLibrary() });
 * // stage.capture(world.query('mover'));
 * // stage.draw(0.5); // halfway between the last two steps; then renderer.render(stage.scene, camera)
 * @see engine/gfx/stage.test.ts
 */
import { BufferGeometry, Color, Group, Mesh, Scene, type Material, type Object3D } from 'three/webgpu';
import type { Log } from '../core/log';
import type { Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { Field } from '../core/schema';
import type { QueryView } from '../sim/queryView';
import type { EntityData } from '../sim/state';
import type { CompiledLevel } from '../world/level/types';
import type { Site } from '../world/site';
import type { Terrain } from '../world/terrain';
import type { CameraPose, Vec3 } from './cameras/pose';
import { createCutaway, type Cutaway } from './cutaway';
import { boxGeometry } from './geometry/box';
import type { LevelMeshes } from './level/meshes';
import type { LevelRecipe } from './level/recipes';
import { runMeshes } from './level/runs';
import { createActorPuppets, type ActorPuppets } from './puppets/actors';
import { createStageCrowd, type StageCrowd } from './stageCrowd';
import { createStageFx, type StageFx } from './stageFx';
import { createStageProps, type StageProps } from './stageProps';
import { createStageRides, RIDE_KINDS, type StageRides } from './stageRides';
import { createStageSite, type StageSite } from './stageSite';
import { groundMesh } from './stageGround';
import { createStageSky, type StageSky } from './stageSky';
import { createStoreyCut, cutPlace } from './storeyCut';
import { createTerrainMeshes, type TerrainMeshes } from './terrain';
import type { Warmup } from './warmup';

/** What a stage is made of: the level (none for an empty stage), where materials come from, and its registry. */
export interface StageOptions {
  /** The compiled level to draw, or null. */
  level: CompiledLevel | null;
  /** The terrain to draw (WP 10.5), or none. */
  terrain?: Terrain | null;
  /** The site to draw (WP 13.15: its structures, and its terrain with the cut), or none. */
  site?: Site | null;
  /** The materials by id: the page's material library (engine/gfx/materials/library.ts). */
  materials: { get(id: string): Material };
  /** Where the component kinds are declared: which ones place an entity (the shared registry by default). */
  registry: Registry;
  /** Where advice goes. */
  log?: Log;
  /** The effects' visual streams: the sim world's (`(...keys) => world.fxRng(...keys)`). */
  fxRng?: (...keys: readonly (string | number)[]) => Rng;
  /** Material swaps for the level's meshes alone: an id its recipes name → the material drawn instead (WP 7.8). */
  levelMaterials?: Readonly<Record<string, string>>;
  /** A level written as storeys: each room's floor material, by room name (WP 13.14; the level entry's `rooms`). */
  levelRooms?: Readonly<Record<string, string>>;
  /** The level's own recipes (WP 13.18; the level entry's `recipes`); a site's structures read their entries'. */
  levelRecipes?: Readonly<Record<string, LevelRecipe>>;
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
  /** The terrain's chunks, or null. */
  readonly terrain: TerrainMeshes | null;
  /** The site's structures and terrain (engine/gfx/stageSite.ts), or null. */
  readonly site: StageSite | null;
  /** Its lights: its own, or the sky a look names (engine/gfx/stageSky.ts). */
  readonly sky: StageSky;
  /** The level's cutaway, made when a player first stands on it; null until then (see the file comment). */
  readonly cutaway: Cutaway | null;
  /** The point a following camera looks at: the level's middle, on the floor. */
  readonly centre: readonly [number, number, number];
  /** The component kinds it reads: those that place an entity, in registry order, then the effects', then the rides'. */
  readonly kinds: readonly string[];
  /** The stand-ins, by entity id. */
  readonly standIns: ReadonlyMap<number, Mesh>;
  /** The actors drawn as puppets, and the player among them. */
  readonly actors: ActorPuppets;
  /** The props standing in the scene, drawn as their props. */
  readonly props: StageProps;
  /** The rides: ziplines, ladders and launchers (engine/gfx/stageRides.ts). */
  readonly rides: StageRides;
  /** The crowd bodies, drawn through a crowd from the frame's camera (`crowd.draw(alpha, camera)`, after `draw`). */
  readonly crowd: StageCrowd;
  /**
   * The effects: bolts, telegraphs, trails and the events' bursts (engine/gfx/stageFx.ts); the view hands it frames.
   * Turned off, they claim no bolt, so bolts draw as stand-ins.
   */
  readonly fx: StageFx;
  /**
   * Reads where the entities are after a sim step of `dt` s (keeps the place before for `draw`); adds and removes. The
   * sim's read-only `queries` give the puppets' feet the ground (none without physics).
   */
  capture(entities: Iterable<EntityData>, dt?: number, queries?: QueryView | null): void;
  /** Puts every stand-in and puppet `alpha` (0 to 1) of the way from its place a step ago to its last. */
  draw(alpha: number): void;
  /** Runs the cutaways for `pose` and the player's `feet`: the fade with `fade`, the cut by storey in a classic `view`. */
  frame(pose: CameraPose, feet: Vec3, options?: { fade?: boolean; view?: boolean }): void;
  /** Registers the level and the stand-ins with `warmup` (see the file comment); `dispose()` undoes it. */
  register(warmup: Pick<Warmup, 'register' | 'keyPart'>): { dispose(): void };
  /** Frees the geometries it made and empties the scene. */
  dispose(): void;
}

/** The sky behind everything (sRGB): what a camera sees above the ground's far edge. */
const SKY = '#2a3140';
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

/** The shorter way from angle `a` to `b`, `k` of the way. */
function lerpAngle(a: number, b: number, k: number): number {
  const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + turn * k;
}

/** Builds a stage (see the file comment). */
export function createStage(options: StageOptions): Stage {
  const scene = new Scene();
  scene.name = options.level ? `stage:${options.level.name}` : 'stage';
  scene.background = new Color(SKY);
  const { level, site: placed = null } = options;
  const land = options.terrain ?? placed?.terrain ?? null;
  // Without a level, a terrain is the ground: its area places the sun and the stage's ground, at its origin's height.
  const area = !level && land ? { corner: [land.origin[0], land.origin[2]] as const, size: [land.cols * land.cell, land.rows * land.cell] as const } : undefined; // prettier-ignore
  const lights = createStageSky(scene, {
    level,
    area,
    registry: options.registry,
    background: SKY,
    rng: () => options.fxRng?.('stage', 'lights'),
  });
  const [w, d] = level ? [level.cols * level.tile, level.rows * level.tile] : (area?.size ?? [16, 16]);
  const [x0, z0] = area?.corner ?? [0, 0];
  const centre = [x0 + w / 2, 0, z0 + d / 2] as const;

  // Under a level written as storeys, under its lowest slab; round a terrain, a frame the terrain fills (stageGround.ts).
  const y = level?.storeys ? level.bounds.min[1] : area ? land!.origin[1] : 0;
  const ground = groundMesh([w, d], options.materials.get(GROUND_MATERIAL), { corner: [x0, z0], y, hole: !!area });
  scene.add(ground);
  const meshes = level ? runMeshes(level, options) : null;
  if (meshes) scene.add(meshes.root);
  const site = placed ? createStageSite(placed, { materials: options.materials, registry: options.registry, log: options.log }) : null; // prettier-ignore
  if (site) scene.add(site.root);
  const terrain = site ? site.terrain : land ? createTerrainMeshes(land, { materials: options.materials }) : null;
  if (terrain && !site) scene.add(terrain.root);
  let cutaway: Cutaway | null = null;
  const storeys = meshes && level?.storeys ? createStoreyCut(meshes) : null;
  const boxes = new Group();
  boxes.name = 'stand-ins';
  const actors = createActorPuppets({ materials: options.materials, registry: options.registry });
  scene.add(boxes, actors.root);
  const props = createStageProps({ scene, materials: options.materials, registry: options.registry });
  const rides = createStageRides({ scene, materials: options.materials });
  const crowd = createStageCrowd({ scene, materials: options.materials, level, registry: options.registry });

  const fx = createStageFx({
    registry: options.registry,
    trails: () => actors.trails(),
    ...(options.fxRng ? { fxRng: options.fxRng } : {}),
  });
  scene.add(fx.effects.root);
  const standing = placeableKinds(options.registry);
  const declared = (kind: string) => options.registry.kinds().includes('component') && options.registry.has('component', kind); // prettier-ignore
  const rideKinds = RIDE_KINDS.filter((kind) => declared(kind) && !standing.includes(kind)); // they stand by their anchors
  const kinds = [...standing, ...fx.kinds.filter((kind) => !standing.includes(kind)), ...rideKinds];
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
    terrain,
    site,
    sky: lights,
    get cutaway() {
      return cutaway;
    },
    centre,
    kinds,
    standIns,
    actors,
    props,
    rides,
    crowd,
    fx,
    capture(entities, dt, queries) {
      const list = [...entities];
      const seen = new Set<number>();
      const puppets = actors.capture(list, dt, queries);
      const drawn = props.capture(list, dt);
      const crowded = crowd.capture(list, dt);
      rides.capture(list);
      const bolts = fx.capture(list);
      if (meshes && !cutaway && actors.hasPlayer()) cutaway = createCutaway(meshes, { objects: () => rides.root.children }); // prettier-ignore
      if (actors.hasPlayer()) site?.follow(() => rides.root.children);
      for (const entity of list) {
        const placed = placeOf(entity, standing);
        const other = puppets.has(entity.id) || drawn.has(entity.id) || crowded.has(entity.id) || bolts.has(entity.id);
        if (!placed || seen.has(entity.id) || other) continue;
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
          boxes.add(mesh);
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
      boxes.updateMatrixWorld(true);
      actors.draw(alpha);
      props.draw(alpha);
      fx.draw(alpha);
    },
    frame(pose, feet, { fade = false, view = false } = {}) {
      cutaway?.update(pose, feet, { fade });
      const place = view && level && storeys ? cutPlace(level, ...feet) : null;
      storeys?.set(place?.storey ?? -1, place?.indoors ?? false);
      site?.update(pose, feet, { fade, view });
    },
    register(warmup) {
      const registrations = [
        warmup.register('stage:ground', { objects: () => [ground] }),
        ...(meshes ? [meshes.register(warmup, 'stage:level')] : []),
        ...(terrain && !site ? [terrain.register(warmup, 'stage:terrain')] : []),
        ...(site ? [site.register(warmup)] : []),
        warmup.register('stage:cutaway', { objects: (): Object3D[] => [...(cutaway?.twins ?? [])] }),
        warmup.keyPart('stage:cutaway', () => (cutaway || site?.structures.some((each) => each.cutaway) ? 'cut' : '')),
        warmup.register('stage:stand-ins', { objects: (): Object3D[] => [...standIns.values()] }),
        warmup.keyPart('stage:stand-ins', () => [...looks].sort().join(';')),
        actors.register(warmup),
        props.register(warmup),
        rides.register(warmup),
        crowd.register(warmup),
        fx.register(warmup),
        lights.register(warmup),
      ];
      return { dispose: () => registrations.forEach((registration) => registration.dispose()) };
    },
    dispose() {
      cutaway?.dispose();
      cutaway = null;
      meshes?.dispose();
      if (site) site.dispose();
      else terrain?.dispose();
      actors.dispose();
      props.dispose();
      rides.dispose();
      crowd.dispose();
      fx.dispose();
      lights.dispose();
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
