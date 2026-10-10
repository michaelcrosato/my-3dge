/**
 * @file The `tex` QA family in T1 (tools/qa/tex.ts, PLAN.md §8.6): the engine's textures pass against
 * tests/baselines/qa-tex.json; on a registry with seeded faults, a generator that does not wrap gives `seamDelta` and
 * `period`, one with values out of range gives `range`, one that throws gives `bake`, each once, valued by the worst
 * bake and naming it; a game's texture modules are found under `labs/<name>/textures/`;
 * `--only` and a baseline entry accepting a known problem work through `runQa`.
 * @see tools/qa/tex.ts
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../../engine/core/registry';
import { defineTexture } from '../../engine/gfx/textures/texture';
import { runQa, type QaFamily } from '../cmd/qa';
import { ROOT } from '../x';
import family, { checkTextures, textureModules } from './tex';

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

  it("finds a game's texture modules and honours --only", async () => {
    const root = repository({
      'labs/box/textures/moss.ts': 'export {};\n',
      'labs/box/textures/moss.test.ts': 'export {};\n',
      'labs/box/levels/hall.txt': '#\n',
      'labs/hello/textures/sample.ts': 'export {};\n',
    });
    expect(textureModules(root)).toEqual(['labs/box/textures/moss.ts', 'labs/hello/textures/sample.ts']);
    expect(await family.run({ root, only: ['texture:brick'] })).toEqual([]);
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
