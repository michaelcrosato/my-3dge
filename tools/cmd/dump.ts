/**
 * @file Dumps the scene and the state of the page `x inspect` keeps open, as text (PLAN.md §8.1, §8.3, WP 2.7):
 * `__engine.scene.dump()`, one object a line (name, type, position, size, material, triangles, entity), then the
 * run's tick, hash and entities.
 *
 * `--step n` first runs n sim steps through `__engine.step` (recorded in the session, as an agent's steps are);
 * `--depth d` cuts the tree below depth d and `--filter text` keeps the objects whose name or type holds the text
 * (with their parents). The whole dump goes to `out/dump/<page>/scene.txt` and the state to `state.json`; up to about
 * 15 lines of the tree are printed. When Vite reloaded the page since the last call, the first line says so.
 *
 * Usage: node x dump [--step n] [--depth d] [--filter text]. Exit 0 with the dump, 1 when the page throws or has no
 * view, 2 on a usage error (no session: start one with `node x inspect`).
 *
 * @example
 * // node x inspect
 * // node x dump --step 60 --filter mover
 * @see tools/cmd/inspect.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { targetSlug } from '../lib/report';
import { UsageError, type Command, type CommandResult } from '../x';
import { callSession, findSession, reloadLines } from './inspect';
import { wholeFlag } from './sim';

/** Tree lines printed; the rest are in scene.txt. */
const SHOWN = 14;

export default {
  usage: 'dump [--step n] [--depth d] [--filter text]',
  options: { step: { type: 'string' }, depth: { type: 'string' }, filter: { type: 'string' } },
  maxPositionals: 0,
  async run({ values, root }): Promise<CommandResult> {
    const step = wholeFlag(values.step, 'step', 0);
    const depth = values.depth === undefined ? undefined : wholeFlag(values.depth, 'depth', 0);
    const session = findSession(root);
    if (!session) throw new UsageError('no inspect session is running: start one with node x inspect');
    let reply: { scene: string; hash: string; tick: number; entities: unknown[]; reloaded?: string };
    try {
      reply = await callSession(session, 'dump', { step, depth, filter: values.filter });
    } catch (error) {
      const message = `${session.page} could not dump: ${error instanceof Error ? error.message : String(error)}`;
      return { ok: false, summary: 'no dump', failures: [{ id: 'DUMP_FAILED', message }] };
    }
    const out = join('out', 'dump', targetSlug(session.page));
    mkdirSync(join(root, out), { recursive: true });
    writeFileSync(join(root, out, 'scene.txt'), `${reply.scene}\n`);
    const state = { tick: reply.tick, hash: reply.hash, entities: reply.entities };
    writeFileSync(join(root, out, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    const tree = reply.scene.split('\n');
    return {
      ok: true,
      target: session.page,
      summary: `${session.page}: tick ${reply.tick}, hash ${reply.hash}, ${reply.entities.length} entities, ${tree.length} objects`,
      lines: [
        ...reloadLines(reply),
        ...tree.slice(0, SHOWN),
        ...(tree.length > SHOWN ? [`… ${tree.length - SHOWN} more lines in ${out}/scene.txt`] : []),
      ],
      metrics: { tick: reply.tick, hash: reply.hash, entities: reply.entities.length, objects: tree.length },
      artifacts: [
        { path: `${out}/scene.txt`, kind: 'text', describes: `the scene of ${session.page}, one object a line` },
        { path: `${out}/state.json`, kind: 'json', describes: 'the tick, hash and entities' },
      ],
    };
  },
} satisfies Command;
