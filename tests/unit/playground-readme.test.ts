/**
 * @file The playground's README check (PLAN.md WP 13.1, as WP 2.7's for the box): every claim labs/playground/README.md
 * makes in code spans holds (a setting, file, command, flag, scene, camera code or `__engine` member it names exists),
 * every scene the modules of labs/playground/scenes/ register has a row in its demo index, and every `playground.*`
 * setting a row in its settings table. The checks are tests/unit/readmeClaims.ts's; tests/unit/box-readme.test.ts
 * proves each fails on a fixture README.
 * @see labs/playground/README.md
 */
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registry } from '../../engine/core/registry';
import { ROOT } from '../../tools/x';
import '../../labs/playground/menu';
import '../../labs/playground/looks/cel';
import '../../labs/playground/looks/pixel';
import { missingProblems, readmeProblems } from './readmeClaims';

/** The playground's scene modules (tests aside), imported once so their scenes and settings are registered. */
const SCENE_MODULES = globSync('labs/playground/scenes/*.ts', { cwd: ROOT }).filter(
  (file) => !file.endsWith('.test.ts'),
);
for (const file of SCENE_MODULES.sort()) await import(join(ROOT, file));

/** The README, as it is. */
const README = readFileSync(join(ROOT, 'labs/playground/README.md'), 'utf8');

describe('labs/playground/README.md', () => {
  it('has a demo index row for every playground scene and a settings row for every playground setting', () => {
    const scenes = registry.list('scene').flatMap(({ id }) => (id.startsWith('playground:') ? [id] : []));
    const settings = registry.list('setting').flatMap(({ id }) => (id.startsWith('playground.') ? [id] : []));
    expect(scenes).toContain('playground:gym');
    expect(settings.length).toBeGreaterThanOrEqual(3);
    expect(missingProblems(README, 'playground', scenes, settings)).toEqual([]);
  });

  it('names only settings, files, commands, flags, scenes, cameras and members that exist', async () => {
    expect(await readmeProblems(README, { lab: 'playground', scene: 'playground:gym' })).toEqual([]);
  });
});
