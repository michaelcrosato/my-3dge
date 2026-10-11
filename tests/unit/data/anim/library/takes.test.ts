/**
 * @file The takes the library's clips were cut from, and the CMU ledger's completeness (PLAN.md §10.1 and §10.3, WP
 * 8.6), rewritten from `my-3d2dge:tools/mocap-test.mjs`:
 * - a clip cut from a capture database names the take and the seconds it was cut from, `TAKE FROM-TO`, where TAKE is
 *   CMU's (`13_29`) or 100STYLE's (`<Style>_<gait>`, the gait one of FW, BW, FR, BR, SW, SR and ID: `Old_FW`), the
 *   cut lasting the clip's length to within a frame at 30 fps (format 1's grid);
 * - a 100STYLE clip's take is its own style, in its set's gait (`Aeroplane_Walk` in `style100`: `Aeroplane_FW`);
 * - a CMU clip's take is the one its catalog picks, cut within the stretch picked, and the ledger lists the clip as
 *   `used` there (the picks themselves are tests/unit/data/anim/ledger/'s and catalogs/');
 * - every take of the ledger is measured: its frame rate, length (to 0.1 s: `90_10`, a frame long, reads 0.0), active
 *   stretch inside it, fit, travel and hip range, with the flags its numbers call for (`loose`: a fit over 30 mm on
 *   average; `short`: under a second; each limit as the rounded numbers show it).
 *
 * @see data/anim/cmu/README.md
 */
import { describe, expect, it } from 'vitest';
import { SET_DIRS, setOf } from '../../../anim/clip-parity';
import { readLedger } from '../ledger/ledger';
import { readCatalogs } from '../sources/sources';

/** A take as a clip names it: the take, then the seconds it was cut from, two decimals each. */
const TAKE = /^(\d+_\d+|(.+)_(FW|BW|FR|BR|SW|SR|ID)) (\d+\.\d\d)-(\d+\.\d\d)$/;
/** 100STYLE's gait, by set. */
const GAITS: Record<string, string> = {
  style100: 'FW',
  style100_back: 'BW',
  style100_backrun: 'BR',
  style100_idle: 'ID',
  style100_run: 'FR',
  style100_side: 'SW',
  style100_siderun: 'SR',
};

/** Every clip that names a take, read: where it is, the take, 100STYLE's style and gait, the seconds, its `dur`. */
const CUT = SET_DIRS.flatMap((dir) =>
  Object.entries(setOf(dir).clips).flatMap(([name, clip]) => {
    if (clip.take === undefined) return [];
    const [, take = clip.take, style, gait, from = 'NaN', to = 'NaN'] = TAKE.exec(clip.take) ?? [];
    return [{ dir, name, take, style, gait, from: Number(from), to: Number(to), dur: clip.dur, text: clip.take }];
  }),
);
const ledger = readLedger();
const byId = new Map(ledger.takes.map((take) => [take.id, take]));

describe('a clip cut from a take', () => {
  it('names it as TAKE FROM-TO, CMU’s or 100STYLE’s, lasting the clip to within a frame at 30 fps', () => {
    expect(CUT).toHaveLength(60 + 878);
    for (const cut of CUT) {
      const where = `${cut.dir}/${cut.name}: take "${cut.text}"`;
      expect(TAKE.test(cut.text), `${where} is not TAKE FROM-TO (seconds)`).toBe(true);
      expect(cut.to - cut.from, where).toBeGreaterThan(0);
      expect(Math.abs(cut.to - cut.from - cut.dur), `${where} against dur ${cut.dur}`).toBeLessThan(1 / 30);
    }
  });

  it('of 100STYLE is its own style, in its set’s gait', () => {
    const style100 = CUT.filter((cut) => cut.dir.startsWith('style100'));
    expect(style100).toHaveLength(878);
    for (const cut of style100) {
      expect([cut.style, cut.gait], `${cut.dir}/${cut.name}`).toEqual([
        cut.name.slice(0, cut.name.lastIndexOf('_')),
        GAITS[cut.dir],
      ]);
    }
  });

  it('of CMU is the take its catalog picks, cut within the stretch picked, and the ledger lists it as used', () => {
    const picks = readCatalogs()['cmu.json']?.$pick ?? {};
    const cmu = CUT.filter((cut) => cut.dir === 'cmu');
    expect(cmu.map((cut) => cut.name).sort()).toEqual(Object.keys(setOf('cmu').clips).sort());
    for (const cut of cmu) {
      const [take, start = 0, end = Number(byId.get(take)?.sec)] = picks[cut.name] ?? [];
      const where = `cmu/${cut.name}: ${cut.text}, picked [${picks[cut.name]?.join(', ')}]`;
      expect(cut.take, where).toBe(take);
      expect(cut.from >= start - 0.005 && cut.to <= end + 0.005, where).toBe(true);
      expect(byId.get(cut.take)?.used.split(' '), where).toContain(cut.name);
    }
  });
});

describe('the CMU ledger', () => {
  it('measures every one of its 2,548 takes, flagged as its numbers say', () => {
    expect(ledger.takes).toHaveLength(2548);
    for (const take of ledger.takes) {
      const where = `take ${take.id}`;
      const [sec, [mean = NaN, worst = NaN], [from = NaN, to = NaN]] = [
        Number(take.sec),
        take.fit.split('/').map(Number),
        take.active.split('-').map(Number),
      ];
      expect(take.fps === '60' || take.fps === '120', `${where}: fps ${take.fps}`).toBe(true);
      expect(take.sec, `${where}: sec, to 0.1 s (90_10 lasts a frame: 0.0)`).toMatch(/^\d+\.\d$/);
      expect(/^[\d.]+-[\d.]+$/.test(take.active) && from <= to && to <= sec + 0.05, `${where}: active`).toBe(true);
      expect(/^\d+\/\d+$/.test(take.fit) && mean <= worst, `${where}: fit ${take.fit}`).toBe(true);
      expect(take.travel, `${where}: travel`).toMatch(/^\d+(\.\d+)?$/);
      const [low = NaN, high = NaN] = take.hips.split('-').map(Number);
      expect(/^\d+-\d+$/.test(take.hips) && low <= high, `${where}: hips ${take.hips}`).toBe(true);
      const flags = take.flags.split(' ').filter(Boolean);
      // the numbers are rounded (fit to 1 mm, sec to 0.1 s), so a flag may sit on its limit's rounded value
      const [loose, short] = [flags.includes('loose'), flags.includes('short')];
      expect(loose ? mean >= 30 : mean <= 30, `${where}: loose ${loose}, fit ${take.fit}`).toBe(true);
      expect(short ? sec <= 1 : sec >= 1, `${where}: short ${short}, ${take.sec} s`).toBe(true);
      for (const flag of flags) expect(['inverted', 'floats', 'loose', 'short', 'fps?'], where).toContain(flag);
    }
  });
});
