/**
 * @file A site drawn (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3): `createStageSite(site, options)` draws each of a
 * site's structures, its level's meshes by runs (engine/gfx/level/runs.ts) in its level entry's looks (`registry`'s:
 * its swaps, rooms' floors and recipes), in a group standing at the structure's `at`, turned its quarter turns about
 * +Y as its bodies are (engine/world/site.ts), and the site's terrain with its cut left out (engine/gfx/terrain.ts). Each structure has its cutaway (engine/gfx/cutaway.ts, made once a player
 * stands on the stage: `follow`) and its cutaway by storey (engine/gfx/storeyCut.ts), both run in its own frame:
 * `update(pose, feet, { fade, view })` carries the camera's pose and the player's feet into each structure's frame
 * (`toLocal`, the yaw less its turns), cuts and fades there, and in a classic view (`view`) hides, in the structure
 * the player stands in, the storeys above the player's and the roof while indoors (`cutPlace`): the others stay whole.
 * The objects `follow` hands it (the stage's rides) stand in the world, so they fade once, in the world's frame.
 *
 * Names: a structure's group `site:<site>/<index>` holding its level's meshes (`level:<name>/…`, so the ID pass shows
 * which building and storey a pixel is), the terrain's chunks `terrain:<name>/…`.
 *
 * Invariants: presentation only, never read by the sim; equal sites give equal graphs; `register(warmup)` registers
 * every structure's meshes, the cutaways' twins and the terrain's levels; `dispose` frees what it made.
 *
 * @example
 * // const drawn = createStageSite(getSite('site:block'), { materials, registry });
 * // scene.add(drawn.root);
 * // each frame, once a player stands: drawn.follow(); drawn.update(camera.pose(), player.feet, { fade, view });
 * @see engine/gfx/stageSite.test.ts
 */
import { Group, type Material, type Object3D } from 'three/webgpu';
import type { Log } from '../core/log';
import type { Registry } from '../core/registry';
import { toLocal, type Site, type SiteStructure } from '../world/site';
import type { CameraPose, Vec3 } from './cameras/pose';
import { createCutaway, type Cutaway } from './cutaway';
import type { LevelMeshes } from './level/meshes';
import { levelLooks, runMeshes } from './level/runs';
import { createStoreyCut, cutPlace, type StoreyCut } from './storeyCut';
import { createTerrainMeshes, type TerrainMeshes } from './terrain';
import type { Warmup } from './warmup';

/** One structure as drawn: its group in the world, its meshes in its own frame, its cutaways. */
export interface StageStructure {
  readonly structure: SiteStructure;
  readonly group: Group;
  readonly meshes: LevelMeshes;
  readonly storeys: StoreyCut;
  readonly cutaway: Cutaway | null;
}

/** A site as the stage draws it (see the file comment). */
export interface StageSite {
  readonly root: Group;
  readonly structures: readonly StageStructure[];
  readonly terrain: TerrainMeshes | null;
  /** Makes the structures' cutaways (their fades taking `objects` too), once: when a player first stands. */
  follow(objects?: () => readonly Object3D[]): void;
  /** Cuts, fades and hides storeys for `pose` and the player's `feet` (see the file comment). */
  update(pose: CameraPose, feet: Vec3, options?: { fade?: boolean; view?: boolean }): void;
  /** The structure and storey `feet` stand on, and whether indoors (`cutPlace` in its frame); null outside them all. */
  where(feet: Vec3): { structure: SiteStructure; storey: number; indoors: boolean } | null;
  register(warmup: Pick<Warmup, 'register'>): { dispose(): void };
  dispose(): void;
}

/** `pose` in structure `s`'s frame: its position carried by `toLocal`, its yaw less the structure's turns. */
function localPose(s: SiteStructure, pose: CameraPose): CameraPose {
  const [x, z] = toLocal(s, pose.position[0], pose.position[2]);
  return { ...pose, position: [x, pose.position[1] - s.at[1], z], yaw: pose.yaw - (s.turn * Math.PI) / 2 };
}

/** `feet` in structure `s`'s frame. */
function localFeet(s: SiteStructure, [x, y, z]: Vec3): Vec3 {
  const [lx, lz] = toLocal(s, x, z);
  return [lx, y - s.at[1], lz];
}

/** Draws `site` (see the file comment). */
export function createStageSite(
  site: Site,
  options: { materials: { get(id: string): Material }; registry?: Registry; log?: Log },
): StageSite {
  const root = new Group();
  root.name = `site:${site.name}`;
  const terrain = site.terrain ? createTerrainMeshes(site.terrain, { materials: options.materials, cut: site.cut }) : null; // prettier-ignore
  if (terrain) root.add(terrain.root);
  const drawn = site.structures.map((structure) => {
    const group = new Group();
    group.name = `${root.name}/${structure.index}`;
    group.position.set(...structure.at);
    group.rotation.y = (structure.turn * Math.PI) / 2;
    const looks = options.registry ? levelLooks(options.registry, `level:${structure.name}`) : {};
    const meshes = runMeshes(structure.level, { materials: options.materials, log: options.log, ...looks });
    group.add(meshes.root);
    root.add(group);
    return { structure, group, meshes, storeys: createStoreyCut(meshes), cutaway: null as Cutaway | null };
  });
  root.updateMatrixWorld(true);
  /** The rides' fade: world objects, so a cutaway of no parts of its own, run in the world's frame. */
  let rides: Cutaway | null = null;
  const where = (feet: Vec3) => {
    for (const { structure } of drawn) {
      const [x, y, z] = localFeet(structure, feet);
      const { level } = structure;
      if (x < 0 || z < 0 || x >= level.cols * level.tile || z >= level.rows * level.tile) continue; // as a tile's edges
      const place = cutPlace(level, x, y, z);
      if (place.storey >= 0) return { structure, ...place };
    }
    return null;
  };
  return {
    root,
    structures: drawn,
    terrain,
    follow(objects) {
      for (const each of drawn) each.cutaway ??= createCutaway(each.meshes);
      if (objects) rides ??= createCutaway({ root, parts: [] }, { objects });
    },
    update(pose, feet, { fade = false, view = false } = {}) {
      const inside = view ? where(feet) : null;
      rides?.update(pose, feet, { fade });
      for (const each of drawn) {
        each.cutaway?.update(localPose(each.structure, pose), localFeet(each.structure, feet), { fade });
        if (inside?.structure === each.structure) each.storeys.set(inside.storey, inside.indoors);
        else each.storeys.clear();
      }
    },
    where,
    register(warmup) {
      const registrations = [
        ...drawn.map((each) => each.meshes.register(warmup, `${each.group.name}:level`)),
        warmup.register(`${root.name}:cutaway`, { objects: () => drawn.flatMap((each) => each.cutaway?.twins ?? []) }),
        ...(terrain ? [terrain.register(warmup, `${root.name}:terrain`)] : []),
      ];
      return { dispose: () => registrations.forEach((registration) => registration.dispose()) };
    },
    dispose() {
      rides?.dispose();
      for (const each of drawn) {
        each.cutaway?.dispose();
        each.meshes.dispose();
      }
      terrain?.dispose();
      root.removeFromParent();
    },
  };
}
