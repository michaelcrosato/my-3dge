/**
 * @file Prints the generated help: every command, or one command's file comment and flags.
 *
 * The list shows each command with the first sentence of its file comment; `node x help <cmd>` prints the whole
 * comment and the flags its module declares. Each command's file comment is its help, so this cannot go stale
 * (PLAN.md §8.1). When there are more commands than the output's lines hold (MAX_LINES), it prints their names on
 * a few lines instead, and the list with the sentences goes to `out/help/all/commands.txt` (WP 2.7, the 19th).
 *
 * Usage: node x help [cmd]. `node x <cmd> --help` is the same as `node x help <cmd>`.
 * Exit codes: 0, or 2 for an unknown command (naming the closest one).
 *
 * @see tools/x.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  closest,
  commandHelp,
  commandNames,
  ENGINE_ONLY_COMMANDS,
  engineOnly,
  firstSentence,
  isGame,
  loadCommand,
  MAX_LINES,
  UsageError,
  type Command,
  type CommandResult,
} from '../x';

export default {
  usage: 'help [cmd]',
  options: {},
  maxPositionals: 1,
  async run({ positionals, root }): Promise<CommandResult> {
    const names = commandNames(root);
    const [wanted] = positionals;
    if (wanted === undefined) {
      const width = Math.max(...names.map((name) => name.length));
      const listed = names.map((name) => `  ${name.padEnd(width)}  ${firstSentence(commandHelp(root, name))}`);
      const summary = `${names.length} commands: node x <cmd> [args]; node x help <cmd> for one`;
      if (listed.length <= MAX_LINES - 2)
        return { ok: true, summary, lines: listed, metrics: { commands: names.length } };
      const file = join('out', 'help', 'all', 'commands.txt');
      mkdirSync(join(root, 'out', 'help', 'all'), { recursive: true });
      writeFileSync(join(root, file), `${listed.join('\n')}\n`);
      const rows: string[] = [];
      for (const name of names) {
        if (rows.length && `${rows.at(-1)}, ${name}`.length <= 110) rows[rows.length - 1] += `, ${name}`;
        else rows.push(`  ${name}`);
      }
      return {
        ok: true,
        summary,
        lines: [...rows, `each with what it does: ${file}`],
        metrics: { commands: names.length },
        artifacts: [{ path: file, kind: 'text', describes: 'every command with the first sentence of its help' }],
      };
    }
    if (!names.includes(wanted)) {
      if (isGame(root) && ENGINE_ONLY_COMMANDS.includes(wanted)) throw new UsageError(engineOnly(wanted));
      const near = closest(wanted, names);
      throw new UsageError(`there is no command "${wanted}": ${near ? `did you mean ${near}?` : names.join(', ')}`);
    }
    const command = await loadCommand(root, wanted);
    const flags = Object.entries(command.options).map(
      ([flag, spec]) => `--${flag}${spec.type === 'string' ? ' <value>' : ''}${spec.short ? ` (-${spec.short})` : ''}`,
    );
    return {
      ok: true,
      target: wanted,
      summary: `node x ${command.usage}`,
      lines: [...commandHelp(root, wanted).split('\n'), `flags: ${flags.length ? flags.join(', ') : 'none'}`],
      metrics: { flags: flags.length },
    };
  },
} satisfies Command;
