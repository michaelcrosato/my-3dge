/**
 * @file Tests for the house's plans (labs/playground/levels/plan.ts and house.ts, PLAN.md WP 13.18): a plan paints
 * rectangles in metres, later paint over earlier, and refuses a size or a rectangle off whole tiles or outside its map,
 * naming it and the fix; `levelText` writes the storeys bottom first; the house compiles to its four storeys and its
 * seventeen rooms, one for each marker, each marker inside its own room; and it draws no two surfaces facing one way in
 * one plane (z-fighting): none facing up (a ray down every 0.25 m: the floors fought the walls and heads of the storey
 * under them until engine/gfx/level/meshes.ts's `STOREY_SEAM`, and the window sills the wall under them, WP 13.35),
 * none in a reveal (rays along each opening: its jambs fought the wall's cut ends until they lined it, WP 13.36) and
 * none round a slab's edge (rays at each floor slab, from outside: its edge fought the wall under it, the paint band
 * over the siding, WP 13.36); and no grazing ray reaches a head's paint past the siding faced over it (rays at each
 * faced head's ends and top, a tenth off its face: 1,786 did through the facing's open 3 mm step, WP 13.36). And it
 * draws a floor at its storey's base under every tile one is seen on, a railing's too, as the yard's decks do (rays
 * down under its rails: through a railing's tiles they met the storey below, the ground or a wall's paint top a seam
 * under the floor, WP 13.38).
 * @see labs/playground/levels/plan.ts
 * @see labs/playground/levels/house.ts
 */
import { MeshBasicMaterial, Raycaster, Vector3, type Intersection, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { createLevelMeshes, STOREY_SEAM } from '../../../engine/gfx/level/meshes';
import { FRAME } from '../../../engine/gfx/level/openings';
import { levelLooks } from '../../../engine/gfx/level/runs';
import { getLevel } from '../../../engine/sim-api';
import { HOUSE_MARKERS } from './house';
import './yard'; // the tree house's and the lookout's decks
import { levelText, Plan } from './plan';

describe('a storey plan', () => {
  it('paints rectangles in metres, later paint over earlier', () => {
    const hut = new Plan(2, 1.5, 0.5).box([0, 0, 2, 1.5], '#', '.').line([0.5, 1, 1.5, 1.5], '+');
    expect([hut.map, hut.at(0.75, 0.75), hut.at(0.75, 1.25)]).toEqual(['####\n#..#\n#++#', '.', '+']);
  });

  it('refuses a size or a rectangle off whole tiles or outside its map, naming it and the fix', () => {
    expect(() => new Plan(2.1, 1, 0.5)).toThrow(/its width 2.1 m is not whole 0.5 m tiles: give metres on whole tiles/);
    expect(() => new Plan(2, 1, 0.5).fill([0, 0, 3, 1], '#')).toThrow(/\[0, 0, 3, 1\] is not inside its 2 × 1 m: give x0 ≤ x1/); // prettier-ignore
    expect(() => new Plan(2, 1, 0.5).fill([1, 0, 0.5, 1], '#')).toThrow(/is not inside/);
  });

  it('writes a level’s text: its front matter, then each storey’s keys and map, bottom first', () => {
    const plan = new Plan(1, 0.5, 0.5, '.');
    const text = levelText({ description: 'Two floors.', tile: 0.5 }, [{ keys: { storey: 'ground', base: 0, height: 2.5 }, plan }, { keys: { storey: 'upper', base: 3, height: 2.5 }, plan }]); // prettier-ignore
    expect(text.indexOf('storey: ground') < text.indexOf('storey: upper')).toBe(true);
    expect(text.startsWith('---\ndescription: Two floors.\ntile: 0.5\n---\n')).toBe(true);
  });
});

/** The house's meshes as the stage draws them (its recipes and rooms), placed. */
function houseMeshes() {
  const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, 'level:house');
  const meshes = createLevelMeshes(getLevel('level:house'), { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms }); // prettier-ignore
  meshes.root.updateMatrixWorld(true);
  return meshes;
}

/** Where a ray from `origin` along `direction` meets two faces of `root` facing the same way in one plane. */
function fights(root: Object3D, origin: Vector3, direction: Vector3): string[] {
  const hits: Intersection[] = new Raycaster(origin, direction).intersectObject(root, true);
  const found: string[] = [];
  for (let i = 0; i + 1 < hits.length; i++) {
    const [a, b] = [hits[i], hits[i + 1]];
    const other = a.object !== b.object || a.instanceId !== b.instanceId; // a ray along a quad's diagonal meets both its halves
    const facing = a.face!.normal.dot(b.face!.normal) > 0.99;
    if (other && facing && b.distance - a.distance < 0.002) found.push(`${a.object.name} and ${b.object.name} at ${a.point.toArray().map((v) => v.toFixed(2))}`); // prettier-ignore
  }
  return found;
}

describe('the house', () => {
  it('compiles to its four storeys and seventeen rooms, a marker each, inside its own room', () => {
    const house = getLevel('level:house');
    expect(house.storeys!.map((storey) => storey.name)).toEqual(['basement', 'ground', 'upper', 'attic']);
    expect(house.rooms!.map((room) => room.name).sort()).toEqual(Object.values(HOUSE_MARKERS).sort());
    for (const room of house.rooms!) {
      const [col, row] = room.marker;
      const [c0, r0, c1, r1] = room.rect;
      expect(col >= c0 && col <= c1 && row >= r0 && row <= r1, room.name).toBe(true);
    }
  });

  it('draws no two surfaces facing up in one plane: no floor in a wall’s, a head’s or a sill’s (z-fighting)', () => {
    const level = getLevel('level:house');
    const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, 'level:house'); // as the stage draws it
    const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms });
    meshes.root.updateMatrixWorld(true);
    const ray = new Raycaster();
    const shared: string[] = [];
    for (let x = 0.125; x < level.cols * level.tile; x += 0.25)
      for (let z = 0.125; z < level.rows * level.tile; z += 0.25) {
        ray.set(new Vector3(x, 30, z), new Vector3(0, -1, 0));
        const hits = ray.intersectObject(meshes.root, true);
        for (let i = 0; i + 1 < hits.length; i++) {
          const [a, b] = [hits[i], hits[i + 1]];
          const other = a.object !== b.object || a.instanceId !== b.instanceId; // a ray along a quad's diagonal meets both its halves
          if (other && Math.abs(a.point.y - b.point.y) < 0.002) shared.push(`${a.object.name} and ${b.object.name} at (${x}, ${a.point.y.toFixed(2)}, ${z})`); // prettier-ignore
        }
      }
    expect(shared).toEqual([]);
    meshes.dispose();
  });

  it('draws a floor at its storey’s base under every tile one is seen on, a railing’s too (the house and the decks)', () => {
    // Under a railing's bottom rail nothing faced up: the landing's showed the hall 3 m below, the bulkhead's and the
    // garage deck's the paint tops of the walls a centimetre under them, the decks' the ground (WP 13.38).
    const holes: Record<string, number> = {};
    const [ray, down] = [new Raycaster(), new Vector3(0, -1, 0)];
    for (const name of ['level:house', 'level:treehouse', 'level:lookout']) {
      const level = getLevel(name);
      const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, name);
      const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms });
      meshes.root.updateMatrixWorld(true);
      const t = level.tile;
      for (const [k, { name: storey, base, tiles, floored }] of level.storeys!.entries()) {
        const own = meshes.parts.filter((part) => part.storey === k).map((part) => part.mesh); // its storey's meshes
        tiles.forEach((ch, i) => {
          if (!floored[i] || !['floor', 'railing'].includes(level.legend[ch].mesh ?? '')) return; // a floor shows on it
          const [x, z] = [((i % level.cols) + 0.5) * t, (Math.floor(i / level.cols) + 0.5) * t];
          ray.set(new Vector3(x + 0.09, base + 0.09, z + 0.09), down); // under its rails, off its posts
          const [floor] = ray.intersectObjects(own, false); // the faces facing up, as the camera sees them
          if (floor && Math.abs(floor.point.y - base) < STOREY_SEAM / 5) return; // its storey's floor at its base
          const [hit] = ray.intersectObject(meshes.root, true); // what shows there instead
          const key = `${name}/${storey} '${ch}': ${hit ? `${hit.object.name.replace(/@.*/, '')} ${(base - hit.point.y).toFixed(3)} m down` : 'nothing'}`; // prettier-ignore
          holes[key] = (holes[key] ?? 0) + 1;
        });
      }
      meshes.dispose();
    }
    expect(holes).toEqual({});
  });

  it('lines every door’s and window’s reveal with its frame: no wood in the plane of the wall’s cut end', () => {
    const level = getLevel('level:house');
    const meshes = houseMeshes();
    const found: string[] = [];
    const first: string[] = [];
    const t = level.tile;
    for (const { axis, tiles, bottom, top } of level.openings!) {
      const [c0, r0, c1, r1] = tiles;
      const [x, z] = [((c0 + c1 + 1) / 2) * t, ((r0 + r1 + 1) / 2) * t];
      for (const across of [-0.06, 0, 0.06])
        for (let y = bottom + 0.15; y < top - 0.05; y += 0.4)
          for (const way of [1, -1]) {
            const origin = axis === 'x' ? new Vector3(x, y, z + across) : new Vector3(x + across, y, z);
            const direction = axis === 'x' ? new Vector3(way, 0, 0) : new Vector3(0, 0, way);
            found.push(...fights(meshes.root, origin, direction));
            const [hit] = new Raycaster(origin, direction).intersectObject(meshes.root, true);
            if (!hit?.object.name.endsWith('/frames')) first.push(`${hit?.object.name} first from ${origin.toArray()}`);
          }
    }
    expect(found).toEqual([]);
    expect(first).toEqual([]); // the frame's jamb, standing PROUD into the opening, before the wall's cut end
    meshes.dispose();
  });

  it('stands each floor slab’s edge back from the wall under it: no paint band in the plane of the siding', () => {
    const level = getLevel('level:house');
    const meshes = houseMeshes();
    const [width, depth] = [level.cols * level.tile, level.rows * level.tile];
    const found: string[] = [];
    for (const { base, slab } of level.storeys!.slice(1)) {
      const y = base - slab / 2;
      for (let a = 0.125; a < Math.max(width, depth); a += 0.25) {
        if (a < depth) found.push(...fights(meshes.root, new Vector3(-1, y, a), new Vector3(1, 0, 0)), ...fights(meshes.root, new Vector3(width + 1, y, a), new Vector3(-1, 0, 0))); // prettier-ignore
        if (a < width) found.push(...fights(meshes.root, new Vector3(a, y, -1), new Vector3(0, 0, 1)), ...fights(meshes.root, new Vector3(a, y, depth + 1), new Vector3(0, 0, -1))); // prettier-ignore
      }
    }
    expect(found).toEqual([]);
    meshes.dispose();
  });

  it('closes the siding over each opening at its ends and top: no grazing ray reaches the head’s paint behind it', () => {
    const level = getLevel('level:house');
    const meshes = houseMeshes();
    const t = level.tile;
    const reached: string[] = [];
    let aimed = 0;
    for (const { axis, tiles, top, storey: k } of level.openings!) {
      const { name } = level.storeys![k];
      const fullTop = level.storeys![k].fullTop - (k + 1 < level.storeys!.length ? STOREY_SEAM : 0); // the head's drawn top
      if (!meshes.parts.some((part) => part.name.startsWith(`level:house/${name}/heads:`))) continue; // faced: not under a pitched roof
      const [c0, r0, c1, r1] = tiles;
      const [a0, a1] = axis === 'x' ? [c0 * t, (c1 + 1) * t] : [r0 * t, (r1 + 1) * t];
      const faces = axis === 'x' ? [r0 * t, (r1 + 1) * t] : [c0 * t, (c1 + 1) * t];
      // A point on the head's face 2 mm in from an end or the top, and a ray grazing it at a tenth from that end or
      // from above: it crosses the facing's 3 mm step 0.2 mm out of the head's face, so only a cap stops it there.
      const aims: [along: number, y: number, way: [number, number]][] = [];
      for (let y = top + FRAME + 0.05; y < fullTop - 0.02; y += 0.1) aims.push([a0 + 0.002, y, [1, 0]], [a1 - 0.002, y, [-1, 0]]); // prettier-ignore
      for (let a = a0 + 0.05; a < a1; a += 0.1) aims.push([a, fullTop - 0.002, [0, -1]]);
      for (const [s, face] of [-1, 1].map((s, i) => [s, faces[i]] as const))
        for (const [along, y, [da, dy]] of aims) {
          const at = axis === 'x' ? new Vector3(along, y, face) : new Vector3(face, y, along);
          const way = axis === 'x' ? new Vector3(da, dy, -0.1 * s) : new Vector3(-0.1 * s, dy, da);
          const origin = at.clone().addScaledVector(way.normalize(), -0.2);
          const [hit] = new Raycaster(origin, way).intersectObject(meshes.root, true);
          aimed++;
          if (hit?.object.name.endsWith(`${name}/heads`)) reached.push(`${hit.object.name} at ${hit.point.toArray().map((v) => v.toFixed(3))}`); // prettier-ignore
        }
    }
    expect(aimed).toBeGreaterThan(500);
    expect(reached).toEqual([]);
    meshes.dispose();
  });
});
