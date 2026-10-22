/**
 * @file Unit tests for the interact scene (labs/playground/scenes/interact.ts, levels/cottage.ts; PLAN.md WP 13.16):
 * the cottage stands where its site puts it, its front door hung in the doorway's middle and two panes in each
 * window, the kitchen's lamp lit; its replay (tests/replays/playground-interact.replay.json) plays the story in its
 * order, each step's prompt the HUD's: the door opens away from the player, who walks in, turns the light off and on
 * at its switch, walks out and closes the door; a strike bursts it open and a second breaks it, splintering; a chair
 * is picked up and thrown through the east window, whose pane breaks.
 * @see labs/playground/scenes/interact.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playReplay } from '../../../engine/sim/replay';
import { createSession } from '../../../engine/sim/session';
import { siteStructureAt, type DoorComponent, type ScenePropComponents } from '../../../engine/sim-api';
import { INTERACT, INTERACT_START, interact } from './interact';

const REPLAY = JSON.parse(readFileSync(join(process.cwd(), 'tests/replays/playground-interact.replay.json'), 'utf8'));

type Entity = ScenePropComponents & { door?: DoorComponent; interactor?: { prompt: string } };

describe('the interact scene', () => {
  it('stands the cottage at (7, 5), its door in the doorway, two panes a window and the kitchen’s lamp lit', () => {
    const [cottage] = INTERACT.structures;
    expect([cottage.footprint, siteStructureAt(INTERACT, 10, 0.1, 7.5)?.room?.name, INTERACT_START[2]]).toEqual([[7, 5, 13, 10], 'kitchen', 13]); // prettier-ignore
    const session = createSession(interact, { seed: 1 });
    session.step({});
    const of = (id: number) => session.world.get(id) as unknown as Entity;
    expect(of(2).door!.hinge).toEqual([9.55, 0, 9.75]); // 5 cm in from the doorway's west end, in the wall's middle
    expect([3, 4, 5, 6].map((id) => [of(id).sceneProp.prop, of(id).sceneProp.x, of(id).sceneProp.z])).toEqual([
      ['prop:pane', 12.75, 6.75], // the east window
      ['prop:pane', 12.75, 7.25],
      ['prop:pane', 7.75, 9.75], // the south window
      ['prop:pane', 8.25, 9.75],
    ]);
    expect(of(7).propLight).toEqual({ on: true, group: 'room:kitchen' });
  });

  it('plays its replay’s story in order, with the HUD’s prompts', () => {
    const played = playReplay(REPLAY);
    const { world } = played.session;
    const story = world.events
      .trace()
      .filter((e) => ['door', 'switch', 'strike', 'splinters', 'pickup', 'throw', 'glass'].includes(e.type))
      .map((e) => {
        const p = e.payload as { open?: boolean; on?: boolean; prop?: string };
        return e.type === 'door' ? `door ${p.open ? 'open' : 'shut'}` : e.type === 'switch' ? `light ${p.on ? 'on' : 'off'}` : `${e.type}${p.prop ? ` ${p.prop}` : ''}`; // prettier-ignore
      });
    expect(story).toEqual([
      'door open',
      'light off',
      'light on',
      'door shut',
      'door open', // the first strike bursts it open
      'strike',
      'splinters prop:door', // the second breaks it
      'strike',
      'pickup',
      'throw',
      'glass prop:pane',
    ]);
    const prompts = [5, 111, 113, 300, 340, 434, 440].map((until) => {
      const at = playReplay(REPLAY, { until }).session.world;
      return (at.get(1) as unknown as Entity).interactor!.prompt;
    });
    expect(prompts).toEqual(['Open', 'Lights off', 'Lights on', 'Open', 'Close', 'Pick up', 'Throw']);
    expect([world.has(3), (world.get(2) as unknown as Entity).door!.broken]).toEqual([false, true]);
  });
});
