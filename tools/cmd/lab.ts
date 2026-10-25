/**
 * @file `node x lab` (PLAN.md WP 10.8): keeps the labs index, labs/labs.json, which the index page (labs/index/) and
 * the labs suite (tests/e2e/labs.spec.ts) read through labs/index/labs.ts, which this command loads by path where the
 * checkout has it (a game made from the engine gets tools/, never the labs: tools/game/imports.test.ts). Ported from
 * `my-3d2dge:tools/labs-test.mjs` (its checks), with a temporary lab's `answer` and `expires` added.
 * - `list` (the default) prints every page and lab with its links and its `x` command, and fails on a temporary lab
 *   past its `expires` date (settle it: `answer`, then `rm`, or keep it as a lab) and on any problem with the file
 *   (`checkLabs`), each naming its fix.
 * - `add <page> --title … --what … --command … --question … [--days 14] [--link label=suffix]…` adds a temporary lab
 *   for the page directory `labs/<page>/` (which must exist), added today, expiring `days` later; its links default to
 *   `Open`. `answer <page> <text>` records a temporary lab's answer once it is settled. `rm <page>` takes a temporary
 *   lab off the index (its directory stays: deleting it is a change of its own).
 *
 * Usage: node x lab [list | add <page> | answer <page> <text> | rm <page>] [flags]. Exit 0; 1 on an expired lab or a
 * problem with the file; 2 on a usage error.
 * @see tools/cmd/lab.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UsageError, type Command, type CommandResult } from '../x';

/** A lab of the index, as labs/index/labs.ts's `LabRecord` has it (the fields this command writes and reads). */
interface LabRecord {
  page: string;
  title: string;
  what: string;
  command: string;
  links: [label: string, suffix: string][];
  added?: string;
  question?: string;
  answer?: string;
  expires?: string;
}

/** labs/labs.json, as labs/index/labs.ts's `LabsIndex` has it. */
interface LabsIndex {
  $about: string;
  sections: { id: string; title: string; entries: LabRecord[] }[];
}

/** What this command calls of labs/index/labs.ts. */
interface LabsModel {
  checkLabs(index: LabsIndex): string[];
  expiredLabs(index: LabsIndex, today: string): LabRecord[];
}

/** The index's model, beside the index in the engine's checkout. */
export const LABS_MODEL = 'labs/index/labs.ts';

/** The index's model, loaded by path from the checkout at `root`. */
const labsModel = (root: string): Promise<LabsModel> => import(pathToFileURL(join(root, LABS_MODEL)).href);

/** The index's file, from the repository root. */
export const LABS_FILE = 'labs/labs.json';
/** How long a temporary lab lasts by default, in days. */
export const LAB_DAYS = 14;

const SUBCOMMANDS = ['list', 'add', 'answer', 'rm'] as const;
const day = (date: Date) => date.toISOString().slice(0, 10);

/** Builds the command; tests inject the day. */
export function createLabCommand(options: { today?: () => string } = {}): Command {
  const today = options.today ?? (() => day(new Date()));
  return {
    usage:
      'lab [list | add <page> | answer <page> <text> | rm <page>] [--title --what --command --question --days --link]',
    options: {
      ...Object.fromEntries(['title', 'what', 'command', 'question', 'days'].map((f) => [f, { type: 'string' as const }])), // prettier-ignore
      link: { type: 'string', multiple: true },
    },
    maxPositionals: 3,
    async run({ positionals, values, root }): Promise<CommandResult> {
      const [sub = 'list', page, text] = positionals;
      if (!(SUBCOMMANDS as readonly string[]).includes(sub))
        throw new UsageError(`lab takes ${SUBCOMMANDS.join(', ')}, not ${sub}`);
      const path = join(root, LABS_FILE);
      if (!existsSync(path) || !existsSync(join(root, LABS_MODEL)))
        throw new UsageError(`no ${LABS_FILE} and ${LABS_MODEL} here: the labs index is the engine's (labs/index/)`);
      const { checkLabs, expiredLabs } = await labsModel(root);
      const index = JSON.parse(readFileSync(path, 'utf8')) as LabsIndex;
      const temporary = index.sections.find((section) => section.id === 'temporary');
      if (!temporary) throw new Error(`${LABS_FILE} has no temporary section: add { "id": "temporary", … } back`);
      /** Writes the index as Prettier formats it, as the committed file is. */
      const write = async () => {
        const prettier = await import('prettier');
        const options = (await prettier.resolveConfig(path)) ?? {};
        writeFileSync(path, await prettier.format(JSON.stringify(index), { ...options, filepath: path }));
      };
      const find = (name: string | undefined, verb: string): LabRecord => {
        if (!name) throw new UsageError(`lab ${verb} needs the lab's page: one of ${temporary.entries.map((lab) => lab.page).join(', ') || 'none yet'}`); // prettier-ignore
        const lab = temporary.entries.find((entry) => entry.page === name);
        if (!lab) throw new UsageError(`no temporary lab ${name} to ${verb}: node x lab list shows them`);
        return lab;
      };
      if (sub === 'add') {
        if (!page || !/^[a-z][a-z0-9-]*$/.test(page)) throw new UsageError('lab add needs a page: a lowercase directory name under labs/'); // prettier-ignore
        if (!existsSync(join(root, 'labs', page, 'index.html')))
          throw new UsageError(`labs/${page}/index.html does not exist: make the page first (labs/index/lab.ts helps)`);
        const missing = ['title', 'what', 'command', 'question'].filter((flag) => typeof values[flag] !== 'string');
        if (missing.length) throw new UsageError(`lab add needs ${missing.map((flag) => `--${flag}`).join(', ')}`);
        const days = Number(values.days ?? LAB_DAYS);
        if (!Number.isInteger(days) || days < 1) throw new UsageError(`--days takes a whole number of days, 1 or more`);
        const added = today();
        const expires = day(new Date(Date.parse(added) + days * 86_400_000));
        const links = ((values.link as string[] | undefined) ?? ['Open=']).map((link): [string, string] => {
          const at = link.indexOf('=');
          if (at < 1) throw new UsageError(`--link takes label=suffix (suffix '', ?a=b or #x), not ${link}`);
          return [link.slice(0, at), link.slice(at + 1)];
        });
        const lab: LabRecord = { page, title: String(values.title), what: String(values.what), command: String(values.command), links, added, question: String(values.question), expires }; // prettier-ignore
        temporary.entries.push(lab);
        const problems = checkLabs(index);
        if (problems.length) throw new UsageError(problems[0]);
        await write();
        return { ok: true, summary: `added ${page}: it expires ${expires}`, target: 'add' };
      }
      if (sub === 'answer') {
        const lab = find(page, 'answer');
        if (!text) throw new UsageError('lab answer needs the answer, in a few words');
        lab.answer = text;
        await write();
        return { ok: true, summary: `${page}: answered; take it off with node x lab rm ${page} or keep it as a lab`, target: 'answer' }; // prettier-ignore
      }
      if (sub === 'rm') {
        const lab = find(page, 'rm');
        temporary.entries.splice(temporary.entries.indexOf(lab), 1);
        await write();
        return { ok: true, summary: `took ${page} off the index (labs/${page}/ stays)`, target: 'rm' };
      }
      const failures = [
        ...checkLabs(index).map((message) => ({ id: 'LAB_BAD_INDEX', message, file: LABS_FILE })),
        ...expiredLabs(index, today()).map((lab) => ({ id: 'LAB_EXPIRED', message: `${lab.page} expired on ${lab.expires}: settle it (node x lab answer ${lab.page} "…", then node x lab rm ${lab.page}) or move it to the labs kept`, file: LABS_FILE })), // prettier-ignore
      ];
      const lines = index.sections.flatMap(
        (section) =>
        section.entries.map((lab) => `${section.id}: ${lab.page}: ${lab.links.map(([label]) => label).join(', ')} · ${lab.command}${lab.expires ? ` (expires ${lab.expires})` : ''}`), // prettier-ignore
      );
      const count = index.sections.reduce((sum, section) => sum + section.entries.length, 0);
      return { ok: failures.length === 0, summary: `${count} labs and pages, ${temporary.entries.length} temporary`, lines, failures, target: 'list', metrics: { labs: count, temporary: temporary.entries.length } }; // prettier-ignore
    },
  };
}

export default createLabCommand();
