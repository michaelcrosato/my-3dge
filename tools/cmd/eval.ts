/**
 * @file Evaluates JavaScript in the page `x inspect` keeps open, and prints its value as JSON (PLAN.md §8.1, WP 2.7):
 * `node x eval "__engine.hash()"`.
 *
 * The text is an expression, awaited (`await __engine.render()` works; for statements, write an arrow function and
 * call it: `(() => { __engine.step(60); return __engine.hash(); })()`). The value comes back through JSON, so
 * functions and cycles do not survive; the whole value goes to `out/eval/all/result.json`, and up to 18 lines of it
 * are printed. When Vite reloaded the page since the last call, the first line says so.
 *
 * Usage: node x eval "<js>". Exit 0 with the value, 1 when the expression throws in the page or the session has
 * gone, 2 on a usage error (no expression; no session: start one with `node x inspect`).
 *
 * @example
 * // node x inspect
 * // node x eval "__engine.camera.get().describe"
 * @see tools/cmd/inspect.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError, type Command, type CommandResult } from '../x';
import { callSession, findSession, reloadLines } from './inspect';

export default {
  usage: 'eval "<js>"',
  options: {},
  maxPositionals: 1,
  async run({ positionals, root }): Promise<CommandResult> {
    const [js] = positionals;
    if (!js?.trim()) throw new UsageError('give an expression to evaluate in the page: node x eval "__engine.hash()"');
    const session = findSession(root);
    if (!session) throw new UsageError('no inspect session is running: start one with node x inspect');
    let reply: { value: unknown; reloaded?: string };
    try {
      reply = await callSession(session, 'eval', { js });
    } catch (error) {
      const message = `${js} threw in ${session.page}: ${error instanceof Error ? error.message : String(error)}`;
      return { ok: false, summary: 'the expression threw', failures: [{ id: 'EVAL_THREW', message }] };
    }
    const text = JSON.stringify(reply.value, null, 2) ?? 'undefined';
    const out = join('out', 'eval', 'all');
    mkdirSync(join(root, out), { recursive: true });
    writeFileSync(join(root, out, 'result.json'), `${text}\n`);
    const lines = text.split('\n');
    return {
      ok: true,
      target: 'all',
      summary: `${session.page}: ${lines.length === 1 ? text.slice(0, 160) : `${lines.length} lines`}`,
      lines: [...reloadLines(reply), ...(lines.length > 1 ? lines : [])],
      artifacts: [{ path: `${out}/result.json`, kind: 'json', describes: `the value of ${js.slice(0, 80)}` }],
    };
  },
} satisfies Command;
