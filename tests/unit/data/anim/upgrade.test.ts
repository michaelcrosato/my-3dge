/**
 * @file WP 8.8's Done-when (PLAN.md §10.5 step 9): in every set whose sources this repository can reach, at least 80%
 * of the clips are re-imported from them with parity (`via: "source"`, tools/anim/upgrade.ts), and every clip that is
 * not is listed with its reason in data/anim/upgrade.json, which names no clip the set lacks. Sets whose sources are
 * out of reach say why (tools/anim/fetch.ts `SET_SOURCES`): the Quaternius GLBs wait for the owner (ESC-0003), and the
 * 100STYLE sets for a defect that touches them. Every format-2 clip carries its hands, grips and feet's roll on every
 * key, the spine override on all of its keys or none, and contacts and events in time order.
 */
import { describe, expect, it } from 'vitest';
import { SET_SOURCES } from '../../../../tools/anim/fetch';
import { readSet } from '../../../../tools/anim/repack';
import { readUpgraded } from '../../../../tools/anim/upgrade';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const UPGRADED = readUpgraded(ROOT);
const AVAILABLE = Object.keys(SET_SOURCES).filter((set) => SET_SOURCES[set].status === 'available');

describe('the re-import from the sources', () => {
  it.each(AVAILABLE)('upgrades at least 80%% of %s with parity, the rest listed with their reasons', (dir) => {
    const set = readSet(dir);
    const names = Object.keys(set.clips);
    const fromSource = names.filter((name) => set.clips[name].via === 'source');
    expect(fromSource.length / names.length, `${fromSource.length} of ${names.length}`).toBeGreaterThanOrEqual(0.8);
    const line = UPGRADED[dir];
    expect(line, `${dir} has no line in data/anim/upgrade.json: run node x anim upgrade ${dir}`).toBeDefined();
    expect([line.swapped, line.of]).toEqual([fromSource.length, names.length]);
    const kept = names.filter((name) => set.clips[name].via !== 'source');
    expect(Object.keys(line.kept).sort()).toEqual(kept.sort());
    for (const why of Object.values(line.kept)) expect(why.length).toBeGreaterThan(10);
  });

  it('says why every other set is not re-imported', () => {
    for (const [dir, source] of Object.entries(SET_SOURCES)) {
      if (source.status === 'available') continue;
      expect(source.why.length, dir).toBeGreaterThan(10);
      expect(UPGRADED[dir], `${dir} is ${source.status}, yet listed as upgraded`).toBeUndefined();
    }
  });

  it.each(AVAILABLE)('writes the format-2 fields of each clip of %s from the source in full', (dir) => {
    for (const [name, clip] of Object.entries(readSet(dir).clips)) {
      if (clip.via !== 'source') continue;
      const every = (field: string) =>
        clip.keys.every((k) => (k as unknown as Record<string, unknown>)[field] !== undefined);
      for (const field of ['handL', 'handR', 'gripL', 'gripR', 'rollL', 'rollR']) expect(every(field), `${name} ${field}`).toBe(true); // prettier-ignore
      const spined = clip.keys.filter((k) => k.spine).length;
      expect([0, clip.keys.length], `${name}: the spine override on every key or none`).toContain(spined);
      const times = [...(clip.events ?? []).map((e) => e.t), ...(clip.contacts ?? []).map((c) => c.from)];
      for (const t of times) expect(t).toBeLessThanOrEqual(clip.dur + 1e-9);
      const events = (clip.events ?? []).map((e) => e.t);
      expect(events, `${name}: events in time order`).toEqual([...events].sort((a, b) => a - b));
    }
  });
});
