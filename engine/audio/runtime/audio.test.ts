/**
 * @file Unit tests for the audio runtime without Web Audio (engine/audio/runtime/audio.ts, in Node): it is `off`, says
 * so once (`AUDIO_OFF`), and every call is a quiet no-op, while mistakes still throw with their fix: an unknown id
 * (effect, song, stinger or binding), an option out of range, an unknown room. Playing through Web Audio is tests/e2e/audio.spec.ts's.
 */
import { describe, expect, it } from 'vitest';
import { createLog } from '../../core/log';
import { createAudio } from './audio';

/** A log that keeps its lines instead of printing them. */
function quietLog() {
  const lines: string[] = [];
  return {
    lines,
    log: createLog({ console: { warn: (line) => lines.push(line), error: (line) => lines.push(line) } }),
  };
}

describe('createAudio without Web Audio', () => {
  it('is off, says so once, and plays nothing', async () => {
    const { lines, log } = quietLog();
    const audio = createAudio({ log });
    createAudio({ log });
    expect(audio.state).toBe('off');
    expect(lines).toEqual([
      '[AUDIO_OFF] sound is off: this runtime has no Web Audio (AudioContext) or no window for gestures: open the page in a browser with Web Audio (every current one has it); the game runs on in silence',
    ]);
    expect(audio.play('sfx:jump')).toBeNull();
    expect(audio.footstep('stone', [0, 0, 1])).toBeNull();
    expect(audio.event('hit', { sfx: 'sfx:hit' })).toBeNull();
    audio.music('song:dungeon', { intensity: 0.5 });
    audio.intensity(1);
    audio.stinger('sfx:secret');
    audio.duck(true);
    audio.update({ position: [0, 1, 0], yaw: 0, pitch: 0 });
    expect(audio.volume('music', 0.25)).toBe(0.25);
    expect(audio.volume('master', 3)).toBe(1);
    expect(audio.mute()).toBe(true);
    audio.bind('boss', 'sfx:secret');
    expect(audio.info()).toEqual({
      state: 'off',
      rate: null,
      voices: [],
      mixer: null,
      music: null,
      listener: { position: [0, 1, 0], yaw: 0, pitch: 0 },
      bindings: { boss: 'sfx:secret' },
    });
    await audio.close();
    expect(audio.state).toBe('closed');
  });

  it('still refuses mistakes with their fix', () => {
    const audio = createAudio({ log: quietLog().log });
    expect(() => audio.play('sfx:jupm')).toThrow(/CORE_NO_ENTRY.*sfx:jump/);
    expect(() => audio.play('sfx:jump', { vol: 9 })).toThrow(/AUDIO_BAD_OPTION.*vol is 9, not a number from 0 to 4/);
    expect(() => audio.play('sfx:jump', { variant: 1.5 })).toThrow(/variant is 1.5, not a whole number from 0 to 3/);
    expect(() => audio.play('sfx:jump', { position: [0, 1] as never })).toThrow(/position is \[0,1\]/);
    expect(() => audio.room('cavern' as never)).toThrow(/AUDIO_BAD_ROOM/);
    expect(() => audio.music('song:dungeonn')).toThrow(/CORE_NO_ENTRY.*song:dungeon/);
    expect(() => audio.stinger('sfx:secrte')).toThrow(/CORE_NO_ENTRY.*sfx:secret/);
    expect(() => audio.bind('boss', 'sfx:secrte')).toThrow(/CORE_NO_ENTRY.*sfx:secret/);
  });
});
