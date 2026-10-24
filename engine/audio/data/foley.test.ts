/**
 * @file Unit tests for the engine's foley (engine/audio/data/foley.ts, PLAN.md WP 13.22): it names a step for every
 * surface footsteps know and meets none of the chip effects' ids; every effect passes the kind's checks and renders
 * every variant finite, heard and below full scale, as long as its voices last; its loops start and end quiet; and
 * each renders the same bits as its golden hashes.
 *
 * Goldens are keyed by platform, as engine/audio/data/sounds.test.ts keys the engine's other sounds; a golden changes
 * only with a reason in the commit that changes it: a deliberate change to a sound or to the DSP's output.
 * @see engine/audio/data/foley.ts
 */
import { describe, expect, it } from 'vitest';
import { peak } from '../dsp/measure';
import { DEFAULT_RATE, soundHash } from '../dsp/render';
import { SURFACE_STEPS } from '../../world/footsteps';
import { EFFECTS } from './effects';
import { FOLEY } from './foley';
import { getSfx, renderSfx, sfxProblems, sfxVoices } from './sfx';

const PLATFORM = `${process.platform}-${process.arch}`;

/** Each effect's hash: its variants' in order, space-separated. */
const GOLDEN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'linux-x64': {
    'sfx:stepWood': '1a8894bfddc8f894 944cb3f62ab94a99 05ae0265483094c4 ff3bcc400adeee4c',
    'sfx:stepTile': 'a80a2549f63347a6 0bcd802a5139cdfe d6343c7d1bc38d37 c0d7760d9effb374',
    'sfx:stepCarpet': 'a4bb955a629dbc7e 369dbb364d96230a 0a68f7e04d195898 1fec0eb8b25b6727',
    'sfx:stepConcrete': '395b9147d6c715a1 f084b4ee0644bd37 cdcfaf7751981f53 b663af1b4fdcdbf2',
    'sfx:stepGrass': 'e1315c13cdbd6c29 9d79fd514e2c4c4a 27ee74b878c55574 489d340d2a8fa4a2',
    'sfx:stepGravel': '3079660bdbe18a61 e358484e6c062ee9 953efdd4b8c040f2 e7b751c04105cc8b',
    'sfx:stepMetal': '142a5ec25bb0c9f4 b23d107d68abfc7d af5101131992d04e a111878efb9d4e46',
    'sfx:slide': '047fb2f8f3521cc5 8928f030656a867c 0e087add22fda474',
    'sfx:landBody': '2c353f3891ce9181 8671bd27c077d868 d0ce8e958f6d22e0',
    'sfx:mantle': 'ed7b15e4a0878eea e137742586b6fbb9 c220aa515aeea692',
    'sfx:climbGrip': 'd6a4d93af7ea4d9f 82d4f6c604ef9f5a 94f57844a2b962ad aea6ef684eea3b14',
    'sfx:ladderRung': '47c9e6a4a8e6397b ebd58d9b6004111a c2fe7f7249d3c67c 4d17577891b27654',
    'sfx:zipAttach': '2a9f27923c1cdf76 2efa2476e55afe5f c39f61395832c039',
    'sfx:zipRun': '7d14c4a2e1030af9',
    'sfx:crouchCloth': 'b46e7b13f27bf1f0 d3cfc8595d1379dd ebb41246278ae3c9',
    'sfx:launch': '717954b4f0895044 13914b9f0ff96b66 39c747b03efb5fcf',
    'sfx:doorOpen': 'a7b362a33e8a1c23 8a2a102e239e8fc1 de65775985c0d505',
    'sfx:doorClose': 'eb4377d737bf4db2 8c909291d4496a36 f39eda15182535aa',
    'sfx:doorLocked': '4fc2c6225a20c772 472fe507bb45143c fbad224251c8b30e',
    'sfx:doorBreak': '49f758f31e5abc9c c2faabfdda351f42 231d86cc448820ff',
    'sfx:windowSlide': 'a9417001aee04183 94b518991509e59d dfdae7768e971091',
    'sfx:glassBreak': '60fc7b215f1b60e1 1cd53ec37ad2a2bc 0d4a2678d08c9bfb',
    'sfx:switchClick': '4b10ba15a53ef5c8 acf93a589d2a7da7 8efd989e9be6d0bc',
    'sfx:grab': '25b278d9bb1b6407 88daa7871225ab1b f468553c0ba290b2',
    'sfx:swish': '51f54b2082a4ffcb 75313569cf2f31c4 c23b903453443933 75d2ae7030badada',
    'sfx:punchHit': 'f6fbed7f296f53d4 74c191d7946544a2 3dbf085e8d1f3581 dfdf9023dc9fba4d',
    'sfx:kickHit': '743ad6a763653914 20033eb95ec1c510 dc3fdc6ede423fe9 8a9b0376cd221ae8',
    'sfx:bodyFall': '1e9f3dbc8a5ad2dc 399e4becee8f1345 9395d913c111a445',
    'sfx:impactWood': 'f7be10906bd7e1ab 9ba2333de35f02ee 974fe33dcc02faae 159a552179983b84',
    'sfx:impactMetal': 'a9bdf6fe7c15be4c f19543d58d262ab4 503ba58bc251446a 7a73475a9095d64f',
    'sfx:impactConcrete': '2de6c5c49923a1e6 88304e75fbe4ab75 16eac9a4709af819 0ce1eeb201a574bc',
    'sfx:impactGlass': '4bb9f4d46728cdb6 babc97ededdac686 0edf90f575f2b1c6 5d6c45bd41fe292d',
    'sfx:impactBody': '60b8f46d4e3bf8c3 94513ba2131029f5 3f3ce7c6934957af 82ab612481a0e40a',
    'sfx:impactDirt': 'aa8abbe7954ed96e e22ebc6b18ff3542 d8b87050b3368e12 b9d085f94421d4e6',
    'sfx:pistolShot': 'c777aeafc94d859b 7d0d5a7ef97941a7 f0f9258e1b0de5a6 61991c7978aabf1f',
    'sfx:rifleShot': '69d248b242e78cd2 0e7452a9b9382862 59dc72f10ab147f4 6088e88346f38d2d',
    'sfx:reload': 'b5b5e7285ac49b61 a9dbe98b36cc1afe ebe45efa8d9e7393',
    'sfx:dryFire': '900b7e0cfd57f5f9 1cf46abae1d975f3 9b5f758ba0a9dd62',
    'sfx:drawGun': '0804195b6a8d85e7 07175215696fdc16 71c3d8b6db23fb7d',
    'sfx:holsterGun': '859a9a49640aaf4b 2d5f9c8898c2691e f83b884bab502e6e',
    'sfx:wind': '8adf659c4c27c337',
  },
};

const IDS = Object.keys(FOLEY);

describe('the engine’s foley', () => {
  it('names a step for every surface footsteps know, and none of the chip effects’ ids', () => {
    for (const sfx of new Set(Object.values(SURFACE_STEPS))) expect(IDS).toContain(sfx);
    expect(IDS.filter((id) => Object.hasOwn(EFFECTS, id))).toEqual([]);
  });

  it.each(IDS)('%s passes its checks and renders every variant, heard and below full scale', (id) => {
    const sfx = getSfx(id);
    expect(sfxProblems(sfx)).toEqual([]);
    const end = Math.max(...sfxVoices(sfx).map((voice) => (voice.at ?? 0) + (voice.dur ?? 0.15)));
    for (let variant = 0; variant < sfx.variants; variant++) {
      const samples = renderSfx(sfx, { variant });
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(peak(samples)).toBeGreaterThan(0.03);
      expect(peak(samples)).toBeLessThan(1);
      expect(Math.abs(samples.length - end * DEFAULT_RATE)).toBeLessThanOrEqual(1);
    }
  });

  it('starts and ends its loops quiet, so they have no seam', () => {
    for (const id of ['sfx:zipRun', 'sfx:wind']) {
      const samples = renderSfx(id);
      expect([Math.abs(samples[0]), Math.abs(samples[samples.length - 1])].every((v) => v < 1e-3)).toBe(true);
    }
  });

  it.runIf(PLATFORM in GOLDEN)(`match their golden hashes (${PLATFORM})`, () => {
    const hashes: Record<string, string> = {};
    for (const id of IDS) {
      const variants = Array.from({ length: getSfx(id).variants }, (_, variant) => renderSfx(id, { variant }));
      hashes[id] = variants.map(soundHash).join(' ');
    }
    expect(hashes).toEqual(GOLDEN[PLATFORM]);
  });
});
