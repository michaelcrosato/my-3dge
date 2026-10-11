/**
 * @file The `geo` QA family in T1 (tools/qa/geo.ts, PLAN.md §8.6): the engine's geometry and the level files' meshes
 * pass against tests/baselines/qa-geo.json; on a registry with seeded faults, each fault gives its metric once per
 * geometry (missing attributes, NaN, degenerate triangles, flipped normals, bounds in centimetres or collapsed to a
 * line, a blown vertex budget, a builder that throws, one that differs between builds); a level's meshes report an
 * undefined recipe, too many draw calls and meshes outside its bounds; a game's geometry modules are found under
 * `labs/<name>/geometry/`; every prop's parts are checked as the prop draws them, under its id, with a part naming
 * no geometry and parts floating over their body's base reported too (WP 4.5); `--only` and a baseline entry
 * accepting a known problem work through `runQa`.
 * @see tools/qa/geo.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BufferGeometry, Float32BufferAttribute } from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../../engine/core/registry';
import { boxGeometry } from '../../engine/gfx/geometry/box';
import { defineGeometry } from '../../engine/gfx/geometry/geometry';
import { compileLevel } from '../../engine/world/level/compile';
import { defineProp } from '../../engine/world/props/prop';
import { defineGlyph } from '../../engine/world/level/glyph';
import { runQa, type QaFamily } from '../cmd/qa';
import { ROOT } from '../x';
import family, { checkGeometries, checkLevelMeshes, checkProps, geometryModules, labModules } from './geo';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository holding `files`. */
function repository(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qa-geo-')));
  temporary.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** A triangle soup: positions, and normals and UVs unless left out. */
function soup(positions: number[], normals?: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (normals)
    geometry.setAttribute('uv', new Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  return geometry;
}

/** A registry with faulty geometry beside the kit's. */
function faulty() {
  const reg = createRegistry();
  const define = (id: string, create: () => BufferGeometry, budget?: number) =>
    defineGeometry(id, { description: 'A faulty test shape.', create, ...(budget ? { budget } : {}) }, reg);
  const up = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  // One good triangle facing +Z, then one wound the other way, then one with no area.
  define('geometry:test-flipped', () =>
    soup([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0], [...up, ...up, ...up]),
  );
  define('geometry:test-bare', () => soup([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  define('geometry:test-nan', () => soup([0, 0, 0, 1, 0, 0, Number.NaN, 1, 0], up));
  define('geometry:test-centimetres', () => boxGeometry({ width: 120, height: 180, depth: 40 }));
  define('geometry:test-line', () => soup([0, 0, 0, 1, 0, 0, 2, 0, 0], up));
  define('geometry:test-heavy', () => boxGeometry(), 12);
  define('geometry:test-throws', () => {
    throw new Error('no vertices today');
  });
  let builds = 0;
  define('geometry:test-drifts', () => boxGeometry({ width: 1 + builds++ }));
  return reg;
}

describe('the geo QA family', () => {
  it("passes the engine's geometry and the level files' meshes against their baseline", async () => {
    const result = await runQa(ROOT, 'geo');
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(readFileSync(join(ROOT, 'tests', 'baselines', 'qa-geo.json'), 'utf8'))).toEqual([]);
    expect(await family.run({ root: ROOT, only: ['geometry:'] })).toEqual([]);
    expect(await family.run({ root: ROOT, only: ['level:fixtures/'] })).toEqual([]);
  });

  it('reports each fault of a geometry once per metric, naming the numbers and the fix', () => {
    const violations = checkGeometries(faulty()).filter((v) => v.id.startsWith('geometry:test-'));
    expect(violations.map((v) => [v.id, v.metric, v.value])).toEqual([
      ['geometry:test-bare', 'attributes', 2],
      ['geometry:test-centimetres', 'bounds', 2],
      ['geometry:test-drifts', 'unstableHash', 1],
      ['geometry:test-flipped', 'degenerate', 1],
      ['geometry:test-flipped', 'normals', 1],
      ['geometry:test-heavy', 'vertices', 24],
      ['geometry:test-line', 'degenerate', 1],
      ['geometry:test-line', 'bounds', 1],
      ['geometry:test-nan', 'nonFinite', 1],
      ['geometry:test-throws', 'build', 1],
    ]);
    const message = (id: string, metric: string) => violations.find((v) => v.id === id && v.metric === metric)!.message;
    expect(message('geometry:test-bare', 'attributes')).toMatch(/^at its defaults: missing normal, uv/);
    expect(message('geometry:test-centimetres', 'bounds')).toMatch(
      /120 × 180 × 40 m, longer than 100 m: sizes are in metres/,
    );
    expect(message('geometry:test-heavy', 'vertices')).toMatch(/24 vertices at its defaults, above its budget of 12/);
    expect(message('geometry:test-throws', 'build')).toBe('building it threw: no vertices today');
    expect(checkGeometries(faulty(), ['geometry:test-nan']).map((v) => v.metric)).toEqual(['nonFinite']);
  });

  it("reports a level's undefined recipes, its draw calls above 20 and meshes outside its bounds", () => {
    const reg = createRegistry();
    // Ten glyphs of ten heights: ten block meshes, 2 groups each, drawn in colour and into a shadow map.
    const steps = 'ABCDEFGHIJ';
    for (const [i, char] of [...steps].entries()) {
      defineGlyph(
        `glyph:step${i}`,
        { char, top: 0.25 * (i + 1), solid: true, collider: 'box', mesh: 'wall', nav: { walkable: false } },
        reg,
      );
    }
    defineGlyph(
      'glyph:hedge',
      { char: 'z', top: 1, solid: true, collider: 'box', mesh: 'hedge', nav: { walkable: false } },
      reg,
    );
    const level = compileLevel(`#############\n#${steps}z#\n#############\n`, { file: 'steps.txt', registry: reg });
    const violations = checkLevelMeshes('level:steps', level, 'steps.txt');
    expect(violations.map((v) => [v.id, v.metric, v.value])).toEqual([
      ['level:steps', 'recipe', 1],
      ['level:steps', 'drawCalls', 48],
    ]);
    expect(violations[0].message).toMatch(/GFX_LEVEL_RECIPE.*hedge/);
    expect(violations[1]).toMatchObject({ file: 'steps.txt' });
    const room = compileLevel(readFileSync(join(ROOT, 'fixtures', 'levels', 'room.txt'), 'utf8'), { file: 'room.txt' });
    const shrunk = { ...room, bounds: { min: room.bounds.min, max: [16, 3, 12] as const } };
    const outside = checkLevelMeshes('level:room', shrunk);
    expect(outside.map((v) => [v.metric, v.value])).toEqual([['bounds', 0.5]]);
    expect(outside[0].message).toMatch(/reach 0\.500 m outside the level's bounds/);
  });

  it("checks every prop's parts as the prop draws them, under the prop's id", async () => {
    const reg = faulty();
    expect(checkProps(reg)).toEqual([]);
    const part = { geometry: 'geometry:box', params: { width: 0.5, height: 0.5, depth: 0.5 } };
    defineProp('prop:floating', { parts: [{ ...part, position: [0, 0.2, 0] }], body: { type: 'fixed' } }, reg);
    defineProp('prop:sunk', { parts: [{ ...part, position: [0, -0.05, 0] }], body: { type: 'dynamic' } }, reg);
    defineProp('prop:lost', { parts: [{ name: 'body', geometry: 'geometry:nowhere' }] }, reg);
    defineProp('prop:huge', { parts: [part, { name: 'slab', params: { width: 500 } }] }, reg);
    defineProp(
      'prop:dense',
      { parts: [{ geometry: 'geometry:test-heavy' }, { geometry: 'geometry:test-nan', name: 'b' }] },
      reg,
    );
    const violations = checkProps(reg);
    expect(violations.map((v) => [v.id, v.metric, +v.value.toFixed(3)])).toEqual([
      ['prop:dense', 'vertices', 24],
      ['prop:dense', 'nonFinite', 1],
      ['prop:floating', 'float', 0.2],
      ['prop:huge', 'bounds', 1],
      ['prop:lost', 'reference', 1],
      ['prop:sunk', 'float', 0.05],
    ]);
    const message = (id: string) => violations.find((v) => v.id === id)!.message;
    expect(message('prop:dense')).toMatch(/^24 vertices in part mesh \(geometry:test-heavy\), above its budget of 12/);
    expect(message('prop:floating')).toMatch(
      /lowest point is 0\.200 m above its base, where its box body stands, so the prop floats/,
    );
    expect(message('prop:huge')).toMatch(/^part slab \(geometry:box\): its bounds are 500 × 1 × 1 m/);
    expect(message('prop:lost')).toMatch(/^part body \(geometry:nowhere\) names a geometry no entry defines/);
    expect(checkProps(reg, ['prop:crate', 'prop:sunk']).map((v) => v.id)).toEqual(['prop:sunk']);
    const result = await runQa(ROOT, 'geo', ['prop:']);
    expect([result.failures, result.violations]).toEqual([[], 0]);
    expect(
      labModules(repository({ 'labs/box/props/chest.ts': '', 'labs/box/props/chest.test.ts': '' }), 'props'),
    ).toEqual(['labs/box/props/chest.ts']);
  });

  it("finds a game's geometry modules and honours --only", async () => {
    const root = repository({
      'labs/box/geometry/crate.ts': 'export {};\n',
      'labs/box/geometry/crate.test.ts': 'export {};\n',
      'labs/box/levels/room.txt': '#####\n#@..#\n#####\n',
      'labs/hello/geometry/sample.ts': 'export {};\n',
    });
    expect(geometryModules(root)).toEqual(['labs/box/geometry/crate.ts', 'labs/hello/geometry/sample.ts']);
    expect(await family.run({ root, only: ['geometry:box', 'level:room'] })).toEqual([]);
  });

  it('fails new problems and passes ones the baseline accepts with a reason', async () => {
    const reg = faulty();
    const only: QaFamily = { run: () => checkGeometries(reg, ['geometry:test-heavy']) };
    const root = repository({});
    const failing = await runQa(root, 'geo', [], async () => only);
    expect(failing.failures.map((f) => f.id)).toEqual(['QA_GEO']);
    mkdirSync(join(root, 'tests', 'baselines'), { recursive: true });
    const accepted = [{ id: 'geometry:test-heavy', metric: 'vertices', value: 24, reason: 'a test: a seeded fault' }];
    writeFileSync(join(root, 'tests', 'baselines', 'qa-geo.json'), JSON.stringify(accepted));
    const passing = await runQa(root, 'geo', [], async () => only);
    expect([passing.failures, passing.accepted]).toEqual([[], 1]);
  });
});
