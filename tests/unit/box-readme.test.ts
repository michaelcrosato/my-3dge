/**
 * @file The README check (PLAN.md §9.0, §5.8: shardfall's station guides held to the code; WP 2.7): every claim
 * labs/box/README.md makes in code spans must hold. A setting path names a declared setting; a file or directory
 * exists; `node x <cmd>` names a command, flags it takes and settings for `--set` and `node x set <path> <value>`,
 * `npm run <script>` a script of package.json and files that exist; a URL's parameters are routes or settings;
 * `box:<name>` is a registered scene; `cam=…` is a camera code; `__engine.<member>` is a member `help()` lists. A
 * fixture README that names a missing setting, file, command, flag or member fails with one line each. And the
 * other way round (gate G7's review): every scene the modules of labs/box/scenes/ register has a row in the demo index
 * (its file or its id), and every `box.*` setting they declare a row in the settings table; a fixture README that
 * leaves one out fails, naming it.
 * @see labs/box/README.md
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../engine';
import { ROUTE_KEYS } from '../../engine/app/routes';
import { registry } from '../../engine/core/registry';
import { readCameraCode } from '../../engine/gfx/cameras/place';
import { loadSettings } from '../../tools/cmd/set';
import { commandNames, loadCommand, ROOT } from '../../tools/x';
import '../../labs/box/scenes/room';

/** The box's scene modules (tests aside), imported once so their scenes and settings are registered. */
const SCENE_MODULES = globSync('labs/box/scenes/*.ts', { cwd: ROOT }).filter((file) => !file.endsWith('.test.ts'));
for (const file of SCENE_MODULES.sort()) await import(join(ROOT, file));

/** The rows of the table under the heading `heading` in `text` (up to the next heading). */
function section(markdown: string, heading: string): string {
  const text = `\n${markdown}`;
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + heading.length + 2);
  return text.slice(start, next < 0 ? undefined : next);
}

/**
 * What the README leaves out of `scenes` (`box:<name>` ids) and `settings` (`box.*` paths), one sentence each: a scene
 * needs a row in the demo index naming its file or id, a setting a row in the settings table.
 */
function missingProblems(text: string, scenes: readonly string[], settings: readonly string[]): string[] {
  const index = section(text, '## The demo index');
  const table = section(text, '## Settings');
  const problems: string[] = [];
  for (const id of scenes) {
    const file = `labs/box/scenes/${id.slice('box:'.length)}.ts`;
    const rows = index.split('\n').filter((line) => line.startsWith('| '));
    if (!rows.some((row) => row.includes(`\`${file}\``) || row.includes(`\`${id}\``))) {
      problems.push(`the demo index has no row for the scene ${id} (${file})`);
    }
  }
  for (const path of settings) {
    if (!table.includes(`| \`${path}\` |`)) problems.push(`the settings table has no row for ${path}`);
  }
  return problems;
}

/** A setting path: dotted lower-case words, such as box.room.speed. */
const SETTING = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;
/** A file name ending: what makes a dotted span a path. */
const FILE = /\.(ts|txt|json|md|html|js)$/;

/** Every problem with the claims in `text`'s code spans, one sentence each ([] when all hold). */
async function readmeProblems(text: string): Promise<string[]> {
  await loadSettings(ROOT);
  const engine = await createHeadless({ scene: 'box:room' });
  const members = engine
    .help()
    .split('\n')
    .map((line) => line.split(/[\s(]/)[0]);
  const commands = commandNames(ROOT);
  const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: object };
  const problems: string[] = [];
  const setting = (path: string, where: string) => {
    if (!registry.has('setting', path)) problems.push(`${where} names the setting ${path}, which nobody declares`);
  };
  const file = (path: string, where: string) => {
    if (path.includes('<')) return; // a placeholder: labs/box/scenes/<name>
    const found = path.includes('*')
      ? globSync(path, { cwd: ROOT }).length > 0
      : existsSync(join(ROOT, path)) || existsSync(join(ROOT, `${path}.ts`)); // a module, as imports name it
    if (!found) problems.push(`${where} names ${path}, which does not exist`);
  };
  const query = (search: string, where: string) => {
    for (const key of new URLSearchParams(search).keys()) {
      if (!(ROUTE_KEYS as readonly string[]).includes(key)) setting(key, where);
    }
  };
  const command = async (words: string[], where: string) => {
    const [name, ...rest] = words;
    if (!commands.includes(name)) return void problems.push(`${where} runs x ${name}, which is no command`);
    const { options } = await loadCommand(ROOT, name);
    const [first] = rest.filter((word, i) => !word.startsWith('-') && rest[i - 1]?.startsWith('--') !== true);
    if (name === 'set' && first !== undefined && !first.includes('<')) setting(first, where); // x set <path> <value>
    rest.forEach((word, i) => {
      if (word.startsWith('--') && !Object.hasOwn(options, word.slice(2))) {
        problems.push(`${where} gives x ${name} the flag ${word}, which it does not take`);
      }
      if (rest[i - 1] === '--set') setting(word.split('=')[0], where);
      if (!word.startsWith('-') && rest[i - 1]?.startsWith('--') !== true && /\//.test(word))
        file(word.split('?')[0], where);
    });
  };
  for (const [, span] of text.matchAll(/`([^`]+)`/g)) {
    const where = `\`${span}\``;
    if (span.startsWith('node x ')) await command(span.slice('node x '.length).split(/\s+/), where);
    else if (span.startsWith('npm run ')) {
      const [script, ...files] = span.slice('npm run '.length).split(/\s+/);
      if (!Object.hasOwn(scripts, script)) problems.push(`${where} runs npm run ${script}, which package.json lacks`);
      for (const word of files) if (word !== '--') file(word, where);
    } else if (span.startsWith('__engine.')) {
      const name = /^__engine\.([\w.]+?)(?:\(|$)/.exec(span)?.[1] ?? '';
      if (!members.includes(name)) problems.push(`${where} calls __engine.${name}, which help() does not list`);
      for (const [, path] of span.matchAll(/'([a-z][\w.]+)'/g)) if (SETTING.test(path)) setting(path, where);
    } else if (span.startsWith('?')) query(span, where);
    else if (span.includes('/') || FILE.test(span)) {
      const [path, search] = span.split('?');
      file(path, where);
      if (search) query(search, where);
    } else if (/^box:/.test(span)) {
      if (!registry.has('scene', span)) problems.push(`${where} names a scene nobody registers`);
    } else if (/^cam3?=/.test(span)) {
      try {
        readCameraCode(span);
      } catch (error) {
        problems.push(`${where} is no camera code: ${(error as Error).message}`);
      }
    } else if (SETTING.test(span)) setting(span, where);
  }
  return problems;
}

describe('labs/box/README.md', () => {
  it('has a demo index row for every box scene and a settings row for every box setting', () => {
    const scenes = registry.list('scene').flatMap(({ id }) => (id.startsWith('box:') ? [id] : []));
    const settings = registry.list('setting').flatMap(({ id }) => (id.startsWith('box.') ? [id] : []));
    expect(scenes.length).toBeGreaterThanOrEqual(9);
    expect(settings.length).toBeGreaterThanOrEqual(12);
    const text = readFileSync(join(ROOT, 'labs/box/README.md'), 'utf8');
    expect(missingProblems(text, scenes, settings)).toEqual([]);
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
    expect(missingProblems(fixture, scenes, ['box.room.speed', 'box.room.movers'])).toEqual([
      'the demo index has no row for the scene box:hall (labs/box/scenes/hall.ts)',
      'the demo index has no row for the scene box:fight-1000 (labs/box/scenes/fight-1000.ts)',
      'the settings table has no row for box.room.movers',
    ]);
  });

  it('names only settings, files, commands, flags, scenes, cameras and members that exist', async () => {
    expect(await readmeProblems(readFileSync(join(ROOT, 'labs/box/README.md'), 'utf8'))).toEqual([]);
  });

  it('fails a fixture README that names a missing setting, file, command, flag or member', async () => {
    const fixture = [
      'Tune `box.room.sped` (a typo), read `labs/box/levels/crypt.txt`, run `node x flim labs/box` (a typo) and',
      '`node x shot labs/box --angle 3 --set box.room.slow=1`, open `labs/box/?box.room.fast=2`, call `__engine.fps()`,',
      'set one with `node x set box.room.sped 3`.',
    ].join('\n');
    expect(await readmeProblems(fixture)).toEqual([
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
