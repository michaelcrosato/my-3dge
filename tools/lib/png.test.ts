/**
 * @file Tests tools/lib/png.ts: RGB and RGBA images through every PNG row filter decode to the pixels written.
 */
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from './png';

/** One PNG chunk: length, type, data and a CRC (unchecked by the decoder, so zero). */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, data, Buffer.alloc(4)]);
}

/** Encodes rows of raw channel bytes, each row with its own filter applied, as a PNG. */
function encode(width: number, rows: number[][], channels: 3 | 4, filters: number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(rows.length, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  const raw: number[] = [];
  rows.forEach((row, y) => {
    const filter = filters[y % filters.length];
    raw.push(filter);
    row.forEach((value, x) => {
      const left = x >= channels ? row[x - channels] : 0;
      const up = y > 0 ? rows[y - 1][x] : 0;
      const corner = x >= channels && y > 0 ? rows[y - 1][x - channels] : 0;
      const paeth = () => {
        const [pa, pb, pc] = [Math.abs(up - corner), Math.abs(left - corner), Math.abs(left + up - 2 * corner)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      };
      const predict = [0, left, up, (left + up) >> 1, filter === 4 ? paeth() : 0][filter];
      raw.push((value - predict) & 0xff);
    });
  });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rowsOf = (width: number, height: number, channels: number) =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width * channels }, (_, i) => (y * 37 + i * 11 + ((i * y) % 7)) & 0xff),
  );

describe('decodePng', () => {
  it('decodes RGBA through all five row filters', () => {
    const rows = rowsOf(5, 5, 4);
    const { width, height, rgba } = decodePng(encode(5, rows, 4, [0, 1, 2, 3, 4]));
    expect([width, height]).toEqual([5, 5]);
    expect(Array.from(rgba)).toEqual(rows.flat());
  });

  it('decodes RGB to RGBA with alpha 255', () => {
    const rows = rowsOf(3, 4, 3);
    const { rgba } = decodePng(encode(3, rows, 3, [4, 3, 2, 1]));
    const expected = rows.flat().flatMap((_, i, all) => (i % 3 === 0 ? [all[i], all[i + 1], all[i + 2], 255] : []));
    expect(Array.from(rgba)).toEqual(expected);
  });

  it('refuses what is not a PNG', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow('decodePng: not a PNG');
  });
});
