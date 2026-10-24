/**
 * @file The site part of the public sim API (PLAN.md §6.1, Phase 13, WP 13.13, WP 10.5): every name sim-side game code
 * takes for levels written as storeys (their 3D queries) and for outdoor ground (the terrain kind, its queries, its
 * body and its navigation), re-exported whole by engine/sim-api.ts, so that file stays under its line cap, as
 * engine/sim/movementApi.ts does for movement (ADR-0025 amendment 7). Game code imports these names from
 * engine/sim-api.ts (or engine/index.ts), never from here: the public-API rule rejects any other engine path.
 *
 * Invariants: the same as engine/sim-api.ts's: a flat list of `export … from` lines, one name per line, grouped by
 * area and append-only; WP 13.15 appends the sites' names. Only sim-side modules are re-exported, and each name is
 * documented where it is declared.
 *
 * @example
 * // labs/playground/scenes/hill.ts
 * // import { addTerrainBody, defineTerrain, getTerrain } from '../../../engine/sim-api';
 * @see engine/sim-api.ts
 */

// Storeys (WP 13.13): format 2, levels written as storeys, read a storey at a time or in 3D: the highest surface at or
// under a point, its storey (by height, or by that surface) and its room.
export { LEVEL_FORMAT_2 } from '../world/level/types';
export { storeyView } from '../world/level/storeys';
export { floorBelow } from '../world/level/heights';
export { surfaceBelow } from '../world/level/heights';
export { storeyAt } from '../world/level/heights';
export { storeyBelow } from '../world/level/heights';
export { roomAt } from '../world/level/heights';
export type { StoreyDescriptor } from '../world/level/types';
export type { RoomDescriptor } from '../world/level/types';
export type { OpeningDescriptor } from '../world/level/types';
export type { RoofDescriptor } from '../world/level/types';

// Terrain (WP 10.5): the registry kind `terrain`, a seeded heightfield, its queries, its body and its navigation.
export { defineTerrain } from '../world/terrain';
export { getTerrain } from '../world/terrain';
export { makeTerrain } from '../world/terrain';
export { terrainProblems } from '../world/terrain';
export { TERRAIN_FIELDS } from '../world/terrain';
export type { Terrain } from '../world/terrain';
export type { TerrainSpec } from '../world/terrain';
export type { TerrainEntry } from '../world/terrain';
export type { TerrainHill } from '../world/terrain';
export type { TerrainFlat } from '../world/terrain';
export { terrainHeight } from '../world/terrain';
export { terrainGradient } from '../world/terrain';
export { terrainNormal } from '../world/terrain';
export { terrainGrade } from '../world/terrain';
export { terrainSurface } from '../world/terrain';
export { scatterTerrain } from '../world/terrain';
export type { ScatterRule } from '../world/terrain';
export type { TerrainPlace } from '../world/terrain';
export { addTerrainBody } from './levelBodies';
export { terrainNavGrid } from '../world/terrainNav';
export { terrainNavSurface } from '../world/terrainNav';
export type { TerrainNavOptions } from '../world/terrainNav';
export type { NavSurface } from '../world/nav';
export type { NavSource } from '../world/nav';

// Sites (WP 13.15): levels standing on a terrain, each placed and turned in quarter turns, the terrain cut under
// them; the queries over all of it, the bodies, the ladders and the navigation over every storey and the terrain.
export { defineSite } from '../world/site';
export { getSite } from '../world/site';
export { makeSite } from '../world/site';
export { SITE_FIELDS } from '../world/site';
export { toWorld } from '../world/site';
export { toLocal } from '../world/site';
export type { Site } from '../world/site';
export type { SiteSpec } from '../world/site';
export type { SiteStructure } from '../world/site';
export type { StructureSpec } from '../world/site';
export { siteFloorBelow } from '../world/siteQueries';
export { siteSurfaceBelow } from '../world/siteQueries';
export { siteStructureAt } from '../world/siteQueries';
export { siteSolidAt } from '../world/siteQueries';
export { siteClearSight } from '../world/siteQueries';
export { siteRescueGrid } from '../world/siteQueries';
export type { SiteRescueGrid } from '../world/siteQueries';
export { createSiteNav } from '../world/siteNav';
export type { SiteNav } from '../world/siteNav';
export type { SiteNavOptions } from '../world/siteNav';
export { addSiteBodies } from './levelBodies';
export { addSiteLadders } from './rides';
// The scene's props as navigation blocks (WP 13.21): what a site's walkers go round.
export { propObstacles } from './propBlocks';
export type { NavBlock } from '../world/siteNav';
