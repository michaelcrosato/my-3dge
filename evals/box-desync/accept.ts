/**
 * @file The acceptance of the eval task box-desync (evals/box-desync/prompt.md), run by `node x evals` in the
 * attempt's copy, whose start (start.patch) gives the slimes state outside the sim's components that survives from
 * one run to the next: three runs of the crowd of slimes in one process give one hash, and box-4-hop gives its golden
 * at its last step (the replays' goldens, in three runs each, are the task's command).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../engine';
import '../../labs/box/scenes/crowd-100';

describe('the crowd, run after run', () => {
  it('plays box:crowd-100 of slimes the same three times in one process', async () => {
    const hashes = new Set<string>();
    for (let run = 0; run < 3; run++) {
      const engine = await createHeadless({ scene: 'box:crowd-100', settings: { 'box.crowd.mix': 'slimes' } });
      engine.step(240);
      hashes.add(engine.hash());
    }
    expect(hashes.size).toBe(1);
  }, 300_000);

  it('gives box-4-hop its golden hash at its last step', async () => {
    const text = readFileSync('tests/replays/box-4-hop.replay.json', 'utf8');
    const { steps, hashes } = JSON.parse(text) as { steps: number; hashes: Record<string, Record<string, string>> };
    const engine = await createHeadless({ scene: 'box:crowd-100' });
    const replay = engine.replay as (text: string, options: object) => Promise<{ hash: string }>;
    expect((await replay(text, {})).hash).toBe(hashes[`${process.platform}-${process.arch}`][steps]);
  }, 300_000);
});
