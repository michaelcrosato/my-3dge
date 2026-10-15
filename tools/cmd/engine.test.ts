/**
 * @file Unit tests for `node x engine` (tools/cmd/engine.ts; PLAN.md WP 10.7): in the engine's own repository it says
 * how to make a game and refuses a game's flags; in a game it names the pinned engine, fails on an engine file changed
 * without a declaration (as `x check`'s plugin `engine` does), and `--update --from` moves the game to another engine
 * through that engine's new-game.mjs. `--test`, which makes a real game and runs its whole gate, is the full run's step
 * (tools/cmd/ci.ts), not a unit test.
 * @see tools/cmd/engine.ts
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createGame } from '../game/new-game.mjs';
import { ROOT, type CommandContext } from '../x';
import engine, { check, engineOnlyListed } from './engine';

const folders: string[] = [];
afterAll(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

/** A fresh temporary folder, removed after the tests. */
function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'x-engine-test-'));
  folders.push(made);
  return made;
}

/** Runs the command at `root` with `values`. */
const run = (root: string, values: CommandContext['values'] = {}) => engine.run({ root, values, positionals: [] });

/** A game made from this checkout, without git. */
function game(): string {
  const target = join(folder(), 'g');
  createGame({ target, name: 'g', git: false });
  return target;
}

describe('x engine', () => {
  it('in the engine’s own repository, says how to make a game and refuses a game’s flags', async () => {
    expect(await run(ROOT)).toMatchObject({ ok: true, summary: expect.stringContaining('new-game.mjs <dir>') });
    await expect(run(ROOT, { check: true })).rejects.toThrow(/not a game/);
    expect(await check.run({ root: ROOT, lane: false })).toEqual({
      failures: [],
      summary: 'the engine’s own repository',
    });
  });

  it('in a game, names the pinned engine, and fails on an engine file changed without a declaration', async () => {
    const root = game();
    expect(await run(root)).toMatchObject({
      ok: true,
      summary: expect.stringMatching(/^my-3dge@\w{7} .* as shipped$/),
    });
    writeFileSync(join(root, 'engine', 'index.ts'), '// mine\n');
    const found = await run(root, { check: true });
    expect(found).toMatchObject({ ok: false, failures: [{ id: 'ENGINE_EDITED', file: 'engine/index.ts' }] });
    expect(found.failures?.[0].message).toMatch(/git checkout -- engine\/index\.ts.*ENGINE-FEEDBACK\.md/);
    expect((await check.run({ root, lane: false })).failures).toHaveLength(1);
    writeFileSync(join(root, 'ENGINE-FEEDBACK.md'), '## Local engine patches\n- `engine/index.ts`: why\n');
    expect(await run(root, { check: true })).toMatchObject({ ok: true, metrics: { declared: 1 } });
    await expect(run(root, { test: true })).rejects.toThrow(/engine’s own repository/);
  });

  it('finds the engine’s own commands in a game’s help, printed or in its file', () => {
    const shown = 'x help: ok: 18 commands\n  anim      The library.\n  sim       Runs a scene.\n';
    expect(engineOnlyListed(folder(), shown)).toEqual([]);
    expect(engineOnlyListed(folder(), `${shown}  ci        The merge gate.\n`)).toEqual(['ci']);
    const listed = folder();
    mkdirSync(join(listed, 'out', 'help', 'all'), { recursive: true });
    writeFileSync(join(listed, 'out', 'help', 'all', 'commands.txt'), '  docs      Generates.\n  sim       Runs.\n');
    expect(engineOnlyListed(listed, shown)).toEqual(['docs']);
  });

  it('moves a game to the engine --from names, through that engine’s new-game.mjs', async () => {
    const root = game();
    const next = join(folder(), 'engine');
    for (const path of ['tools/game', 'engine', 'package.json', 'package-lock.json', 'LICENSE']) {
      cpSync(join(ROOT, path), join(next, path), { recursive: true });
    }
    writeFileSync(join(next, 'tools', 'game', 'engine-version.txt'), `${'d'.repeat(40)} 2026-11-01T00:00:00Z\n`);
    writeFileSync(join(next, 'engine', 'index.ts'), '// the next engine\n');
    const done = await run(root, { update: true, from: next });
    expect(done).toMatchObject({ ok: true, summary: 'the game is on the new engine' });
    expect(done.lines?.[0]).toMatch(/moved from my-3dge@\w{7} to my-3dge@ddddddd: \d+ engine files changed, 0 added, \d+ removed/); // prettier-ignore
    expect(await run(root)).toMatchObject({ ok: true, summary: expect.stringMatching(/^my-3dge@ddddddd /) });
  });
});
