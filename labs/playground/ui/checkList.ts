/**
 * @file The owner's checks, listed (docs/PLAYGROUND.md §9.3, PLAN.md WP 13.28): each check's id, kind, title, what to
 * try and judge in plain words, where it comes from, where it is judged and, for a decision, its choices.
 * labs/playground/ui/checks.ts says what the kinds mean, how a check is opened and how its answer is kept.
 *
 * Invariants: data only. A decide check stands for each escalation awaiting the owner's review (its choices in plain
 * words, the call already taken first), a try check for each item of §9.3's playtest and each thing docs/PROGRESS.md
 * names as not verifiable here; labs/playground/ui/checks.test.ts holds the list to both. A spot to stand (`place`)
 * comes from the gym's courses and the block's data, never as numbers written twice.
 *
 * Game code, a page's: it imports only the playground's own files.
 *
 * @example
 * OWNER_CHECKS.find((check) => check.id === 'mantle')?.go?.query; // { scene: 'gym' }
 * OWNER_CHECKS.filter((check) => check.kind === 'decide').map((check) => check.from); // ['ESC-0002', …, 'ESC-0006']
 * @see labs/playground/ui/checks.test.ts
 */
import { MANTLE_RUNS } from '../courses/mantle';
import { SLIDE_RAMPS } from '../courses/slideRamps';
import { STRIP_START } from '../courses/strip';
import { GLIDE_START } from '../courses/superglide';
import { ZIPLINE_STARTS } from '../courses/zipline';
import { GYM_ZIPLINE } from '../levels/gym';
import { SITE_STRUCTURES } from '../levels/site';

/** Where a check is judged (see the file comment). */
export interface CheckGo {
  /** Another page of the repository, by its path (`labs/index/`): opened in a new tab. */
  readonly page?: string;
  /** The page's query. */
  readonly query?: Readonly<Record<string, string>>;
  /** Where the player stands and faces, by the scene's dev action `place`. */
  readonly place?: { readonly at: readonly [number, number, number]; readonly yaw: number };
}

/** One choice of a decide check: its id, its words, and the escalation record's option it takes (from 1). */
export interface CheckOption {
  readonly id: string;
  readonly label: string;
  readonly option: number;
}

/** One check (see the file comment). */
export interface OwnerCheck {
  readonly id: string;
  readonly kind: 'decide' | 'try';
  readonly title: string;
  /** What to try and what to judge, in plain words; `{action}` names that action's key. */
  readonly what: string;
  /** Where it comes from: the escalation's id, or the doc's item. */
  readonly from: string;
  readonly go?: CheckGo;
  /** A decide check's choices, the call already taken first. */
  readonly options?: readonly CheckOption[];
}

/** The playtest's item `n` (docs/PLAYGROUND.md §9.3). */
const item = (n: number) => `docs/PLAYGROUND.md §9.3, item ${n}`;

/** The gym's spot `at` on the block (the gym stands at `SITE_STRUCTURES.gym.at` there). */
const onBlock = (at: readonly number[]) => {
  const [x, y, z] = SITE_STRUCTURES.gym.at;
  return [at[0] + x, at[1] + y, at[2] + z] as const;
};

/** The 20° ramp's deck, the mantle walls' run-up and the zipline's way down, from the gym's courses. */
const [, slideX, slideDeck] = SLIDE_RAMPS[2];
const [, mantleX] = MANTLE_RUNS[0];
const DOWN_THE_LINE = Math.atan2(GYM_ZIPLINE.to[0] - GYM_ZIPLINE.from[0], GYM_ZIPLINE.to[2] - GYM_ZIPLINE.from[2]);

/** The checks, the decisions first (see the file comment). */
export const OWNER_CHECKS: readonly OwnerCheck[] = [
  {
    id: 'esc-0002',
    kind: 'decide',
    title: 'The shooter camera with your back to a wall',
    what: 'Indoors, with Apex’s back to a wall, there is no room behind him for the over-the-shoulder camera. For now it squeezes in close, and in a handful of frames it cannot keep his chest in view. Walk the house and back into walls, then pick what that moment should do.', // prettier-ignore
    from: 'ESC-0002',
    go: { query: { scene: 'site-house', cam3: 'shoulder' } },
    options: [
      { id: 'keep', label: 'Keep it: the camera squeezes in; ignore the few frames that miss him', option: 1 },
      { id: 'eyes', label: 'Switch to a first-person view for that moment, his arms shown', option: 2 },
      { id: 'through', label: 'Let the camera stand past the wall, the wall faded', option: 3 },
      { id: 'open', label: 'Not sure yet: leave it open', option: 4 },
    ],
  },
  {
    id: 'esc-0003',
    kind: 'decide',
    title: 'The Quaternius animation files',
    what: 'Some of Apex’s animations come from the free Quaternius Universal Animation Library. Upgrading them needs four files you supply once (UAL1_Standard.glb, UAL1_Standard_RM.glb, UAL2_Standard.glb and UAL2_Standard_RM.glb, from quaternius.com). Without them those animations stay at their older version; everything else works.', // prettier-ignore
    from: 'ESC-0003',
    options: [
      { id: 'without', label: 'Leave them: keep the older versions', option: 2 },
      { id: 'supply', label: 'I will supply the files (in the chat, or a link)', option: 1 },
    ],
  },
  {
    id: 'esc-0004',
    kind: 'decide',
    title: 'Live runs of the AI-usability tests',
    what: 'Fourteen practice tasks measure how easily a fresh AI agent uses the engine from its docs alone. Running them for real spends your Claude usage: 14 attempts of 30 to 45 minutes each. Until you say so, only the free dry run, which checks the tasks themselves, is used.', // prettier-ignore
    from: 'ESC-0004',
    options: [
      { id: 'not-now', label: 'Not now: keep the free dry run', option: 3 },
      { id: 'here', label: 'Run them with Claude Code in this environment at the next gate', option: 1 },
      { id: 'key', label: 'Run them with an API key I add to the environment’s secrets', option: 2 },
    ],
  },
  {
    id: 'esc-0005',
    kind: 'decide',
    title: 'The 5,000-person crowd’s speed',
    what: 'The plan asked the 5,000-person crowd to take half the processor time to draw. Culling it on the GPU halved its draw calls, but the processor time stayed the same: it goes on posing the bodies, not on drawing them. See the crowd (the Stress Box opens in a new tab), then pick what comes next.', // prettier-ignore
    from: 'ESC-0005',
    go: { page: 'labs/box/', query: { scene: 'crowd-5000' } },
    options: [
      { id: 'accept', label: 'Accept it: count the halved draw calls; faster posing becomes a task of its own', option: 1 }, // prettier-ignore
      { id: 'stage-2', label: 'Build the next GPU step now (about 1.5 times faster, short of 2)', option: 2 },
      { id: 'wait', label: 'Keep the task open until faster posing lands, then measure again', option: 3 },
    ],
  },
  {
    id: 'esc-0006',
    kind: 'decide',
    title: 'How thoroughly the tests catch bugs',
    what: 'Mutation testing plants small bugs in the engine’s simulation and animation code and counts how many the tests catch. The plan asked for 90%. Testing all of it takes 10 to 12 hours, so each run tests a fixed tenth: 94% are caught there, about 74% in the rest.', // prettier-ignore
    from: 'ESC-0006',
    options: [
      { id: 'sample', label: 'Fine: read the 90% on the tested tenth, and test a new tenth each stage', option: 1 },
      { id: 'all', label: 'Keep at it until all of it reaches 90% (many hours of work)', option: 2 },
      { id: 'rule', label: 'Make the tenth the rule: 90% there, a fresh draw reported each stage', option: 3 },
    ],
  },
  {
    id: 'sprint',
    kind: 'try',
    title: 'Sprint the strip, in first person',
    what: 'Hold {sprint} and run down the strip of distance markers ({forward} moves). Judge the top speed, how the view widens as you sprint, and how quickly you stop when you let go.', // prettier-ignore
    from: item(1),
    go: { query: { scene: 'gym', cam3: 'first' }, place: { at: STRIP_START, yaw: 0 } },
  },
  {
    id: 'slide',
    kind: 'try',
    title: 'Slide down the 20° ramp',
    what: 'You start on top of the 20° ramp. Sprint ({sprint}) off its edge, hold {crouch} to slide down, and press {jump} near the bottom to slide-jump. Is the speed kept? Does it feel good?', // prettier-ignore
    from: item(2),
    go: { query: { scene: 'gym' }, place: { at: [slideX, slideDeck, 30.5], yaw: 0 } },
  },
  {
    id: 'mantle',
    kind: 'try',
    title: 'Mantle, vault and climb',
    what: 'Ahead stand walls from 0.5 m to 2.1 m: run at each and press {jump} to climb over the top. Beyond them, fences from 0.6 m to 1.2 m to vault, then climb walls from 3 m to 7.2 m. Which heights feel wrong?', // prettier-ignore
    from: item(3),
    go: { query: { scene: 'gym' }, place: { at: [mantleX, 0, 8.5], yaw: 0 } },
  },
  {
    id: 'superglide',
    kind: 'try',
    title: 'Superglide off the 1.5 m wall',
    what: 'Run at the 1.5 m wall ahead and press {jump} to climb it; as you reach the top, press {jump} and then {crouch} almost at once. Done right, you shoot forward at speed. Is the timing fair?', // prettier-ignore
    from: item(4),
    go: { query: { scene: 'gym' }, place: { at: GLIDE_START, yaw: 0 } },
  },
  {
    id: 'superglide-boost',
    kind: 'try',
    title: 'Superglide with the mantle boost',
    what: 'With the mantle boost on, one button does it: press {crouch} as you reach the top of the wall ahead, and you glide off at full speed. Easier than the two-button superglide, and does it feel right?', // prettier-ignore
    from: item(4),
    go: { query: { scene: 'gym', 'movement.mantle.boost': 'true' }, place: { at: GLIDE_START, yaw: 0 } },
  },
  {
    id: 'zipline',
    kind: 'try',
    title: 'Ride the zipline and jump off',
    what: 'You stand on the tower by the zipline. Press {interact} to grab the line, ride it down, and press {jump} halfway to jump off. Do the ride and the jump feel right?', // prettier-ignore
    from: item(5),
    go: { query: { scene: 'gym' }, place: { at: ZIPLINE_STARTS.top, yaw: DOWN_THE_LINE } },
  },
  {
    id: 'balloon',
    kind: 'try',
    title: 'Ride the balloon and skydive',
    what: 'The balloon’s line is in front of you. Press {interact} to ride up to the balloon, which throws you into a skydive: look down to dive, level to glide, {forward} to steer, and land on the house’s roof. Do the fall and the landing feel right?', // prettier-ignore
    from: item(5),
    go: { query: { scene: 'site-gym' }, place: { at: onBlock(ZIPLINE_STARTS.balloon), yaw: 0 } },
  },
  {
    id: 'house-things',
    kind: 'try',
    title: 'Doors, windows, chairs and lights',
    what: 'Kick in the front door ({melee} at the door), break a window, carry a chair and throw it ({interact}), and switch the kitchen light ({interact} at the switch). Does each work, look and sound right?', // prettier-ignore
    from: item(6),
    go: { query: { scene: 'site' } },
  },
  {
    id: 'range',
    kind: 'try',
    title: 'Aim down sights at the range',
    what: 'Draw a gun ({weapon1} or {weapon2}), hold {aim} to aim down the sights and shoot the targets; {shoulder} swaps shoulders. Does aiming feel right?', // prettier-ignore
    from: item(7),
    go: { query: { scene: 'site-range', cam3: 'shoulder' } },
  },
  {
    id: 'shooter-house',
    kind: 'try',
    title: 'Walk the house in the shooter camera',
    what: 'Walk every room, upstairs and down, and turn in tight spots. The camera should never clip into a wall or lose you.', // prettier-ignore
    from: item(7),
    go: { query: { scene: 'site-house', cam3: 'shoulder' } },
  },
  {
    id: 'platformer-yard',
    kind: 'try',
    title: 'Run and jump round the yard, platformer camera',
    what: 'Run and jump around the back yard. The camera turns itself back behind you as you move: does that help or fight you?', // prettier-ignore
    from: item(8),
    go: { query: { scene: 'site-backyard', cam3: 'follow' } },
  },
  {
    id: 'iso-storeys',
    kind: 'try',
    title: 'Every floor in isometric and top-down',
    what: 'Walk every floor of the house: the floors above you should cut away so you always see yourself; aim with the mouse pointer. Then press {camera} once for top-down and walk it again.', // prettier-ignore
    from: item(9),
    go: { query: { scene: 'site-house', cam: 'iso' } },
  },
  {
    id: 'looks-noon',
    kind: 'try',
    title: 'Both looks at noon',
    what: 'Walk around the block at noon. P switches between the cel look and the pixel look, {camera} the camera. Anything ugly, hard to read or broken?', // prettier-ignore
    from: item(10),
    go: { query: { scene: 'site', 'playground.hour': '12' } },
  },
  {
    id: 'looks-night',
    kind: 'try',
    title: 'Both looks at night',
    what: 'The same at 10 at night, in isometric; P switches the looks. Noted so far: the yellow accent reads weak from isometric, and the cel look’s night is very dark there.', // prettier-ignore
    from: item(10),
    go: { query: { scene: 'site', cam: 'iso', 'playground.hour': '22' } },
  },
  {
    id: 'cel-brick',
    kind: 'try',
    title: 'The gym’s brick in the cel look',
    what: 'In the cel look the shadows on the gym’s brick go nearly black instead of shifting colour. Fine as it is, or should they keep more colour?', // prettier-ignore
    from: item(10),
    go: { query: { scene: 'site-gym', 'post.look': 'look:playground-cel' } },
  },
  {
    id: 'rain',
    kind: 'try',
    title: 'A downpour on the street',
    what: 'Heavy rain on the street. Does it look right, and does the game stay smooth?',
    from: item(11),
    go: { query: { scene: 'site-street', 'playground.rain': '1' } },
  },
  {
    id: 'dust',
    kind: 'try',
    title: 'Dust in the house',
    what: 'Dust floating in the house’s light. Does it look right, and does the game stay smooth?',
    from: item(11),
    go: { query: { scene: 'site-house', 'playground.dust': '1' } },
  },
  {
    id: 'labs',
    kind: 'try',
    title: 'The labs index',
    what: 'The labs index opens in a new tab. In the Animation Lab, pick a move, scrub through it and show the bones; in the Library Lab, search for a clip and Apply it. Easy to use?', // prettier-ignore
    from: item(12),
    go: { page: 'labs/index/' },
  },
  {
    id: 'front-end',
    kind: 'try',
    title: 'The title screen, pause and settings',
    what: 'Try the title screen, pause (Esc), the spawn picker, settings (rebind a key; the field of view, the movement profile, the volumes) and photo mode. Then reload the page: are your settings and your key kept?', // prettier-ignore
    from: item(13),
    go: { query: { 'playground.title': 'on' } },
  },
  {
    id: 'tour',
    kind: 'try',
    title: 'Watch the tour',
    what: 'The tour plays every feature as a demo: the camera should change every 8 seconds and the look every 16. Then press any key: do you get the playground back?', // prettier-ignore
    from: item(14),
    go: { query: { replay: 'playground-tour', 'playground.attract': 'on' } },
  },
  {
    id: 'sound',
    kind: 'try',
    title: 'The sound',
    what: 'Listen as you play (sound starts with your first key or click): footsteps on each floor, doors, glass, the guns at the range, the neighbours and the dog. Is anything missing, too loud or wrong?', // prettier-ignore
    from: 'docs/PROGRESS.md: speakers are not verifiable here',
    go: { query: { scene: 'site-house' } },
  },
  {
    id: 'pixel-glide',
    kind: 'try',
    title: 'The pixel look’s glide in top-down',
    what: 'Walk around in top-down in the pixel look. The picture should glide smoothly as it follows you; a soft shadow edge may flicker a few pixels. Does anything crawl or shimmer?', // prettier-ignore
    from: 'docs/PROGRESS.md: the pixel look’s glide is not verifiable here (ADR-0025 amendment 35)',
    go: { query: { scene: 'site', cam: 'overhead', 'post.look': 'look:playground-pixel' } },
  },
  {
    id: 'gamepad',
    kind: 'try',
    title: 'A gamepad, if you have one',
    what: 'Plug in a gamepad and play: move, jump, sprint, the menus (Start pauses). Does everything work? Skip this one without a pad.', // prettier-ignore
    from: 'docs/PROGRESS.md: pads are not verifiable here',
    go: { query: { scene: 'gym' } },
  },
];
