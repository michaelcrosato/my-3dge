/**
 * @file Tests `x html` (tools/cmd/html.ts) on a temporary directory with the build injected: `--write` writes the file
 * once, `--check` passes on it and fails on a stale or missing one (`HTML_STALE`) and on a page that loads from outside
 * (`HTML_EXTERNAL`); both flags at once are a usage error.
 * @see tools/cmd/html.ts
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ONE_FILE } from '../lib/oneFile';
import { UsageError } from '../x';
import { createHtmlCommand } from './html';

const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Runs the command with `page` as the build's output, in `root`. */
function run(root: string, page: string, values: Record<string, boolean>) {
  return createHtmlCommand(async () => page).run({ root, values, positionals: [] } as never);
}

describe('x html', () => {
  it('writes the file, then finds it current', async () => {
    const root = mkdtempSync(join(tmpdir(), 'html-'));
    made.push(root);
    expect(await run(root, '<p>a</p>', { check: true })).toMatchObject({ ok: false, summary: `${ONE_FILE} stale` });
    expect(await run(root, '<p>a</p>', { write: true })).toMatchObject({ ok: true, metrics: { written: 1 } });
    expect(readFileSync(join(root, ONE_FILE), 'utf8')).toBe('<p>a</p>');
    expect(await run(root, '<p>a</p>', { write: true })).toMatchObject({ ok: true, metrics: { written: 0 } });
    expect(await run(root, '<p>a</p>', {})).toMatchObject({ ok: true, metrics: { bytes: 8, stale: 0 } });
    writeFileSync(join(root, ONE_FILE), '<p>old</p>');
    const stale = await run(root, '<p>a</p>', { check: true });
    expect(stale.failures?.map((failure) => failure.id)).toEqual(['HTML_STALE']);
  });

  it('fails on a page that loads from outside, and on both flags', async () => {
    const root = mkdtempSync(join(tmpdir(), 'html-'));
    made.push(root);
    const outside = await run(root, '<script src="https://x/a.js"></script>', { write: true });
    expect(outside.ok).toBe(false);
    expect(outside.failures?.map((failure) => failure.id)).toEqual(['HTML_EXTERNAL']);
    await expect(run(root, '', { check: true, write: true })).rejects.toThrow(UsageError);
  });
});
