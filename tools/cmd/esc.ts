/**
 * @file Escalations and the calls made without an answer (DOCTRINE.md, Escalation; PLAN.md §8.14, ADR-0017): writes
 * and lists the records in docs/escalations/ (tools/lib/escalations.ts), and checks them as `x check`'s `esc` plugin.
 *
 * - `open "<question>" --principle <Name> --option "…" --option "…" --recommend N [--why "…"] [--run <id>]
 *   [--no-wait]` writes `docs/escalations/ESC-NNNN-<slug>.md` (status open, deadline 15 minutes after raised) and
 *   prints the message to post. Post it, then wait for the deadline (`send_later`), doing the doctrine's preferred
 *   alternative and never the action. `--no-wait` (for the rest of a run after a first timeout, and in ultracode
 *   lanes): post or report it and go on without stopping; record the call with `decide` before the deadline (a
 *   lane reports the id to the integrator, who decides for the run, §11.3).
 * - `answer ESC-NNNN "<answer>"`: the owner answered (also after a call); act on it.
 * - `decide ESC-NNNN --call "<what was done and why>" --commit <sha>`: no answer by the deadline; commit first. The
 *   status becomes decided-in-absence, awaiting the owner's review.
 * - `close ESC-NNNN`: the owner reviewed it, keeping or reversing the call. `answer`, `decide` and `close` take
 *   `--follow-up "<what still has to happen>"`.
 * - `list [--open] [--write]`: the records; `--open` keeps those still needing review, calls first, then open (the
 *   overdue flagged), then answered. `--write` regenerates docs/escalations/README.md, which every subcommand that
 *   changes a record also rewrites.
 *
 * `--principle` takes the doctrine's short names (PLAN.md §3), comma-separated, in any case. `--run` defaults to
 * `$X_RUN`, else the Claude Code session (`$CLAUDE_CODE_REMOTE_SESSION_ID`, `$CLAUDE_CODE_SESSION_ID`), else `local`.
 * The plugin fails on a malformed record, a duplicate id, an open record past its deadline with no call ("decide or
 * answer ESC-NNNN") and a stale README; in an ultracode lane the last two are warnings (the integrator handles them).
 *
 * Usage: node x esc <open|answer|decide|close|list> …. Exit 0; 1 when a record cannot move that way; 2 on a usage
 * error.
 * @see tools/cmd/esc.test.ts
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalPrinciple,
  deadlineFor,
  DIR,
  generateIndex,
  INDEX,
  isoSeconds,
  isOverdue,
  nextId,
  readRecords,
  slugOf,
  wellFormed,
  writeIndex,
  writeRecord,
  type Escalation,
  type Status,
} from '../lib/escalations';
import type { Finding } from '../lib/report';
import { closest, UsageError, type Command, type CommandResult } from '../x';
import type { CheckOutcome, CheckPlugin } from './check';

/** The subcommands, with the flags and positional arguments each takes. */
const SUBCOMMANDS = {
  open: { flags: ['principle', 'option', 'recommend', 'why', 'run', 'no-wait'], args: ['"<question>"'] },
  answer: { flags: ['follow-up'], args: ['ESC-NNNN', '"<answer>"'] },
  decide: { flags: ['call', 'commit', 'follow-up'], args: ['ESC-NNNN'] },
  close: { flags: ['follow-up'], args: ['ESC-NNNN'] },
  list: { flags: ['open', 'write'], args: [] },
} as const;
type Subcommand = keyof typeof SUBCOMMANDS;

/** What the command reads from outside; tests pass a virtual clock and a fixed environment. */
export interface EscOptions {
  /** The current time; the records' `raised`, the deadlines and the overdue check use it. */
  now?: () => Date;
  /** The environment the run id defaults from. */
  env?: Record<string, string | undefined>;
}

/** The run a record belongs to: `--run`, else `$X_RUN`, else the Claude Code session, else `local`. */
export function runId(flag: string | undefined, env: Record<string, string | undefined>): string {
  return flag || env.X_RUN || env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || 'local';
}

/** A time as the short message shows it: `12:15 UTC`. */
const clock = (iso: string) => `${iso.slice(11, 16)} UTC`;
/** The options, numbered, the recommended one marked. */
const numbered = (options: readonly string[], recommended: number) =>
  options.map((option, i) => `${i + 1}. ${option}${i + 1 === recommended ? ' (recommended)' : ''}`);

/** The short message `open` prints for the owner: the question, the options and what happens without an answer. */
export function messageFor(record: Escalation, wait: boolean): string[] {
  const n = record.recommendation;
  const tail = wait
    ? `Reply by ${clock(record.deadline)} (${record.deadline}). Without an answer I take option ${n} and record the call; until then I take the doctrine's preferred alternative, never the action.`
    : `Not waiting (reported without stopping): I take option ${n} now and record the call; answer any time to change it.`;
  return [`${record.id} (${record.principle}): ${record.title}`, ...numbered(record.options, n), tail];
}

/** `n` and `word`, plural unless `n` is 1: `2 records`. */
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The flag values as strings, or undefined. */
const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** Builds the command; tests inject the clock and the environment. */
export function createEscCommand(options: EscOptions = {}): Command {
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;
  return {
    usage: 'esc <open|answer|decide|close|list> [args]',
    options: {
      principle: { type: 'string' },
      option: { type: 'string', multiple: true },
      recommend: { type: 'string' },
      why: { type: 'string' },
      run: { type: 'string' },
      'no-wait': { type: 'boolean' },
      call: { type: 'string' },
      commit: { type: 'string' },
      'follow-up': { type: 'string' },
      open: { type: 'boolean' },
      write: { type: 'boolean' },
    },
    maxPositionals: 3,
    async run({ values, positionals, root }): Promise<CommandResult> {
      const [name = '', ...args] = positionals;
      if (!(name in SUBCOMMANDS)) {
        const near = closest(name, Object.keys(SUBCOMMANDS));
        const hint = near ? `did you mean ${near}?` : `one of ${Object.keys(SUBCOMMANDS).join(', ')}`;
        throw new UsageError(name ? `there is no x esc ${name}: ${hint}` : `name a subcommand: ${hint}`);
      }
      const sub = name as Subcommand;
      const spec = SUBCOMMANDS[sub];
      const misplaced = Object.keys(values).filter((flag) => !(spec.flags as readonly string[]).includes(flag));
      if (misplaced.length) {
        const allowed = spec.flags.length ? spec.flags.map((flag) => `--${flag}`).join(', ') : 'no flags';
        throw new UsageError(`x esc ${sub} takes ${allowed}, not --${misplaced.join(', --')}`);
      }
      if (args.length !== spec.args.length) {
        throw new UsageError(`x esc ${sub} takes ${spec.args.join(' ') || 'no arguments'}`);
      }
      if (sub === 'list') return list(root, now(), values.open === true, values.write === true);
      if (sub === 'open') return open(root, now(), args[0], values, runId(str(values.run), env));
      return update(root, now(), sub, args, values);
    },
  };
}

/** `x esc open`: validates the question, writes the record and the README, and prints the message to post. */
async function open(
  root: string,
  at: Date,
  question: string,
  values: Record<string, unknown>,
  run: string,
): Promise<CommandResult> {
  const title = question.replace(/\s+/g, ' ').trim();
  if (!title) throw new UsageError('ask the question: x esc open "<question>"');
  if (!str(values.principle)) throw new UsageError('name the principle at stake: --principle <Name> (PLAN.md §3)');
  let principle: string;
  try {
    principle = canonicalPrinciple(str(values.principle) ?? '');
  } catch (error) {
    throw new UsageError(`--principle ${(error as Error).message}`);
  }
  const choices = ((values.option as string[] | undefined) ?? []).map((option) => option.replace(/\s+/g, ' ').trim());
  if (choices.length < 2 || choices.some((option) => !option)) {
    throw new UsageError('give at least two choices: --option "…" --option "…"');
  }
  const recommendation = Number(str(values.recommend));
  if (!Number.isInteger(recommendation) || recommendation < 1 || recommendation > choices.length) {
    throw new UsageError(`recommend one of the options by number: --recommend 1 to ${choices.length}`);
  }
  mkdirSync(join(root, DIR), { recursive: true });
  const records = readRecords(root);
  const wait = values['no-wait'] !== true;
  const id = nextId(records);
  const raised = isoSeconds(at);
  const record: Escalation = {
    ...{ id, title, status: 'open', principle, raised, deadline: isoSeconds(deadlineFor(at)), run },
    ...{ options: choices, recommendation, answer: null, call: null, commit: null, followUp: null },
  };
  const file = `${id}-${slugOf(title)}.md`;
  const how = wait
    ? `, waiting until ${record.deadline}`
    : ' without waiting (--no-wait: an earlier escalation in this run timed out, or an ultracode lane)';
  const body = [
    `# ${id}: ${title}`,
    '',
    str(values.why)?.trim() || 'No reasoning was given.',
    '',
    '## Options',
    '',
    ...numbered(choices, recommendation),
    '',
    '## Log',
    '',
    `- ${raised}: opened${how} (run ${run}).`,
  ].join('\n');
  writeRecord(root, file, record, body);
  await writeIndex(root);
  const message = messageFor(record, wait);
  const next = wait
    ? `Next: wait until ${record.deadline} (send_later). Answered: node x esc answer ${id} "<answer>". No answer: commit, then node x esc decide ${id} --call "<what was done and why>" --commit <sha>.`
    : `Next: node x esc decide ${id} --call "<what was done and why>" --commit <sha> before ${clock(record.deadline)} (in an ultracode lane, report ${id} to the integrator instead).`;
  return {
    ok: true,
    summary: `${id} opened (${principle}); post the message below`,
    lines: ['Post this where the owner is watching (the chat or the PR):', ...message.map((line) => `  ${line}`), next],
    metrics: { id, file: `${DIR}/${file}`, deadline: record.deadline, wait, message: message.join('\n') },
  };
}

/** The statuses each changing subcommand may start from. */
const FROM: Record<'answer' | 'decide' | 'close', Status[]> = {
  answer: ['open', 'answered', 'decided-in-absence'],
  decide: ['open'],
  close: ['open', 'answered', 'decided-in-absence'],
};

/** Why a record cannot move on from its status, as the sentence to print. */
function refusal(record: Escalation): string {
  if (record.status === 'closed') return `${record.id} is closed: open a new escalation if the question comes back`;
  if (record.status === 'answered') return `${record.id} was answered ("${record.answer}"): act on the answer`;
  return `${record.id} already has a call (at ${record.commit}): the owner answers or closes it now`;
}

/** `x esc answer | decide | close`: moves one record on, logs it, and rewrites the README. */
async function update(
  root: string,
  at: Date,
  sub: 'answer' | 'decide' | 'close',
  args: string[],
  values: Record<string, unknown>,
): Promise<CommandResult> {
  const records = readRecords(root);
  const id = /^(?:ESC-)?(\d{1,4})$/i.exec(args[0]);
  const wanted = id ? `ESC-${id[1].padStart(4, '0')}` : args[0];
  const found = records.find((record) => record.file.startsWith(`${wanted}-`));
  if (!found) {
    const ids = records.map((record) => record.file.slice(0, 8));
    const near = closest(wanted, ids);
    throw new UsageError(`there is no record ${wanted} in ${DIR}/${near ? `: did you mean ${near}?` : ''}`);
  }
  if (found.problems.length) {
    const file = `${DIR}/${found.file}`;
    const failures = [{ id: 'ESC_RECORD', message: `${file}: ${found.problems.join('; ')}`, file }];
    return { ok: false, summary: `${wanted} is malformed: fix it first`, failures, target: sub };
  }
  const [record] = wellFormed([found]);
  if (!FROM[sub].includes(record.status)) {
    const failures = [{ id: 'ESC_STATE', message: refusal(record), file: `${DIR}/${record.file}` }];
    return { ok: false, summary: `${record.id} is ${record.status}`, failures, target: sub };
  }
  const when = isoSeconds(at);
  const followUp = str(values['follow-up'])?.trim() || record.followUp;
  let next: Escalation;
  let log: string;
  if (sub === 'answer') {
    const answer = args[1].replace(/\s+/g, ' ').trim();
    if (!answer) throw new UsageError('give the answer: x esc answer ESC-NNNN "<answer>"');
    next = { ...record, status: 'answered', answer, followUp };
    log = `answered by the owner: ${answer}`;
  } else if (sub === 'decide') {
    const call = str(values.call)?.replace(/\s+/g, ' ').trim();
    const commit = str(values.commit)?.trim().toLowerCase();
    if (!call) throw new UsageError('say what was done and why: --call "<call>"');
    if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
      throw new UsageError('name the commit holding the work, made before deciding: --commit <sha>');
    }
    next = { ...record, status: 'decided-in-absence', call, commit, followUp };
    const late = isOverdue(record, at) ? '' : ' (before the deadline: a run that does not wait)';
    log = `decided in the owner's absence at ${commit}${late}: ${call}`;
  } else {
    next = { ...record, status: 'closed', followUp };
    log = 'closed by the owner';
  }
  const followNote = followUp && followUp !== record.followUp ? ` Follow-up: ${followUp}` : '';
  const stop = /[.!?]$/.test(log) ? '' : '.';
  writeRecord(root, record.file, next, `${found.body.trimEnd()}\n- ${when}: ${log}${stop}${followNote}`);
  const wrote = await writeIndex(root);
  return {
    ok: true,
    summary: `${record.id} is ${next.status}`,
    lines: [`${DIR}/${record.file}: ${record.status} → ${next.status}`, `${INDEX} ${wrote ? 'rewritten' : 'current'}`],
    metrics: { id: record.id, status: next.status },
    target: sub,
  };
}

/** The order `list --open` shows records in: calls awaiting review, open, answered. */
const REVIEW_ORDER: Status[] = ['decided-in-absence', 'open', 'answered'];

/** `x esc list`: one line per record (`--open`: those still needing review, calls first); `--write` regenerates. */
async function list(root: string, at: Date, onlyOpen: boolean, write: boolean): Promise<CommandResult> {
  const records = readRecords(root);
  const good = wellFormed(records);
  const shown = onlyOpen ? REVIEW_ORDER.flatMap((status) => good.filter((record) => record.status === status)) : good;
  const lines = shown.map((record) => {
    const extra =
      record.status === 'decided-in-absence'
        ? `call at ${record.commit}: ${record.call}`
        : record.status === 'open'
          ? `deadline ${record.deadline}${isOverdue(record, at) ? ', OVERDUE: decide or answer it' : ''}`
          : record.status === 'answered'
            ? `answer: ${record.answer}`
            : (record.answer ?? record.call ?? 'closed');
    return `${record.id} ${record.status} (${record.principle}): ${record.title} [${extra}]`;
  });
  const malformed = records.length - good.length;
  if (malformed) lines.push(`${count(malformed, 'malformed record')}: node x check names the problems`);
  if (write) {
    mkdirSync(join(root, DIR), { recursive: true });
    lines.push((await writeIndex(root)) ? `wrote ${INDEX}` : `${INDEX} was already current`);
  }
  const overdue = good.filter((record) => isOverdue(record, at)).length;
  const review = good.filter((record) => record.status === 'decided-in-absence').length;
  const subject = onlyOpen ? 'still needing review' : 'in all';
  return {
    ok: true,
    summary: `${count(shown.length, 'record')} ${subject} (${count(review, 'call')} awaiting review, ${overdue} overdue)`,
    lines: lines.length ? lines : ['no records'],
    metrics: { shown: shown.length, records: records.length, review, overdue, malformed },
    target: 'list',
  };
}

/** The `x check` rules: well-formed records with unique ids, no open record overdue, a current README. */
export async function checkEscalations(root: string, at: { now: Date; lane: boolean }): Promise<CheckOutcome> {
  if (!existsSync(join(root, DIR))) return { failures: [], summary: 'no records' };
  const records = readRecords(root);
  const failures: Finding[] = [];
  const warnings: Finding[] = [];
  for (const record of records) {
    const file = `${DIR}/${record.file}`;
    for (const problem of record.problems) failures.push({ id: 'ESC_RECORD', message: `${file}: ${problem}`, file });
  }
  const ids = new Map<string, string>();
  for (const record of records) {
    const id = /^ESC-\d{4}/.exec(record.file)?.[0];
    if (!id) continue;
    const first = ids.get(id);
    if (first) {
      const message = `${id} is used by ${first} and ${record.file}: renumber the later one (its file name and id) with the next free number`;
      failures.push({ id: 'ESC_DUPLICATE', message, file: `${DIR}/${record.file}` });
    } else ids.set(id, record.file);
  }
  const good = wellFormed(records);
  const inLane =
    ' (a warning in this ultracode lane: the integrator escalates once for the run and records the call, PLAN.md §11.3)';
  const overdue = good.filter((record) => isOverdue(record, at.now));
  for (const record of overdue) {
    const message = `${record.id} is open past its deadline (${record.deadline}) with no call: decide or answer ${record.id} (node x esc decide ${record.id} --call "<what was done and why>" --commit <sha>, or node x esc answer ${record.id} "<answer>")`;
    (at.lane ? warnings : failures).push({
      id: 'ESC_OVERDUE',
      message: at.lane ? message + inLane : message,
      file: `${DIR}/${record.file}`,
    });
  }
  const stale =
    !existsSync(join(root, INDEX)) || readFileSync(join(root, INDEX), 'utf8') !== (await generateIndex(root, records));
  if (stale) {
    const message = `${INDEX} is stale: run node x esc list --write (never edit it by hand)`;
    (at.lane ? warnings : failures).push({ id: 'ESC_INDEX_STALE', message, file: INDEX });
  }
  const having = (status: Status) => good.filter((record) => record.status === status).length;
  const metrics = {
    records: records.length,
    open: having('open'),
    overdue: overdue.length,
    review: having('decided-in-absence'),
    answered: having('answered'),
    closed: having('closed'),
  };
  return {
    failures,
    warnings,
    metrics,
    summary: `${count(records.length, 'record')}: ${metrics.open} open (${metrics.overdue} overdue), ${count(metrics.review, 'call')} awaiting review, ${metrics.answered} answered, ${metrics.closed} closed; index ${stale ? 'stale' : 'current'}`,
  };
}

export default createEscCommand();

/** The `esc` plugin of `x check` (T0): well-formed records, none overdue, a current README. */
export const check: CheckPlugin = {
  name: 'esc',
  run: ({ root, lane }) => checkEscalations(root, { now: new Date(), lane }),
};
