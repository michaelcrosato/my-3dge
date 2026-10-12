/**
 * @file The state a replay reaches, for `x replay --state` and `--until n` (tools/cmd/replay.ts; gate G7's review):
 * `writeState(root, file, runtime, until?)` plays a replay file in a runtime (Node's, tools/cmd/sim.ts `nodeRuntime`)
 * to its last step, or to step `until`, and writes the canonical state there and its event trace, as `x sim` writes its
 * own, to `stateFile(file)`: `out/replay/<name>/state.json`, `<name>` the file's without `.replay.json`. So an agent
 * reads where a run left its bodies, its props and its components without a page or a probe of its own.
 *
 * Invariants: it only reads the replay and plays it from step 0 (the runtime's player); a step past the replay's last
 * is a usage error, never a silent clamp.
 *
 * @example
 * stateFile('tests/replays/box-5-fight.replay.json'); // 'out/replay/box-5-fight/state.json'
 * @see tools/cmd/replay.test.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { serialize, type Canonical } from '../../engine/core/hash';
import type { Replay } from '../../engine/sim/replay';
import type { Runtime } from '../cmd/sim';
import { UsageError } from '../x';

/** Where the state of replay `file` goes: `out/replay/<name>/state.json`, beside the reports. */
export function stateFile(file: string): string {
  return `out/replay/${basename(file).replace(/(\.replay)?\.json$/, '')}/state.json`;
}

/**
 * Writes the state `file` reaches in `runtime` after step `until` (its last by default) and its trace to
 * `stateFile(file)`; returns the line that says where, with the state's hash. A step past the last is a usage error.
 */
export async function writeState(root: string, file: string, runtime: Runtime, until?: number): Promise<string> {
  const text = readFileSync(file, 'utf8');
  const { steps } = JSON.parse(text) as Replay;
  if (until !== undefined && until > steps)
    throw new UsageError(`--until ${until} is past ${basename(file)}'s last step, ${steps}`);
  const step = until ?? steps;
  const view = await runtime.stateAt(text, step);
  const out = stateFile(file);
  mkdirSync(join(root, out, '..'), { recursive: true });
  writeFileSync(join(root, out), `${serialize({ state: view.state, trace: view.trace } as unknown as Canonical)}\n`);
  return `${basename(file)}: the state after step ${step} (hash ${view.hash}) and its trace in ${out}`;
}
