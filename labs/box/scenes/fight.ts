/**
 * @file The fight, Box 5 (PLAN.md §9.0, WP 6.7): the hall with its hero and a crowd (labs/box/scenes/crowd-1000.ts),
 * fighting. `box:fight` is 36 walkers, slimes and wisps, mixed; `box:fight-1000` (fight-1000.ts) is its preset for
 * 1,000. `setupFight(w)` is the setup they share.
 *
 * - **The hero** (labs/box/scenes/fight-hero.ts, the scene's step): his combo (slash, backslash, spin), the thrust
 *   out of a dash, and his bolt, with a sword (`HERO_FIGHT`, labs/box/cast/hero.ts).
 * - **The foes** (fight-foes.ts): the crowd's walkers swing at him, its slimes pounce and its wisps shoot, each
 *   telegraphing its attack on the floor while it winds up, the walkers and slimes taking turns through his attack
 *   tokens (engine/world/ai.ts, three at once); their bolts fly swept (engine/world/projectiles.ts).
 * - **Blows** (fight-rules.ts) land through the engine's `damage`: hit points, the push as momentum, big hits
 *   throwing bodies up a little, killing ones throwing them high, the corpse group the crowd walks through (the
 *   crowd's step removes corpses), the hit-stop, and the event `damage`, from which the page draws damage numbers;
 *   the events `hit`, `slain`, `shot` and `slam` burst the page's effects. None of it reads the page: the page's
 *   effects and numbers are drawn from the sim, never into it, so its hash is the same with effects on or off.
 *
 * The setup is the crowd's (`setupCrowd`: the hall, the hero, the queue, the crowd's step), then the fight's systems:
 * `fight.steer` and `fight.rigs` in the place of the crowd's `crowd.steer` and `crowd.rigs`, and `fight.shots`. The
 * first step joins the fight (`joinFight`; what the setup spawns joins at its end): the hero's sword and his
 * `fightHero`, `fightHealth` and `fightTokens`; each member's `fightHealth` (its kind's hit points), `fightFoe` (a
 * first cool-down drawn from the stream `fight`: up to 1 s, a wisp's first shot later) and `fightTelegraph`. The hero
 * spawns with his reactions and cape (`reactions`, `secondary`: WP 6.2 in the box, WP 7.8), so the page's first
 * warm-up builds his cape, rather than a second one at the first step that holds the first frames back.
 *
 * Settings: the crowd's (`box.crowd.count`, 36 here; `box.crowd.mix`), the hall's for the hero (`box.hall.*`), and
 * `box.fight.god` (`FIGHT_SETTINGS`: what it does is fight-rules.ts's `hurtHero`) and `box.fight.precise` (off by
 * default, so box-5-fight's goldens hold: on, the hero is posed in the sim every step from his first, and his sword's
 * trail is sim data; tests/replays/box-5-precise.replay.json, after G9).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * Tests: labs/box/scenes/fight.test.ts, tests/replays/box-5-fight.replay.json (`node x replay
 * tests/replays/box-5-*.replay.json --browser page`), tests/e2e/box-fight.spec.ts, tests/e2e/parity.spec.ts.
 *
 * @example
 * // node x sim labs/box/scenes/fight --steps 600
 * // http://127.0.0.1:5173/labs/box/?scene=fight&cam3=chase (J attacks, L fires a bolt)
 */
import { defineScene, defineSettings, type Intents, type World } from '../../../engine/sim-api';
import { HERO_FIGHT } from '../cast/hero';
import { SLIME_ATTACK } from '../cast/slime';
import { WALKER_ATTACK } from '../cast/walker';
import { WISP_ATTACK } from '../cast/wisp';
import { setupCrowd, type CrowdComponents } from './crowd-1000';
import { fightRigs, flyShots, steerFoes } from './fight-foes';
import { heroFight } from './fight-hero';
import { type FightComponents, type FightEvents, type FightWorld } from './fight-rules';
import { boxSounds } from '../sounds/events';
import { HALL_LEVEL } from './hall';

/** The fight's settings: whether the hero's hit points hold, and whether his sword's trail is sim data. */
export const FIGHT_SETTINGS = defineSettings({
  'box.fight.god': {
    type: 'boolean',
    default: true,
    when: 'scene',
    description: 'Foes’ blows flinch and push the hero but take no hit points (off: they do, and he rallies at none).',
  },
  'box.fight.precise': {
    type: 'boolean',
    default: false,
    when: 'scene',
    description:
      'The hero is posed in the sim every step (anim.preciseHits), so his sword’s trail is sim data, hashed: box-5-precise proves it holds in Node and Chromium.',
  },
});

/** The fight's setup: the crowd's, and the fight's systems (see the file comment); returns the hero's id. */
export function setupFight(w: FightWorld): number {
  const gear = { reactions: {}, secondary: { ...HERO_FIGHT.secondary } }; // from his first step: the page warms his cape
  const hero = setupCrowd(w as unknown as World<CrowdComponents>, gear);
  w.systems.remove('crowd.steer');
  w.systems.remove('crowd.rigs');
  w.systems.add('fight.steer', steerFoes, { phase: 'ai' });
  w.systems.add('fight.rigs', fightRigs, { phase: 'anim' });
  w.systems.add('fight.shots', flyShots, { phase: 'rules' });
  return hero;
}

/**
 * The fight joined, once, at the first step (spawns made in the setup join at its end): the hero's sword and his
 * components, each member's (see the file comment).
 */
export function joinFight(w: FightWorld): void {
  const [hero] = w.query('actor', 'animator');
  if (!hero || hero.fightHero) return;
  hero.animator.weapon = HERO_FIGHT.weapon;
  hero.animator.preciseHits = w.settings.get<boolean>('box.fight.precise');
  w.add(hero.id, 'fightHero');
  w.add(hero.id, 'fightHealth', { hp: HERO_FIGHT.health });
  w.add(hero.id, 'fightTokens');
  const rng = w.rng('fight');
  for (const { id, crowdWalker, crowdSlime } of w.query('crowdMember')) {
    const kind = crowdWalker ? WALKER_ATTACK : crowdSlime ? SLIME_ATTACK : WISP_ATTACK;
    w.add(id, 'fightHealth', { hp: kind.health });
    const cool = kind === WISP_ATTACK ? WISP_ATTACK.first + rng.next() * WISP_ATTACK.spread : rng.next();
    w.add(id, 'fightFoe', { cool });
    w.add(id, 'fightTelegraph');
  }
}

/** The fight's step: joined at the first, then the hero's fight (labs/box/scenes/fight-hero.ts). */
export function fightStep(w: FightWorld, intents: Intents): void {
  joinFight(w);
  heroFight(w, intents);
}

/** The fight, 36 mixed. */
export const fight = defineScene<FightComponents, FightEvents>('box:fight', {
  description:
    'Box 5: the hall, its hero with a sword, and 36 walkers, slimes and wisps that swing, pounce and shoot at him, telegraphed, as he cuts them down.',
  level: 'level:hall',
  sounds: boxSounds(HALL_LEVEL),
  physics: true,
  settings: { 'box.crowd.count': 36 },
  setup(w) {
    setupFight(w);
  },
  step: fightStep,
});

export default fight;
