/**
 * @file Moves as data (PLAN.md WP 6.1, §6.6, Appendix C; I-10): the registry kind `move`, one entry per named strike,
 * in self-describing fields in metres, radians and seconds. Where the striking hand (or foot) sweeps: `arc`, `height`
 * (or `kickHeight`), `reach`, `plane`; with what: `hand`, `limb`; how the body moves with it: `body { lean, lunge,
 * hop, crouch, twist }` and `spin`; how long each phase lasts: `time { wind, active, recover, hold }`; when it can
 * connect: `hitAt`; whether a held weapon leaves a ribbon: `trail`; whether the lunge moves the character:
 * `rootMotion`. The engine's 24 moves are my-3d2dge's `E.MOVES`, written in these fields; `LEGACY_FIELDS` is Appendix
 * C's conversion table, old field by old field, and `fromLegacy` applies it (moves-data.test.ts converts all 24). The
 * engine adds the door kick (`ADDED_MOVES`: `move:breach`, WP 13.19).
 *
 * Invariants:
 * - Angles turn toward the right hand when positive (authoring.ts `turnRight`); on the `vertical` plane, upward.
 * - Heights are metres from the shoulder centre (the neck joint), never scaled; a kick's `kickHeight` is a share of
 *   the hip height. Reaches (and `windReach`) are metres from the shoulder centre at the reference arm
 *   (`REFERENCE_ARM`), scaled by the body's arm length when `reachScale` is `'arm'`.
 * - `hitAt` is the move's own: 0.35 of the active phase by default for every move, however the move was made (the
 *   old one depended on whether it was built from a name or a spec).
 * - Entries are frozen registry entries (engine/core/registry.ts); a game adds its own with `defineMove`. A missing id
 *   warns once and gives `move:slash`.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:2543-2572` (`E.MOVES`) and the defaults of `:1844-1849` (the rest
 * height, the reach, the hold, a kick's lean and lunge, the crouch).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * getMove('move:thrust').reach; // [0.1875, 0.625]: the blade extends from 3 to 10 old units
 * fromLegacy({ a0: 0.05, a1: 0, hand: 'L', blade: 0 }).trail; // false
 * defineMove('move:poke', { arc: [0, 0], reach: [0.2, 0.6] }, createRegistry()).hitAt; // 0.35
 * @see engine/anim/moves-data.test.ts
 */
import { codeError } from '../core/log';
import { ease } from '../core/math';
import { galleryField } from '../core/gallery';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { freezeValue, parse, type Schema, type SpecOf } from '../core/schema';

/** Source units per metre (Appendix C). */
const UNITS = 16;

/** The arm length, shoulder to wrist, that move reaches are written for: my-3d2dge's 9.2 units, metres. */
export const REFERENCE_ARM = 9.2 / UNITS;

/** A two-number field: a value at the start and at the end of the strike. */
const pair = (value: readonly [number, number], unit: string, description: string) =>
  ({ type: 'array', items: { type: 'number' }, default: value, unit, description }) as const;

/** The fields of a `move` entry. The defaults are a plain right-hand strike's (my-3d2dge's `Attack` defaults). */
export const MOVE_FIELDS = {
  time: {
    type: 'object',
    description: 'Seconds of each phase: the wind-up, the strike, the recovery; and the share of the recovery held.',
    default: { wind: 0.06, active: 0.1, recover: 0.18, hold: 0.3 },
    properties: {
      wind: { type: 'number', default: 0.06, minimum: 0, unit: 's', description: 'The wind-up (anticipation).' },
      active: { type: 'number', default: 0.1, minimum: 0, unit: 's', description: 'The strike.' },
      recover: { type: 'number', default: 0.18, minimum: 0, unit: 's', description: 'The follow-through.' },
      hold: { type: 'number', default: 0.3, minimum: 0, maximum: 1, description: 'Share of recover held still.' },
    },
  },
  hitAt: {
    type: 'number',
    default: 0.35,
    minimum: 0,
    maximum: 1,
    description: 'Share of the active phase before the strike can connect: the hit window opens there.',
  },
  arc: pair(
    [0, 0],
    'rad',
    'The swing angle at the start and end of the strike; + toward the right hand (up on vertical).',
  ),
  height: pair([-0.4375, -0.4375], 'm', 'Hand height from the shoulder centre at the start and end (ground plane).'),
  kickHeight: pair([0.1, 0.1], 'share', 'A kick: the foot height at the start and end, as shares of the hip height.'),
  reach: pair([0.46875, 0.46875], 'm', 'Distance from the shoulder centre at the start and end, at the reference arm.'),
  windReach: {
    type: 'number',
    minimum: 0,
    unit: 'm',
    description: 'Where the wind draws the hand from rest, at the reference arm; ¾ of reach[0] when absent.',
  },
  hand: { type: 'string', enum: ['R', 'L', 'both'], default: 'R', description: 'The striking hand (both: a grip).' },
  limb: { type: 'string', enum: ['hand', 'footR'], default: 'hand', description: 'What strikes: a hand or the foot.' },
  plane: {
    type: 'string',
    enum: ['ground', 'vertical'],
    default: 'ground',
    description: 'The swing plane: level around the body, or upright in front of it (a chop).',
  },
  spin: { type: 'number', default: 0, description: 'Whole turns of the body during the strike, toward the left.' },
  body: {
    type: 'object',
    description: 'How the body moves with the strike.',
    default: { lean: 0.3, lunge: 0.075, hop: 0, crouch: 0.15, twist: 1 },
    properties: {
      lean: { type: 'number', default: 0.3, minimum: -0.8, maximum: 0.8, unit: 'rad', description: 'Forward lean.' },
      lunge: {
        type: 'number',
        default: 0.075,
        minimum: -0.25,
        maximum: 0.3125,
        unit: 'm',
        description: 'Step forward of the pelvis and the lead foot.',
      },
      hop: { type: 'number', default: 0, minimum: 0, maximum: 0.75, unit: 'm', description: 'Lift at mid-strike.' },
      crouch: { type: 'number', default: 0.15, minimum: 0, maximum: 1, description: 'Crouch share in the wind-up.' },
      twist: { type: 'number', default: 1, description: 'Share of the usual shoulder turn that follows the arc.' },
    },
  },
  trail: { type: 'boolean', default: true, description: 'A held weapon strikes and leaves a ribbon (false: a fist).' },
  reachScale: {
    type: 'string',
    enum: ['arm', 'none'],
    default: 'arm',
    description:
      'Scale reaches (and windReach) by the body’s arm length over the reference arm, or not; heights are never scaled.',
  },
  rootMotion: {
    type: 'string',
    enum: ['visual', 'apply'],
    default: 'visual',
    description: 'The lunge as body motion only, or as root motion that moves the character forward.',
  },
  gallery: galleryField(),
} as const satisfies Schema;

/** A `move` entry: one named strike. */
export type Move = Entry<typeof MOVE_FIELDS>;

/** What `defineMove` takes: any field, `time` and `body` field by field; the others keep a plain strike's values. */
export type MoveSpec = Omit<SpecOf<typeof MOVE_FIELDS>, 'time' | 'body'> & {
  time?: Partial<Move['time']>;
  body?: Partial<Move['body']>;
};

/** The phases of a move, in order. */
export const MOVE_PHASES = ['wind', 'active', 'recover'] as const;

/** A phase of a move. */
export type MovePhase = (typeof MOVE_PHASES)[number];

/**
 * The engine's moves: my-3d2dge's `E.MOVES` through `fromLegacy` (moves-data.test.ts proves each), lengths in metres.
 * Kicks carry the old kick defaults (lean −0.22, lunge 0.025, crouch 0) where they set none.
 */
// prettier-ignore
export const ENGINE_MOVES: Readonly<Record<string, MoveSpec>> = {
  // blades, staves and clubs (the right hand)
  'move:slash': { arc: [1.7, -1.7], height: [-0.375, -0.5625], reach: [0.46875, 0.46875], time: { wind: 0.08, active: 0.1, recover: 0.22 } },
  'move:backslash': { arc: [-1.5, 1.6], height: [-0.5, -0.3125], reach: [0.46875, 0.46875], body: { lunge: 0.05 }, time: { wind: 0.07, active: 0.1, recover: 0.2 } },
  'move:overhead': { plane: 'vertical', arc: [2.4, -1.25], reach: [0.4375, 0.4375], body: { lunge: 0.125, crouch: 0.35, lean: 0.4 }, time: { wind: 0.16, active: 0.09, recover: 0.26 } },
  'move:rising': { plane: 'vertical', arc: [-1.35, 2.1], reach: [0.4375, 0.4375], body: { hop: 0.21875, lunge: 0.05, crouch: 0.4 }, time: { wind: 0.09, active: 0.11, recover: 0.24 } },
  'move:thrust': { arc: [0.12, 0], height: [-0.3125, -0.25], reach: [0.1875, 0.625], windReach: 0.3515625, body: { lunge: 0.1875, lean: 0.5 }, time: { wind: 0.11, active: 0.07, recover: 0.22 } },
  'move:spin': { arc: [1.3, 1.3], spin: 1, height: [-0.375, -0.375], reach: [0.5, 0.5], body: { lunge: 0, lean: 0.1 }, time: { wind: 0.09, active: 0.3, recover: 0.18 } },
  'move:plunge': { plane: 'vertical', arc: [-1.45, -1.5], reach: [0.3125, 0.5625], windReach: 0.3515625, body: { lunge: 0, lean: 0.1 }, time: { wind: 0.06, active: 0.25, recover: 0.15 } },
  'move:twohand': { hand: 'both', plane: 'vertical', arc: [2.5, -1.4], reach: [0.40625, 0.40625], body: { lunge: 0.15, crouch: 0.5, lean: 0.5 }, time: { wind: 0.2, active: 0.1, recover: 0.3 } },
  // fists (the jab leads with the left)
  'move:jab': { hand: 'L', arc: [0.05, 0], height: [-0.0625, -0.03125], reach: [0.1875, 0.5375], windReach: 0.3515625, body: { lunge: 0.05625, lean: 0.22 }, trail: false, time: { wind: 0.035, active: 0.06, recover: 0.13 } },
  'move:cross': { arc: [0.25, 0], height: [-0.0625, -0.03125], reach: [0.15625, 0.55], windReach: 0.3515625, body: { lunge: 0.1125, lean: 0.38, twist: 1.8 }, trail: false, time: { wind: 0.06, active: 0.07, recover: 0.17 } },
  'move:hook': { arc: [1.45, -0.4], height: [-0.03125, 0], reach: [0.425, 0.425], body: { lunge: 0.08125, lean: 0.3, twist: 1.5 }, trail: false, time: { wind: 0.08, active: 0.09, recover: 0.2 } },
  'move:uppercut': { plane: 'vertical', arc: [-1.15, 0.95], reach: [0.45, 0.45], body: { crouch: 0.6, hop: 0.15625, lunge: 0.075, lean: 0.2 }, trail: false, time: { wind: 0.11, active: 0.09, recover: 0.26 } },
  'move:haymaker': { arc: [2.1, -0.5], height: [0.0625, -0.0625], reach: [0.4875, 0.4875], body: { lunge: 0.1625, lean: 0.5, twist: 1.6 }, trail: false, time: { wind: 0.22, active: 0.1, recover: 0.3 } },
  'move:elbow': { arc: [0.9, -0.3], height: [-0.03125, 0], reach: [0.21875, 0.21875], body: { lunge: 0.0625, twist: 1.4 }, trail: false, time: { wind: 0.05, active: 0.07, recover: 0.16 } },
  // kicks (the right foot; heights are shares of the hip height)
  'move:kick': { limb: 'footR', arc: [0.1, 0], kickHeight: [0.35, 0.8], reach: [0.40625, 0.40625], body: { lean: -0.22, lunge: 0.025, crouch: 0 }, time: { wind: 0.07, active: 0.09, recover: 0.2 } },
  'move:roundhouse': { limb: 'footR', arc: [1.7, -0.45], kickHeight: [1, 1.55], reach: [0.4375, 0.4375], body: { lean: -0.3, lunge: 0.025, crouch: 0, twist: 1.3 }, time: { wind: 0.1, active: 0.13, recover: 0.24 } },
  'move:sweep': { limb: 'footR', arc: [1.9, -1.7], kickHeight: [0.08, 0.08], reach: [0.46875, 0.46875], body: { lean: 0.3, lunge: 0.025, crouch: 0.9 }, time: { wind: 0.08, active: 0.16, recover: 0.24 } },
  'move:flyingkick': { limb: 'footR', arc: [0.1, 0], kickHeight: [0.5, 0.75], reach: [0.46875, 0.46875], body: { lean: -0.35, lunge: 0.21875, hop: 0.4375, crouch: 0 }, time: { wind: 0.1, active: 0.22, recover: 0.24 } },
  'move:knee': { limb: 'footR', arc: [0, 0], kickHeight: [0.45, 0.85], reach: [0.125, 0.125], body: { lean: 0.2, lunge: 0.0625, crouch: 0 }, time: { wind: 0.06, active: 0.08, recover: 0.18 } },
  'move:axekick': { limb: 'footR', arc: [0.2, 0], kickHeight: [2, 0.5], reach: [0.3, 0.3], body: { lean: -0.2, lunge: 0.025, crouch: 0 }, time: { wind: 0.14, active: 0.08, recover: 0.24 } },
  // magic, throws and shoves
  'move:cast': { hand: 'both', plane: 'vertical', arc: [1.4, 0.1], reach: [0.5, 0.5], body: { lunge: 0.0375, lean: 0.15 }, trail: false, time: { wind: 0.22, active: 0.12, recover: 0.32 } },
  'move:throw': { plane: 'vertical', arc: [2.5, -0.25], reach: [0.46875, 0.46875], body: { lunge: 0.1125, lean: 0.45 }, trail: false, time: { wind: 0.16, active: 0.08, recover: 0.24 } },
  'move:bash': { hand: 'both', plane: 'vertical', arc: [1, -0.35], reach: [0.3125, 0.3125], body: { lunge: 0.1875, hop: 0.075, crouch: 0.45, lean: 0.55 }, trail: false, time: { wind: 0.12, active: 0.07, recover: 0.24 } },
  'move:claw': { arc: [1.2, -1], height: [0.0625, -0.25], reach: [0.4375, 0.4375], body: { lunge: 0.1125, lean: 0.4 }, trail: false, time: { wind: 0.12, active: 0.08, recover: 0.24 } },
};

/**
 * The moves the engine adds to the port's (registered with them): the door kick (WP 13.19), a front kick with the sole
 * at the lock's height, its hit 0.83 s in, where Mesh2Motion's `Kick_Breach` lands its strike (its 1.83 s with the
 * step back the body does not need).
 */
// prettier-ignore
export const ADDED_MOVES: Readonly<Record<string, MoveSpec>> = {
  'move:breach': { limb: 'footR', arc: [0.05, 0], kickHeight: [0.6, 0.85], reach: [0.4375, 0.5], body: { lean: -0.3, lunge: 0, crouch: 0 }, hitAt: 0.5, time: { wind: 0.75, active: 0.16, recover: 0.5 } },
};

/** A move as a body is told it: the move (an id, or a spec of its own) and where it is, a phase and a share of it. */
export interface MoveInput {
  /** The move: an id (`move:slash`, or just `slash`), a `Move`, or a spec. */
  readonly move: string | Move | MoveSpec;
  /** The phase playing. */
  readonly phase: MovePhase;
  /** Progress through the phase, 0 to 1. */
  readonly u: number;
}

/** The problems of a move beyond its fields: a pair that is not two numbers, a strike with no time. */
function moveProblems(move: Move): string[] {
  const problems: string[] = [];
  for (const key of ['arc', 'height', 'kickHeight', 'reach'] as const) {
    if (move[key].length !== 2) problems.push(`${key} has ${move[key].length} numbers; it takes [start, end]`);
  }
  const { wind, active, recover } = move.time;
  if (wind + active + recover <= 0) problems.push('time has no wind, active or recover: the move would never play');
  return problems;
}

/** Declares the kind `move` on `registry`, with the engine's moves, unless it has it. */
export function moveKind(registry: Registry): void {
  if (registry.kinds().includes('move')) return;
  registry.defineKind('move', {
    description:
      'A named strike: the swing (arc, height, reach, plane), what strikes, the body motion, the phase times and the hit window.',
    fields: MOVE_FIELDS,
    fallback: 'move:slash',
    defineWith: "defineMove('<id>', { arc: [a0, a1], reach: [r0, r1], time: { wind, active, recover } })",
    check: (entry) => moveProblems(entry as Move),
  });
  for (const [id, spec] of Object.entries({ ...ENGINE_MOVES, ...ADDED_MOVES })) registry.def('move', id, spec as Record<string, unknown>); // prettier-ignore
}
moveKind(sharedRegistry);

/**
 * Defines a move on `registry` (the shared one by default) and returns it; absent fields keep a plain strike's
 * values. Throws `CORE_BAD_SPEC` naming each problem, `CORE_DUPLICATE_ID` when defined twice.
 */
export function defineMove(id: string, spec: MoveSpec, registry: Registry = sharedRegistry): Move {
  moveKind(registry);
  return registry.def('move', id, spec as Record<string, unknown>) as Move;
}

/** The move `id` of `registry`; a missing id warns once (`CORE_UNKNOWN_ID`, naming the closest) and gives `move:slash`. */
export function getMove(id: string, registry: Registry = sharedRegistry): Move {
  moveKind(registry);
  return registry.get('move', id) as Move;
}

/** Moves already parsed from a spec (an object given to `resolveMove`), so a body reads each spec once. */
const parsed = new WeakMap<object, Move>();

/**
 * The move `move` names, with `over` laid on it (`time` and `body` field by field): an id (a bare name gets the
 * `move:` prefix), a `Move` entry, or a spec, parsed once and frozen. Throws `CORE_BAD_SPEC` for a bad spec; a
 * missing id warns once and gives `move:slash`.
 */
export function resolveMove(
  move: string | Move | MoveSpec,
  over?: MoveSpec,
  registry: Registry = sharedRegistry,
): Move {
  let base: Move;
  if (typeof move === 'string') base = getMove(move.includes(':') ? move : `move:${move}`, registry);
  else if ('kind' in move && 'id' in move && move.kind === 'move') base = move as Move;
  else base = parsed.get(move) ?? remember(move, specToMove(move, 'move:custom'));
  if (!over) return base;
  const { id, kind: _kind, ...fields } = base;
  const merged = { ...fields, ...over, time: { ...fields.time, ...over.time }, body: { ...fields.body, ...over.body } };
  return specToMove(merged as MoveSpec, id);
}

/** `spec` parsed against `MOVE_FIELDS` and checked, frozen, with `id`. */
function specToMove(spec: MoveSpec, id: string): Move {
  const where = `move ${JSON.stringify(id)}`;
  const move = { ...parse(MOVE_FIELDS, spec, where), id, kind: 'move' } as Move;
  const problems = moveProblems(move);
  if (problems.length) throw codeError('CORE_BAD_SPEC', { where, problems: problems.join('; ') });
  return freezeValue(move);
}

/** Keeps `move` as the parse of `spec`, and returns it. */
function remember(spec: object, move: Move): Move {
  parsed.set(spec, move);
  return move;
}

/**
 * How far the root has travelled forward at `phase` and `u`, metres before the build's size: the lunge's full step
 * over the strike, held after it. Only `rootMotion: 'apply'` moves travel (0 otherwise): their body shows no lunge.
 */
export function rootTravel(move: Move, phase: MovePhase | undefined, u: number): number {
  if (move.rootMotion !== 'apply' || phase === undefined || phase === 'wind') return 0;
  return phase === 'active' ? move.body.lunge * ease.outCubic(Math.min(1, Math.max(0, u))) : move.body.lunge;
}

/** A my-3d2dge `E.MOVES` spec, as its fields were written (units of 1/16 m, Appendix C). */
export interface LegacyMove {
  rel?: boolean;
  a0?: number;
  a1?: number;
  z0?: number;
  z1?: number;
  reach?: number;
  r0?: number;
  r1?: number;
  hand?: 'R' | 'L' | 'both';
  plane?: 'side' | 'ground';
  kick?: boolean;
  spin?: boolean;
  lunge?: number;
  hop?: number;
  crouch?: number;
  lean?: number;
  twist?: number;
  hold?: number;
  blade?: number;
  wind?: number;
  active?: number;
  recover?: number;
  hitAt?: number;
}

/** Appendix C's table: each old field of `E.MOVES` and the new field it becomes (`fromLegacy` applies it). */
export const LEGACY_FIELDS: Readonly<Record<keyof LegacyMove, string>> = {
  a0: 'arc[0], radians, unchanged (+ toward the right hand)',
  a1: 'arc[1], radians, unchanged; absent, it is a0',
  z0: 'height[0] = z0 / 16 metres from the shoulder centre (rest −7 units); kicks: kickHeight[0], unchanged (rest 0.1)',
  z1: 'height[1] = z1 / 16 (kickHeight[1] on kicks); absent, it is z0',
  reach: 'reach = [reach / 16, reach / 16] metres at the reference arm, reachScale "arm" (rel); absent, 7.5 units',
  r0: 'reach[0] = r0 / 16; the wind still starts at ¾ of the old reach: windReach = ¾ × (reach or 7.5) / 16',
  r1: 'reach[1] = r1 / 16',
  hand: 'hand, unchanged: "R" (the default), "L" or "both"',
  plane: 'plane: "side" becomes "vertical"; the default is "ground" (automatic side-view chops are dropped)',
  kick: 'limb: "footR", with the kick defaults lean −0.22, lunge 0.4 / 16 and crouch 0',
  spin: 'spin: 1 (whole turns)',
  lunge: 'body.lunge = lunge / 16 metres (default 1.2 units, 0.4 on kicks), within [−4, 5] units',
  hop: 'body.hop = hop / 16 metres, within [0, 12] units',
  crouch: 'body.crouch, a share, unchanged (default 0.15, 0 on kicks)',
  lean: 'body.lean, radians, unchanged (default 0.3, −0.22 on kicks), within ±0.8',
  twist: 'body.twist, a share of the usual shoulder turn, unchanged (default 1)',
  hold: 'time.hold, a share of recover, unchanged (default 0.3)',
  blade: 'blade: 0 becomes trail: false',
  wind: 'time.wind, seconds',
  active: 'time.active, seconds',
  recover: 'time.recover, seconds',
  hitAt: 'hitAt, a share of active (0.35 for every move, from a name or a spec)',
  rel: 'dropped: every move is relative to the shoulders; heights above the ground (rel false) have no counterpart',
};

/** `x` within [lo, hi]. */
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Rounds away the binary noise of a division by 16, so converted numbers read as written. */
const metres = (units: number) => Math.round((units / UNITS) * 1e9) / 1e9;

/** A legacy `E.MOVES` spec in the new fields (Appendix C, `LEGACY_FIELDS`); defaults are written out only when needed. */
export function fromLegacy(old: LegacyMove): MoveSpec {
  const kick = old.kick === true;
  const out: { -readonly [K in keyof MoveSpec]: MoveSpec[K] } = {};
  if (kick) out.limb = 'footR';
  if (old.hand && old.hand !== 'R') out.hand = old.hand;
  if (old.plane === 'side') out.plane = 'vertical';
  out.arc = [old.a0 ?? 0, old.a1 ?? old.a0 ?? 0];
  if (old.spin) out.spin = 1;
  if (old.plane !== 'side') {
    const rest = kick ? 0.1 : -7;
    const [z0, z1] = [old.z0 ?? rest, old.z1 ?? old.z0 ?? rest];
    if (kick) out.kickHeight = [z0, z1];
    else out.height = [metres(z0), metres(z1)];
  }
  const R = old.reach ?? 7.5;
  out.reach = [metres(old.r0 ?? R), metres(old.r1 ?? R)];
  if ((old.r0 ?? R) !== R) out.windReach = metres(0.75 * R);
  const body: Record<string, number> = {};
  if (kick) Object.assign(body, { lean: -0.22, lunge: metres(0.4), crouch: 0 });
  if (old.lean !== undefined) body.lean = clamp(old.lean, -0.8, 0.8);
  if (old.lunge !== undefined) body.lunge = metres(clamp(old.lunge, -4, 5));
  if (old.hop !== undefined) body.hop = metres(clamp(old.hop, 0, 12));
  if (old.crouch !== undefined) body.crouch = clamp(old.crouch, 0, 1);
  if (old.twist !== undefined) body.twist = old.twist;
  if (Object.keys(body).length) out.body = body;
  if (old.blade === 0) out.trail = false;
  if (old.hitAt !== undefined) out.hitAt = old.hitAt;
  const time: Record<string, number> = {
    wind: old.wind ?? 0.06,
    active: old.active ?? 0.1,
    recover: old.recover ?? 0.18,
  };
  if (old.hold !== undefined) time.hold = old.hold;
  out.time = time;
  return out;
}
