/**
 * @file Prints the generated help: every command, or one command's file comment and flags.
 *
 * The list shows each command with the first sentence of its file comment; `node x help <cmd>` prints the whole
 * comment and the flags its module declares. Each command's file comment is its help, so this cannot go stale
 * (PLAN.md §8.1).
 *
 * Usage: node x help [cmd]. `node x <cmd> --help` is the same as `node x help <cmd>`.
 * Exit codes: 0, or 2 for an unknown command (naming the closest one).
 *
 * @see tools/x.test.ts
 */
import {
  closest,
  commandHelp,
  commandNames,
  firstSentence,
  loadCommand,
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
      return {
        ok: true,
        summary: `${names.length} commands: node x <cmd> [args]; node x help <cmd> for one`,
        lines: names.map((name) => `  ${name.padEnd(width)}  ${firstSentence(commandHelp(root, name))}`),
        metrics: { commands: names.length },
      };
    }
    if (!names.includes(wanted)) {
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
