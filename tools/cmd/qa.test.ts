/**
 * @file Unit tests for `x qa` (tools/cmd/qa.ts): families found in `tools/qa/`, baselines compared by id and metric
 * (new and worse violations fail, slack and stale entries warn, unknown keys fail), `--only` prefixes, and the usage
 * errors, on fixture repositories written to temporary directories.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch, loadCommand, ROOT } from '../x';
import { compareWithBaselines, qaFamilies, readBaselines, runQa, type QaBaseline, type QaViolation } from './qa';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository holding `files`. */
function repository(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'x-qa-')));
  temporary.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.0.0' }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const violation = (id: string, value: number, metric = 'pop'): QaViolation => ({
  id,
  metric,
  value,
  message: `${id} pops by ${value}°`,
});
const baseline = (id: string, value: number, metric = 'pop'): QaBaseline => ({
  id,
  metric,
  value,
  reason: 'a known source pop',
});

describe('compareWithBaselines', () => {
  it('fails a new violation and passes an accepted one', () => {
    const result = compareWithBaselines(
      'anim',
      [violation('clip:walk', 12), violation('clip:run', 30)],
      [baseline('clip:run', 30)],
    );
    expect(result.failures.map((f) => f.id)).toEqual(['QA_ANIM']);
    expect(result.failures[0].message).toBe('clip:walk pop: clip:walk pops by 12°');
    expect(result.accepted).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('fails an accepted violation that got worse', () => {
    const result = compareWithBaselines('anim', [violation('clip:run', 31)], [baseline('clip:run', 30)]);
    expect(result.failures.map((f) => f.id)).toEqual(['QA_ANIM_WORSE']);
    expect(result.failures[0].message).toContain('got worse: 31 > the accepted 30 (a known source pop)');
  });

  it('matches by id and metric', () => {
    const result = compareWithBaselines('anim', [violation('clip:run', 5, 'footSlide')], [baseline('clip:run', 30)]);
    expect(result.failures.map((f) => f.id)).toEqual(['QA_ANIM']);
  });

  it('warns about slack and stale entries', () => {
    const result = compareWithBaselines(
      'anim',
      [violation('clip:run', 20)],
      [baseline('clip:run', 30), baseline('clip:old', 9)],
    );
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((w) => w.id)).toEqual(['QA_BASELINE_SLACK', 'QA_BASELINE_STALE']);
  });

  it('keeps only the ids --only names, for violations and entries alike', () => {
    const result = compareWithBaselines(
      'anim',
      [violation('clip:walk', 12), violation('action:jump', 3)],
      [baseline('action:old', 1)],
      ['clip:'],
    );
    expect(result.failures.map((f) => f.message.split(' ')[0])).toEqual(['clip:walk']);
    expect(result.warnings).toEqual([]);
  });
});

describe('readBaselines', () => {
  it("reads every file of the family, each area's included", () => {
    const root = repository({
      'tests/baselines/qa-anim.json': JSON.stringify([baseline('clip:run', 30)]),
      'tests/baselines/qa-anim-library.json': JSON.stringify([baseline('clip:cmu-01', 40)]),
      'tests/baselines/qa-animal.json': JSON.stringify([baseline('x:y', 1)]),
    });
    const { entries, failures } = readBaselines(root, 'anim');
    expect(failures).toEqual([]);
    expect(entries.map((entry) => entry.id)).toEqual(['clip:cmu-01', 'clip:run']);
  });

  it('fails an unknown key, naming the closest, and an entry without a reason', () => {
    const root = repository({
      'tests/baselines/qa-geo.json': JSON.stringify([
        { id: 'prop:crate', metric: 'degenerate', value: 1, reasn: 'typo' },
        { id: 'prop:barrel', metric: 'degenerate', value: 1, reason: '' },
      ]),
    });
    const { entries, failures } = readBaselines(root, 'geo');
    expect(entries).toEqual([]);
    expect(failures.map((f) => f.message)).toEqual([
      'tests/baselines/qa-geo.json[0] has an unknown key "reasn": did you mean "reason"? (keys: id, metric, value, reason)',
      'tests/baselines/qa-geo.json[0] needs an id, a metric, a numeric value and a reason',
      'tests/baselines/qa-geo.json[1] needs an id, a metric, a numeric value and a reason',
    ]);
  });
});

describe('families', () => {
  const FAMILY = [
    '/** @file A fixture QA family. */',
    "import type { QaFamily } from '" + join(ROOT, 'tools/cmd/qa') + "';",
    'export default {',
    "  run: ({ only }) => [{ id: 'level:hall', metric: 'unreachable', value: 2, message: 'two spawns cannot reach the exit' }]",
    '    .filter((v) => only.length === 0 || only.some((p) => v.id.startsWith(p))),',
    '} satisfies QaFamily;',
  ].join('\n');

  it('are the modules in tools/qa/, and runQa checks one against its baselines', async () => {
    const root = repository({ 'tools/qa/level.ts': FAMILY, 'tools/qa/level.test.ts': '' });
    expect(qaFamilies(root)).toEqual(['level']);
    expect(qaFamilies(repository({}))).toEqual([]);
    expect((await runQa(root, 'level')).failures.map((f) => f.id)).toEqual(['QA_LEVEL']);
    expect((await runQa(root, 'level', ['prop:'])).violations).toBe(0);
  });

  it('x qa runs them, exits 1 on a violation and 0 within the baseline, and filters with --only', async () => {
    const root = repository({ 'tools/qa/level.ts': FAMILY });
    const commands = { qa: () => loadCommand(ROOT, 'qa') };
    const printed: string[] = [];
    const print = (line: string) => printed.push(line);
    expect(await dispatch(['qa', 'level'], { root, commands, print })).toBe(1);
    expect(printed[0]).toBe('x qa: FAIL: level: 1 new or worse');
    expect(await dispatch(['qa', 'level', '--only', 'prop:,clip:'], { root, commands, print })).toBe(0);
    mkdirSync(join(root, 'tests/baselines'), { recursive: true });
    writeFileSync(
      join(root, 'tests/baselines/qa-level.json'),
      JSON.stringify([baseline('level:hall', 2, 'unreachable')]),
    );
    printed.length = 0;
    expect(await dispatch(['qa', 'level'], { root, commands, print })).toBe(0);
    expect(printed[1]).toBe('level: ok, 1 violations, 1 accepted by the baseline');
  });

  it('x qa exits 2 for no family or an unknown one, naming the closest', async () => {
    const root = repository({ 'tools/qa/level.ts': FAMILY });
    const commands = { qa: () => loadCommand(ROOT, 'qa') };
    const printed: string[] = [];
    expect(await dispatch(['qa', 'levle'], { root, commands, print: (line) => printed.push(line) })).toBe(2);
    expect(printed[1]).toContain('there is no QA family "levle": did you mean level?');
    expect(await dispatch(['qa'], { root, commands, print: () => undefined })).toBe(2);
  });

  it('node x qa on the repository lists the families in tools/qa/, level (WP 2.2) among them', () => {
    const run = spawnSync(process.execPath, ['x', 'qa'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stdout).toMatch(/name a QA family \(families: ([a-z]+, )*level(, [a-z]+)*\)/);
  });
});
