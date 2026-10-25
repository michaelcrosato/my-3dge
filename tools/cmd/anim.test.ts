/**
 * @file Tests `x anim` (tools/cmd/anim.ts, WP 8.5) through the dispatcher, offline: `find punch` in 20 lines or fewer
 * (Done when), `show`, `bake` with its three.js JSON, `sheet`'s SVG, `cut` and `import` writing and checking set
 * directories, each reading another directory of sets (`--sets`, an `import --out`'s), `cmu ledger`, and the usage
 * errors that name the closest choice; `fetch` where Mesh2Motion's files are cached, and `upgrade`'s refusals. The `cmu`
 * subcommands that fetch
 * (`get`, `all`, `rates`) and `import --cmu` need the network: tools/anim/*.test.ts cover them offline.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimationClip } from 'three';
import { describe, expect, it } from 'vitest';
import { MESH2MOTION, MESH2MOTION_CACHE } from '../anim/fetch';
import { riggedGlb } from '../anim/glb-fixture';
import { requireSource } from '../lib/source';
import { dispatch, MAX_LINES, ROOT } from '../x';
import { subcommandOf, targetOf } from './anim';

/** Runs `node x anim …` in process; the exit code and the printed lines. */
async function anim(...args: string[]): Promise<[number, string[]]> {
  const lines: string[] = [];
  const code = await dispatch(['anim', ...args], { print: (line) => lines.push(line) });
  return [code, lines];
}
const reportOf = (target: string) => JSON.parse(readFileSync(join(ROOT, 'out/anim', target, 'report.json'), 'utf8'));

describe('x anim', () => {
  it('find punch prints 20 lines or fewer (Done when)', async () => {
    const [code, lines] = await anim('find', 'punch');
    expect(code).toBe(0);
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(lines[0]).toMatch(/^x anim: ok: \d+ clips and \d+ CMU takes match/);
    expect(lines.at(-1)).toBe('report: out/anim/find-punch/report.json');
  });

  it('shows a clip as text, the lens folding its angles', async () => {
    const [code, lines] = await anim('show', 'cmu/Walk_Loop', '--lens');
    expect(code).toBe(0);
    expect(lines[0]).toBe('x anim: ok: cmu/Walk_Loop: 1.1 s, a loop, 16 keys');
    expect(lines[1]).toMatch(/^\{"clip": "Walk_Loop", "src": "CMU_02"/);
  });

  it('bakes a clip, and writes it as three.js AnimationClip JSON', async () => {
    const [code, lines] = await anim('bake', 'cmu/Walk_Loop', '--json');
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/34 frames, [\d.]+ KB of tracks; FK parity mean 0\.\d\d mm/);
    const json = JSON.parse(readFileSync(join(ROOT, 'out/anim/bake-cmu-Walk_Loop/clip.json'), 'utf8'));
    expect(AnimationClip.parse(json).tracks.length).toBe(json.tracks.length);
  });

  it('draws a contact sheet as SVG', async () => {
    const [code] = await anim('sheet', 'quaternius/Punch_Cross', '--frames', '3', '--views', 'front,top');
    expect(code).toBe(0);
    const svg = readFileSync(join(ROOT, 'out/anim/sheet-quaternius-Punch_Cross/sheet.svg'), 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(reportOf('sheet-quaternius-Punch_Cross').artifacts[0].kind).toBe('image');
  });

  it('cuts a set into a directory, then finds nothing changed', async () => {
    const out = mkdtempSync(join(tmpdir(), 'anim-cut-'));
    expect((await anim('cut', 'cmu', '--clips', 'Cartwheel,Backflip', '--name', 'FLIPS', '--out', out))[0]).toBe(0);
    const [code, lines] = await anim(
      'cut',
      'cmu',
      '--clips',
      'Cartwheel,Backflip',
      '--name',
      'FLIPS',
      '--out',
      out,
      '--check',
    );
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/all 4 files as the tool writes them/);
  });

  it('imports a .glb, lists one, and checks a set against what it writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anim-import-'));
    writeFileSync(join(dir, 'lib.glb'), riggedGlb());
    const glb = join(dir, 'lib.glb');
    const [listed, list] = await anim('import', glb, '--list');
    expect([listed, list[1]]).toEqual([0, `${glb}: rig unreal`]);
    const out = join(dir, 'set');
    expect((await anim('import', glb, '--name', 'MINE', '--out', out))[0]).toBe(0);
    expect(readFileSync(join(out, 'Wave_Loop.json'), 'utf8')).toMatch(/"via": "source"/);
    expect((await anim('import', glb, '--name', 'MINE', '--out', out, '--check'))[0]).toBe(0);
    const [code, lines] = await anim('import', glb, '--name', 'MINE', '--out', out, '--check', '--legacy');
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/ANIM_SET_DIFFERS/);
  });

  it('finds, shows, bakes, draws and cuts the sets of another directory (--sets), naming the flag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anim-sets-'));
    writeFileSync(join(dir, 'lib.glb'), riggedGlb());
    expect((await anim('import', join(dir, 'lib.glb'), '--name', 'MINE', '--out', join(dir, 'mine')))[0]).toBe(0);
    const [found, hits] = await anim('find', 'wave', '--sets', dir);
    expect([found, hits[1]]).toEqual([0, expect.stringMatching(/^mine\/Wave_Loop {2}/)]);
    expect(await anim('show', 'mine/Wave_Loop', '--sets', dir)).toEqual([
      0,
      expect.arrayContaining([expect.stringMatching(/^x anim: ok: mine\/Wave_Loop: /)]),
    ]);
    expect((await anim('bake', 'Wave_Loop', '--sets', dir))[0]).toBe(0);
    expect((await anim('sheet', 'mine/Wave_Loop', '--frames', '2', '--sets', dir))[0]).toBe(0);
    const out = join(dir, 'cut');
    const [cut] = await anim('cut', 'mine', '--sets', dir, '--clips', 'Wave_Loop', '--name', 'WAVE', '--out', out);
    expect(cut).toBe(0);
    const clipIn = (set: string) => readFileSync(join(set, 'Wave_Loop.json'), 'utf8');
    expect(clipIn(out)).toBe(clipIn(join(dir, 'mine')));
    const [missing, lines] = await anim('cut', 'mine', '--clips', 'Wave_Loop', '--name', 'WAVE', '--out', out);
    expect(missing).toBe(1);
    expect(lines[0]).toMatch(/no set mine in data\/anim\/sets\/: .*--sets <dir>/);
    const [noDir, why] = await anim('show', 'mine/Wave_Loop', '--sets', join(dir, 'nowhere'));
    expect([noDir, why[0]]).toEqual([1, expect.stringMatching(/--sets takes a directory of set directories/)]);
    expect((await anim('show', 'mine/Wave_Loop'))[1][0]).toMatch(/no set mine in data\/anim\/sets\/: .*--sets <dir>/);
  });

  it('queries the CMU ledger', async () => {
    const [code, lines] = await anim('cmu', 'ledger', 'cartwheel', '--status', 'used');
    expect(code).toBe(0);
    expect(lines[1]).toMatch(/^49_06\t.*USED: Cartwheel/);
  });

  it('repacks the curated sets still from my-3d2dge as committed (needs the my-3d2dge checkout)', async (context) => {
    requireSource('my-3d2dge', context);
    const [code, lines] = await anim('repack', '--check');
    expect(code).toBe(0);
    expect(lines.slice(1, 3)).toEqual(['mesh2motion: ok', 'cmu: ok']);
  });

  it('refuses a set it cannot upgrade, saying why, and names the closest for one it lacks', async () => {
    expect((await anim('upgrade'))[0]).toBe(2);
    const [unknown, said] = await anim('upgrade', 'mesh2moton');
    expect([unknown, said.join('\n')]).toEqual([2, expect.stringMatching(/did you mean mesh2motion\?/)]);
    const [blocked, why] = await anim('upgrade', 'quaternius');
    expect([blocked, why.join('\n')]).toEqual([1, expect.stringMatching(/ESC-0003/)]);
  });

  it("fetches Mesh2Motion's files only where they are missing (needs them in .cache, or the network)", async (context) => {
    if (!Object.keys(MESH2MOTION.files).every((file) => existsSync(join(ROOT, MESH2MOTION_CACHE, file))))
      context.skip();
    const [code, lines] = await anim('fetch'); // each file there already, its sha256 matched: no download
    expect([code, lines[0]]).toEqual([0, expect.stringMatching(/mesh2motion: 3 files at 653a969/)]);
  });

  it('exits 2 for an unknown subcommand or a flag it does not take, naming the closest', async () => {
    expect(() => subcommandOf(['fnd'])).toThrow(/did you mean find\?/);
    expect(targetOf(['show', 'cmu/Walk_Loop'])).toBe('show-cmu-Walk_Loop');
    const [code, lines] = await anim('find', 'punch', '--lens');
    expect(code).toBe(2);
    expect(lines.join('\n')).toMatch(/anim find takes no --lens/);
    expect((await anim('cmu', 'ledgr'))[0]).toBe(2);
    expect((await anim('show'))[0]).toBe(2);
  });
});
