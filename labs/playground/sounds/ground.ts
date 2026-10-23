/**
 * @file What the playground's floors sound like, and the room a listener stands in (docs/PLAYGROUND.md §8.1, PLAN.md
 * WP 13.22): `surfaceUnder(x, y, z)` names the footstep surface (engine/world/footsteps.ts) under a point of the site
 * (labs/playground/levels/site.ts), and `roomUnder(x, y, z)` what the room there is made of, for its reverb
 * (engine/audio/runtime/reverb.ts `roomAcoustics`), or null in the open air.
 *
 * - Surfaces: in a house room whose floor the house names (`HOUSE_ROOMS`: tiles, wood, carpet), that floor; else a
 *   glyph of the playground's own with a tag of its own (the sidewalks' concrete, the road line's asphalt); else the
 *   structure's floors (`FLOORS`: the street's asphalt, the path's flagstones as stone, the shed's, the treehouse's and
 *   the lookout's wood, the ring's canvas `=` as carpet, concrete elsewhere); off every structure, the terrain's tag
 *   (grass, and rock where it is steep).
 * - Rooms: a house room by its floor's area, its storey's height and its floor, the basement's and the garage's bare
 *   (little in them: `BARE`) and the basement's walls concrete; the shed and the treehouse small rooms of wood, their
 *   footprints' size, where their own floor is underfoot; null anywhere else (outdoors, on the porch, under the
 *   shelter's open roof, among the treehouse's stilts).
 *
 * Both make `SITE_GROUND`, the site's scenes' ground for their sound map (events.ts beside it) and the page's listener.
 *
 * Invariants: pure functions of the site and the point, sim-side (the scenes' sound map reads `surfaceUnder` in Node
 * as the page does), so a run's footsteps are the same everywhere; a point is read 5 cm over the feet (on a flat
 * paving, whose box is no taller than its top, by its footprint).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * surfaceUnder(62, 0.15, 84); // 'concrete': the street's north sidewalk
 * roomUnder(62, 0.15, 84); // null: outdoors
 * @see labs/playground/sounds/ground.test.ts
 */
import { siteStructureAt, siteSurfaceBelow, toLocal, type SiteStructure } from '../../../engine/sim-api';
import { HOUSE_ROOMS } from '../levels/house';
import { SITE } from '../levels/site';
import type { PlaygroundGround, PlaygroundRoom } from './events';

/** The house rooms' floor materials as the surfaces they sound. */
const MATERIAL_SURFACES: Readonly<Record<string, string>> = { 'material:tiles': 'tile', 'material:wood': 'wood', 'material:carpet': 'carpet' }; // prettier-ignore

/** Each structure's floors by its name in the site: a glyph's surface, `'*'` for the rest (see the file comment). */
const FLOORS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  street: { '*': 'asphalt' },
  path: { '*': 'stone' },
  shed: { '*': 'wood' },
  treehouse: { '*': 'wood' },
  lookout: { '*': 'wood' },
  ring: { '=': 'carpet', '*': 'concrete' },
};

/** What a bare room's contents soak up (a share of its floor's area): a basement's boxes, a garage's car. */
export const BARE = 0.1;

/** The structures whose insides are small rooms (see the file comment). */
const SMALL_ROOMS: Readonly<Record<string, string>> = { shed: 'wood', treehouse: 'wood' };

/** The engine's default glyph tag: a glyph that names none sounds as its structure's floors. */
const UNTAGGED = 'stone';

/** The flat paving (a box no taller than its top) whose footprint holds (x, z) and whose top is at feet y. */
const paving = (x: number, y: number, z: number) =>
  SITE.structures.find(({ footprint: [x0, z0, x1, z1], bounds }) => x >= x0 && x < x1 && z >= z0 && z < z1 && bounds.max[1] - bounds.min[1] < 0.01 && Math.abs(y - bounds.max[1]) < 0.1); // prettier-ignore

/** The structure, storey and room at feet (x, y, z): its box 5 cm over them, else a flat paving under them. */
function structureAt(x: number, y: number, z: number) {
  const flat = siteStructureAt(SITE, x, y + 0.05, z) ? null : paving(x, y, z);
  return flat ? { structure: flat, storey: 0, room: null } : siteStructureAt(SITE, x, y + 0.05, z);
}

/** The character of the tile of `s` under world (x, z) on storey `storey`, or '' off its map. */
function glyphAt(s: SiteStructure, storey: number, x: number, z: number): string {
  const { level } = s;
  const [lx, lz] = toLocal(s, x, z);
  const [col, row] = [Math.floor(lx / level.tile), Math.floor(lz / level.tile)];
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return '';
  return (level.storeys?.[storey]?.tiles ?? level.tiles)[row * level.cols + col] ?? '';
}

/** The footstep surface under (x, y, z), feet at y (see the file comment). */
export function surfaceUnder(x: number, y: number, z: number): string {
  const at = structureAt(x, y, z);
  const tag = siteSurfaceBelow(SITE, x, y + 0.05, z);
  if (!at) return tag || 'grass';
  const room = at.room && (HOUSE_ROOMS as Readonly<Record<string, string>>)[at.room.name];
  if (at.structure.name === 'house' && room) return MATERIAL_SURFACES[room] ?? 'concrete';
  if (tag && tag !== UNTAGGED) return tag; // a glyph of the playground's own, or the terrain within the box
  const floors = FLOORS[at.structure.name] ?? {};
  return floors[glyphAt(at.structure, at.storey, x, z)] ?? floors['*'] ?? 'concrete';
}

/** The room at (x, y, z), feet at y, as `roomAcoustics` takes it; null in the open air (see the file comment). */
export function roomUnder(x: number, y: number, z: number): PlaygroundRoom | null {
  const at = structureAt(x, y, z);
  if (!at) return null;
  const { structure, storey, room } = at;
  const name = structure.name;
  if (Object.hasOwn(SMALL_ROOMS, name)) {
    if (surfaceUnder(x, y, z) !== SMALL_ROOMS[name]) return null; // under it, not in it: the treehouse's stilts
    const [x0, z0, x1, z1] = structure.footprint;
    return { name, area: (x1 - x0) * (z1 - z0), height: 2.4, floor: SMALL_ROOMS[name] };
  }
  if (name !== 'house' || !room) return null;
  const floor = (HOUSE_ROOMS as Readonly<Record<string, string>>)[room.name];
  const height = structure.level.storeys?.[storey]?.height ?? 2.7;
  if (floor) return { name: room.id, area: room.area, height, floor: MATERIAL_SURFACES[floor] ?? 'concrete' };
  const below = (structure.level.storeys?.[storey]?.base ?? 0) < 0; // the basement's walls are its foundations
  return { name: room.id, area: room.area, height, floor: 'concrete', contents: BARE, ...(below ? { walls: 'concrete' } : {}) }; // prettier-ignore
}

/** The site's ground, for the site's scenes' sound map (events.ts) and the page's listener. */
export const SITE_GROUND: PlaygroundGround = { surface: surfaceUnder, room: roomUnder };
