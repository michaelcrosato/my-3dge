/**
 * @file WP 8.10's checks (PLAN.md §5.8, §10.1 and §10.5 step 5): the sets and catalogs adopted from shardfall
 * (tools/anim/shardfall.ts), Quaternius v2's parity with v1, and 100STYLE's credit (CC BY 4.0). That each set rejoins
 * to shardfall's file is tests/unit/data/anim/sets/'s.
 *
 * Offline: the adoption on small sets; the `via` marks and bodies; every clip of the eight sets decoding with no NaN
 * through the port; the catalogs (SHA-256 of shardfall's, key order included); the credit in every `style100*` set,
 * SOURCES.md's 100STYLE section, the CC BY 4.0 legal code and the on-screen rule. With the checkouts (else deferred:
 * no source): the source decoder (WP 8.2's oracle) decodes all 980 of shardfall's clips with no NaN; v2 against v1,
 * both on v1's rest bodies at 30 fps, has 79 of the 87 shared clips within v1's fit and the other 8 miss for the
 * reasons `MISSES` gives, while on each version's own rest bodies fewer than 60 pass; and the tool writes exactly the
 * committed files.
 *
 * @see tools/anim/shardfall.ts
 * @see data/anim/SOURCES.md
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { samplePose, type Clip } from '../../../../engine/anim/clip/readable';
import { poseError, poseMeanError, type ClipSet, type RestBody } from '../../../../engine/anim/clip/validate';
import { CLIP_FPS, frameCount, loadLegacyReadable, type LegacyReadable } from '../../../../tools/anim/legacy-readable';
import { readSet, readSetDir, SETS_DIR } from '../../../../tools/anim/repack';
import {
  adoptSet,
  CATALOGS_DIR,
  main,
  markVia,
  readV1Set,
  SHARDFALL_CATALOGS,
  SHARDFALL_SETS,
  shardfallCatalogFiles,
} from '../../../../tools/anim/shardfall';
import { requireSource, type SkippableTest } from '../../../../tools/lib/source';
import { ROOT } from '../../../../tools/x';
import { REST, standing } from '../../anim/clip-fixtures';
import { canonicalSha256 } from './catalogs/catalogs';
import { ANIM_DIR } from './ledger/ledger';
import { readSources, squash, type Catalog } from './sources/sources';

/** The SHA-256 of each catalog shardfall wrote at `fa2dab6`, as `JSON.stringify` writes it. */
const CATALOG_SHA256: Record<string, string> = {
  '100style.json': '669be42f2b1b8ce794a588ad952702e1a2060b2529ea0a41d50c214de99f75b4',
  '100style_back.json': 'b2d4d70cd9554d2a9e7b6fe9758da9a38215e983c2f2c5d6789aec408523675a',
  '100style_backrun.json': '41a434e98bdd21cf8b2c5ea1b064469f999b90b13949b1e63a5a15cf8f3dcdeb',
  '100style_idle.json': '07a3a353d911d8ba9bf5e46be1d0fa7f43619857f6ab6cc1ab176d7a6e9885b9',
  '100style_run.json': '9d5fb013416912c123a8e5e5337df667aa622de4bba9895a7fa57e20dbf50d95',
  '100style_side.json': '68c6af9b3f8d7e1e308d1aa1842f6a24b9dc4351a987dccccc3b1a116aed7ebd',
  '100style_siderun.json': '3a7aad881fbd69f642603a9fd4ad1119d440a4b11d03c2eb97c4507c37f8a1db',
  'quaternius.json': '4999877bb7b1424a99b466631c94e6ee73535ac38252f95641cc963e35696e87',
};
/** SHA-256 of https://creativecommons.org/licenses/by/4.0/legalcode.txt, CC BY 4.0's legal code. */
const CC_BY_SHA256 = '9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411';
/** The SHA-256 of v1's `body` in my-3d2dge's QUATERNIUS set (`JSON.stringify`): the mannequin's. */
const V1_BODY_SHA256 = 'bd1b934f484898adf62fa6378db0b6a362b6991ac47fa2d45de81ad9fd42c77d';
/** The 15 clips Quaternius v2 has and v1 had not. */
const NEW_IN_V2 = ['ClimbUp_1m', 'Death01_RM', 'Melee_Hook_RM', 'Shield_Dash', 'Slide_Exit_RM', 'Slide_Start_RM']
  .concat(['Sword_Dash', 'Sword_Heavy_Combo', 'Sword_Heavy_Combo_RM', 'Sword_Regular_A_RM', 'Sword_Regular_A_Rec_RM'])
  .concat(['Sword_Regular_B_RM', 'Sword_Regular_B_Rec_RM', 'Sword_Regular_C_RM', 'Sword_Regular_Combo_RM']);
/** The rule CC BY 4.0's credit sets, stated in SOURCES.md and docs/ANIMATION-LIBRARY.md alike. */
const CREDIT_RULE =
  'Any page or game that ships a `style100*` clip shows the credit on screen: the title, the authors, the license ' +
  'with its link, a link to the dataset, and a note that the clips were changed.';

/** Why each of the 8 shared clips misses v1's fit (§10.5 step 5): a drop below the floor, or the metric missed. */
const MISSES: Record<string, { miss: 'drop' | 'mean and worst' | 'worst'; drop?: number; hips?: [number, number] }> = {
  Swim_Idle_Loop: { miss: 'drop', drop: 1246, hips: [-47, -36] },
  Swim_Fwd_Loop: { miss: 'drop', drop: 1067, hips: [-9, -7] },
  Death01: { miss: 'mean and worst' },
  Sword_Attack: { miss: 'worst' },
  Sword_Attack_RM: { miss: 'worst' },
  Walk_Formal_Loop: { miss: 'worst' },
  Zombie_Walk_Fwd_Loop: { miss: 'worst' },
  Walk_Loop: { miss: 'worst' },
};

const sets = Object.fromEntries(Object.keys(SHARDFALL_SETS).map((dir) => [dir, readSet(dir)]));
const quaternius = sets.quaternius as ClipSet;
const style100 = Object.keys(sets).filter((dir) => dir.startsWith('style100'));
const catalogOf = (dir: string) =>
  dir === 'quaternius' ? 'quaternius.json' : `${dir.replace('style100', '100style')}.json`;
const readCatalog = (file: string) => JSON.parse(readFileSync(join(CATALOGS_DIR, file), 'utf8')) as Catalog;
const allClips = () => Object.values(sets).flatMap((set) => Object.values(set.clips).map((clip) => ({ set, clip })));
const restOf = (set: ClipSet, clip: Clip) => set.sources?.[clip.src ?? '']?.rest as RestBody;

/** Every frame of `clip` at 30 fps on `rest`, decoded by `decode`: false at the first value that is not finite. */
function decodesFinite(
  decode: (rest: RestBody, clip: Clip, t: number) => ArrayLike<number>,
  rest: RestBody,
  clip: Clip,
) {
  for (let f = 0; f < frameCount(clip.dur); f++)
    if (!Array.from(decode(rest, clip, f / CLIP_FPS)).every(Number.isFinite)) return false;
  return true;
}

/**
 * The mean and worst error (mm) of clip `b` on `restB` against `a` on `restA`, both decoded by the oracle at 30 fps
 * over the shorter, `b` lowered by `drop` mm; and how far `b` sits below `a` on average over its points and frames.
 */
function parity(MR: LegacyReadable, restA: object, a: Clip, restB: object, b: Clip, drop = 0) {
  const n = frameCount(Math.min(a.dur, b.dur));
  let [sum, worst, dz] = [0, 0, 0];
  for (let f = 0; f < n; f++) {
    const A = MR.pose(restA, a, f / CLIP_FPS);
    const B = MR.pose(restB, b, f / CLIP_FPS).map((v, i) => (i % 3 === 2 ? v - drop : v));
    sum += poseMeanError(A, B);
    worst = Math.max(worst, poseError(A, B));
    for (let i = 2; i < A.length; i += 3) dz += A[i] - B[i];
  }
  return { mean: sum / n, worst, drop: dz / (n * MR.P) };
}

/** The oracle and v1's QUATERNIUS set, from the my-3d2dge checkout (the test is deferred without it), loaded once. */
let loaded: { MR: LegacyReadable; v1: ClipSet } | undefined;
function withV1(test: SkippableTest): { MR: LegacyReadable; v1: ClipSet } {
  const source = requireSource('my-3d2dge', test);
  return (loaded ??= { MR: loadLegacyReadable(source), v1: readV1Set(source, 'quaternius') });
}

describe('the adoption (tools/anim/shardfall.ts), on small sets', () => {
  const sources = { A: { rest: REST } };
  const clip = (name: string, t = 1): Clip => ({ clip: name, src: 'A', dur: t, keys: [standing(0), standing(t)] });
  const v2: ClipSet = {
    set: 'Q',
    format: 1,
    sources,
    fit: { a: [1, 2], c: [5, 6] },
    clips: { a: clip('a'), c: clip('c') },
  };
  const v1: ClipSet = { set: 'Q', sources, body: { height: 1 }, fit: { a: [9, 9], b: [3, 4], c: [9, 9] }, clips: {} };
  const { clip: _unnamed, ...b } = clip('b', 2);
  v1.clips = { a: clip('a'), b, c: clip('c') };

  it('marks a clip via its route, last in its header, before its keys', () => {
    expect(Object.keys(markVia(clip('a'), 'shardfall'))).toEqual(['clip', 'src', 'dur', 'via', 'keys']);
    expect(markVia(markVia(clip('a'), 'v1'), 'shardfall').via).toBe('shardfall');
  });

  it('gives a set body null, and marks every clip via shardfall, nothing else changed', () => {
    const set = adoptSet(v2);
    expect(Object.keys(set)).toEqual(['set', 'format', 'sources', 'body', 'fit', 'clips']);
    expect([set.body, set.fit, Object.values(set.clips).map((c) => c.via)]).toEqual([
      null,
      v2.fit,
      ['shardfall', 'shardfall'],
    ]);
  });

  it("keeps v1's clips where they were in v1, via v1 with their fit, and v1's body (a copy)", () => {
    const set = adoptSet(v2, v1, ['b']);
    expect(Object.keys(set.clips)).toEqual(['a', 'b', 'c']);
    expect(set.fit).toEqual({ a: [1, 2], b: [3, 4], c: [5, 6] });
    expect(Object.keys(set.fit ?? {})).toEqual(['a', 'b', 'c']);
    expect([set.clips.b?.clip, set.clips.b?.via, set.clips.b?.dur, set.clips.c?.via]).toEqual([
      'b',
      'v1',
      2,
      'shardfall',
    ]);
    expect([set.body, set.body === v1.body]).toEqual([{ height: 1 }, false]);
  });

  it('refuses a kept clip v1 lacks, or one shardfall still has, naming the fix', () => {
    expect(() => adoptSet(v2, v1, ['z'])).toThrow(/v1 has no clip "z".*V1_KEPT/);
    expect(() => adoptSet(v2, v1, ['a'])).toThrow(/shardfall's set has "a".*V1_KEPT/);
  });
});

describe('the sets from shardfall', () => {
  it('marks every clip of the eight sets via shardfall, but quaternius’s Punch_Enter, kept from v1, via v1', () => {
    const routes = allClips().map(({ set, clip }) => `${set.set}/${clip.clip}: ${clip.via}`);
    expect(routes.filter((route) => !route.endsWith(': shardfall'))).toEqual(['QUATERNIUS/Punch_Enter: v1']);
    expect(routes).toHaveLength(980 + 1);
  });

  it("gives each style100* set body null, and quaternius v1's: 1,829 mm, 22 segments, 24 bands, 2,238 bytes", () => {
    for (const dir of style100) expect(sets[dir]?.body, dir).toBeNull();
    const body = quaternius.body as { height: number; segs: object[]; bands: object[] };
    expect([body.height, body.segs.length, body.bands.length, JSON.stringify(body).length]).toEqual([
      1829, 22, 24, 2238,
    ]);
    expect(canonicalSha256(body)).toBe(V1_BODY_SHA256);
  });

  it('holds 878 clips of 100STYLE, all loops, 775 with a speed; Quaternius v2’s 102, 32 loops, 10 with a speed', () => {
    const style = style100.flatMap((dir) => Object.values(sets[dir]?.clips ?? {}));
    expect([
      style.length,
      style.filter((c) => c.loop).length,
      style.filter((c) => c.speed !== undefined).length,
    ]).toEqual([878, 878, 775]);
    const v2 = Object.values(quaternius.clips).filter((c) => c.via === 'shardfall');
    expect([v2.length, v2.filter((c) => c.loop).length, v2.filter((c) => c.speed !== undefined).length]).toEqual([
      102, 32, 10,
    ]);
  });

  it('decodes every clip of the eight sets with no NaN through the port, at 30 fps on its set’s rest bodies', () => {
    const broken = allClips().filter(({ set, clip }) => !decodesFinite(samplePose, restOf(set, clip), clip));
    expect(broken.map(({ set, clip }) => `${set.set}/${clip.clip}`)).toEqual([]);
  });

  it('the source decoder decodes all 980 of shardfall’s clips with no NaN (needs my-3d2dge)', (context) => {
    const { MR } = withV1(context);
    const fromShardfall = allClips().filter(({ clip }) => clip.via === 'shardfall');
    expect(fromShardfall).toHaveLength(980);
    const broken = fromShardfall.filter(({ set, clip }) => !decodesFinite(MR.pose, restOf(set, clip), clip));
    expect(broken.map(({ set, clip }) => `${set.set}/${clip.clip}`)).toEqual([]);
  });
});

describe('Quaternius v2 against v1 (§10.5 step 5; needs the my-3d2dge checkout)', () => {
  it('shares 87 clips: v2 drops Punch_Enter and adds 15', (context) => {
    const { v1 } = withV1(context);
    const [old, now] = [
      Object.keys(v1.clips),
      Object.keys(quaternius.clips).filter((n) => quaternius.clips[n]?.via !== 'v1'),
    ];
    expect(old.filter((name) => !now.includes(name))).toEqual(['Punch_Enter']);
    expect(now.filter((name) => !old.includes(name))).toEqual(NEW_IN_V2);
    expect(now.filter((name) => old.includes(name))).toHaveLength(87);
  });

  it("on v1's rests at 30 fps, 79 of the 87 are within v1's fit, mean and worst; 8 miss as MISSES says", (context) => {
    const { MR, v1 } = withV1(context);
    const shared = Object.keys(v1.clips).filter((name) => quaternius.clips[name]?.via === 'shardfall');
    const misses: string[] = [];
    for (const name of shared) {
      const [a, b] = [v1.clips[name] as Clip, quaternius.clips[name] as Clip];
      const rest = restOf(v1, a);
      const [fitMean, fitWorst] = v1.fit?.[name] ?? [0, 0];
      const { mean, worst, drop } = parity(MR, rest, a, restOf(v1, b), b);
      if (mean <= fitMean && worst <= fitWorst) continue;
      misses.push(name);
      const why = MISSES[name];
      if (why?.miss === 'drop') {
        const hips = b.keys.map((key) => key.hips[2]);
        expect([Math.round(drop), Math.min(...hips), Math.max(...hips)], name).toEqual([why.drop, ...(why.hips ?? [])]);
        const raised = parity(MR, rest, a, rest, b, -drop);
        expect(raised.mean <= fitMean && raised.worst <= fitWorst, `${name} within fit once raised`).toBe(true);
      } else {
        expect([mean > fitMean, worst > fitWorst], name).toEqual([why?.miss === 'mean and worst', true]);
      }
    }
    expect(shared.length - misses.length).toBe(79);
    expect(misses.sort()).toEqual(Object.keys(MISSES).sort());
  });

  it("on their own rests fewer than 60 pass: v2's differ in UAL1's bt and spineW, UAL2's neckW", (context) => {
    const { MR, v1 } = withV1(context);
    const shared = Object.keys(v1.clips).filter((name) => quaternius.clips[name]?.via === 'shardfall');
    const pass = shared.filter((name) => {
      const [a, b] = [v1.clips[name] as Clip, quaternius.clips[name] as Clip];
      const { mean, worst } = parity(MR, restOf(v1, a), a, restOf(quaternius, b), b);
      return mean <= (v1.fit?.[name]?.[0] ?? 0) && worst <= (v1.fit?.[name]?.[1] ?? 0);
    });
    expect(pass.length).toBeLessThan(60);
    const differ = (src: string) => {
      const was = (v1.sources?.[src]?.rest ?? {}) as Record<string, unknown>;
      const now = (quaternius.sources?.[src]?.rest ?? {}) as Record<string, unknown>;
      return Object.keys(now).filter((field) => JSON.stringify(was[field]) !== JSON.stringify(now[field]));
    };
    expect({ UAL1: differ('UAL1'), UAL2: differ('UAL2') }).toEqual({ UAL1: ['bt', 'spineW'], UAL2: ['neckW'] });
  });

  it("keeps v1's body and Punch_Enter, which on v2's UAL1 rest stays within its fit of its v1 decode", (context) => {
    const { MR, v1 } = withV1(context);
    expect(quaternius.body).toEqual(v1.body);
    const [was, now] = [v1.clips.Punch_Enter as Clip, quaternius.clips.Punch_Enter as Clip];
    const { via: _via, ...unmarked } = now;
    expect(unmarked).toEqual({ clip: 'Punch_Enter', ...was });
    expect(quaternius.fit?.Punch_Enter).toEqual(v1.fit?.Punch_Enter);
    const { mean, worst } = parity(MR, restOf(v1, was), was, restOf(quaternius, now), now);
    const [fitMean, fitWorst] = v1.fit?.Punch_Enter ?? [0, 0];
    expect([mean <= fitMean, worst <= fitWorst], `${mean.toFixed(1)} / ${worst.toFixed(1)} mm`).toEqual([true, true]);
  });
});

describe('the catalogs from shardfall', () => {
  it('are shardfall’s eight, the SHA-256 of each recorded here (key order included)', () => {
    expect(Object.keys(CATALOG_SHA256)).toEqual([...SHARDFALL_CATALOGS]);
    for (const file of SHARDFALL_CATALOGS) expect(canonicalSha256(readCatalog(file)), file).toBe(CATALOG_SHA256[file]);
  });

  it('describe every clip of their set, and name each other entry in $skip; quaternius’s also Punch_Enter', () => {
    for (const dir of Object.keys(SHARDFALL_SETS)) {
      const catalog = readCatalog(catalogOf(dir));
      const names = Object.keys(catalog).filter((name) => !name.startsWith('$'));
      const clips = Object.keys(sets[dir]?.clips ?? {});
      expect(
        clips.filter((name) => !names.includes(name)),
        dir,
      ).toEqual([]);
      expect(
        names.filter((name) => !clips.includes(name) && !(name in (catalog.$skip ?? {}))),
        dir,
      ).toEqual([]);
    }
  });

  it('deep-equal shardfall’s, and the tool formats them as committed (needs shardfall)', async (context) => {
    const source = requireSource('shardfall', context);
    const files = await shardfallCatalogFiles(source);
    for (const file of SHARDFALL_CATALOGS) {
      const original = readFileSync(join(source, 'anim', 'catalogs', file), 'utf8');
      expect(JSON.stringify(readCatalog(file)), file).toBe(JSON.stringify(JSON.parse(original)));
      expect(files[file], file).toBe(readFileSync(join(CATALOGS_DIR, file), 'utf8'));
    }
  });
});

describe("100STYLE's credit (CC BY 4.0)", () => {
  const { text, sources } = readSources();
  const section = text.slice(text.indexOf('\n## 100STYLE\n')).split(/\n## /)[1] ?? '';

  it('is in every style100* set, as shardfall wrote it: 100STYLE, CC BY 4.0, Mason, Starke and Komura', () => {
    for (const dir of style100) {
      expect(sets[dir]?.credit, dir).toBe('100STYLE (CC BY 4.0 (credit: 100STYLE, Mason, Starke and Komura))');
      expect(sets[dir]?.sources?.['100STYLE']?.url, dir).toBe('https://zenodo.org/records/8127870');
    }
  });

  it('has its section in SOURCES.md: title, authors, year, dataset, DOI, license and its link, changes', () => {
    const row = sources.find((candidate) => candidate.source === '100STYLE');
    expect([row?.license, row?.licenseText, row?.url]).toEqual([
      'CC BY 4.0',
      'LICENSES/CC-BY-4.0.txt',
      'https://zenodo.org/records/8127870',
    ]);
    for (const fact of [
      '100STYLE Dataset',
      'Ian Mason, Sebastian Starke and Taku Komura',
      '2022',
      'https://zenodo.org/records/8127870',
    ])
      expect(squash(section), fact).toContain(fact);
    for (const fact of [
      '10.1145/3522618',
      'https://creativecommons.org/licenses/by/4.0/',
      'one loop per style and gait',
      '`fa2dab6`',
    ])
      expect(squash(section), fact).toContain(fact);
  });

  it('keeps CC BY 4.0’s legal code unchanged', () => {
    const legalCode = readFileSync(join(ANIM_DIR, 'LICENSES', 'CC-BY-4.0.txt'));
    expect(createHash('sha256').update(legalCode).digest('hex')).toBe(CC_BY_SHA256);
  });

  it('must be shown on screen wherever a style100* clip ships: SOURCES.md and docs/ANIMATION-LIBRARY.md say so', () => {
    const library = readFileSync(join(ROOT, 'docs', 'ANIMATION-LIBRARY.md'), 'utf8');
    expect(squash(section)).toContain(CREDIT_RULE);
    expect(squash(library)).toContain(CREDIT_RULE);
  });
});

describe('the command line (needs the shardfall and my-3d2dge checkouts)', () => {
  const root = mkdtempSync(join(tmpdir(), 'my3dge-shardfall-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('finds the committed files as it writes them, and writes and checks elsewhere', async (context) => {
    requireSource('shardfall', context);
    requireSource('my-3d2dge', context);
    const printed: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void printed.push(line));
    try {
      expect(await main(['--check'])).toBe(0);
      expect(
        printed.every((line) => line.endsWith(': ok')),
        printed.join('\n'),
      ).toBe(true);
      expect(await main(['--check'], root, root)).toBe(1);
      expect(await main([], root, root)).toBe(0);
      expect(await main(['--check'], root, root)).toBe(0);
      expect(readSetDir(join(root, 'quaternius'))).toEqual(readSetDir(join(SETS_DIR, 'quaternius')));
    } finally {
      log.mockRestore();
    }
    expect(printed.at(-1)).toBe('catalogs: ok');
  });
});
