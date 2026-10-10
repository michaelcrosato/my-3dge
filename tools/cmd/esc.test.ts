/**
 * @file Tests `x esc` (tools/cmd/esc.ts, tools/lib/escalations.ts) in temporary directories on a virtual clock: an
 * escalation opened, its deadline passed, a call recorded and the record closed; the status rules; `--no-wait`;
 * usage errors; every malformed record, a duplicate id and a stale README failing `x check`; the README
 * regenerating Prettier-clean; the front matter round-tripping; and a smoke run on the repository.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { check as prettierCheck, resolveConfig } from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';
import {
  INDEX,
  parseRecord,
  serializeRecord,
  slugOf,
  validateFields,
  writeIndex,
  type Escalation,
} from '../lib/escalations';
import { dispatch, ROOT } from '../x';
import { discoverPlugins } from './check';
import { checkEscalations, createEscCommand, runId } from './esc';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository root holding `files`, with the repository's Prettier settings. */
function sandbox(files: Record<string, string> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'x-esc-')));
  temporary.push(root);
  const all = {
    'package.json': '{ "version": "0.0.0" }\n',
    '.prettierrc.json': readFileSync(join(ROOT, '.prettierrc.json'), 'utf8'),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A virtual clock from 2026-10-10 12:00 UTC, moved on by hand: nothing really waits. */
function virtualClock() {
  let ms = Date.parse('2026-10-10T12:00:00Z');
  return { now: () => new Date(ms), advance: (minutes: number) => void (ms += minutes * 60_000) };
}
type Clock = ReturnType<typeof virtualClock>;

/** Runs `node x esc <argv…>` in `root` on `clock`; returns the exit code and the printed lines. */
async function esc(root: string, clock: Clock, ...argv: string[]) {
  const printed: string[] = [];
  const commands = { esc: async () => createEscCommand({ now: clock.now, env: { X_RUN: 'run-1' } }) };
  const code = await dispatch(['esc', ...argv], { root, commands, print: (line) => printed.push(line) });
  return { code, printed, text: printed.join('\n') };
}

/** The record whose file starts with `id`, parsed. */
function record(root: string, id: string) {
  const file = readdirSync(join(root, 'docs/escalations')).find((name) => name.startsWith(`${id}-`)) ?? '?';
  return { file, ...parseRecord(readFileSync(join(root, 'docs/escalations', file), 'utf8')) };
}

const readme = (root: string) => readFileSync(join(root, INDEX), 'utf8');
const SKY = ['--option', 'Generate the sky procedurally', '--option', 'Commit the PNG', '--recommend', '1'];
const openSky = (root: string, clock: Clock, ...extra: string[]) =>
  esc(root, clock, 'open', 'Commit a PNG sky texture?', '--principle', 'assets', ...SKY, ...extra);

describe('an escalation, from open to closed', () => {
  it('opens, passes its deadline on a virtual clock, records a call, closes, and regenerates the README', async () => {
    const root = sandbox();
    const clock = virtualClock();
    const opened = await openSky(root, clock, '--why', 'The sky needs detail.');
    expect(opened.code).toBe(0);
    expect(opened.printed[0]).toBe('x esc: ok: ESC-0001 opened (Assets); post the message below');
    expect(opened.printed).toContain('  ESC-0001 (Assets): Commit a PNG sky texture?');
    expect(opened.printed).toContain('  1. Generate the sky procedurally (recommended)');
    expect(opened.text).toContain('Reply by 12:15 UTC (2026-10-10T12:15:00Z)');
    const first = record(root, 'ESC-0001');
    expect(first.file).toBe('ESC-0001-commit-a-png-sky-texture.md');
    expect(first.fields).toEqual({
      ...{ id: 'ESC-0001', title: 'Commit a PNG sky texture?', status: 'open', principle: 'Assets' },
      ...{ raised: '2026-10-10T12:00:00Z', deadline: '2026-10-10T12:15:00Z', run: 'run-1' },
      ...{ options: ['Generate the sky procedurally', 'Commit the PNG'], recommendation: 1 },
      ...{ answer: null, call: null, commit: null, followUp: null },
    });
    expect(first.body).toContain('The sky needs detail.');

    clock.advance(15);
    expect((await checkEscalations(root, { now: clock.now(), lane: false })).failures).toEqual([]);
    clock.advance(1);
    const late = await checkEscalations(root, { now: clock.now(), lane: false });
    expect(late.failures.map((f) => f.id)).toEqual(['ESC_OVERDUE']);
    expect(late.failures[0].message).toContain('decide or answer ESC-0001');
    const inLane = await checkEscalations(root, { now: clock.now(), lane: true });
    expect([inLane.failures.length, inLane.warnings?.map((f) => f.id)]).toEqual([0, ['ESC_OVERDUE']]);
    expect((await esc(root, clock, 'list', '--open')).printed[1]).toContain('OVERDUE: decide or answer it');

    const call = 'Generated the sky procedurally: the doctrine prefers procedural assets';
    const decided = await esc(root, clock, 'decide', 'ESC-0001', '--call', call, '--commit', 'ABC1234');
    expect(decided.code).toBe(0);
    expect(record(root, 'ESC-0001').fields).toMatchObject({ status: 'decided-in-absence', call, commit: 'abc1234' });
    expect(await checkEscalations(root, { now: clock.now(), lane: false })).toMatchObject({ failures: [] });
    const review = readme(root);
    expect(review).toContain("## Calls awaiting the owner's review (1)");
    expect(review).toContain('[ESC-0001](ESC-0001-commit-a-png-sky-texture.md)');
    expect(review.indexOf('## Calls awaiting')).toBeLessThan(review.indexOf('## Open (0)'));

    clock.advance(60);
    expect((await esc(root, clock, 'close', '1', '--follow-up', 'Keep the call')).code).toBe(0);
    const closed = record(root, 'ESC-0001');
    expect(closed.fields).toMatchObject({ status: 'closed', call, followUp: 'Keep the call' });
    expect(closed.body).toContain('- 2026-10-10T12:00:00Z: opened, waiting until 2026-10-10T12:15:00Z (run run-1).');
    expect(closed.body).toContain(`- 2026-10-10T12:16:00Z: decided in the owner's absence at abc1234: ${call}.`);
    expect(closed.body).toContain('- 2026-10-10T13:16:00Z: closed by the owner. Follow-up: Keep the call');
    expect(readme(root)).toContain('## Closed (1)');
    expect((await esc(root, clock, 'list', '--open')).printed[1]).toBe('no records');
    expect(await checkEscalations(root, { now: clock.now(), lane: false })).toMatchObject({ failures: [] });
    const options = (await resolveConfig(join(root, INDEX))) ?? {};
    expect(await prettierCheck(readme(root), { ...options, filepath: join(root, INDEX) })).toBe(true);
  });

  it('numbers on, says when it does not wait, and keeps to the status rules', async () => {
    const root = sandbox();
    const clock = virtualClock();
    await openSky(root, clock);
    const question = 'Add a runtime dependency for YAML?';
    const noWait = await esc(
      root,
      clock,
      'open',
      question,
      '--principle',
      'common ground, MASTERY',
      ...SKY,
      '--no-wait',
    );
    expect(noWait.code).toBe(0);
    expect(noWait.text).toContain('Not waiting (reported without stopping): I take option 1 now');
    expect(noWait.text).toContain('Next: node x esc decide ESC-0002');
    const second = record(root, 'ESC-0002');
    expect([second.file, second.fields.principle]).toEqual([
      `ESC-0002-${slugOf(question)}.md`,
      'Common ground, Mastery',
    ]);
    expect(second.body).toContain('opened without waiting (--no-wait');

    expect((await esc(root, clock, 'answer', 'ESC-0002', 'Write the reader ourselves')).code).toBe(0);
    expect(record(root, 'ESC-0002').fields).toMatchObject({ status: 'answered', answer: 'Write the reader ourselves' });
    const refused = await esc(root, clock, 'decide', 'ESC-0002', '--call', 'x', '--commit', 'abc1234');
    expect([refused.code, refused.text]).toEqual([1, expect.stringContaining('ESC_STATE: ESC-0002 was answered')]);

    clock.advance(20);
    expect((await esc(root, clock, 'decide', 'ESC-0001', '--call', 'Generated it', '--commit', 'abc1234')).code).toBe(
      0,
    );
    const again = await esc(root, clock, 'decide', 'ESC-0001', '--call', 'Generated it', '--commit', 'abc1234');
    expect([again.code, again.text]).toEqual([1, expect.stringContaining('ESC-0001 already has a call (at abc1234)')]);
    expect((await esc(root, clock, 'answer', '1', 'Fine, keep it')).code).toBe(0);
    expect(record(root, 'ESC-0001').fields).toMatchObject({ status: 'answered', call: 'Generated it' });

    expect((await esc(root, clock, 'close', 'ESC-0002')).code).toBe(0);
    const closed = await esc(root, clock, 'answer', 'ESC-0002', 'Changed my mind');
    expect([closed.code, closed.text]).toEqual([1, expect.stringContaining('ESC-0002 is closed')]);
    const all = await esc(root, clock, 'list');
    expect(all.printed[0]).toBe('x esc: ok: 2 records in all (0 calls awaiting review, 0 overdue)');
    expect(await checkEscalations(root, { now: clock.now(), lane: false })).toMatchObject({ failures: [] });
  });

  it('defaults the run to $X_RUN, else the Claude Code session, else local', () => {
    expect(runId('flag', { X_RUN: 'env' })).toBe('flag');
    expect(runId(undefined, { X_RUN: 'env', CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_1' })).toBe('env');
    expect(runId(undefined, { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_1', CLAUDE_CODE_SESSION_ID: 'uuid' })).toBe('cse_1');
    expect(runId(undefined, {})).toBe('local');
  });
});

describe('usage errors', () => {
  const sky = ['open', 'Commit a PNG?', '--principle', 'Assets'];
  it.each([
    [[], 'name a subcommand'],
    [['opne', 'Q?'], 'there is no x esc opne: did you mean open?'],
    [['open', 'Q?', '--principle', 'Asets', ...SKY], 'did you mean "Assets"?'],
    [['open', 'Q?', ...SKY], 'name the principle at stake'],
    [[...sky, '--option', 'Only one', '--recommend', '1'], 'give at least two choices'],
    [[...sky, '--option', 'A', '--option', 'B', '--recommend', '3'], '--recommend 1 to 2'],
    [[...sky, ...SKY, '--call', 'x'], 'x esc open takes --principle, --option, --recommend, --why, --run, --no-wait'],
    [['decide', 'ESC-0009', '--call', 'x', '--commit', 'abc1234'], 'there is no record ESC-0009'],
    [['decide', 'ESC-0001', '--call', 'x'], 'name the commit holding the work'],
    [['decide', 'ESC-0001', '--commit', 'abc1234'], 'say what was done and why'],
    [['answer', 'ESC-0001'], 'x esc answer takes ESC-NNNN "<answer>"'],
  ])('x esc %j exits 2: %s', async (argv, message) => {
    const root = sandbox();
    const clock = virtualClock();
    await openSky(root, clock);
    const result = await esc(root, clock, ...argv);
    expect([result.code, result.text]).toEqual([2, expect.stringContaining(message)]);
    expect(readdirSync(join(root, 'docs/escalations'))).toEqual(['ESC-0001-commit-a-png-sky-texture.md', 'README.md']);
  });
});

const VALID: Escalation = {
  ...{ id: 'ESC-0001', title: 'Commit a PNG?', status: 'open', principle: 'Assets', run: 'run-1' },
  ...{ raised: '2026-10-10T12:00:00Z', deadline: '2026-10-10T12:15:00Z', options: ['Generate it', 'Commit it'] },
  ...{ recommendation: 1, answer: null, call: null, commit: null, followUp: null },
};
const BODY = '# ESC-0001: Commit a PNG?\n\nWhy.';

describe('x check on the records', () => {
  it.each([
    ['ESC-0001-png.md', (t: string) => t.replace('run: run-1', 'run: run-1\ncolour: red'), 'unknown field "colour"'],
    ['ESC-0001-png.md', (t: string) => t.replace('run: run-1\n', ''), 'missing "run"'],
    ['ESC-0001-png.md', (t: string) => t.replace('status: open', 'status: pending'), '"status" must be open'],
    ['ESC-0001-png.md', (t: string) => t.replace('principle: Assets', 'principle: Speed'), '"principle": "Speed"'],
    ['ESC-0001-png.md', (t: string) => t.replace('principle: Assets', 'principle: assets'), 'spelled as'],
    ['ESC-0001-png.md', (t: string) => t.replace('12:15:00Z', '12:30:00Z'), '15 minutes after "raised"'],
    ['ESC-0001-png.md', (t: string) => t.replace('recommendation: 1', 'recommendation: 3'), '(1 to 2)'],
    ['ESC-0001-png.md', (t: string) => t.replace('  - "Commit it"\n', ''), 'at least two choices'],
    ['ESC-0001-png.md', (t: string) => t.replace('status: open', 'status: decided-in-absence'), 'needs its "call"'],
    ['ESC-0001-png.md', (t: string) => t.replace('call: null', 'call: Did it'), '"call" and "commit" go together'],
    ['ESC-0001-png.md', (t: string) => t.replace('commit: null', 'commit: nope'), '"commit" must be null or a commit'],
    ['ESC-0001-png.md', (t: string) => t.replace('answer: null', 'answer: Yes please'), 'an open record has no answer'],
    ['ESC-0001-png.md', (t: string) => t.replace('raised: 2026-10-10T12:00:00Z', 'raised: today'), '"raised" must be'],
    ['ESC-0001-png.md', (t: string) => t.replace('title: "Commit a PNG?"', 'title: "broken'), 'malformed quoted'],
    ['ESC-0002-png.md', (t: string) => t, '"id" is ESC-0001 but the file name says ESC-0002'],
    ['esc-1.md', (t: string) => t, 'the file name must be ESC-NNNN-<slug>.md'],
    ['ESC-0001-png.md', (t: string) => t.replace(/^---\n/, ''), 'no front matter'],
    ['ESC-0001-png.md', (t: string) => t.replace(/\n---\n[\s\S]*$/, '\n---\n'), 'a short body'],
  ])('%s fails when edited: %s', async (file, edit, problem) => {
    const root = sandbox({ [`docs/escalations/${file}`]: edit(serializeRecord(VALID, BODY)) });
    await writeIndex(root);
    const outcome = await checkEscalations(root, { now: new Date(VALID.raised), lane: false });
    expect(outcome.failures.length).toBeGreaterThan(0);
    expect(outcome.failures.filter((f) => f.id !== 'ESC_RECORD')).toEqual([]);
    expect(outcome.failures.map((f) => f.message).join('\n')).toContain(problem);
  });

  it('passes a well-formed record, and fails a duplicate id and a stale or missing README', async () => {
    const text = serializeRecord(VALID, BODY);
    const root = sandbox({ 'docs/escalations/ESC-0001-png.md': text });
    const at = { now: new Date(VALID.raised), lane: false };
    expect((await checkEscalations(root, at)).failures.map((f) => f.id)).toEqual(['ESC_INDEX_STALE']);
    expect((await esc(root, virtualClock(), 'list', '--write')).text).toContain(`wrote ${INDEX}`);
    expect(await checkEscalations(root, at)).toMatchObject({ failures: [], metrics: { records: 1, open: 1 } });
    writeFileSync(join(root, INDEX), `${readme(root)}\nA hand edit.\n`);
    expect((await checkEscalations(root, at)).failures.map((f) => f.id)).toEqual(['ESC_INDEX_STALE']);
    expect((await checkEscalations(root, { ...at, lane: true })).warnings?.map((f) => f.id)).toEqual([
      'ESC_INDEX_STALE',
    ]);
    writeFileSync(join(root, 'docs/escalations/ESC-0001-copy.md'), text);
    await writeIndex(root);
    const duplicate = await checkEscalations(root, at);
    expect(duplicate.failures.map((f) => f.id)).toEqual(['ESC_DUPLICATE']);
    expect(duplicate.failures[0].message).toContain('renumber the later one');
    expect(await checkEscalations(sandbox(), at)).toEqual({ failures: [], summary: 'no records' });
  });

  it('round-trips the front matter, quoting what YAML would misread', () => {
    const tricky = [
      'He said "no": #1 - really?',
      'null',
      'yes',
      '- dash first',
      '12',
      'Café, naïve: résumé',
      'back\\slash',
      'WebGPU only',
    ];
    for (const title of tricky) {
      const fields = { ...VALID, title, options: [title, 'B'], answer: title };
      const parsed = parseRecord(serializeRecord({ ...fields, status: 'answered' }, BODY));
      expect(parsed.fields).toEqual({ ...fields, status: 'answered' });
    }
    expect(serializeRecord(VALID, BODY)).toContain('\nid: ESC-0001\ntitle: "Commit a PNG?"\nstatus: open\n');
    expect(validateFields(parseRecord(serializeRecord(VALID, BODY)).fields, 'ESC-0001-png.md')).toEqual([]);
    expect(slugOf('Café: naïve résumé?')).toBe('cafe-naive-resume');
    expect(slugOf('a'.repeat(60))).toHaveLength(48);
    expect(slugOf('one two three four five six seven eight nine ten eleven')).toBe(
      'one-two-three-four-five-six-seven-eight-nine-ten',
    );
    expect(slugOf('???')).toBe('question');
  });
});

describe('the repository', () => {
  it('runs the esc plugin in x check, and it passes with a current README', async () => {
    const plugin = (await discoverPlugins(ROOT)).find((candidate) => candidate.name === 'esc');
    expect(plugin).toBeDefined();
    expect((await plugin?.run({ root: ROOT, lane: false }))?.failures).toEqual([]);
  });

  it('node x esc list exits 0', () => {
    const run = spawnSync(process.execPath, ['x', 'esc', 'list'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^x esc: ok: \d+ records? in all/);
  });
});
