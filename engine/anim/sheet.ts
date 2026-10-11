/**
 * @file Skeleton contact sheets (PLAN.md WP 3.4, `anim.sheet()`): `animSheet(frames)` draws poses as stick figures in
 * one SVG, in Node, each frame from the views asked for, so an agent can look at a pose, a move's samples or a state
 * matrix without a browser. `x sheet` (WP 6.6) turns a sheet into a PNG through the browser, on demand.
 *
 * Invariants:
 * - Reproducible: the SVG depends only on the poses, the skeleton and the options (no clock, no randomness, numbers
 *   written with two decimals), and `hash` is its FNV-1a digest, so a sheet is compared by hash, never by image.
 * - Orthographic views with +Y up. `front` looks at the character's face (its left on the page's right), `side` from
 *   its right (forward points right), `back` from behind, `top` from above (forward points up the page), and
 *   `threeQuarter` from its front left, 20° up. Every frame and view shares one scale, framed to hold all the poses.
 * - Colours: the left side blue, the right side red, the centre grey; sockets are orange squares; a frame's label
 *   carries the first 8 digits of its `hashPose`.
 *
 * @example
 * import { Pose } from './pose';
 * const sheet = animSheet([new Pose(), { pose: new Pose(), label: 'rest again' }], { views: ['front', 'side'] });
 * sheet.svg.startsWith('<svg'); // true
 * sheet.hash === animSheet([new Pose(), new Pose()], { views: ['front', 'side'] }).hash; // false: the labels differ
 * @see engine/anim/sheet.test.ts
 */
import { Fnv64 } from '../core/hash';
import { Vector3 } from '../core/math';
import { createWorldPose, forwardKinematics, jointToWorld, socketPosition, tipPosition } from './fk';
import { hashPose, Pose } from './pose';
import { createSkeleton, JOINT_COUNT, JOINTS, PARENTS, SOCKETS, type Skeleton } from './skeleton';

/** The views a sheet can draw: a camera yaw about +Y (0 in front of the character) and a pitch above the ground. */
export const SHEET_VIEWS = {
  front: { yaw: 0, pitch: 0 },
  side: { yaw: -Math.PI / 2, pitch: 0 },
  back: { yaw: Math.PI, pitch: 0 },
  top: { yaw: Math.PI, pitch: Math.PI / 2 },
  threeQuarter: { yaw: Math.PI / 4, pitch: Math.PI / 9 },
} as const;

/** A view's name. */
export type SheetView = keyof typeof SHEET_VIEWS;

/** One frame of a sheet: a pose, and its label (`#<index>` when absent). */
export interface SheetFrame {
  pose: Pose;
  label?: string;
}

/** What a sheet draws, and how. */
export interface SheetOptions {
  /** The skeleton the poses are for; `build:chibi`'s by default. */
  skeleton?: Skeleton;
  /** The views of each frame, side by side; `['front', 'side']` by default. */
  views?: readonly SheetView[];
  /** Frames per row; as many as fit 8 view panels by default. */
  columns?: number;
  /** One view panel's size in pixels (square); 160 by default. */
  cell?: number;
  /** A title across the top. */
  title?: string;
  /** Whether to draw the sockets; true by default. */
  sockets?: boolean;
}

/** A drawn sheet: the SVG text, its hash, and its size in pixels. */
export interface Sheet {
  svg: string;
  /** The SVG's 64-bit FNV-1a digest, 16 hex digits: equal sheets, equal hash. */
  hash: string;
  width: number;
  height: number;
  frames: number;
}

/** Layout, in pixels: the panel margin, the label band, the gap between frames, the title band. */
const LAYOUT = { pad: 8, label: 14, gap: 6, title: 22 } as const;
const COLOR = { L: '#2f6fd0', R: '#d0412f', C: '#555555', socket: '#e08a00', floor: '#b8b8b8', panel: '#f6f6f4' };

/** A number for the SVG: two decimals, no `-0`. */
const num = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
};
/** Text for the SVG, escaped. */
const text = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
/** A joint's side colour, by its name's last letter. */
const sideColor = (name: string) => (name.endsWith('L') ? COLOR.L : name.endsWith('R') ? COLOR.R : COLOR.C);

/** A view's camera axes: right and up on the page, and toward the camera (for depth). */
function viewAxes(view: SheetView): [Vector3, Vector3, Vector3] {
  const { yaw, pitch } = SHEET_VIEWS[view];
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const toward = new Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
  const up = new Vector3().crossVectors(toward, right);
  return [right, up, toward];
}

/** One frame's world points: joints, leaf tips, sockets, the head's centre and the root. */
interface Points {
  joints: Vector3[];
  tips: Vector3[];
  sockets: Vector3[];
  head: Vector3;
  root: Vector3;
}

/** The world points of `pose` on `skeleton`. */
function pointsOf(skeleton: Skeleton, pose: Pose): Points {
  const world = forwardKinematics(skeleton, pose, createWorldPose());
  const joints = JOINTS.map((_, j) => new Vector3().fromArray(world.positions, j * 3));
  const tips = JOINTS.map((_, j) => tipPosition(skeleton, world, j));
  const sockets = SOCKETS.map((name) => socketPosition(skeleton, world, name));
  const head = jointToWorld(world, 'head', new Vector3(0, skeleton.headRadius, 0));
  return { joints, tips, sockets, head, root: pose.rootPos.clone() };
}

/**
 * Draws `frames` (poses, or `{ pose, label }`) as an SVG contact sheet: one card per frame, holding one panel per
 * view, all at one scale. The same frames and options give the same SVG and hash, in Node and in a browser.
 */
export function animSheet(frames: readonly (Pose | SheetFrame)[], options: SheetOptions = {}): Sheet {
  const skeleton = options.skeleton ?? createSkeleton();
  const views = options.views ?? (['front', 'side'] as const);
  const cell = options.cell ?? 160;
  const items = frames.map((frame, i) =>
    frame instanceof Pose ? { pose: frame, label: `#${i}` } : { pose: frame.pose, label: frame.label ?? `#${i}` },
  );
  const columns = Math.max(1, Math.min(items.length, options.columns ?? Math.max(1, Math.floor(8 / views.length))));
  const rows = Math.ceil(items.length / columns);
  const cardWidth = views.length * cell;
  const top = options.title ? LAYOUT.title : 0;
  const width = columns * cardWidth + (columns + 1) * LAYOUT.gap;
  const height = top + rows * (LAYOUT.label + cell) + (rows + 1) * LAYOUT.gap;
  const axes = views.map(viewAxes);
  const points = items.map((item) => pointsOf(skeleton, item.pose));
  // one scale for every panel: the largest extent of any view, padded
  const bounds = axes.map(([right, up]) => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (p: Vector3, r = 0) => {
      const [x, y] = [p.dot(right), p.dot(up)];
      box[0] = Math.min(box[0], x - r);
      box[1] = Math.min(box[1], y - r);
      box[2] = Math.max(box[2], x + r);
      box[3] = Math.max(box[3], y + r);
    };
    for (const p of points) {
      [...p.joints, ...p.tips, ...p.sockets, p.root].forEach((q) => grow(q));
      grow(p.head, skeleton.headRadius);
    }
    return box;
  });
  const extent = Math.max(1e-6, ...bounds.map((b) => Math.max(b[2] - b[0], b[3] - b[1])));
  const k = (cell - 2 * LAYOUT.pad) / extent;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="monospace" font-size="10">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
  ];
  if (options.title) out.push(`<text x="${LAYOUT.gap}" y="15" font-size="13">${text(options.title)}</text>`);
  items.forEach((item, i) => {
    const x0 = LAYOUT.gap + (i % columns) * (cardWidth + LAYOUT.gap);
    const y0 = top + LAYOUT.gap + Math.floor(i / columns) * (LAYOUT.label + cell + LAYOUT.gap);
    const label = `${text(item.label)} <tspan fill="#888888">${hashPose(item.pose).slice(0, 8)}</tspan>`;
    out.push(`<g transform="translate(${x0} ${y0})">`, `<text x="2" y="10">${label}</text>`);
    views.forEach((view, v) => {
      const [right, up, toward] = axes[v];
      const b = bounds[v];
      const [px, py] = [v * cell + cell / 2, LAYOUT.label + cell / 2];
      const [cx, cy] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      const at = (p: Vector3) => [num(px + (p.dot(right) - cx) * k), num(py - (p.dot(up) - cy) * k)];
      const p = points[i];
      out.push(`<rect x="${v * cell}" y="${LAYOUT.label}" width="${cell}" height="${cell}" fill="${COLOR.panel}"/>`);
      if (SHEET_VIEWS[view].pitch === 0) {
        const floor = num(py + cy * k);
        out.push(`<line x1="${v * cell}" y1="${floor}" x2="${(v + 1) * cell}" y2="${floor}" stroke="${COLOR.floor}"/>`);
      }
      // bones, far ones first: parent → joint, and each leaf to its tip
      const bones: { from: Vector3; to: Vector3; name: string; depth: number }[] = [];
      for (let j = 0; j < JOINT_COUNT; j++) {
        const name = JOINTS[j];
        if (PARENTS[j] >= 0) bones.push({ from: p.joints[PARENTS[j]], to: p.joints[j], name, depth: 0 });
        if (!PARENTS.includes(j) && name !== 'head') bones.push({ from: p.joints[j], to: p.tips[j], name, depth: 0 });
      }
      for (const bone of bones) bone.depth = (bone.from.dot(toward) + bone.to.dot(toward)) / 2;
      for (const bone of [...bones].sort((a, c) => a.depth - c.depth)) {
        const [[x1, y1], [x2, y2]] = [at(bone.from), at(bone.to)];
        out.push(
          `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${sideColor(bone.name)}" stroke-width="2" stroke-linecap="round"/>`,
        );
      }
      const [hx, hy] = at(p.head);
      out.push(`<circle cx="${hx}" cy="${hy}" r="${num(skeleton.headRadius * k)}" fill="none" stroke="${COLOR.C}"/>`);
      p.joints.forEach((joint, j) => {
        const [x, y] = at(joint);
        out.push(`<circle cx="${x}" cy="${y}" r="1.6" fill="${sideColor(JOINTS[j])}"/>`);
      });
      if (options.sockets !== false) {
        for (const socket of p.sockets) {
          const [x, y] = at(socket);
          out.push(`<rect x="${num(+x - 1.5)}" y="${num(+y - 1.5)}" width="3" height="3" fill="${COLOR.socket}"/>`);
        }
      }
      const [rx, ry] = at(p.root);
      out.push(`<path d="M${num(+rx - 3)} ${ry}h6M${rx} ${num(+ry - 3)}v6" stroke="${COLOR.C}"/>`);
    });
    out.push('</g>');
  });
  out.push('</svg>');
  const svg = out.join('\n');
  return { svg, hash: new Fnv64().string(svg).hex(), width, height, frames: items.length };
}
