/**
 * @file The MCP bridge's tools (PLAN.md §8.11, WP 7.6): each calls an inspector member, and its input schema is that
 * member's argument schema projected onto JSON Schema (tools/mcp/schema.ts), its description the member's help line,
 * so `help()`, the inspector's argument checks and the tools come from one table (shardfall's tool table, PLAN.md
 * §5.8). The table is the members registered in this process: engine/app/headless.ts loads every module that
 * registers one, and a page lists the same (engine/app/viewMembers.ts).
 *
 * - `engine_open(page, params)`: opens a page or scene (the backend's, not a member's), URL parameters as its routes
 *   read them; `engine_step(n, intents)` → `step`; `engine_state(query)` → `state`; `engine_set(path, value)` → `set`.
 * - `engine_dump(depth, filter)` → `scene.dump`, after the tick, hash and entity count; `engine_input(script)` →
 *   `input.play`; `engine_actions(name, args)` → `actions.run`, or `actions.list` without a name.
 * - `engine_shot(ids, metrics, thumbnail, marks, image, width, height)` → `shot`: the frame as a PNG plus its ID pass,
 *   look metrics and thumbnail map as JSON (tools/mcp/results.ts); not offered headless, which has no renderer.
 * - `engine_replay(file, options)` → `replay` of a replay file's text, judged against its goldens for this platform.
 * - `engine_help(member)` → `help`, after the tools and the members they call; `docs_lookup(symbol)` → the generated
 *   docs and the comments they come from (tools/mcp/docs.ts); `engine_call(member, args)` → any member (`camera.set`,
 *   `bot`, `feel`, `stats`…), its arguments by name or in call order, the one tool §8.11 does not name.
 *
 * Where a member's only argument is an object whose keys its schema leaves undeclared (`shot` and `scene.dump` take
 * `options`), the tool names the keys itself (`own`) until the member declares them; `omit` drops what the tool fills
 * (replay's `text`, read from the file); `optional` relaxes a required argument the tool can do without. Inputs are
 * checked against the tool's fields before anything runs (engine/core/schema.ts `validate`: an unknown key names the
 * closest), then the member checks its own (`DEV_BAD_ARGS`).
 *
 * Invariants: a tool whose member is missing from the table is not listed; a member that needs a renderer is not
 * offered by a backend without one; every failure is a result with `isError`, never a thrown protocol error.
 *
 * @example
 * import { registry } from '../../engine/core/registry';
 * const step = toolList(registry, true).find((tool) => tool.name === 'engine_step');
 * step?.inputSchema.properties?.n; // { type: 'integer', description: 'How many steps.', default: 1, minimum: 0 }
 * @see tools/mcp/tools.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import '../../engine/app/headless'; // registers every inspector member, as a page's engine does
import type { PlayResult } from '../../engine/app/playback';
import type { Registry } from '../../engine/core/registry';
import { listProblems, validate, type Field, type Schema } from '../../engine/core/schema';
import { helpText, signatureOf, type Member } from '../../engine/dev/members';
import type { ShotJson } from '../../engine/gfx/shot';
import { PLATFORM } from '../cmd/replay';
import { closest } from '../x';
import type { Backend, Params, Progress } from './backend';
import { docsLookup } from './docs';
import { errorResult, judgeGoldens, shotResult, valueResult } from './results';
import { argsSchema } from './schema';

/** What a tool runs with: the repository root, the backend, where the members are registered, where progress goes. */
export interface ToolContext {
  root: string;
  backend: Backend;
  registry: Registry;
  progress: Progress;
}

/** One tool of the table (see the file comment). */
interface ToolSpec {
  name: string;
  /** The member whose argument schema the inputs project and whose help line describes the tool. */
  member?: string;
  /** What the tool adds to (or, without a member, is) its description. */
  about: string;
  own?: Schema;
  omit?: readonly string[];
  optional?: readonly string[];
  /** True when it changes nothing in the run (MCP's `readOnlyHint`). */
  reads?: boolean;
  run(c: ToolContext, input: Record<string, unknown>): Promise<CallToolResult>;
}

/** Calls a member on the context's backend. */
const call = (c: ToolContext, name: string, ...args: unknown[]) => c.backend.call(name, args, c.progress);
/** A JSON (or text) result for a tool. */
const answer = (c: ToolContext, tool: string, value: unknown) => valueResult(value, c.root, tool);
/** Drops the keys whose value is undefined. */
const defined = (object: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

/** A replay file under `root`: its path from there, its text, its scene and its goldens for this platform. */
export function replayFile(root: string, file: string, platform = PLATFORM) {
  const path = relative(root, resolve(root, file));
  if (path.startsWith('..') || !existsSync(join(root, path))) {
    throw new Error(`MCP_NO_FILE: ${file} is no file in the repository: name a replay such as tests/replays/box-1-room.replay.json`); // prettier-ignore
  }
  const text = readFileSync(join(root, path), 'utf8');
  const replay = JSON.parse(text) as { scene?: unknown; hashes?: Record<string, Record<string, string>> };
  if (typeof replay.scene !== 'string') throw new Error(`MCP_NO_FILE: ${path} names no scene: it is not a replay (my3dge-replay/1)`); // prettier-ignore
  return { file: path, text, scene: replay.scene, goldens: replay.hashes?.[platform] };
}

/** engine_shot's own inputs: the keys of ShotOptions the shot member's `options` leaves undeclared, and the image's. */
const SHOT_OWN = {
  ids: { type: 'boolean', description: 'Draw the ID pass and list what it sees (ShotOptions.ids; on unless false).' },
  metrics: { type: 'boolean', description: 'Measure the look and judge it (ShotOptions.metrics; on unless false).' },
  thumbnail: { type: 'boolean', description: "The 48 × 27 thumbnail's object map (ShotOptions.thumbnail; on unless false)." }, // prettier-ignore
  marks: { type: 'boolean', description: 'Number what the ID pass sees on the image, its legend in marks (ShotOptions.marks).' }, // prettier-ignore
  image: { type: 'boolean', default: true, description: 'Answer with the frame as a PNG image too.' },
  width: { type: 'integer', minimum: 1, description: "Shoot at this width (with height); the drawing buffer's when absent." }, // prettier-ignore
  height: { type: 'integer', minimum: 1, description: "Shoot at this height (with width); the drawing buffer's when absent." }, // prettier-ignore
} as const satisfies Schema;

/** The tools (see the file comment), in the order the server lists them. */
const TOOLS: readonly ToolSpec[] = [
  {
    name: 'engine_open',
    about: "Opens a page (headless, a scene) and waits until it is ready; answers what opened and its info(). The page's routes read params (engine/app/routes.ts).", // prettier-ignore
    own: {
      page: { type: 'string', required: true, description: 'labs/box, labs/playground (another lab, or an .html file), an optional ?query; headless also a scene id (box:room) or module.' }, // prettier-ignore
      params: { type: 'object', default: {}, description: "URL parameters: scene, seed, cam or cam3, and settings by path: { scene: 'room', 'box.room.speed': 3 }." }, // prettier-ignore
    },
    async run(c, { page, params }) {
      const opened = await c.backend.open(page as string, params as Params, c.progress);
      return valueResult(opened, c.root, 'engine_open', !opened.ready || opened.errors.length > 0);
    },
  },
  { name: 'engine_step', member: 'step', about: 'Answers { tick }.', run: async (c, { n, intents }) => answer(c, 'engine_step', { tick: await call(c, 'step', n, intents) }) }, // prettier-ignore
  { name: 'engine_state', member: 'state', about: 'Name components in query to keep it short.', reads: true, run: async (c, { query }) => answer(c, 'engine_state', await call(c, 'state', query)) }, // prettier-ignore
  {
    name: 'engine_dump',
    member: 'scene.dump',
    about: 'Headed by the tick, hash and entity count.',
    omit: ['options'],
    own: {
      depth: { type: 'integer', minimum: 0, description: 'The deepest level shown (the scene is 0).' },
      filter: { type: 'string', description: 'A text the names or types shown must contain.' },
    },
    reads: true,
    async run(c, { depth, filter }) {
      const tree = String(await call(c, 'scene.dump', defined({ depth, filter })));
      const { tick } = (await call(c, 'info')) as { tick: number };
      const count = ((await call(c, 'entities')) as unknown[]).length;
      return answer(
        c,
        'engine_dump',
        `tick ${tick}, hash ${String(await call(c, 'hash'))}, ${count} entities\n${tree}`,
      );
    },
  },
  {
    name: 'engine_shot',
    member: 'shot',
    about: 'Answers with the frame as a PNG and its numbers as JSON: look metrics and notes, the ID pass, the map.',
    omit: ['options'],
    own: SHOT_OWN,
    reads: true,
    async run(c, { image, width, height, ...rest }) {
      if ((width === undefined) !== (height === undefined)) {
        throw new Error('MCP_BAD_INPUT: engine_shot takes width and height together, or neither');
      }
      const size = width === undefined ? {} : { size: { width, height } };
      const options = { ...defined(rest), ...(image && rest.marks !== true ? { pixels: true } : {}), ...size };
      const shot = (await call(c, 'shot', options)) as ShotJson;
      return shotResult(image ? shot : { ...shot, pixels: undefined, marked: undefined }, c.root);
    },
  },
  { name: 'engine_input', member: 'input.play', about: 'Answers { steps, tick }.', run: async (c, { script }) => answer(c, 'engine_input', await call(c, 'input.play', script)) }, // prettier-ignore
  {
    name: 'engine_replay',
    member: 'replay',
    about: "Plays a replay file (in a page, the page showing its scene) and judges its hashes against the file's goldens for this platform.", // prettier-ignore
    omit: ['text'],
    own: { file: { type: 'string', required: true, description: 'The replay file, from the repository root: tests/replays/box-1-room.replay.json.' } }, // prettier-ignore
    async run(c, { file, options }) {
      const replay = replayFile(c.root, file as string);
      await c.backend.forReplay(replay.scene, c.progress);
      const played = (await call(c, 'replay', replay.text, options)) as PlayResult;
      return answer(c, 'engine_replay', { file: replay.file, goldens: judgeGoldens(replay.goldens, played.hashes), ...played }); // prettier-ignore
    },
  },
  { name: 'engine_set', member: 'set', about: 'Answers the change.', run: async (c, { path, value }) => answer(c, 'engine_set', await call(c, 'set', path, value)) }, // prettier-ignore
  {
    name: 'engine_actions',
    member: 'actions.run',
    about: "Without a name, lists the dev actions (actions.list): the scene's own, then god, freeze, spawn, travel, timeScale.", // prettier-ignore
    optional: ['name'],
    async run(c, { name, args }) {
      const value = name === undefined ? await call(c, 'actions.list') : await call(c, 'actions.run', name, args);
      return answer(c, 'engine_actions', value);
    },
  },
  {
    name: 'engine_help',
    member: 'help',
    about: 'Without a member, headed by these tools.',
    reads: true,
    async run(c, { member }) {
      const members = helpText(c.registry, member as string | undefined);
      if (member !== undefined) return answer(c, 'engine_help', members);
      const tools = toolList(c.registry, c.backend.renders).map((tool) => `${tool.name}: ${tool.description}`);
      return answer(c, 'engine_help', `${tools.join('\n')}\n\n__engine (engine_call reaches each):\n${members}`);
    },
  },
  {
    name: 'docs_lookup',
    about: "Looks a name up in the generated docs (docs/API.md, docs/ERRORS.md, docs/INDEX.md) and answers its comments: an export's, an error code's, a module's.", // prettier-ignore
    own: { symbol: { type: 'string', required: true, description: 'An export (createHeadless), an error code (DEV_BAD_ARGS) or a module path (engine/app/headless.ts).' } }, // prettier-ignore
    reads: true,
    run: async (c, { symbol }) => answer(c, 'docs_lookup', docsLookup(c.root, symbol as string)),
  },
  {
    name: 'engine_call',
    about: 'Calls any inspector member (engine_help lists them, with their arguments) and answers its value.',
    own: {
      member: { type: 'string', required: true, description: 'Its name: camera.set, bot, feel, stats, errors…' },
      args: { type: 'any', description: "Its arguments by name ({ code: 'cam=iso' }) or in call order (['cam=iso']); none for a value member." }, // prettier-ignore
    },
    async run(c, { member, args }) {
      const names = offeredMembers(c.registry, c.backend.renders).map((m) => m.id);
      const entry = names.includes(member as string) ? memberOf(c.registry, member as string) : undefined;
      if (!entry) {
        const near = closest(String(member), names);
        throw new Error(`MCP_NO_MEMBER: __engine has no member ${String(member)} here${near ? `: did you mean ${near}?` : ''} (engine_help lists them)`); // prettier-ignore
      }
      return answer(c, 'engine_call', await call(c, entry.id, ...positional(entry, args)));
    },
  },
];

/** The member `name` on `registry`. */
const memberOf = (registry: Registry, name: string) => registry.get('inspectorMember', name) as Member;

/** The members a backend offers: every one, less those that need a renderer when it has none. */
function offeredMembers(registry: Registry, renders: boolean): Member[] {
  return (registry.list('inspectorMember') as Member[]).filter((member) => renders || member.needs !== 'renderer');
}

/** `args` in `member`'s call order: a list as it is, an object by its argument names, one value as the first. */
export function positional(member: Member, args: unknown): unknown[] {
  if (args === undefined || args === null) return [];
  if (Array.isArray(args)) return args;
  if (typeof args !== 'object') return [args];
  const names = Object.keys(member.args);
  const unknown = Object.keys(args).filter((key) => !names.includes(key));
  if (unknown.length) {
    const takes = names.length ? `it takes ${names.join(', ')}` : 'it takes none';
    throw new Error(`MCP_BAD_INPUT: __engine.${member.id} has no argument ${unknown.join(', ')}: ${takes} (${signatureOf(member)})`); // prettier-ignore
  }
  const values = names.map((name) => (args as Record<string, unknown>)[name]);
  while (values.length && values.at(-1) === undefined) values.pop();
  return values;
}

/** A tool's fields in the schema language: its member's arguments (less `omit`, `optional` relaxed), then its own. */
function fieldsOf(spec: ToolSpec, members: ReadonlyMap<string, Member>): Schema | null {
  const member = spec.member === undefined ? undefined : members.get(spec.member);
  if (spec.member !== undefined && !member) return null;
  const fields: Record<string, Field> = {};
  for (const [key, field] of Object.entries(member?.args ?? {})) {
    if (spec.omit?.includes(key)) continue;
    const { required: _required, ...relaxed } = field;
    fields[key] = spec.optional?.includes(key) ? relaxed : field;
  }
  return { ...fields, ...spec.own };
}

/** The tools a backend offers, with their fields (see the file comment's invariants). */
function offered(registry: Registry, renders: boolean) {
  const members = new Map(offeredMembers(registry, renders).map((member) => [member.id, member]));
  return TOOLS.map((spec) => ({
    spec,
    fields: fieldsOf(spec, members),
    member: members.get(spec.member ?? ''),
  })).filter((tool): tool is { spec: ToolSpec; fields: Schema; member: Member | undefined } => tool.fields !== null);
}

/** The tools the server lists, generated from the members registered on `registry` (see the file comment). */
export function toolList(registry: Registry, renders: boolean): Tool[] {
  const names = offeredMembers(registry, renders).map((member) => member.id);
  return offered(registry, renders).map(({ spec, fields, member }) => {
    const description = member ? `${member.help} ${spec.about} (__engine.${signatureOf(member)})` : spec.about;
    const listed = spec.name === 'engine_call' ? { ...fields, member: { ...fields.member, enum: names } } : fields;
    const annotations = spec.reads ? { annotations: { readOnlyHint: true } } : {};
    return { name: spec.name, description, inputSchema: argsSchema(listed, spec.name), ...annotations };
  });
}

/** Runs tool `name` with `input` in `context`; every failure is an `isError` result. */
export async function runTool(name: string, input: unknown, context: ToolContext): Promise<CallToolResult> {
  const tool = offered(context.registry, context.backend.renders).find(({ spec }) => spec.name === name);
  if (!tool) return errorResult(new Error(`MCP_NO_TOOL: there is no tool ${name} here: the tool list names them`));
  const { value, problems } = validate(tool.fields, input ?? {});
  if (problems.length) return errorResult(new Error(`MCP_BAD_INPUT: ${name}: ${listProblems(problems)}`));
  try {
    return await tool.spec.run(context, value as Record<string, unknown>);
  } catch (error) {
    return errorResult(error);
  }
}
