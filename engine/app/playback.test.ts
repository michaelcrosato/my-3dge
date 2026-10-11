/**
 * @file Unit tests for engine/app/playback.ts (T1, PLAN.md §6.5 item 9, WP 2.7): a replay played one step at a time
 * gives `playReplay`'s hashes at every step (the kernel's replays, with intents, settings and dev actions, and the
 * box's), and its goldens; it records itself again point for point; `playInto` hashes the checkpoints or every step,
 * stops at `until` with the state and trace, draws after every n-th step, applies view changes, and refuses a view
 * change that would change play (`APP_PLAY_SETTING`) or a replay holding a view setting (`SIM_BAD_REPLAY`).
 * @see engine/app/playback.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../../fixtures/scenes/kernel';
import '../../labs/box/scenes/room';
import { registry } from '../core/registry';
import type { SettingValue } from '../core/settings';
import { playReplay, type Replay } from '../sim/replay';
import { createSession, getScene, type Session } from '../sim/scene';
import { createPlayback, playInto, type PlayTarget } from './playback';

const REPLAYS = ['kernel-movers', 'kernel-crowd', 'box-1-room', 'box-1-tuned'];
const text = (name: string) => readFileSync(`tests/replays/${name}.replay.json`, 'utf8');

/** A play target over a fresh session per replay, counting draws and recording view changes. */
function target() {
  let session: Session | undefined;
  const log: string[] = [];
  const played: PlayTarget = {
    registry,
    begin: (replay: Replay) =>
      (session = createSession(getScene(replay.scene), { seed: replay.seed, settings: replay.settings })),
    stepped: () => void log.push(`step ${session!.world.tick}`),
    draw: async () => void log.push('draw'),
    camera: (code) => void log.push(`camera ${code}`),
    setView: (path: string, value: SettingValue) => void session!.set(path, value),
  };
  return { played, log, session: () => session! };
}

describe('createPlayback', () => {
  it("gives playReplay's hash at every step, and records the replay again", () => {
    for (const name of REPLAYS) {
      const replay = JSON.parse(text(name)) as Replay;
      const expected = playReplay(replay, { checkpoints: 'every' }).hashes;
      const playback = createPlayback(replay);
      const session = createSession(getScene(replay.scene), { seed: replay.seed, settings: replay.settings });
      const got: Record<string, string> = { 0: session.world.hash() };
      while (!playback.done) {
        playback.step(session);
        got[playback.tick] = session.world.hash();
      }
      expect(got, name).toEqual(expected);
      expect(session.record().inputs, name).toEqual(replay.inputs);
    }
  });
});

describe('playInto', () => {
  it('gives the goldens at the checkpoints, drawing after every step', async () => {
    for (const name of REPLAYS) {
      const replay = JSON.parse(text(name)) as Replay;
      const { played, log } = target();
      const run = await playInto(played, text(name));
      expect(run.hashes, name).toEqual(replay.hashes['linux-x64']);
      expect([run.steps, run.frames, log.filter((line) => line === 'draw').length]).toEqual([600, 600, 600]);
      expect(run.state).toBeUndefined();
    }
  });

  it('stops at until with the state and trace, hashes every step, draws every n-th, and applies view changes', async () => {
    const { played, log, session } = target();
    const views = [[2, { cam: 'cam=topdown', set: { 'kernel.trail': 4 } }]] as const;
    const run = await playInto(played, text('kernel-movers'), { until: 5, every: true, draw: 2, views });
    expect(Object.keys(run.hashes)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect([run.steps, run.frames, run.trace?.tick, run.trace?.hash]).toEqual([5, 2, 5, run.hash]);
    expect(run.state?.entities.length).toBeGreaterThan(0);
    expect(log.slice(0, 6)).toEqual(['step 1', 'step 2', 'draw', 'camera cam=topdown', 'step 3', 'step 4']);
    expect(session().settings.get('kernel.trail')).toBe(4);
    expect(
      session()
        .record()
        .inputs.some(([, change]) => change.set),
    ).toBe(false);
  });

  it('refuses a view change that changes play, and a replay holding a view setting', async () => {
    const views = [[0, { set: { 'kernel.speed': 2 } }]] as const;
    await expect(playInto(target().played, text('kernel-movers'), { views })).rejects.toThrow(/APP_PLAY_SETTING/);
    const viewed = { ...JSON.parse(text('kernel-movers')), settings: { 'kernel.trail': 3 } };
    await expect(playInto(target().played, JSON.stringify(viewed))).rejects.toThrow(/SIM_BAD_REPLAY.*marked view/);
  });
});
