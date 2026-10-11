/**
 * @file The README check (PLAN.md §9.0, §5.8: shardfall's station guides held to the code; WP 2.7): every claim
 * labs/box/README.md makes in code spans must hold. A setting path names a declared setting; a file or directory
 * exists; `node x <cmd>` names a command, flags it takes and settings for `--set` and `node x set <path> <value>`,
 * `npm run <script>` a script of package.json and files that exist; a URL's parameters are routes or settings;
 * `box:<name>` is a registered scene; `cam=…` is a camera code; `__engine.<member>` is a member `help()` lists. A
 * fixture README that names a missing setting, file, command, flag or member fails with one line each.
 * @see labs/box/README.md
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../engine';
import { ROUTE_KEYS } from '../../engine/app/routes';
import { registry } from '../../engine/core/registry';
import { parseCameraCode } from '../../engine/gfx/cameras/codes';
import { loadSettings } from '../../tools/cmd/set';
import { commandNames, loadCommand, ROOT } from '../../tools/x';
import '../../labs/box/scenes/room';

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
        parseCameraCode(span);
      } catch (error) {
        problems.push(`${where} is no camera code: ${(error as Error).message}`);
      }
    } else if (SETTING.test(span)) setting(span, where);
  }
  return problems;
}

describe('labs/box/README.md', () => {
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
