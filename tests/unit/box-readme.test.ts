/**
 * @file The README check (PLAN.md §9.0, §5.8: shardfall's station guides held to the code; WP 2.7): every claim
 * labs/box/README.md makes in code spans must hold. A setting path names a declared setting; a file or directory
 * exists; `node x <cmd>` names a command, flags it takes and settings for `--set` and `node x set <path> <value>`,
 * `npm run <script>` a script of package.json and files that exist; a URL's parameters are routes or settings;
 * `box:<name>` is a registered scene; `cam=…` is a camera code; `__engine.<member>` is a member `help()` lists. A
 * fixture README that names a missing setting, file, command, flag or member fails with one line each. And the
 * other way round (gate G7's review): every scene the modules of labs/box/scenes/ register has a row in the demo index
 * (its file or its id), and every `box.*` setting they declare a row in the settings table; a fixture README that
 * leaves one out fails, naming it. The checks are tests/unit/readmeClaims.ts's, shared with the playground's README
 * test.
 * @see labs/box/README.md
 */
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registry } from '../../engine/core/registry';
import { ROOT } from '../../tools/x';
import '../../labs/box/scenes/room';
import { missingProblems, readmeProblems, type ReadmeLab } from './readmeClaims';

/** The box's scene modules (tests aside), imported once so their scenes and settings are registered. */
const SCENE_MODULES = globSync('labs/box/scenes/*.ts', { cwd: ROOT }).filter((file) => !file.endsWith('.test.ts'));
for (const file of SCENE_MODULES.sort()) await import(join(ROOT, file));

/** The box, as the README checks read it: its scenes are `box:<name>`; the room lists the members. */
const BOX: ReadmeLab = { lab: 'box', scene: 'box:room' };

describe('labs/box/README.md', () => {
  it('has a demo index row for every box scene and a settings row for every box setting', () => {
    const scenes = registry.list('scene').flatMap(({ id }) => (id.startsWith('box:') ? [id] : []));
    const settings = registry.list('setting').flatMap(({ id }) => (id.startsWith('box.') ? [id] : []));
    expect(scenes.length).toBeGreaterThanOrEqual(9);
    expect(settings.length).toBeGreaterThanOrEqual(12);
    const text = readFileSync(join(ROOT, 'labs/box/README.md'), 'utf8');
    expect(missingProblems(text, 'box', scenes, settings)).toEqual([]);
  });

  it('fails a fixture README that leaves a scene or a setting out', () => {
    const fixture = [
      '## The demo index',
      '',
      '| Scene | What it proves | The command that shows it |',
      '|---|---|---|',
      '| `labs/box/scenes/room.ts` | Box 1. | `node x sim labs/box/scenes/room` |',
      '',
      '## Settings',
      '',
      '| Setting | What it tunes |',
      '|---|---|',
      '| `box.room.speed` | How fast. |',
      '',
      '## The page',
    ].join('\n');
    const scenes = ['box:room', 'box:hall', 'box:fight-1000'];
    expect(missingProblems(fixture, 'box', scenes, ['box.room.speed', 'box.room.movers'])).toEqual([
      'the demo index has no row for the scene box:hall (labs/box/scenes/hall.ts)',
      'the demo index has no row for the scene box:fight-1000 (labs/box/scenes/fight-1000.ts)',
      'the settings table has no row for box.room.movers',
    ]);
  });

  it('names only settings, files, commands, flags, scenes, cameras and members that exist', async () => {
    expect(await readmeProblems(readFileSync(join(ROOT, 'labs/box/README.md'), 'utf8'), BOX)).toEqual([]);
  });

  it('fails a fixture README that names a missing setting, file, command, flag or member', async () => {
    const fixture = [
      'Tune `box.room.sped` (a typo), read `labs/box/levels/crypt.txt`, run `node x flim labs/box` (a typo) and',
      '`node x shot labs/box --angle 3 --set box.room.slow=1`, open `labs/box/?box.room.fast=2`, call `__engine.fps()`,',
      'set one with `node x set box.room.sped 3`.',
    ].join('\n');
    expect(await readmeProblems(fixture, BOX)).toEqual([
      '`box.room.sped` names the setting box.room.sped, which nobody declares',
      '`labs/box/levels/crypt.txt` names labs/box/levels/crypt.txt, which does not exist',
      '`node x flim labs/box` runs x flim, which is no command',
      '`node x shot labs/box --angle 3 --set box.room.slow=1` gives x shot the flag --angle, which it does not take',
      '`node x shot labs/box --angle 3 --set box.room.slow=1` names the setting box.room.slow, which nobody declares',
      '`labs/box/?box.room.fast=2` names the setting box.room.fast, which nobody declares',
      '`__engine.fps()` calls __engine.fps, which help() does not list',
      '`node x set box.room.sped 3` names the setting box.room.sped, which nobody declares',
    ]);
  });
});
