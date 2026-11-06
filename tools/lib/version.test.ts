/**
 * @file Unit tests for tools/lib/version.ts (T1, WP 13.45): versions ordered by major, minor and patch; the check
 * passes with no origin/main or nothing differing from it, and otherwise only above main's version, naming the bump.
 * @see tools/lib/version.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { above, parseVersion, versionCheck } from './version';

/** A repository whose package.json holds `version`, committed, with origin/main at that commit when `main`. */
function repo(version: string, main = true): string {
  const root = mkdtempSync(join(tmpdir(), 'x-version-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version }));
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one');
  if (main) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

describe('versions', () => {
  it('parses major.minor.patch and orders by major, then minor, then patch', () => {
    expect([parseVersion('0.1.0'), parseVersion('1.2'), parseVersion('v1.0.0')]).toEqual([[0, 1, 0], null, null]);
    expect([above('0.1.1', '0.1.0'), above('0.2.0', '0.1.9'), above('1.0.0', '0.9.9')]).toEqual([true, true, true]);
    expect([above('0.1.0', '0.1.0'), above('0.1.0', '0.1.1'), above('x', '0.1.0')]).toEqual([false, false, false]);
  });

  it('passes with no origin/main, and on main itself', () => {
    expect(versionCheck(repo('0.1.0', false))).toMatchObject({ ok: true, reason: expect.stringMatching(/no origin\/main/) }); // prettier-ignore
    expect(versionCheck(repo('0.1.0'))).toMatchObject({ ok: true, reason: 'nothing differs from origin/main' });
  });

  it('fails a change without a bump, naming the fix, and passes one above main', () => {
    const root = repo('0.1.0');
    writeFileSync(join(root, 'game.ts'), 'export {};\n');
    expect(versionCheck(root)).toMatchObject({ ok: false, main: '0.1.0', reason: expect.stringMatching(/npm version patch/) }); // prettier-ignore
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '0.1.1' }));
    expect(versionCheck(root)).toMatchObject({ ok: true, version: '0.1.1', main: '0.1.0' });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: 'next' }));
    expect(versionCheck(root).ok).toBe(false);
  });
});
