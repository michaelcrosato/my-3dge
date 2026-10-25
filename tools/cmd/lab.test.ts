/**
 * @file Tests `x lab` (tools/cmd/lab.ts, WP 10.8) on a copy of the labs index in a scratch root: `list` passes on the
 * committed index and fails on a temporary lab past its date, naming how to settle it; `add` dates a lab and refuses a
 * page that does not exist; `answer` and `rm` settle and remove one; and labs/index/labs.ts's checks name each problem.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLabs, labLinks, type LabsIndex } from '../../labs/index/labs';
import { ROOT, UsageError } from '../x';
import { createLabCommand, LAB_DAYS, LABS_FILE } from './lab';

/** A scratch root holding a copy of labs/labs.json and a page `glow`. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'x-lab-'));
  mkdirSync(join(root, 'labs', 'glow'), { recursive: true });
  cpSync(join(ROOT, LABS_FILE), join(root, LABS_FILE));
  writeFileSync(join(root, 'labs', 'glow', 'index.html'), '<!doctype html>');
  return root;
}
const read = (root: string) => JSON.parse(readFileSync(join(root, LABS_FILE), 'utf8')) as LabsIndex;
const run = (root: string, today: string, positionals: string[], values: Record<string, string | string[]> = {}) =>
  createLabCommand({ today: () => today }).run({ root, positionals, values });

describe('x lab', () => {
  it('lists the committed index: every page and lab, none expired, the file sound', async () => {
    const index = read(ROOT);
    expect(checkLabs(index)).toEqual([]);
    const result = await run(ROOT, '2026-10-25', []);
    expect(result.ok).toBe(true);
    expect(result.lines?.length).toBe(index.sections.reduce((sum, section) => sum + section.entries.length, 0));
    expect(labLinks(index).every((link) => link.href.startsWith(`../${link.page}/`))).toBe(true);
  });

  it('adds a temporary lab dated today, answers it, fails once it expires, and takes it off', async () => {
    const root = scratch();
    const flags = { title: 'Glow', what: 'Bloom against the tone map.', command: 'node x shot labs/glow', question: 'Does bloom read at night?' }; // prettier-ignore
    expect((await run(root, '2026-10-25', ['add', 'glow'], { ...flags, link: ['Night=?hour=22'] })).ok).toBe(true);
    const lab = read(root).sections.find((section) => section.id === 'temporary')!.entries[0];
    expect([lab.added, lab.expires, lab.links]).toEqual(['2026-10-25', '2026-11-08', [['Night', '?hour=22']]]);
    expect(LAB_DAYS).toBe(14);
    expect((await run(root, '2026-11-08', [])).ok).toBe(true); // on its last day
    const late = await run(root, '2026-11-09', []);
    expect(late.ok).toBe(false);
    expect(late.failures?.[0].message).toMatch(/glow expired on 2026-11-08: settle it \(node x lab answer glow/);
    await run(root, '2026-11-09', ['answer', 'glow', 'Yes, at 0.6']);
    expect(read(root).sections[2].entries[0].answer).toBe('Yes, at 0.6');
    await run(root, '2026-11-09', ['rm', 'glow']);
    expect(read(root).sections[2].entries).toEqual([]);
    expect((await run(root, '2026-11-09', [])).ok).toBe(true);
  });

  it('refuses a page that does not exist, a lab it lacks, and a flag it needs, naming the fix', async () => {
    const root = scratch();
    await expect(run(root, '2026-10-25', ['add', 'nosuch'], { title: 't', what: 'w', command: 'node x', question: 'q' })).rejects.toThrow(/labs\/nosuch\/index.html does not exist/); // prettier-ignore
    await expect(run(root, '2026-10-25', ['add', 'glow'], { title: 't' })).rejects.toThrow(/needs --what, --command, --question/); // prettier-ignore
    await expect(run(root, '2026-10-25', ['rm', 'glow'])).rejects.toThrow(UsageError);
    await expect(run(root, '2026-10-25', ['open'])).rejects.toThrow(/lab takes list, add, answer, rm/);
  });

  it("names each problem with an index's file: sections, a page listed twice, a lab's fields and dates", () => {
    const index: LabsIndex = { $about: '', sections: [{ id: 'keep', title: 'Labs', entries: [] }] };
    expect(checkLabs(index)[0]).toMatch(/keep pages, keep, temporary, in that order/);
    const bad = read(ROOT);
    bad.sections[1].entries.push({ ...bad.sections[1].entries[0], expires: '2026-13-40' });
    expect(checkLabs(bad)).toEqual(expect.arrayContaining([expect.stringMatching(/listed twice/), expect.stringMatching(/expires is a temporary lab's/)])); // prettier-ignore
  });
});
