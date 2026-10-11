/**
 * @file Tests the GLB reader's guards (tools/anim/glb.ts, WP 8.5) on small `.glb` files built here in memory: float,
 * signed, unsigned and normalized (quantized) accessors read by the glTF spec, interleaved and sparse ones, files and
 * accessors that stop short, and LINEAR, STEP and CUBICSPLINE tracks in-betweened as the spec says.
 */
import { describe, expect, it } from 'vitest';
import { glbBytes, nodeTree, parseGlb, readAccessor, sampleTrack, slerp, tracksOf, type Track } from './glb';
import { GlbBuilder, turn } from './glb-fixture';

/** A `.glb` holding `values` as one accessor, read back. */
function roundTrip(values: number[], type: string, componentType: number, normalized = false) {
  const builder = new GlbBuilder();
  const index = builder.add(values, type, componentType, normalized);
  return readAccessor(parseGlb(builder.build({}), 'test.glb'), index);
}

describe('the accessors', () => {
  it('read floats as they are, scalars as numbers and vectors as arrays', () => {
    expect(roundTrip([0.5, -2, 3], 'SCALAR', 5126)).toEqual([0.5, -2, 3]);
    expect(roundTrip([1, 2, 3, 4, 5, 6], 'VEC3', 5126)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('read signed and unsigned integers, normalized as the spec says (signed ones clamp at −1)', () => {
    expect(roundTrip([-128, -127, 0, 127], 'SCALAR', 5120, true)).toEqual([-1, -1, 0, 1]);
    expect(roundTrip([-32768, -32767, 16384, 32767], 'SCALAR', 5122, true)).toEqual([-1, -1, 16384 / 32767, 1]);
    expect(roundTrip([0, 255, 51], 'SCALAR', 5121, true)).toEqual([0, 1, 0.2]);
    expect(roundTrip([0, 65535], 'SCALAR', 5123, true)).toEqual([0, 1]);
    expect(roundTrip([-5, 7], 'SCALAR', 5122)).toEqual([-5, 7]);
    expect(roundTrip([70000], 'SCALAR', 5125)).toEqual([70000]);
  });

  it('reads a quantized rotation as the float one it stands for', () => {
    const q = turn([0, 0, 1], 90);
    const read = roundTrip(
      q.map((v) => Math.round(v * 32767)),
      'VEC4',
      5122,
      true,
    )[0] as number[];
    read.forEach((v, i) => expect(v).toBeCloseTo(q[i], 4));
  });

  it('follows a byte stride, and lays sparse elements over the base', () => {
    const bytes = new Float32Array([1, 2, 99, 3, 4, 99]);
    const doc = {
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: 'VEC2' },
        {
          componentType: 5126,
          count: 3,
          type: 'SCALAR',
          sparse: { count: 1, indices: { bufferView: 1, componentType: 5125 }, values: { bufferView: 2 } },
        },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 24, byteStride: 12 },
        { buffer: 0, byteOffset: 24, byteLength: 4 },
        { buffer: 0, byteOffset: 28, byteLength: 4 },
      ],
    };
    const bin = new Uint8Array(32);
    bin.set(new Uint8Array(bytes.buffer), 0);
    bin.set(new Uint8Array(new Uint32Array([2]).buffer), 24);
    bin.set(new Uint8Array(new Float32Array([7]).buffer), 28);
    const glb = parseGlb(glbBytes(doc, bin), 'test.glb');
    expect(readAccessor(glb, 0)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(readAccessor(glb, 1)).toEqual([0, 0, 7]);
  });

  it('refuses a file that is no .glb, an accessor past the end, and an unknown component type', () => {
    expect(() => parseGlb(new Uint8Array(40), 'a.fbx')).toThrow(/a.fbx is not a binary glTF.*to-glb.py/);
    const short = { accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }] };
    const views = { bufferViews: [{ buffer: 0, byteLength: 48 }] };
    const glb = parseGlb(glbBytes({ ...short, ...views }, new Uint8Array(12)), 'short.glb');
    expect(() => readAccessor(glb, 0)).toThrow(/short.glb: accessor 0 reads past the end/);
    const odd = { accessors: [{ bufferView: 0, componentType: 5130, count: 1, type: 'SCALAR' }], ...views };
    expect(() => readAccessor(parseGlb(glbBytes(odd, new Uint8Array(48)), 'odd.glb'), 0)).toThrow(/5130/);
  });
});

describe('the tracks', () => {
  const track = (interpolation: Track['interpolation'], v: number[][], path: Track['path'] = 'translation'): Track => ({
    node: 0,
    path,
    t: [0, 1],
    v,
    interpolation,
  });

  it('in-between LINEAR, hold STEP, and hold either end', () => {
    expect(sampleTrack(track('LINEAR', [[0], [10]]), 0.25)).toEqual([2.5]);
    expect(sampleTrack(track('STEP', [[0], [10]]), 0.75)).toEqual([0]);
    expect(sampleTrack(track('LINEAR', [[0], [10]]), 5)).toEqual([10]);
    expect(sampleTrack(track('LINEAR', [[0], [10]]), -1)).toEqual([0]);
  });

  it('in-between CUBICSPLINE as a Hermite spline of in-tangent, value and out-tangent per key', () => {
    // zero tangents: smoothstep; tangents matching the slope: a straight line
    const flat = track('CUBICSPLINE', [[0], [0], [0], [0], [10], [0]]);
    expect(sampleTrack(flat, 0.25)[0]).toBeCloseTo(10 * (3 * 0.0625 - 2 * 0.015625), 12);
    const line = track('CUBICSPLINE', [[10], [0], [10], [10], [10], [10]]);
    expect(sampleTrack(line, 0.3)[0]).toBeCloseTo(3, 12);
    expect(sampleTrack(line, 1)[0]).toBe(10);
    const [a, b] = [turn([0, 1, 0], 0), turn([0, 1, 0], 90)];
    const zero = [0, 0, 0, 0];
    const spun = sampleTrack(track('CUBICSPLINE', [zero, a, zero, zero, b, zero], 'rotation'), 0.5);
    expect(Math.hypot(...spun)).toBeCloseTo(1, 12);
    spun.forEach((v, i) => expect(v).toBeCloseTo(slerp(a, b, 0.5)[i], 12));
  });

  it('reads an animation’s CUBICSPLINE channel with three values a key, and refuses one that has not', () => {
    const builder = new GlbBuilder();
    const input = builder.add([0, 1], 'SCALAR');
    const output = builder.add([0, 0, 0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 4, 5, 6, 0, 0, 0], 'VEC3');
    const sampler = { input, output, interpolation: 'CUBICSPLINE' };
    const animation = {
      name: 'Spline',
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      samplers: [sampler],
    };
    const glb = parseGlb(builder.build({ nodes: [{ name: 'root' }], animations: [animation] }), 'spline.glb');
    const [read] = tracksOf(glb, animation);
    expect(sampleTrack(read, 1)).toEqual([4, 5, 6]);
    const linear = { ...animation, samplers: [{ ...sampler, interpolation: 'LINEAR' }] };
    expect(() => tracksOf(glb, linear)).toThrow(/Spline has 2 key times and 6 values/);
  });
});

describe('the node tree', () => {
  it('visits parents first and finds names whatever their case or namespace', () => {
    const doc = {
      nodes: [{ name: 'Leaf' }, { name: 'mixamorig:Hips', children: [0] }, { name: 'Root', children: [1] }],
    };
    const tree = nodeTree(parseGlb(glbBytes(doc, new Uint8Array(0)), 'tree.glb'));
    expect(tree.order).toEqual([2, 1, 0]);
    expect(tree.parent).toEqual([1, 2, -1]);
    expect([tree.find('root'), tree.find('HIPS'), tree.find('mixamorig:Hips'), tree.find('spine')]).toEqual([
      2,
      1,
      1,
      undefined,
    ]);
  });
});
