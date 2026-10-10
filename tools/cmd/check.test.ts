/**
 * @file Unit tests for `x check` (tools/cmd/check.ts): the asset scan on fixture repositories written to temporary
 * directories (every failure has a failing and a passing fixture), lane detection in a linked worktree, the plugin
 * contract and its discovery, and a smoke run on the repository.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Finding } from '../lib/report';
import { MAX_LINES, ROOT } from '../x';
import { assetScan, binaryKind, discoverPlugins, isLane, runChecks, type CheckPlugin } from './check';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WOFF2 = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]);
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=x@x', '-c', 'user.name=x', ...args], { cwd, stdio: 'pipe' });

/** A temporary git repository holding `files` (path → text or bytes), uncommitted unless `commit`. */
function repository(files: Record<string, string | Buffer>, commit = false): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'x-check-')));
  temporary.push(root);
  git(root, 'init', '-q');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (commit) {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fixture');
  }
  return root;
}

/** The asset scan's findings in a repository holding `files`. */
async function scan(files: Record<string, string | Buffer>) {
  const outcome = await assetScan.run({ root: repository(files), lane: false });
  const brief = (findings: Finding[] = []) => findings.map((f) => `${f.id} ${f.file ?? ''}`.trim());
  return { failures: brief(outcome.failures), warnings: brief(outcome.warnings), outcome };
}

const approval = (path: string, escalation = 'ESC-0001', extra: Record<string, string> = {}) =>
  JSON.stringify([{ path, escalation, reason: 'the owner approved it', ...extra }]);
const RECORD = { 'docs/escalations/ESC-0001-logo.md': '---\nid: ESC-0001\n---\n' };

describe('binaryKind', () => {
  it('names binaries by magic bytes, extension or NUL bytes, and passes text', () => {
    expect(binaryKind('a.dat', PNG)).toBe('PNG');
    expect(binaryKind('a.png', Buffer.from('not really an image'))).toBe('a .png file');
    expect(binaryKind('a.txt', Buffer.from('text\0more'))).toBe('binary (it holds NUL bytes)');
    expect(binaryKind('a.ts', Buffer.from('export const a = 1;\n'))).toBeUndefined();
  });
});

describe('the asset scan', () => {
  it('fails a binary file, naming the escalation that approves one', async () => {
    const { failures, outcome } = await scan({ 'art/logo.png': PNG });
    expect(failures).toEqual(['ASSET_BINARY art/logo.png']);
    expect(outcome.failures[0].message).toContain('x esc open --principle Assets');
  });

  it('passes a binary listed with its escalation record', async () => {
    const { failures } = await scan({
      'art/logo.png': PNG,
      'data/APPROVED-BINARIES.json': approval('art/logo.png'),
      ...RECORD,
    });
    expect(failures).toEqual([]);
  });

  it('fails an approval whose escalation record is missing', async () => {
    const { failures } = await scan({
      'art/logo.png': PNG,
      'data/APPROVED-BINARIES.json': approval('art/logo.png', 'ESC-0002'),
      ...RECORD,
    });
    expect(failures).toEqual(['ASSET_APPROVALS data/APPROVED-BINARIES.json', 'ASSET_BINARY art/logo.png']);
  });

  it('fails an unknown key in the approvals, naming the closest one', async () => {
    const files = {
      'data/APPROVED-BINARIES.json': approval('art/logo.png', 'ESC-0001', { reasn: 'typo' }),
      'art/logo.png': PNG,
      ...RECORD,
    };
    const { failures, outcome } = await scan(files);
    expect(failures).toEqual(['ASSET_APPROVALS data/APPROVED-BINARIES.json']);
    expect(outcome.failures[0].message).toContain('unknown key "reasn": did you mean "reason"?');
  });

  it('warns about an approval for a file that is gone', async () => {
    const { failures, warnings } = await scan({ 'data/APPROVED-BINARIES.json': approval('art/gone.png'), ...RECORD });
    expect(failures).toEqual([]);
    expect(warnings).toEqual(['ASSET_STALE data/APPROVED-BINARIES.json']);
  });

  it('passes a font under data/fonts/ with its license, and fails one without', async () => {
    expect(
      (await scan({ 'data/fonts/Inter.woff2': WOFF2, 'data/fonts/OFL.txt': 'SIL Open Font License' })).failures,
    ).toEqual([]);
    expect((await scan({ 'data/fonts/Inter.woff2': WOFF2 })).failures).toEqual([
      'ASSET_FONT_LICENSE data/fonts/Inter.woff2',
    ]);
  });

  it('fails a font outside data/fonts/', async () => {
    expect((await scan({ 'labs/box/Inter.ttf': WOFF2, 'labs/box/LICENSE': 'MIT' })).failures).toEqual([
      'ASSET_FONT_PLACE labs/box/Inter.ttf',
    ]);
  });

  it('fails a text-named file holding NUL bytes', async () => {
    expect((await scan({ 'data/table.txt': Buffer.from('a\0b') })).failures).toEqual(['ASSET_BINARY data/table.txt']);
    expect((await scan({ 'data/table.txt': 'a b' })).failures).toEqual([]);
  });

  it('fails a base64 run over 1 KB, with its line, and passes a shorter one', async () => {
    const run = (length: number) => `export const a = 1;\nexport const blob = '${'QUJD'.repeat(length / 4)}';\n`;
    const { failures, outcome } = await scan({ 'engine/blob.ts': run(1028) });
    expect(failures).toEqual(['ASSET_BASE64 engine/blob.ts']);
    expect(outcome.failures[0].line).toBe(2);
    expect((await scan({ 'engine/blob.ts': run(1024) })).failures).toEqual([]);
  });

  it('fails a data: URI over 1 KB (once), and passes a short one', async () => {
    const uri = (length: number) => `<img src="data:image/png;base64,${'A'.repeat(length)}">\n`;
    expect((await scan({ 'labs/box/index.html': uri(1100) })).failures).toEqual(['ASSET_DATA_URI labs/box/index.html']);
    expect((await scan({ 'labs/box/index.html': `<link rel="icon" href="data:,">\n${uri(100)}` })).failures).toEqual(
      [],
    );
  });

  it('skips files git ignores, and scans untracked ones', async () => {
    expect((await scan({ '.gitignore': '.cache/\n', '.cache/model.glb': PNG })).failures).toEqual([]);
    expect((await scan({ 'new/untracked.glb': PNG })).failures).toEqual(['ASSET_BINARY new/untracked.glb']);
  });
});

describe('lane mode', () => {
  it('is detected in a linked worktree, and X_LANE overrides it', () => {
    const main = repository({ 'a.txt': 'a' }, true);
    const lane = `${main}-lane`;
    temporary.push(lane);
    git(main, 'worktree', 'add', '-q', lane);
    expect(isLane(main, {})).toBe(false);
    expect(isLane(lane, {})).toBe(true);
    expect(isLane(main, { X_LANE: '1' })).toBe(true);
    expect(isLane(lane, { X_LANE: '0' })).toBe(false);
    expect(() => isLane(main, { X_LANE: 'yes' })).toThrow('X_LANE must be 0 or 1');
  });
});

describe('the plugins', () => {
  const drift: CheckPlugin = {
    name: 'docs',
    warnInLane: true,
    run: () => ({ failures: [{ id: 'DOCS_DRIFT', message: 'docs/INDEX.md is stale' }], metrics: { stale: 1 } }),
  };
  const crash: CheckPlugin = {
    name: 'esc',
    run: () => {
      throw new Error('broken record');
    },
  };

  it('a failing plugin fails x check, and in a lane a warnInLane plugin only warns', async () => {
    const root = repository({});
    const outside = await runChecks(root, [drift], false);
    expect(outside.ok).toBe(false);
    expect(outside.failures?.map((f) => f.id)).toEqual(['DOCS_DRIFT']);
    expect(outside.metrics).toMatchObject({ lane: false, plugins: 1, 'docs.stale': 1 });
    const inLane = await runChecks(root, [drift], true);
    expect(inLane.ok).toBe(true);
    expect(inLane.warnings?.[0].message).toContain('a warning in this ultracode lane');
    expect(inLane.lines).toEqual(['docs: warn']);
  });

  it('a crashing plugin is a failure naming it', async () => {
    const result = await runChecks(repository({}), [crash], false);
    expect(result.failures).toEqual([{ id: 'CHECK_CRASH', message: 'the esc check crashed: broken record' }]);
  });

  it('are the asset scan plus each check exported from tools/cmd/', async () => {
    expect((await discoverPlugins(ROOT)).map((plugin) => plugin.name)).toContain('assets');
    const root = repository({
      'tools/cmd/fake.ts':
        "export const check = { name: 'fake', run: () => ({ failures: [] }) };\nexport default {};\n",
      'tools/cmd/plain.ts': 'export default {};\n',
    });
    expect((await discoverPlugins(root)).map((plugin) => plugin.name)).toEqual(['assets', 'fake']);
    writeFileSync(join(root, 'tools/cmd/bad.ts'), 'export const check = 42;\nexport default {};\n');
    await expect(discoverPlugins(root)).rejects.toThrow('tools/cmd/bad.ts exports check, but not as a CheckPlugin');
  });
});

describe('node x check', () => {
  it('passes on the repository, in at most 20 lines, with a report', () => {
    const run = spawnSync(process.execPath, ['x', 'check'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, X_LANE: '0' },
    });
    expect(run.status, run.stdout).toBe(0);
    expect(run.stdout.split('\n')[0]).toMatch(/^x check: ok: /);
    expect(run.stdout.trimEnd().split('\n').length).toBeLessThanOrEqual(MAX_LINES);
    expect(existsSync(join(ROOT, 'out/check/all/report.json'))).toBe(true);
  });
});
