/**
 * @file Prints and checks the read-only source checkouts, `$MY3D2DGE_SRC` and `$SHARDFALL_SRC`, at their pins.
 *
 * `$MY3D2DGE_SRC` is my-3d2dge and `$SHARDFALL_SRC` is shardfall, each at the commit `scripts/setup.sh` pins. A
 * missing checkout is cloned and detached exactly as that script does: `.cache/src-*`, cloned from the local clone,
 * else from GitHub. A checkout named by its variable is only checked, never changed.
 *
 * Usage: node x src. Fails when a source cannot be resolved; shardfall is private, so the failure names the
 * repository the session must include, and the agent escalates once (PLAN.md §11.5). The sources are read-only.
 *
 * @see tools/lib/source.ts
 */
import { resolveSource, sourceSpecs } from '../lib/source';
import type { Command, CommandResult } from '../x';

export default {
  usage: 'src',
  options: {},
  maxPositionals: 0,
  async run({ root }): Promise<CommandResult> {
    const resolved = sourceSpecs(root).map((spec) => resolveSource(spec, { root }));
    const good = resolved.filter((source) => source.ok);
    return {
      ok: good.length === resolved.length,
      summary:
        good.length === resolved.length
          ? `${resolved.length} sources at their pinned commits`
          : `${resolved.length - good.length} of ${resolved.length} sources unresolved`,
      lines: good.map(
        ({ spec, path, via }) => `${spec.variable}=${path} (${spec.name}@${spec.commit.slice(0, 7)}, from ${via})`,
      ),
      failures: resolved
        .filter((source) => !source.ok)
        .map((source) => ({
          id: 'SRC_UNRESOLVED',
          message: source.problem ?? `${source.spec.variable} is unresolved`,
        })),
      metrics: Object.fromEntries([
        ['resolved', good.length],
        ...good.map(({ spec, path }) => [spec.variable, path ?? ''] as const),
      ]),
    };
  },
} satisfies Command;
