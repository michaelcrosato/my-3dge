/**
 * @file Decodes the PNGs Chromium's screenshots produce (non-interlaced, 8-bit RGB or RGBA) into RGBA bytes, for the
 * frame reads of the e2e fixture (tests/e2e/fixtures.ts) and `x shot` (tools/cmd/shot.ts). Node's zlib inflates;
 * nothing else is needed, so no image dependency is added (doctrine: Common ground).
 *
 * Invariants: other bit depths, palettes and interlaced files throw with the reason; the output is row-major RGBA
 * (an RGB source gets alpha 255).
 *
 * @see tools/lib/png.test.ts
 */
import { inflateSync } from 'node:zlib';

/** Decodes a non-interlaced 8-bit RGB or RGBA PNG (what Chromium's screenshots are) into RGBA bytes. */
export function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('decodePng: not a PNG');
  const header = { width: 0, height: 0, depth: 0, colorType: 0, interlace: 0 };
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      Object.assign(header, { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8] });
      Object.assign(header, { colorType: data[9], interlace: data[12] });
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const { width, height, depth, colorType, interlace } = header;
  if (depth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(
      `decodePng: unsupported PNG (bit depth ${depth}, colour type ${colorType}, interlace ${interlace})`,
    );
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks));
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      let predict = 0;
      if (filter === 1) predict = left;
      else if (filter === 2) predict = up;
      else if (filter === 3) predict = (left + up) >> 1;
      else if (filter === 4) {
        const corner = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
        const [pa, pb, pc] = [Math.abs(up - corner), Math.abs(left - corner), Math.abs(left + up - 2 * corner)];
        predict = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      out[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predict) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: out };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([out[i * 3], out[i * 3 + 1], out[i * 3 + 2], 255], i * 4);
  return { width, height, rgba };
}
