/**
 * @file A CMU-like skeleton and takes written here as text for the CMU tools' tests (WP 8.5; no capture is
 * committed): `testAsf()`, the database's 30 bones with made-up proportions, and `testAmc(n)`, a take of `n` frames
 * at 120 a second in which the subject walks forward (its legs and arms swing, once a second) or, with `travel` 0,
 * steps in place.
 *
 * @example
 * testAsf().includes(':hierarchy'); // true
 * testAmc(3).split('\n').filter((line) => /^\d+$/.test(line)); // ['1', '2', '3']
 * @see tools/anim/asf-amc.test.ts
 */

/** `[name, direction (x left, y up, z forward), length (1/0.45 in), channels]`, parents before children. */
const BONES: [string, number[], number, string][] = [
  ...(['l', 'r'] as const).flatMap((s): [string, number[], number, string][] => {
    const x = s === 'l' ? 1 : -1;
    return [
      [`${s}hipjoint`, [0.6 * x, -0.75, 0.28], 2.4, ''],
      [`${s}femur`, [0.34 * x, -0.94, 0], 7.2, 'rx ry rz'],
      [`${s}tibia`, [0.34 * x, -0.94, 0], 7.4, 'rx'],
      [`${s}foot`, [0, -0.42, 0.9], 2.3, 'rx rz'],
      [`${s}toes`, [0, 0, 1], 1.2, 'rx'],
    ];
  }),
  ['lowerback', [0, 1, -0.05], 2.0, 'rx ry rz'],
  ['upperback', [0, 1, 0], 2.0, 'rx ry rz'],
  ['thorax', [0, 1, 0], 2.0, 'rx ry rz'],
  ['lowerneck', [0, 1, 0.1], 1.5, 'rx ry rz'],
  ['upperneck', [0, 1, 0], 1.5, 'rx ry rz'],
  ['head', [0, 1, 0], 1.5, 'rx ry rz'],
  ...(['l', 'r'] as const).flatMap((s): [string, number[], number, string][] => {
    const x = s === 'l' ? 1 : -1;
    return [
      [`${s}clavicle`, [0.9 * x, 0.4, 0], 3.2, 'ry rz'],
      [`${s}humerus`, [x, 0, 0], 5.0, 'rx ry rz'],
      [`${s}radius`, [x, 0, 0], 3.4, 'rx'],
      [`${s}wrist`, [x, 0, 0], 1.7, 'ry'],
      [`${s}hand`, [x, 0, 0], 0.7, 'rx rz'],
      [`${s}fingers`, [x, 0, 0], 0.6, 'rx'],
      [`${s}thumb`, [0.7 * x, 0, 0.7], 0.8, 'rx rz'],
    ];
  }),
];
const HIERARCHY = [
  'root lhipjoint rhipjoint lowerback',
  ...['l', 'r'].flatMap((s) => [
    `${s}hipjoint ${s}femur`,
    `${s}femur ${s}tibia`,
    `${s}tibia ${s}foot`,
    `${s}foot ${s}toes`,
  ]),
  'lowerback upperback',
  'upperback thorax',
  'thorax lowerneck lclavicle rclavicle',
  'lowerneck upperneck',
  'upperneck head',
  ...['l', 'r'].flatMap((s) => [
    `${s}clavicle ${s}humerus`,
    `${s}humerus ${s}radius`,
    `${s}radius ${s}wrist`,
    `${s}wrist ${s}hand ${s}thumb`,
    `${s}hand ${s}fingers`,
  ]),
];

/** The skeleton, as an `.asf` file's text. */
export function testAsf(): string {
  const bones = BONES.map(([name, dir, length, dof], i) =>
    [
      '  begin',
      `     id ${i + 1}`,
      `     name ${name}`,
      `     direction ${dir.join(' ')}`,
      `     length ${length}`,
      '     axis 0 0 0  XYZ',
      ...(dof ? [`    dof ${dof}`] : []),
      '  end',
    ].join('\n'),
  );
  const head = [':version 1.10', ':name TEST', ':units', '  mass 1.0', '  length 0.45', '  angle deg', ':root'];
  const root = ['   order TX TY TZ RX RY RZ', '   axis XYZ', '   position 0 0 0', '   orientation 0 0 0'];
  return [
    ...head,
    ...root,
    ':bonedata',
    ...bones,
    ':hierarchy',
    '  begin',
    ...HIERARCHY.map((l) => `    ${l}`),
    '  end',
    '',
  ].join('\n');
}

/** A take of `n` frames at 120 a second: a walk forward at `travel` units a second (0: in place), as `.amc` text. */
export function testAmc(n: number, travel = 20): string {
  const lines = ['#!OML:ASF TEST', ':FULLY-SPECIFIED', ':DEGREES'];
  for (let f = 0; f < n; f++) {
    const t = f / 120;
    const swing = Math.sin(2 * Math.PI * t);
    const lift = Math.max(0, Math.sin(2 * Math.PI * t));
    const fixed = (v: number) => v.toFixed(5);
    lines.push(String(f + 1));
    lines.push(
      `root 0 ${fixed(16.4 + 0.3 * Math.cos(4 * Math.PI * t))} ${fixed(travel * t)} ${fixed(-4)} ${fixed(3 * swing)} 0`,
    );
    lines.push(`lowerback ${fixed(2 * swing)} 0 0`, 'upperback 0 0 0', 'thorax 0 0 0', 'lowerneck 0 0 0');
    lines.push('upperneck 0 0 0', 'head 0 0 0');
    for (const [s, k] of [
      ['l', 1],
      ['r', -1],
    ] as const) {
      lines.push(`${s}clavicle 0 0`, `${s}humerus 0 ${fixed(25 * k * swing)} ${fixed(-70 * k)}`);
      lines.push(
        `${s}radius ${fixed(20 + 10 * lift)}`,
        `${s}wrist 0`,
        `${s}hand 0 0`,
        `${s}fingers 10`,
        `${s}thumb 0 0`,
      );
      lines.push(`${s}femur ${fixed(-25 * k * swing)} 0 0`, `${s}tibia ${fixed(15 + 30 * (k > 0 ? lift : 1 - lift))}`);
      lines.push(`${s}foot ${fixed(-10 * k * swing)} 0`, `${s}toes 0`);
    }
  }
  return `${lines.join('\n')}\n`;
}
