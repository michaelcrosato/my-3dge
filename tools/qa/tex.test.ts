/**
 * @file The `tex` QA family in T1 (tools/qa/tex.ts, PLAN.md §8.6): the engine's textures pass against
 * tests/baselines/qa-tex.json; on a registry with seeded faults, a generator that does not wrap gives `seamDelta` and
 * `period`, one with values out of range gives `range`, one that throws gives `bake`, each once, valued by the worst
 * bake and naming it; a game's texture modules are found under `labs/<name>/textures/`; a prop's materials' textures
 * are checked as they bake them, under the prop's id, and a material no entry defines is a `reference` (WP 4.5);
 * `--only` and a baseline entry accepting a known problem work through `runQa`; the contact sheet is written for
 * what was checked, laid out three panels a texture, tiled 2 × 2 with each texture's shape kept and the right way up
 * (row 0 of a map at its panel's bottom, proved on a ramp and on textures that differ top to bottom).
 * @see tools/qa/tex.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../../engine/core/registry';
import { defineMaterial } from '../../engine/gfx/materials/material';
import { bakeTexture } from '../../engine/gfx/textures/bake';
import { defineTexture } from '../../engine/gfx/textures/texture';
import { defineProp } from '../../engine/world/props/prop';
import { runQa, type QaFamily } from '../cmd/qa';
import { ROOT } from '../x';
import { decodePng } from '../lib/png';
import family, { checkPropTextures, checkTextures, textureModules, textureSheet } from './tex';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository holding `files`. */
function repository(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qa-tex-')));
  temporary.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** A registry with the v1 textures and three faulty generators. */
function faulty() {
  const reg = createRegistry();
  const base = { description: 'A faulty test generator.', size: [32, 32] as [number, number] };
  defineTexture(
    'texture:ramp',
    { ...base, create: () => (x, y, texel) => void texel.color.fill(Math.min(255, x * 8)) },
    reg,
  );
  defineTexture(
    'texture:hot',
    {
      ...base,
      create: () => (x, y, texel) => {
        texel.color.fill(100);
        texel.height = 1.5;
      },
    },
    reg,
  );
  defineTexture(
    'texture:broken',
    {
      ...base,
      create: () => () => {
        throw new Error('no texels today');
      },
    },
    reg,
  );
  return reg;
}

describe('the tex QA family', () => {
  it("passes the engine's textures against their baseline", async () => {
    const result = await runQa(ROOT, 'tex');
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(await family.run({ root: ROOT, only: ['texture:'] })).toEqual([]);
  });

  it('reports each fault once per texture and metric, valued by the worst bake', () => {
    const violations = checkTextures(faulty()).filter(
      (v) => !v.id.startsWith('texture:') || /ramp|hot|broken/.test(v.id),
    );
    expect(violations.map((v) => [v.id, v.metric])).toEqual([
      ['texture:broken', 'bake'],
      ['texture:hot', 'range'],
      ['texture:ramp', 'seamDelta'],
      ['texture:ramp', 'period'],
    ]);
    const [broken, hot, seam, period] = violations;
    expect(broken.message).toBe('baking it threw: no texels today');
    expect(hot).toMatchObject({ value: 64 * 64 });
    expect(hot.message).toMatch(/^seed 1 at 64 × 64: 4096 texels out of range, first texel \(0, 0\) has height 1\.5/);
    expect(seam.value).toBeCloseTo(251 / 255, 5);
    expect(seam.message).toMatch(
      /^seed 1 at 64 × 64: map\.r differs by 255\.000 on average across the left–right wrap edge/,
    );
    expect(period.value).toBeGreaterThan(0.9);
    expect(checkTextures(faulty(), ['texture:hot']).map((v) => v.metric)).toEqual(['range']);
  });

  it("checks the textures a prop's materials name, as they bake them, under the prop's id", async () => {
    const reg = faulty();
    expect(checkPropTextures(reg)).toEqual([]);
    defineMaterial('material:rampy', { map: { texture: 'texture:ramp', size: [16, 16] } }, reg);
    defineProp('prop:sign', { parts: [{ material: 'material:rampy', top: 'material:nowhere' }] }, reg);
    const violations = checkPropTextures(reg);
    expect(violations.map((v) => [v.id, v.metric])).toEqual([
      ['prop:sign', 'reference'],
      ['prop:sign', 'seamDelta'],
      ['prop:sign', 'period'],
    ]);
    expect(violations[0].message).toMatch(
      /^part mesh's material:nowhere is not defined, so it draws as material:default/,
    );
    // Baked at the material's 16 × 16 and twice it (the generator's own size would bake 32 and 64): the worst, 32.
    expect(violations[1].message).toMatch(
      /^part mesh's material:rampy \(texture:ramp\), seed 1 at 32 × 32: map\.r differs/,
    );
    expect(checkPropTextures(reg, ['prop:crate'])).toEqual([]);
    const result = await runQa(ROOT, 'tex', ['prop:']);
    expect([result.failures, result.violations]).toEqual([[], 0]);
  });

  it("finds a game's texture modules and honours --only", async () => {
    const root = repository({
      'labs/box/textures/moss.ts': 'export {};\n',
      'labs/box/textures/moss.test.ts': 'export {};\n',
      'labs/box/levels/hall.txt': '#\n',
      'labs/hello/textures/sample.ts': 'export {};\n',
    });
    expect(textureModules(root)).toEqual(['labs/box/textures/moss.ts', 'labs/hello/textures/sample.ts']);
    expect(await family.run({ root, only: ['texture:brick'] })).toEqual([]);
    // The contact sheet of what it checked: one texture, three panels.
    const sheet = decodePng(readFileSync(join(root, 'out', 'qa', 'tex', 'sheet.png')));
    expect([sheet.width, sheet.height]).toEqual([408, 160]);
  });

  it('lays out the contact sheet: colour, normal and emissive tiled 2 × 2, shapes kept, labelled', () => {
    const checker = bakeTexture('texture:checker');
    const staves = bakeTexture('texture:staves');
    const sheet = textureSheet([checker, staves]);
    expect([sheet.width, sheet.height]).toEqual([808, 160]);
    const pixel = (x: number, y: number) => [...sheet.rgba.slice((y * 808 + x) * 4, (y * 808 + x) * 4 + 3)];
    // The checker's panel: one period is 64 px.
    expect(pixel(8, 8)).toEqual(pixel(8 + 64, 8 + 64));
    // No glow: the emissive panel is black. The staves (48 × 16) fill 128 × 43 px, the background below.
    expect(pixel(8 + 2 * 132 + 10, 20)).toEqual([0, 0, 0]);
    expect(pixel(416 + 10, 8 + 42)).not.toEqual([27, 27, 36]);
    expect(pixel(416 + 10, 8 + 44)).toEqual([27, 27, 36]);
  });

  it('draws each map as it is drawn: row 0 at the bottom of its panel, the top row at the top', () => {
    // A 32 × 16 ramp, red 16 × the row and green 8 × the column, so a flip either way changes every edge pixel.
    const reg = createRegistry();
    defineTexture(
      'texture:ramp',
      {
        description: 'A ramp in x and y.',
        size: [32, 16],
        create: () => (x, y, texel) => void texel.color.splice(0, 3, y * 16, x * 8, 0),
      },
      reg,
    );
    const sheet = textureSheet([bakeTexture('texture:ramp', reg)]);
    expect([sheet.width, sheet.height]).toEqual([408, 160]);
    const pixel = (x: number, y: number) => [...sheet.rgba.slice((y * 408 + x) * 4, (y * 408 + x) * 4 + 3)];
    // Scaled 2×: 64 px tall, each texel 2 px; down the panel's left column the rows go 15 … 0, twice.
    const rows = Array.from({ length: 64 }, (_, y) => pixel(8, 8 + y)[0] / 16);
    expect(rows).toEqual(Array.from({ length: 64 }, (_, y) => 15 - (Math.floor(y / 2) % 16)));
    // Along its top row the columns go 0 … 31, twice.
    const columns = Array.from({ length: 128 }, (_, x) => pixel(8 + x, 8)[1] / 8);
    expect(columns).toEqual(Array.from({ length: 128 }, (_, x) => Math.floor(x / 2) % 32));
    expect(pixel(8, 8 + 64)).toEqual([27, 27, 36]);

    // Real textures that differ top to bottom: the panel's top row is the map's top row (h - 1), sampled along x as
    // above, and its bottom row is row 0. The grass (64 × 64) fills 128 × 128 px, the staves (48 × 16) 128 × 43 px.
    for (const [id, tall] of [
      ['texture:grass', 128],
      ['texture:staves', 43],
    ] as const) {
      const bake = bakeTexture(id);
      const scale = 128 / (2 * Math.max(bake.width, bake.height));
      const row = (y: number) =>
        Array.from({ length: 128 }, (_, x) => {
          const from = (y * bake.width + (Math.floor(x / scale) % bake.width)) * 4;
          return [...bake.map.slice(from, from + 3)];
        });
      expect(row(bake.height - 1)).not.toEqual(row(0));
      const single = textureSheet([bake]);
      const drawn = (y: number) =>
        Array.from({ length: 128 }, (_, x) => [...single.rgba.slice((y * 408 + 8 + x) * 4, (y * 408 + 8 + x) * 4 + 3)]);
      expect(drawn(8)).toEqual(row(bake.height - 1));
      expect(drawn(8 + tall - 1)).toEqual(row(0));
      expect(drawn(8 + tall)[0]).toEqual([27, 27, 36]);
    }
  });

  it('fails new problems and passes ones the baseline accepts with a reason', async () => {
    const reg = faulty();
    const only: QaFamily = { run: () => checkTextures(reg, ['texture:hot']) };
    const root = repository({});
    const failing = await runQa(root, 'tex', [], async () => only);
    expect(failing.failures.map((f) => f.id)).toEqual(['QA_TEX']);
    mkdirSync(join(root, 'tests', 'baselines'), { recursive: true });
    const accepted = [{ id: 'texture:hot', metric: 'range', value: 4096, reason: 'a test: a seeded fault' }];
    writeFileSync(join(root, 'tests', 'baselines', 'qa-tex.json'), JSON.stringify(accepted));
    const passing = await runQa(root, 'tex', [], async () => only);
    expect([passing.failures, passing.accepted]).toEqual([[], 1]);
  });
});
