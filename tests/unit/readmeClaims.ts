/**
 * @file The README checks a lab's README test runs (PLAN.md §9.0, §5.8: shardfall's station guides held to the code;
 * WP 2.7, WP 13.1): every claim a lab's README makes in code spans must hold, and every scene and setting of the lab
 * has its row. `readmeProblems(text, lab)` checks the claims: a setting path names a declared setting; a file or
 * directory exists; `node x <cmd>` names a command, flags it takes and settings for `--set` and
 * `node x set <path> <value>`, `npm run <script>` a script of package.json and files that exist; a URL's parameters
 * are routes or settings; `<lab>:<name>` is a registered scene; `cam=…` is a camera code; `__engine.<member>` is a
 * member `help()` lists. `missingProblems(text, lab, scenes, settings)` checks the other way round: every scene of the
 * lab has a row in the demo index (its file or its id), and every setting a row in the settings table.
 *
 * tests/unit/box-readme.test.ts runs them on labs/box/README.md (with the fixtures that prove each check fails) and
 * tests/unit/playground-readme.test.ts on labs/playground/README.md. Each problem is one sentence.
 *
 * @example
 * // missingProblems(text, 'box', ['box:hall'], []); // ['the demo index has no row for the scene box:hall (…)']
 * // await readmeProblems('`box.room.sped`', { lab: 'box', scene: 'box:room' }); // ['`box.room.sped` names …']
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHeadless } from '../../engine';
import { ROUTE_KEYS } from '../../engine/app/routes';
import { registry } from '../../engine/core/registry';
import { readCameraCode } from '../../engine/gfx/cameras/place';
import { loadSettings } from '../../tools/cmd/set';
import { commandNames, loadCommand, ROOT } from '../../tools/x';

/** A lab whose README is checked: its name (`box`, the scenes' prefix) and a scene that lists the members. */
export interface ReadmeLab {
  readonly lab: string;
  readonly scene: string;
}

/** The text under the heading `heading` in `markdown` (up to the next `##` heading); '' without it. */
export function section(markdown: string, heading: string): string {
  const text = `\n${markdown}`;
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + heading.length + 2);
  return text.slice(start, next < 0 ? undefined : next);
}

/**
 * What the README leaves out of `scenes` (`<lab>:<name>` ids) and `settings` (paths), one sentence each: a scene
 * needs a row in the demo index naming its file or id, a setting a row in the settings table.
 */
export function missingProblems(
  text: string,
  lab: string,
  scenes: readonly string[],
  settings: readonly string[],
): string[] {
  const index = section(text, '## The demo index');
  const table = section(text, '## Settings');
  const problems: string[] = [];
  for (const id of scenes) {
    const file = `labs/${lab}/scenes/${id.slice(lab.length + 1)}.ts`;
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
export async function readmeProblems(text: string, { lab, scene }: ReadmeLab): Promise<string[]> {
  await loadSettings(ROOT);
  const engine = await createHeadless({ scene });
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
  const scenes = new RegExp(`^${lab}:`);
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
    } else if (scenes.test(span)) {
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
