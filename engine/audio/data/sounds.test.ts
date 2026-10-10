/**
 * @file Every engine sound renders and passes its checks (PLAN.md WP 9.2's Done-when): the 33 effects (each variant),
 * the 6 drums and the 5 songs render in Node to finite samples that are not silent and stay below full scale, as long
 * as their voices last (a song at least a pass), the same bits run after run and equal to their golden hashes; the
 * kinds' checks find no problem in any of them. The audio QA family (WP 9.4) adds the clipping, DC and duration
 * checks over the same set.
 *
 * Goldens are keyed by platform, as tests/pages/audioDspCases.ts keys the DSP's; a golden changes only with a reason
 * in the commit that changes it: a deliberate change to a sound or to the DSP's output.
 * @see engine/audio/data/effects.ts
 * @see engine/audio/data/drums.ts
 * @see engine/audio/data/songs.ts
 */
import { describe, expect, it } from 'vitest';
import { peak } from '../dsp/measure';
import { DEFAULT_RATE, soundHash } from '../dsp/render';
import { DRUM_KIT, DRUMS } from './drums';
import { EFFECTS } from './effects';
import { getSfx, renderSfx, sfxProblems, sfxVoices } from './sfx';
import { getSong, renderSong, songProblems, songTiming } from './song';
import { SONGS } from './songs';

const PLATFORM = `${process.platform}-${process.arch}`;

/** Each sound's hash: its variants' in order, space-separated. */
const GOLDEN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'linux-x64': {
    'sfx:jump': '90cfd6d1706db427 2935434c61f63579 dcff5881d06f8ffd 66eda3dc4b347071',
    'sfx:jump2': '97f966169a9f3bef a4f5ecd97b6c8e4d 8da7e1a688d1bce0 7433a37ac5b2e68a',
    'sfx:land': '72d75fbb2370d581 206c1cfe27d644ed 54e3e515337ee03e a29127af77d83fd4',
    'sfx:step': '5ed5f345815dc9dc 43dafce4a2355c1f e00507cb26fe6a03 10e1b0de434faada',
    'sfx:coin': '3a33db5615ac7cfc 10a562e38d26e82f ea7344cea0573a1b 10d0961511377743',
    'sfx:pickup': '27db54e582fc5753 6cb8d689d04f431c 8b71927915181a8e f14f7ec3f84dfab5',
    'sfx:key': '1e8fe9e05a99c5d3 b6dfce1bc893686f 81b346ab44e46651 1e0b04bc204b6fb0',
    'sfx:powerup': '409559b463628bee fad10acab50268b5 7599a730aa61b0e1 e36cb442d7901811',
    'sfx:oneup': '7d6a613a620cc74e e16ab0bd56ba41c0 e06c7000df81da39 14dc5e103aecb8e4',
    'sfx:heal': '254e24aec81d26f8 5ace0e7643e9d4a9 7fd4f81e68920cd7 23b22baea38da092',
    'sfx:hit': 'eec02ee4980f7944 c615a2d5f54760ba c3e9fe5c23160f23 3f8e1a9bc4e27805',
    'sfx:hurt': 'fed3b1bf0910fd2f f2182d5e0e38fa43 9a35d269b9b38276 36f75c60f69161f7',
    'sfx:stomp': 'bf0a7c715ef86475 4f17cf5579dd1883 47e7317230a38a57 0c1080e693cb774d',
    'sfx:bump': '19cc0ebffc671b5b e32ceedb035e02ca 2cb9d04f38ab25c4 31d8dc9fb1989b3c',
    'sfx:swing': '760f99d3007db181 eceff679aae13ac0 9e7b324dcb618aa8 81e3cb8fca7b0a46',
    'sfx:whoosh': 'c28556b1e2c94e85 566105919fae41eb 207070878a3432c5 84d5a2ceb369bdfc',
    'sfx:punch': '8ed556b3c00455e8 726bb4be51e73b60 1653a49dd7eb34b0 67d23202b1d13823',
    'sfx:kick': 'da7462a91b246961 d5371009c9f3124e 4303a60a24bdc410 0b306df830042b9a',
    'sfx:shoot': '4d410043193427bf d7c933252a354a01 852142753eccdbc9 61df211ee024964d',
    'sfx:laser': '3be1163e3dbc8d39 c8a4377420483e3f b26302a7d0e99bfe 96f015df87c59d83',
    'sfx:charge': 'cf7aee6c175796d9 db1775b3c670f0e3 e0036000fedae2a5 26207957e79800d3',
    'sfx:explode': '567afad46fc6c19a 1d19a98240be9ee7 f1cf71b689706839 6ec583cb8f70cb80',
    'sfx:boom': '71157efc8097f837 c8c0e995d722d59b 57bd32b849a02961 dea130f476c97fbe',
    'sfx:door': '90e7bb15b4a7f8ab 2f8c3b7418cfce62 ecd2542d29fb609d fe221414b74cd57d',
    'sfx:secret': 'f1f075288aab90b8 349105e6698fc53f 00d7a04ce831c551 f2a60d5e21c49983',
    'sfx:warp': '445a0d5d884911b7 e42a01454ed41fc7 649a9ec1695d4dc3 3e1a049b9c73e7ce',
    'sfx:die': '54f4d213953a1125 2dbaa1926a6e34c9 ea08374d28a2863a 5db7d420a85fef6e',
    'sfx:select': '53aef1a77da9a2be 953839b07e5608de a39c58f1b6603947 7f7c4231becb4fef',
    'sfx:confirm': '52a65e2d6d645c9d a17c088b58441c82 abc85d774646795c c20e6157c7b80eb5',
    'sfx:cancel': 'cf73e14dccfa9218 08c7718cd2618b8c ae3fe344fbffbdcb 21b87b982aea493f',
    'sfx:pause': '219b53606cc7e853 fc235a3eb34b9df5 70ccec6f166afc31 43332c50cf17c0f4',
    'sfx:text': 'bdfaf6d63b8ffef2 eb6d5ea6fbbedbb2 4bcd61c65114c203 f0c09e9e3fec3afc',
    'sfx:blip': 'aba42b00e931cc68 31542a0167d1adf5 0ba5f46d4160a0f0 a8264d67b223302c',
    'sfx:drumKick': '165b5dd3c84e3e30',
    'sfx:drumSnare': '306e45b7639cb1c6',
    'sfx:drumHat': '77b9da824443a0c3',
    'sfx:drumOpenHat': '49f8d6debfa4875c',
    'sfx:drumCrash': 'c3819ed477907ff5',
    'sfx:drumTom': 'e0650d17f60c2167',
    'song:title': '33c9b7f4ca7dafa1',
    'song:adventure': 'e5bcb9ab50b92aec',
    'song:dungeon': 'fe553f33d43bdb5f',
    'song:boss': '3eabee0ae5cb21d9',
    'song:victory': 'b72ccda404e736ad',
  },
};

const SFX_IDS = [...Object.keys(EFFECTS), ...Object.keys(DRUMS)];
const SONG_IDS = Object.keys(SONGS);

/** The checks every rendered sound passes: finite, not silent, below full scale. */
function expectSound(samples: Float32Array): void {
  expect(samples.every(Number.isFinite)).toBe(true);
  expect(peak(samples)).toBeGreaterThan(0.03);
  expect(peak(samples)).toBeLessThan(1);
}

describe('the engine sounds', () => {
  it('are 33 effects, 6 drums in a kit and 5 songs, all defined', () => {
    expect(Object.keys(EFFECTS)).toHaveLength(33);
    expect(Object.keys(DRUMS)).toHaveLength(6);
    expect(Object.values(DRUM_KIT).sort()).toEqual(Object.keys(DRUMS).sort());
    expect(SONG_IDS).toEqual(['song:title', 'song:adventure', 'song:dungeon', 'song:boss', 'song:victory']);
    expect(SFX_IDS.map((id) => getSfx(id).id)).toEqual(SFX_IDS);
    expect(SFX_IDS.filter((id) => getSfx(id).bus === 'ui')).toEqual([
      'sfx:select',
      'sfx:confirm',
      'sfx:cancel',
      'sfx:pause',
      'sfx:text',
      'sfx:blip',
    ]);
  });

  it.each(SFX_IDS)('%s passes its checks and renders every variant as long as its voices last', (id) => {
    const sfx = getSfx(id);
    expect(sfxProblems(sfx)).toEqual([]);
    const end = Math.max(...sfxVoices(sfx).map((voice) => (voice.at ?? 0) + (voice.dur ?? 0.15)));
    for (let variant = 0; variant < sfx.variants; variant++) {
      const samples = renderSfx(sfx, { variant });
      expectSound(samples);
      expect(Math.abs(samples.length - end * DEFAULT_RATE)).toBeLessThanOrEqual(1);
    }
  });

  it.each(SONG_IDS)('%s passes its checks and renders at least one pass', (id) => {
    const song = getSong(id);
    expect(songProblems(song)).toEqual([]);
    const samples = renderSong(song);
    expectSound(samples);
    expect(samples.length).toBeGreaterThanOrEqual(Math.floor(songTiming(song).seconds * DEFAULT_RATE));
    expect(samples.length).toBeLessThan((songTiming(song).seconds + 1) * DEFAULT_RATE);
  });

  it('render the same bits run after run', () => {
    for (const id of ['sfx:hit', 'sfx:boom', 'sfx:drumSnare']) {
      expect(soundHash(renderSfx(id, { variant: getSfx(id).variants - 1 }))).toBe(
        soundHash(renderSfx(id, { variant: getSfx(id).variants - 1 })),
      );
    }
    expect(soundHash(renderSong('song:boss'))).toBe(soundHash(renderSong('song:boss')));
  });

  it.runIf(PLATFORM in GOLDEN)(`match their golden hashes (${PLATFORM})`, () => {
    const hashes: Record<string, string> = {};
    for (const id of SFX_IDS) {
      const variants = Array.from({ length: getSfx(id).variants }, (_, variant) => renderSfx(id, { variant }));
      hashes[id] = variants.map(soundHash).join(' ');
    }
    for (const id of SONG_IDS) hashes[id] = soundHash(renderSong(id));
    expect(hashes).toEqual(GOLDEN[PLATFORM]);
  });
});
