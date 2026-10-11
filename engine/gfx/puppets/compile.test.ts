/**
 * @file Unit tests for compiling bodies (engine/gfx/puppets/compile.ts), in Node: the humanoid's pieces, each part
 * placed at rest where its points resolve (a limb from joint to joint, an eye on its socket), every frame right-handed,
 * mirrored parts the reflection of their left side, sizes in head, limb and torso radii and a build's own drawing
 * fields, a build's size scaling every length, the fixture body's every part type (a curve as 4 limbs, hair as cones,
 * a part riding the root, `on`), `GFX_BAD_BODY` for what a definition cannot see, and `recolor`; and the review of
 * the builds' four chosen fields against the drawn humanoid (ADR-0009 amendment 1: kept). That `reach` bounds every
 * posed vertex is tested with the drawing (draw.test.ts).
 * @see engine/gfx/puppets/compile.ts
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { defineEveryPart } from '../../../fixtures/bodies/everyPart';
import { defineBuild } from '../../anim/builds';
import { createSkeleton, jointIndex, PROPORTIONS, SOCKETS, type JointName, type SocketName } from '../../anim/skeleton';
import { toLinear } from '../../core/color';
import { createRegistry } from '../../core/registry';
import { compileBody, recolor, restPositions, type BodyPiece, type CompiledBody } from './compile';
import { defineBody, getBody } from './grammar';

const humanoid = compileBody('body:humanoid', 'build:chibi');

/** A joint's rest position on `compiled`'s skeleton. */
const restOf = (compiled: CompiledBody, joint: JointName) =>
  new Vector3().fromArray(compiled.rest, jointIndex(joint) * 3);

/** A socket's rest position: its joint's, plus its offset (rest frames are the character's). */
function socketRest(compiled: CompiledBody, socket: SocketName): Vector3 {
  const s = SOCKETS.indexOf(socket);
  const { skeleton } = compiled;
  return new Vector3()
    .fromArray(compiled.rest, skeleton.socketJoints[s] * 3)
    .add(new Vector3().fromArray(skeleton.socketOffsets, s * 3));
}

/** A piece's matrix in the character's rest frame: its bone's rest position, then its own matrix. */
function restMatrix(compiled: CompiledBody, piece: BodyPiece): Matrix4 {
  const at = piece.bone < 0 ? new Vector3() : new Vector3().fromArray(compiled.rest, piece.bone * 3);
  return new Matrix4().fromArray(piece.matrix).premultiply(new Matrix4().makeTranslation(at.x, at.y, at.z));
}

/** The pieces that came from `part` (`mirror[0]`, `mirror[0] (right)`, `parts[3]`). */
const from = (compiled: CompiledBody, part: string) => compiled.pieces.filter((piece) => piece.part === part);

/** The origin and y axis of a piece in the rest frame. */
function axes(compiled: CompiledBody, piece: BodyPiece) {
  const m = restMatrix(compiled, piece);
  const origin = new Vector3().setFromMatrixPosition(m);
  const y = new Vector3().setFromMatrixColumn(m, 1);
  return { origin, y };
}

describe('the humanoid', () => {
  it('compiles to 26 pieces: 10 parts and 8 on each side, the eyes glowing', () => {
    expect(humanoid.pieces).toHaveLength(26);
    expect(humanoid.pieces.filter((piece) => piece.glow).map((piece) => piece.part)).toEqual([
      'mirror[7]',
      'mirror[7] (right)',
    ]);
    expect(new Set(humanoid.pieces.map((piece) => piece.shape))).toEqual(new Set(['limb', 'ball', 'eye']));
  });

  it('is pure: the same body and build give the same pieces', () => {
    const again = compileBody('body:humanoid', 'build:chibi');
    expect(again.pieces.map((piece) => [...piece.matrix])).toEqual(humanoid.pieces.map((piece) => [...piece.matrix]));
    expect(again.reach).toBe(humanoid.reach);
  });

  it('places a limb from joint to joint, riding the first joint', () => {
    const [thigh] = from(humanoid, 'mirror[0]');
    expect(thigh.bone).toBe(jointIndex('thighL'));
    const { origin, y } = axes(humanoid, thigh);
    expect(origin.distanceTo(restOf(humanoid, 'thighL'))).toBeLessThan(1e-12);
    const down = restOf(humanoid, 'shinL').sub(restOf(humanoid, 'thighL'));
    expect(thigh.length).toBeCloseTo(down.length(), 12);
    expect(y.distanceTo(down.normalize())).toBeLessThan(1e-12);
  });

  it('places the eyes on their sockets and the hands on the grips, riding their joints', () => {
    for (const [part, socket, joint] of [
      ['mirror[7]', 'eyeL', 'head'],
      ['mirror[7] (right)', 'eyeR', 'head'],
      ['mirror[6]', 'weaponL', 'handL'],
      ['mirror[6] (right)', 'weaponR', 'handR'],
    ] as const) {
      const [piece] = from(humanoid, part);
      expect(piece.bone, part).toBe(jointIndex(joint));
      expect(axes(humanoid, piece).origin.distanceTo(socketRest(humanoid, socket)), part).toBeLessThan(1e-12);
    }
  });

  it('gives every piece a right-handed frame, so no instance is mirrored by its matrix', () => {
    for (const piece of [...humanoid.pieces, ...compileBody(defineEveryPart(createRegistry())).pieces]) {
      expect(new Matrix4().fromArray(piece.matrix).determinant(), piece.part).toBeGreaterThan(0);
    }
  });

  it('draws the right side as the reflection of the left', () => {
    const reflect = new Matrix4().makeScale(-1, 1, 1);
    for (const left of humanoid.pieces.filter((piece) => /^mirror\[\d+\]$/.test(piece.part))) {
      const [right] = from(humanoid, `${left.part} (right)`);
      expect([right.shape, right.slot, right.length, right.radiusStart, right.radiusEnd]).toEqual([
        left.shape,
        left.slot,
        left.length,
        left.radiusStart,
        left.radiusEnd,
      ]);
      const l = axes(humanoid, left);
      const r = axes(humanoid, right);
      expect(r.origin.distanceTo(l.origin.clone().applyMatrix4(reflect)), left.part).toBeLessThan(1e-12);
      expect(r.y.distanceTo(l.y.clone().applyMatrix4(reflect)), left.part).toBeLessThan(1e-12);
    }
  });

  it('sizes parts in head, limb and torso radii, and in a build’s own drawing fields', () => {
    const skeleton = createSkeleton('build:chibi');
    const [face] = from(humanoid, 'parts[6]');
    expect(new Vector3().setFromMatrixColumn(new Matrix4().fromArray(face.matrix), 0).length()).toBeCloseTo(
      0.9 * skeleton.headRadius,
      12,
    );
    const [thigh] = from(humanoid, 'mirror[0]');
    expect(thigh.radiusStart).toBeCloseTo(1.45 * 0.0625, 12);
    const bulky = compileBody('body:humanoid', 'build:bulky');
    const [wide] = from(bulky, 'mirror[0]');
    expect(wide.radiusStart / bulky.skeleton.build.size).toBeCloseTo(1.45 * 0.08125, 12);
  });

  it('scales every length with the build’s size', () => {
    const giant = defineBuild('build:giant', { size: 2 }, createRegistry());
    const big = compileBody('body:humanoid', giant);
    humanoid.pieces.forEach((piece, i) => {
      const twice = big.pieces[i];
      expect([twice.length, twice.radiusStart, twice.radiusEnd]).toEqual([
        piece.length * 2,
        piece.radiusStart * 2,
        piece.radiusEnd * 2,
      ]);
      for (const k of [12, 13, 14]) expect(twice.matrix[k]).toBeCloseTo(piece.matrix[k] * 2, 12);
    });
    expect(big.reach).toBeCloseTo(humanoid.reach * 2, 12);
  });

  it('takes the slots’ colours in linear RGB, and recolors without recompiling', () => {
    expect(humanoid.colors.skin).toEqual(toLinear('#f1c7a0'));
    const red = recolor(humanoid, { cloth: '#ff0000' });
    expect(red.colors.cloth).toEqual([1, 0, 0]);
    expect(red.colors.skin).toEqual(humanoid.colors.skin);
    expect(red.pieces).toBe(humanoid.pieces);
  });

  it('rests each joint at its parent’s rest position plus its offset', () => {
    const rest = restPositions(humanoid.skeleton);
    expect(rest).toEqual(humanoid.rest);
    expect(new Vector3().fromArray(rest, jointIndex('pelvis') * 3).y).toBeCloseTo(humanoid.skeleton.offsets[1], 12);
  });
});

/**
 * ADR-0009 amendment 1 left WP 3.8 to review the four build fields WP 3.4 chose without source values once bodies
 * were drawn: `ankleHeight`, `footLength`, `handLength` and `chestDepth`. Reviewed against the drawn humanoid on every
 * engine build, all four are kept; these are the fits they were kept for. A limb is the hull of its two end spheres,
 * so its extremes are exact here.
 */
describe('the builds’ new fields on the drawn humanoid (reviewed in WP 3.8: kept)', () => {
  /** A limb piece's end spheres in the rest frame: at a with `radiusStart`, at b with `radiusEnd`. */
  const ends = (compiled: CompiledBody, piece: BodyPiece) => {
    const m = restMatrix(compiled, piece);
    return [
      { at: new Vector3(0, 0, 0).applyMatrix4(m), r: piece.radiusStart },
      { at: new Vector3(0, piece.length, 0).applyMatrix4(m), r: piece.radiusEnd },
    ];
  };
  /** The end spheres of the limb pieces from `parts` (every part when left out). */
  const spheres = (compiled: CompiledBody, parts?: readonly string[]) =>
    compiled.pieces
      .filter((piece) => piece.shape === 'limb' && (!parts || parts.includes(piece.part)))
      .flatMap((piece) => ends(compiled, piece));

  /**
   * How far each build's drawing may fall short, in metres: of the heel and the toe tip (the boot's ends), and of the
   * wrist (the fist's gap to the forearm's cap). `build:skeleton` is drawn thin (the HD floor of 0.55 units for a
   * limb), and its caps reach neither end of its foot at any `footLength` nor its wrist at its `handLength`.
   */
  const SHORT: [string, { heel: number; toe: number; wrist: number }][] = [
    ['build:chibi', { heel: 0, toe: 0.01, wrist: 0 }],
    ['build:heroic', { heel: 0, toe: 0.01, wrist: 0 }],
    ['build:bulky', { heel: 0, toe: 0.01, wrist: 0 }],
    ['build:skeleton', { heel: 0.01, toe: 0.03, wrist: 0.006 }],
  ];

  it.each(SHORT)('fits %s', (id, short) => {
    const compiled = compileBody('body:humanoid', id);
    const { build, tips } = compiled.skeleton;
    const s = build.size;
    const limbRadius = (compiled.body.builds[id]?.limbRadius ?? compiled.body.limbRadius) * s;
    const ankle = restOf(compiled, 'footL');
    const boot = spheres(compiled, ['mirror[2]', 'mirror[3]']);

    // ankleHeight: the boot's caps on the ankle clear the sole. Only the toe's cap dips below it (0.85 limb radii
    // around a toe joint 0.3 ankleHeight up: no ankle below the knee lifts it), by less than the source's boot, which
    // sank a whole limb radius below its foot point on the floor. The floor hides it.
    const atAnkle = boot.filter((sphere) => sphere.at.distanceTo(ankle) < 1e-9);
    expect(atAnkle).toHaveLength(2);
    for (const sphere of atAnkle) expect(sphere.at.y - sphere.r, 'an ankle cap').toBeGreaterThan(0);
    const lowest = spheres(compiled).reduce((low, sphere) =>
      sphere.at.y - sphere.r < low.at.y - low.r ? sphere : low,
    );
    expect(lowest.at.distanceTo(restOf(compiled, 'toeL')), 'the lowest point is under a toe').toBeLessThan(1e-9);
    expect(lowest.at.y - lowest.r, 'less deep than the source').toBeGreaterThan(-limbRadius);

    // footLength: the boot runs from the heel (0.25 footLength behind the ankle) to the toe tip.
    const heel = ankle.z - PROPORTIONS.heel * build.footLength * s;
    const toeTip = restOf(compiled, 'toeL').z + tips[jointIndex('toeL') * 3 + 2];
    const [back, front] = [Math.min(...boot.map((e) => e.at.z - e.r)), Math.max(...boot.map((e) => e.at.z + e.r))];
    expect(back - heel, 'the heel').toBeLessThanOrEqual(short.heel);
    expect(Math.abs(front - toeTip), 'the toe tip').toBeLessThan(short.toe);

    // handLength: the fist (a ball on the grip, 0.4 handLength out) stays within the hand's length and meets the
    // forearm's cap on the wrist.
    const [fist] = from(compiled, 'mirror[6]');
    const fistRadius = new Vector3().setFromMatrixColumn(new Matrix4().fromArray(fist.matrix), 0).length();
    const [grip, wrist] = [socketRest(compiled, 'weaponL').x, restOf(compiled, 'handL').x];
    const wristCap = spheres(compiled, ['mirror[5]']).find((sphere) => Math.abs(sphere.at.x - wrist) < 1e-9)!;
    expect(grip + fistRadius - wrist, 'the fist within the hand').toBeLessThan(build.handLength * s);
    expect(grip - fistRadius - (wrist + wristCap.r), 'the fist on the wrist').toBeLessThanOrEqual(short.wrist);

    // chestDepth: the back socket sits behind the spine, inside the drawn back by under 4 cm: closer to it than the
    // source's cape anchor (1.3 units behind the shoulders, 4.6 cm inside its own drawn back), so a cape hung there
    // hides its top edge in the torso, as the source's did, and a prop that must sit on the surface offsets from it.
    const socket = socketRest(compiled, 'back');
    const [upper] = from(compiled, 'parts[3]');
    const [a, b] = ends(compiled, upper);
    const t = (socket.y - a.at.y) / (b.at.y - a.at.y);
    expect(t >= 0 && t <= 1, 'the upper torso spans the socket').toBe(true);
    const surface = -(a.r + (b.r - a.r) * t);
    expect(socket.z, 'behind the spine').toBeLessThan(0);
    expect(socket.z - surface, 'inside the drawn back').toBeGreaterThan(0);
    expect(socket.z - surface, 'within 4 cm of it').toBeLessThan(0.04);
  });
});

describe('every part type', () => {
  const body = defineEveryPart(createRegistry());
  const every = compileBody(body);

  it('compiles every shape, a curve to 4 limbs and hair to a cone per strand', () => {
    expect(new Set(every.pieces.map((piece) => piece.shape))).toEqual(
      new Set(['limb', 'ball', 'eye', 'box', 'cone', 'blade', 'strip']),
    );
    expect(from(every, 'mirror[5]').map((piece) => piece.shape)).toEqual(['limb', 'limb', 'limb', 'limb']);
    expect(from(every, 'parts[8]').map((piece) => piece.shape)).toEqual(Array(12).fill('cone'));
  });

  it('joins a curve’s limbs end to end, from its first point to its last, bowed away from the body', () => {
    const claw = from(every, 'mirror[5]');
    const ends = claw.map((piece) => {
      const { origin, y } = axes(every, piece);
      return [origin, origin.clone().addScaledVector(y, piece.length)];
    });
    for (let k = 1; k < 4; k++) expect(ends[k][0].distanceTo(ends[k - 1][1])).toBeLessThan(1e-12);
    const hand = restOf(every, 'handL');
    expect(ends[0][0].distanceTo(hand)).toBeLessThan(1e-12);
    const tip = hand.clone().add(new Vector3(0.3, 0, 0.05));
    expect(ends[3][1].distanceTo(tip)).toBeLessThan(1e-12);
    // Halfway along, a quadratic Bézier lies half its bow off the chord's middle: 0.5 × 0.3 × the chord.
    const chord = tip.distanceTo(hand);
    expect(ends[1][1].distanceTo(hand.clone().lerp(tip, 0.5))).toBeCloseTo(0.5 * 0.3 * chord, 12);
  });

  it('roots hair over the back and top of the head, never over the face', () => {
    const centre = new Vector3(0, 0, 0).add(restOf(every, 'head')).add(new Vector3(0, every.skeleton.headRadius, 0));
    for (const strand of from(every, 'parts[8]')) {
      const root = axes(every, strand).origin.sub(centre);
      expect(root.length()).toBeCloseTo(0.95 * 0.9 * every.skeleton.headRadius, 12);
      expect(root.z / root.length()).toBeLessThanOrEqual(0.25 + 1e-12);
    }
  });

  it('rides the root for a part on no joint, and the joint `on` names', () => {
    const [disc] = from(every, 'parts[9]');
    expect(disc.bone).toBe(-1);
    expect(Array.from(disc.matrix.slice(12, 15), (v) => v + 0)).toEqual([0, 0.01, 0]);
    expect(from(every, 'parts[0]')[0].bone).toBe(jointIndex('spine1'));
    expect(from(every, 'parts[2]')[0].bone).toBe(jointIndex('chest'));
  });

  it('hangs the cape from the back socket, flaring down', () => {
    const [cape] = from(every, 'parts[7]');
    expect(cape.shape).toBe('strip');
    expect(cape.bone).toBe(jointIndex('chest'));
    const { origin, y } = axes(every, cape);
    expect(origin.distanceTo(socketRest(every, 'back'))).toBeLessThan(1e-12);
    expect(y.y).toBeLessThan(-0.5);
  });
});

describe('problems a definition cannot see', () => {
  const reg = createRegistry();
  const slots = { skin: '#ffffff' };

  it('names a part from a point to itself', () => {
    defineBody('body:same', { slots, parts: [['box', 'handL', 'handL', 0.02, 0.02, 'skin']] }, reg);
    expect(() => compileBody('body:same', 'build:chibi', { registry: reg })).toThrow(
      /GFX_BAD_BODY.*body:same for build:chibi: parts\[0\] runs from a point to itself/,
    );
  });

  it('names a limb no longer than its radii differ', () => {
    defineBody(
      'body:stub',
      { slots, parts: [['limb', 'handL', ['off', 'handL', 0, 0, 0.01], 0.2, 0.05, 'skin']] },
      reg,
    );
    expect(() => compileBody(getBody('body:stub', reg))).toThrow(
      /GFX_BAD_BODY.*parts\[0\] is 0\.0100 m long, no more than its radii differ.*make it longer or its radii closer/,
    );
  });
});
