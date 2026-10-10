/**
 * @file The registry kind `inspectorMember` (PLAN.md §8.3, §5.8's one tool table, WP 1.6): what an inspector member
 * is (a help line, its arguments as schema fields, its implementation), the checks each one passes when defined, and
 * the signatures and help lines made from them. engine/dev/inspector.ts assembles `__engine` from these entries and
 * registers the core members.
 *
 * Each WP registers its members from its own files: `defineMember(name, spec)` from `dev/`, or `def('inspectorMember',
 * name, spec)` through engine/core/registry.ts from any layer that loads after this module, so no layer imports
 * `dev/` for it. One table feeds `help()`, the argument checks and, later, the MCP server's tool schemas (WP 7.6):
 * `args` is a schema (engine/core/schema.ts) whose key order is the call order.
 *
 * Invariants (each a `CORE_BAD_SPEC` problem when broken): a name is a lower-case word or dotted words
 * (`scene.dump`), and is a member or a namespace of members, never both; every argument field is valid and
 * documented; required arguments come before optional ones; a `value` member (read as a property) takes none; `impl`
 * takes no argument `args` lacks (`impl.length` counts the host).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const members = createRegistry();
 * const at = { type: 'string', required: true, description: 'Whom.' } as const;
 * defineMember('wave', { help: 'Waves.', args: { at }, impl: () => 1 }, members);
 * signatureOf(members.get('inspectorMember', 'wave') as Member); // 'wave(at)'
 * helpText(members); // 'wave(at)  Waves.'
 * @see engine/dev/inspector.test.ts
 */
import type { Log } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { checkField, show, type Field, type Schema } from '../core/schema';
import type { Clock } from '../core/time';
import type { Session } from '../sim/scene';

/** What a member works on: the run behind `__engine`, a page's or `createHeadless`'s. */
export interface InspectorHost {
  /** Where the run's scenes, components and settings are declared: what `describe()` lists. */
  readonly registry: Registry;
  /** Where the inspector's members are registered (the shared registry). */
  readonly members: Registry;
  /** Where errors and advice are recorded: what `errors` and `advice` show. */
  readonly log: Log;
  /** The frame clock over the run's settings: `pause`, `resume`, `step` and `timeScale` go through it. */
  readonly clock: Clock;
  /** The running scene's recorded session: its scene, world and settings store. */
  readonly session: Session;
  /** The JavaScript runtime: `node` or `browser`. */
  readonly runtime: string;
  /** Whether a renderer draws; without one, members that need it throw `DEV_NO_RENDERER`. */
  readonly renderer: boolean;
  /** The GPU adapter's description, null without a renderer. */
  readonly adapter: Readonly<Record<string, unknown>> | null;
  /** The optional GPU features in use. */
  readonly features: readonly string[];
  /** The downgrades taken, as advice codes. */
  readonly downgrades: readonly string[];
  /** Runs `n` sim steps through the clock, with one intents object for every step or one per step. */
  step(n: number, intents: unknown): void;
  /** Starts the scene again with `seed`, keeping the settings changed since it started. */
  restart(seed: number): void;
}

/** How a member is written: `defineMember(name, spec)` or `def('inspectorMember', name, spec)`. */
export interface MemberSpec {
  /** What it does, one line: `help()` prints it after the signature. */
  help: string;
  /** Its arguments in call order, name → schema field. */
  args?: Schema;
  /** The work: the host, then the checked arguments; returns plain data. */
  impl: (host: InspectorHost, ...args: never[]) => unknown;
  /** What the host must have: `renderer` members throw `DEV_NO_RENDERER` without one (`sim` by default). */
  needs?: 'sim' | 'renderer';
  /** True for a property read without a call; `impl(host)` runs on each read. */
  value?: boolean;
}

/** A registered member: its spec with defaults filled, plus `id` (its name) and `kind`. */
export type Member = Entry & Required<MemberSpec>;

/** The fields of an `inspectorMember` entry. */
const MEMBER_FIELDS = {
  help: {
    type: 'string',
    required: true,
    description: 'What it does, one line: help() prints it after the signature.',
  },
  args: {
    type: 'object',
    default: {},
    description: 'Its arguments in call order, name → schema field (engine/core/schema.ts): checked before impl runs.',
  },
  impl: {
    type: 'function',
    required: true,
    description: '(host, ...args) => plain data: the work, given the host (InspectorHost) and the checked arguments.',
  },
  needs: {
    type: 'string',
    enum: ['sim', 'renderer'],
    default: 'sim',
    description: 'What the host must have: renderer members throw DEV_NO_RENDERER on a host without one (headless).',
  },
  value: {
    type: 'boolean',
    default: false,
    description: 'True for a property read without a call (errors, advice); impl(host) runs on each read.',
  },
} as const satisfies Schema;

/** A member's name: a lower-case word, or such words joined by dots. */
const NAME = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

/** The problems of a member entry beyond its fields (the file comment lists them). */
function memberProblems(member: Member, registry: Registry): string[] {
  const problems: string[] = [];
  if (!NAME.test(member.id)) {
    problems.push(`the name ${show(member.id)} must be a lower-case word, or such words joined by dots (scene.dump)`);
  }
  const args = Object.entries(member.args as Record<string, unknown>);
  for (const [key, field] of args) problems.push(...checkField(field, `args.${key}`).map((p) => p.message));
  args.forEach(([key, field], i) => {
    const optional = args.slice(0, i).some(([, before]) => !(before as Field).required);
    if ((field as Field).required && optional) {
      problems.push(`args.${key} is required after an optional argument: put the required ones first`);
    }
  });
  if (member.value && args.length) problems.push('a value member (read as a property) takes no arguments');
  const taken = member.impl.length - 1;
  if (taken > args.length) {
    problems.push(`impl takes ${taken} argument(s) after the host but args declares ${args.length}: declare each one`);
  }
  for (const other of registry.list('inspectorMember')) {
    if (other.id.startsWith(`${member.id}.`) || member.id.startsWith(`${other.id}.`)) {
      problems.push(`it clashes with the member ${other.id}: a name is a member or a namespace of members, not both`);
    }
  }
  return problems;
}

/** Declares the kind `inspectorMember` on `registry` unless it has it. */
export function memberKind(registry: Registry): void {
  if (registry.kinds().includes('inspectorMember')) return;
  registry.defineKind('inspectorMember', {
    description:
      'Members of the inspector (__engine, createHeadless): a call or property with its help line, argument schema and implementation.',
    fields: MEMBER_FIELDS,
    defineWith: "defineMember('<name>', { help, args, impl })",
    check: (entry) => memberProblems(entry as unknown as Member, registry),
  });
}
memberKind(sharedRegistry);

/** Registers an inspector member on `registry` (the shared one by default). Throws `CORE_BAD_SPEC` naming each problem. */
export function defineMember(name: string, spec: MemberSpec, registry: Registry = sharedRegistry): Member {
  memberKind(registry);
  return registry.def('inspectorMember', name, spec as unknown as Record<string, unknown>) as Member;
}

/** How a member is called: `step(n = 1, intents?)`, `get(id)`, or `errors` for a value member. */
export function signatureOf(member: Member): string {
  if (member.value) return member.id;
  const args = Object.entries(member.args as Record<string, Field>).map(([key, field]) => {
    if (field.required) return key;
    return field.default === undefined ? `${key}?` : `${key} = ${show(field.default)}`;
  });
  return `${member.id}(${args.join(', ')})`;
}

/** One argument as `help(name)` lists it: name, type, range, unit, then its description. */
function argumentLine(key: string, field: Field): string {
  const range = [
    field.minimum === undefined ? '' : `≥ ${field.minimum}`,
    field.maximum === undefined ? '' : `≤ ${field.maximum}`,
  ];
  const facts = [field.type, ...range, field.unit ?? '', field.enum ? `one of ${field.enum.map(show).join(', ')}` : ''];
  return `  ${key}: ${facts.filter(Boolean).join(', ')}. ${field.description ?? ''}`;
}

/** `help()`: every member, one line each (signature, then help); with a name, that member and its arguments. */
export function helpText(members: Registry, name?: string): string {
  memberKind(members);
  const line = (member: Member) => [
    signatureOf(member),
    member.help + (member.needs === 'renderer' ? ' (needs a renderer)' : ''),
  ];
  if (name !== undefined) {
    const member = members.get('inspectorMember', name) as Member;
    const args = Object.entries(member.args as Record<string, Field>).map(([key, field]) => argumentLine(key, field));
    return [line(member).join('  '), ...args].join('\n');
  }
  const rows = (members.list('inspectorMember') as Member[]).map(line);
  const width = Math.max(0, ...rows.map(([signature]) => signature.length));
  return rows.map(([signature, help]) => `${signature.padEnd(width)}  ${help}`).join('\n');
}
