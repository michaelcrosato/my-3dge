/**
 * @file `__engine.actions` and `__engine.bot` (PLAN.md §8.3, WP 5.6; doctrine: Agent-operable): the developer's tools
 * on the inspector, registered from this file as `inspectorMember` entries (engine/dev/members.ts), so a page
 * (`x eval "__engine.actions.run('travel', { at: [3, 0, 5] })"`) and `createHeadless` reach the same calls.
 *
 * - `actions.list()`: the dev actions this run has, the scene's own (engine/sim/scene.ts `actions`) and then the
 *   engine's (engine/sim/devActions.ts: god, freeze, spawn, travel, timeScale, and any `defineDevAction` added), each
 *   with what it changes: `sim` (recorded as a dev action) or `settings` alone (recorded as set, view ones never).
 * - `actions.run(name, args)`: runs one between steps through the session (`session.act`: the args checked, its
 *   settings set, then its change to the sim, all or nothing), so the replay holds it; the view snaps to the world.
 * - `bot(plan)`: plays the player with the bot (engine/dev/bot.ts) over the scene's level: the goals `to`, a `tour`,
 *   `back`, the stop condition `until` (`component.field`), `steps`, a `trace`, its options; through `step`, so each
 *   step is recorded (`input.record()` replays it). With `seeds` (`1-20`, `5`, `3,7,9`), a sweep from fresh sessions
 *   of the scene with this run's recorded settings instead, the run itself left alone: one row, a run per seed.
 *
 * Invariants: members change the sim only through the session's recorded operations (engine/dev/members.ts); this
 * module registers them when it loads (engine/app/headless.ts loads it, so every engine has them).
 *
 * @example
 * import { createHeadless } from '../app/headless';
 * import { defineScene } from '../sim/scene';
 * const engine = await createHeadless({ scene: defineScene('dev-actions-demo', { setup: () => {} }) });
 * const actions = engine.actions as { list(): { name: string }[] };
 * actions.list().map((action) => action.name); // ['freeze', 'god', 'spawn', 'timeScale', 'travel']: none of its own
 * @see engine/dev/actions.test.ts
 */
import { codeError } from '../core/log';
import type { Field, Schema } from '../core/schema';
import { changesSim, listDevActions } from '../sim/devActions';
import { getLevel } from '../world/level/level';
import { getSite } from '../world/site';
import { runBot, sweepBot, type BotPlan } from './bot';
import { defineMember } from './members';

/** One dev action as `actions.list()` shows it. */
export interface ActionRow {
  name: string;
  /** Whose it is: the scene's own, or the engine's. */
  from: 'scene' | 'engine';
  /** What it changes: `sim` (recorded as a dev action), or `settings` alone (recorded as set, but view ones). */
  changes: 'sim' | 'settings';
  /** Its help line and its arguments (`at, yaw?, id?`), the engine's only. */
  help?: string;
  args?: string;
}

/** An action's arguments as a list reads them: `at, yaw?, id?`, defaults shown. */
const argsLine = (args: Schema) =>
  Object.entries(args)
    .map(([key, field]: [string, Field]) =>
      field.required ? key : field.default === undefined ? `${key}?` : `${key} = ${JSON.stringify(field.default)}`,
    ) // prettier-ignore
    .join(', ');

defineMember('actions.list', {
  help: "Lists the run's dev actions: the scene's own, then the engine's (god, freeze, spawn, travel, timeScale).",
  impl(h): ActionRow[] {
    const own = Object.keys(h.session.scene.actions ?? {}).sort();
    const scene = own.map((name): ActionRow => ({ name, from: 'scene', changes: 'sim' }));
    const engine = listDevActions(h.registry)
      .filter((action) => !own.includes(action.id))
      .map((action): ActionRow => ({ name: action.id, from: 'engine', changes: changesSim(action) ? 'sim' : 'settings', help: action.help, args: argsLine(action.args) })); // prettier-ignore
    return [...scene, ...engine];
  },
});

defineMember('actions.run', {
  help: "Runs a dev action between steps, recorded in the replay: actions.run('travel', { at: [3, 0, 5] }).",
  args: {
    name: { type: 'string', required: true, description: 'Its name, as actions.list() shows it.' },
    args: { type: 'object', description: 'Its arguments, as actions.list() names them.' },
  },
  impl(h, name: string, args?: Record<string, unknown>) {
    h.session.act(name, args);
    return { name, tick: h.session.world.tick };
  },
});

defineMember('bot', {
  help: 'Plays the player with the bot: to goals, a tour, back; until, steps, trace; with seeds, a sweep of fresh runs.',
  args: {
    plan: {
      type: 'object',
      default: {},
      description:
        "What it plays (engine/dev/bot.ts BotPlan): to ([{ x, z }], and y on a site: a goal a storey up is not one under it), tour, back, until ('component.field'), steps, trace, actor, its options, and seeds for a sweep.",
    },
  },
  impl(h, plan: BotPlan & { seeds?: unknown }) {
    const { seeds, ...rest } = plan;
    const { scene } = h.session;
    if (!scene.level && !scene.site) throw codeError('SIM_BAD_ARGUMENT', { where: '__engine.bot()', value: scene.id, expected: 'a scene with a level or a site for the bot to read (defineScene({ level }))' }); // prettier-ignore
    const level = scene.site ? getSite(scene.site, h.registry) : getLevel(scene.level!, h.registry);
    if (seeds !== undefined) {
      const settings = h.session.settings.values({ view: false });
      return sweepBot(scene, seeds, rest, { registry: h.registry, settings, level });
    }
    return runBot({ world: h.session.world, step: (intents) => h.step(1, [intents]) }, level, rest);
  },
});
