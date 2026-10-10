/**
 * @file The inspector (PLAN.md §8.3, WP 1.6; doctrines: Agent-operable, Verifiable): `window.__engine` in a page and
 * the object `createHeadless` returns in Node are one API, which `createInspector` assembles from the entries of the
 * registry kind `inspectorMember` (engine/dev/members.ts). Later WPs add members from their own files; this module
 * registers the core ones and never names another.
 *
 * A member is a call (`step(n, intents)`) or, with `value: true`, a property read without one (`errors`); a dotted
 * name (`scene.dump`) is a call on a namespace object. A call checks its arguments against the member's schema
 * (`DEV_BAD_ARGS` naming each problem and the signature, before anything happens), then runs `impl(host, ...args)`
 * with the arguments as given (absent ones as their default). A member that `needs: 'renderer'` throws
 * `DEV_NO_RENDERER` on a host without one, as `createHeadless` is. The core members map onto the kernel: `describe`
 * → the registry; `set` → the settings store through the session (text typed as `x set` types it, non-view changes
 * recorded); `errors` and `advice` → the log; `pause`, `resume`, `step` and `timeScale` → the clock; `state`, `hash`,
 * `trace`, `entities`, `get`, `capture` and `restore` → the world; `seed(n)` starts the scene again.
 *
 * Invariants: the object holds its members and nothing else, so `help()` lists exactly what it has (`x docs --check`
 * compares them, tools/lib/docsHelp.ts). Members are read from `host.members` when the inspector is made: register
 * before. Results are plain data, copied (a capture is the world's own object, so it restores in place).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineMember, type InspectorHost } from './members';
 * const members = createRegistry();
 * const times = { type: 'integer', default: 1, minimum: 1, description: 'How often.' } as const;
 * defineMember('ping', { help: 'Answers pong.', args: { times }, impl: (_h, n: number) => 'pong'.repeat(n) }, members);
 * const engine = createInspector({ members } as unknown as InspectorHost);
 * (engine.ping as (n?: number) => string)(2); // 'pongpong'; ping(0) throws DEV_BAD_ARGS
 * @see engine/dev/inspector.test.ts
 */
import pkg from '../../package.json' with { type: 'json' };
import { codeError, defineCodes, type AdviceRecord, type ErrorRecord } from '../core/log';
import { checkValue, copyValue, listProblems, show, type Problem } from '../core/schema';
import { createSettings, type SettingChange } from '../core/settings';
import type { Intents } from '../input/intents';
import type { WorldCapture } from '../sim/capture';
import type { EntityData, WorldState, WorldTrace } from '../sim/state';
import {
  defineMember,
  helpText,
  memberKind,
  signatureOf,
  type InspectorHost,
  type Member,
  type MemberSpec,
} from './members';

/** The codes this module raises, with their fixes. */
export const INSPECTOR_CODES = defineCodes('dev', {
  DEV_NO_RENDERER: {
    template: '__engine.{member} needs a renderer, and this engine has none ({runtime}, headless)',
    fix: 'call it in a page started with createEngine (WP 2.7); headless, read state(), entities(), get(id) and hash() instead',
  },
  DEV_BAD_ARGS: {
    template: '__engine.{member}: {problems}',
    fix: 'call it as {signature}; __engine.help({name}) lists its arguments',
    doc: 'Raised by every `__engine` member (engine/dev/inspector.ts) before it runs, when an argument does not match the schema its member declares: a wrong type, a value out of range, a missing required argument or one too many. Nothing has happened yet.',
  },
});

/** What `info()` reports: the engine's identity and health, and the run. */
export interface EngineInfo {
  version: string;
  runtime: string;
  headless: boolean;
  adapter: Readonly<Record<string, unknown>> | null;
  features: string[];
  downgrades: string[];
  /** The runtime dependencies and their pinned versions. */
  deps: Record<string, string>;
  scene: string;
  seed: number;
  tick: number;
  hz: number;
}

/** One entity as `entities()` lists it: its id and the components it holds. */
export interface EntitySummary {
  id: number;
  components: string[];
}

/** The inspector, `window.__engine` in a page and what `createHeadless` returns: `help()` lists every member. */
export interface Inspector {
  info(): EngineInfo;
  pause(): void;
  resume(): void;
  step(n?: number, intents?: Intents | readonly Intents[]): number;
  timeScale(k?: number): number;
  seed(n?: number): number;
  state(query?: string | readonly string[]): WorldState;
  hash(): string;
  trace(): WorldTrace;
  entities(query?: string | readonly string[]): EntitySummary[];
  get(id: number): EntityData | null;
  set(path: string, value: unknown): SettingChange;
  capture(): WorldCapture;
  restore(capture: WorldCapture): void;
  describe(kind?: string, id?: string): unknown;
  help(member?: string): string;
  readonly errors: readonly ErrorRecord[];
  readonly advice: readonly AdviceRecord[];
  /** The members later WPs register (`input`, `stats`, `scene.dump`…). */
  [member: string]: unknown;
}

/** Throws `DEV_BAD_ARGS` for `member` with these problems. */
function badArgs(member: string, problems: string, signature: string): never {
  throw codeError('DEV_BAD_ARGS', { member, problems, signature, name: show(member) });
}

/** Runs a member on `host`: the renderer check, the argument checks, then `impl` with the arguments as given. */
function call(host: InspectorHost, member: Member, args: readonly unknown[]): unknown {
  if (member.needs === 'renderer' && !host.renderer) {
    throw codeError('DEV_NO_RENDERER', { member: member.id, runtime: host.runtime });
  }
  const fields = Object.entries(member.args);
  const problems: Problem[] = [];
  if (args.length > fields.length) {
    problems.push({ path: '', message: `it takes ${fields.length} argument(s), not ${args.length}` });
  }
  const given = fields.map(([name, field], i) => {
    if (args[i] === undefined) {
      if (field.required) problems.push({ path: name, message: `${name} is required (${field.description})` });
      return copyValue(field.default);
    }
    checkValue(field, args[i], name, problems);
    return args[i];
  });
  if (problems.length) badArgs(member.id, listProblems(problems), signatureOf(member));
  return (member.impl as (h: InspectorHost, ...rest: unknown[]) => unknown)(host, ...given);
}

/** Assembles `__engine` on `host` from the members registered on `host.members` (see the file comment). */
export function createInspector(host: InspectorHost): Inspector {
  memberKind(host.members);
  const root: Record<string, unknown> = {};
  for (const member of host.members.list('inspectorMember') as Member[]) {
    const path = member.id.split('.');
    const leaf = path.pop() as string;
    let target = root;
    for (const part of path) target = (target[part] ??= {}) as Record<string, unknown>;
    if (member.value) Object.defineProperty(target, leaf, { enumerable: true, get: () => call(host, member, []) });
    else target[leaf] = (...args: unknown[]) => call(host, member, args);
  }
  return root as Inspector;
}

/** Component names from a query: none, one name, or a list of names every entity must hold. */
function namesOf(query: unknown, member: string): string[] {
  if (query === undefined) return [];
  if (typeof query === 'string') return [query];
  if (Array.isArray(query) && query.every((name) => typeof name === 'string')) return query;
  return badArgs(
    member,
    `query is ${show(query)}; it must be a component name or a list of names`,
    `${member}(query?)`,
  );
}

const QUERY = {
  type: 'any',
  description: 'A component name, or a list of names an entity must all hold; every entity when absent.',
} as const;

/** The core members (PLAN.md §8.3, WP 1.6), registered on the shared registry when this module loads. */
const CORE_MEMBERS: Record<string, MemberSpec> = {
  info: {
    help: "The engine's identity and health (version, runtime, adapter, features, downgrades, deps) and the run: scene, seed, tick, hz.",
    impl: (h): EngineInfo => ({
      version: pkg.version,
      runtime: h.runtime,
      headless: !h.renderer,
      adapter: h.adapter,
      features: [...h.features],
      downgrades: [...h.downgrades],
      deps: { ...pkg.dependencies },
      scene: h.session.scene.id,
      seed: h.session.world.seed,
      tick: h.session.world.tick,
      hz: h.session.world.hz,
    }),
  },
  pause: {
    help: 'Pauses sim time (the time.paused setting); step(n) still runs single steps.',
    impl: (h) => h.clock.pause(),
  },
  resume: { help: 'Resumes sim time.', impl: (h) => h.clock.resume() },
  step: {
    help: 'Runs n sim steps through the clock, recorded in the session; returns the tick after them.',
    args: {
      n: { type: 'integer', default: 1, minimum: 0, description: 'How many steps.' },
      intents: {
        type: 'any',
        description:
          'One intents object for every step (its pressed buttons, p, on the first only), or a list of one per step (none past its end).',
      },
    },
    impl: (h, n: number, intents: unknown) => {
      h.step(n, intents ?? {});
      return h.session.world.tick;
    },
  },
  timeScale: {
    help: 'Sets sim seconds per real second (the time.scale setting) when k is given; returns it.',
    args: { k: { type: 'number', minimum: 0, description: 'The new time scale: 0.5 is half speed.' } },
    impl: (h, k: number | undefined) => {
      if (k !== undefined) h.clock.timeScale = k;
      return h.clock.timeScale;
    },
  },
  seed: {
    help: "Starts the scene again with seed n (keeping the settings changed since it started) when n is given; returns the run's seed.",
    args: { n: { type: 'integer', description: 'The new seed.' } },
    impl: (h, n: number | undefined) => {
      if (n !== undefined) h.restart(n);
      return h.session.world.seed;
    },
  },
  state: {
    help: 'The sim as plain data, what the hash covers, with the entities the query matches.',
    args: { query: QUERY },
    impl: (h, query: unknown) => {
      const names = namesOf(query, 'state');
      const state = h.session.world.state();
      return { ...state, entities: state.entities.filter((e) => names.every((name) => Object.hasOwn(e, name))) };
    },
  },
  hash: { help: 'The state digest: 16 hex digits.', impl: (h) => h.session.world.hash() },
  trace: {
    help: 'Per-part and per-entity digests, to find where two runs part.',
    impl: (h) => h.session.world.trace(),
  },
  entities: {
    help: 'The live entities the query matches, in id order: each id and the components it holds.',
    args: { query: QUERY },
    impl: (h, query: unknown): EntitySummary[] =>
      h.session.world.query(...namesOf(query, 'entities')).map((e) => ({
        id: e.id,
        components: Object.keys(e).filter((key) => key !== 'id'),
      })),
  },
  get: {
    help: 'One live entity as plain data, components included; null when it does not live.',
    args: { id: { type: 'integer', required: true, description: 'The entity id.' } },
    impl: (h, id: number) => {
      const entity = h.session.world.get(id);
      return entity ? copyValue({ ...entity }) : null;
    },
  },
  set: {
    help: 'Sets a setting, validated against its schema (text is typed as x set types it); returns the change.',
    args: {
      path: { type: 'string', required: true, description: 'The setting path, such as time.scale.' },
      value: { type: 'any', required: true, description: 'The new value, or its text: 2, true, a JSON array.' },
    },
    impl: (h, path: string, value: unknown) => {
      const asText = typeof value === 'string' && h.registry.has('setting', path);
      const typed =
        asText && h.registry.get('setting', path).type !== 'string'
          ? createSettings({ registry: h.registry }).setText(path, value as string).value
          : value;
      return h.session.set(path, typed);
    },
  },
  capture: { help: 'The whole sim, copied, to restore later.', impl: (h) => h.session.world.capture() },
  restore: {
    help: 'Puts back a capture: the next steps continue exactly like the run it came from.',
    args: { capture: { type: 'object', required: true, description: 'What capture() returned.' } },
    impl: (h, capture: WorldCapture) => h.session.world.restore(capture),
  },
  describe: {
    help: 'The registries, as x describe lists them: every kind, one kind with its fields and ids, or one entry.',
    args: {
      kind: { type: 'string', description: 'A kind, such as setting.' },
      id: { type: 'string', description: 'An id of that kind.' },
    },
    impl: (h, kind: string | undefined, id: string | undefined) => {
      if (kind === undefined) return h.registry.describe();
      return id === undefined ? h.registry.describe(kind) : h.registry.describe(kind, id);
    },
  },
  help: {
    help: 'Every member, one line each; with a name, that member and its arguments.',
    args: { member: { type: 'string', description: 'A member name, such as step.' } },
    impl: (h, member: string | undefined) => helpText(h.members, member),
  },
  errors: {
    help: 'The structured error records, latest last.',
    value: true,
    impl: (h) => copyValue([...h.log.errors]),
  },
  advice: {
    help: 'The advice records (warn-once, each with its code), latest last.',
    value: true,
    impl: (h) => copyValue([...h.log.advice]),
  },
};
for (const [name, spec] of Object.entries(CORE_MEMBERS)) defineMember(name, spec);
