/**
 * @file The state hash (PLAN.md §6.5, I-05): 64-bit FNV-1a over the float64 bits of numbers, and the canonical form
 * that turns structured state into one exact byte stream and one exact text. WP 1.4's `hash()`, `trace()` and
 * `capture()` are built on it; replays compare its hex digests.
 *
 * Invariants:
 * - `Fnv64` is standard FNV-1a 64 (offset basis 0xcbf29ce484222325, prime 0x100000001b3), byte by byte, computed in two
 *   32-bit lanes because JavaScript has no fast 64-bit integers. A number feeds its 8 float64 bytes, little-endian,
 *   so `0` and `-0` differ and every last bit counts; every NaN feeds the one canonical NaN. Strings feed their UTF-8
 *   bytes, so `new Fnv64().string('a').hex()` is the published test vector `'af63dc4c8601ec8c'`.
 * - The canonical model: `null`, booleans, numbers, strings, arrays, typed arrays (as arrays of their numbers),
 *   plain objects (keys sorted, so insertion order never matters) and values with `toArray()` (three.js's math
 *   classes: a `Vector3` counts as `[x, y, z]`). `undefined`, functions, symbols, bigints, Maps, other class instances
 *   and nesting past `MAX_DEPTH` (cycles) are refused with `CORE_NOT_CANONICAL`, never skipped.
 * - `hashValue(deserialize(serialize(v))) === hashValue(v)`; `serialize` writes `-0` as `-0` (which `JSON.parse`
 *   reads back exactly) and refuses NaN and ±Infinity, which JSON cannot hold; the hash takes them.
 * - Pure integer arithmetic: identical in Node and Chromium, inside or outside `withSimMath`.
 *
 * Carried from `my-3d2dge:src/stress-world/00-setup.js:59` (`hashNumbers`), rewritten: float64 bits instead of float32
 * (a float32 hash let diverged state "match"), 64 bits instead of 32.
 *
 * @example
 * hashNumbers([1, 2, 3]) === new Fnv64().number(1).number(2).number(3).hex(); // true
 * hashValue({ b: [1, -0], a: 'x' }) === hashValue({ a: 'x', b: [1, -0] }); // true: keys are sorted
 * serialize({ b: [1, -0], a: 'x' }); // '{"a":"x","b":[1,-0]}'
 * @see engine/core/hash.test.ts
 */
import { defineCodes } from './log';

/** The codes this module raises, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const HASH_CODES = defineCodes('core', {
  CORE_NOT_CANONICAL: {
    template: '{path} is {what}, which the canonical form cannot hold',
    fix: 'keep hashed and captured state to null, booleans, finite numbers, strings, arrays, typed arrays, plain objects and three.js math classes; store an id instead of an object reference',
    doc: 'Raised by `Fnv64.value`, `hashValue` and `serialize` (engine/core/hash.ts) for `undefined`, functions, symbols, bigints, Maps, Sets, class instances without `toArray()`, nesting deeper than 100 levels (usually a cycle), and, in `serialize` only, NaN or ±Infinity. Nothing is skipped silently, so two states that differ always hash differently.',
  },
});

/** How deep the canonical form nests before it is refused as a cycle. */
export const MAX_DEPTH = 100;

/** A value the canonical form holds; see the file comment. */
export type Canonical =
  | null
  | boolean
  | number
  | string
  | readonly Canonical[]
  | ArrayLike<number>
  | { toArray(): Canonical[] }
  | { readonly [key: string]: Canonical };

const OFFSET_HI = 0xcbf29ce4;
const OFFSET_LO = 0x84222325;
/** The low 32 bits of the FNV-64 prime 0x100000001b3; its high word is 0x100, a shift by 8. */
const PRIME_LO = 0x1b3;
const TWO_32 = 4294967296;

const scratch = new DataView(new ArrayBuffer(8));
const utf8 = new TextEncoder();

/** Type tags of the canonical byte stream, one byte before each value. */
const TAG = { null: 0, false: 1, true: 2, number: 3, string: 4, array: 5, object: 6 } as const;

/** Where a piece sits in the value: object keys and array indices from the top. */
type Trail = (string | number)[];

/** Throws `CORE_NOT_CANONICAL` for the piece at `trail`, written as `a.b[2]`. */
function refuse(trail: Trail, what: string): never {
  const path = trail.map((step, i) => (typeof step === 'number' ? `[${step}]` : i ? `.${step}` : step)).join('');
  const { template, fix } = HASH_CODES.CORE_NOT_CANONICAL;
  const message = template.replace('{path}', path || 'the value').replace('{what}', what);
  throw new TypeError(`[CORE_NOT_CANONICAL] ${message}: ${fix}`);
}

/** What a refused value is, for the message. */
function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object' || value === null) return `a ${typeof value}`;
  const name = (value as object).constructor?.name;
  return name ? `a ${name}` : 'an object without a prototype';
}

/** True for a plain object: `{}` literals and `Object.create(null)`. */
function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** What `walk` hands the pieces of a value to: the hash feeds them as bytes, `serialize` as text. */
interface Visitor {
  scalar(value: null | boolean | number | string, trail: Trail): void;
  open(kind: 'array' | 'object', length: number): void;
  key(key: string, index: number): void;
  close(kind: 'array' | 'object'): void;
}

/**
 * Walks `value` in canonical order (an object's keys sorted), after the checks both consumers share, and hands each
 * piece to `visit`. `trail` (pushed and popped on the way, read only by a refusal) says where the walk is.
 */
function walk(value: unknown, visit: Visitor, trail: Trail): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    visit.scalar(value, trail);
    return;
  }
  if (typeof value !== 'object') refuse(trail, describe(value));
  if (trail.length >= MAX_DEPTH) refuse(trail, `nested deeper than ${MAX_DEPTH} levels (a cycle?)`);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    if (value instanceof DataView || value instanceof BigInt64Array || value instanceof BigUint64Array) {
      refuse(trail, describe(value));
    }
    const list = value as ArrayLike<unknown>;
    visit.open('array', list.length);
    for (let i = 0; i < list.length; i++) {
      trail.push(i);
      walk(list[i], visit, trail);
      trail.pop();
    }
    visit.close('array');
    return;
  }
  const toArray = (value as { toArray?: unknown }).toArray;
  if (typeof toArray === 'function' && !isPlain(value)) {
    walk(toArray.call(value), visit, trail);
    return;
  }
  if (!isPlain(value)) refuse(trail, describe(value));
  const keys = Object.keys(value).sort();
  visit.open('object', keys.length);
  keys.forEach((key, index) => {
    visit.key(key, index);
    trail.push(key);
    walk((value as Record<string, unknown>)[key], visit, trail);
    trail.pop();
  });
  visit.close('object');
}

/**
 * The 64-bit FNV-1a hash, fed piece by piece: `new Fnv64().number(x).string(id).hex()`. Each method returns the
 * hasher, so calls chain; `hex()` reads the digest without ending the stream.
 */
export class Fnv64 {
  /** The high 32 bits of the running hash. */
  hi = OFFSET_HI;
  /** The low 32 bits of the running hash. */
  lo = OFFSET_LO;

  /** Feeds one byte (0–255). */
  byte(b: number): this {
    const lo = (this.lo ^ b) >>> 0;
    const product = lo * PRIME_LO; // < 2^41: exact
    this.hi = (Math.imul(this.hi, PRIME_LO) + (lo << 8) + ((product / TWO_32) >>> 0)) >>> 0;
    this.lo = product >>> 0;
    return this;
  }

  /** Feeds a 32-bit unsigned integer as 4 bytes, little-endian. */
  uint32(n: number): this {
    let { hi, lo } = this;
    for (let shift = 0; shift < 32; shift += 8) {
      lo = (lo ^ ((n >>> shift) & 0xff)) >>> 0;
      const product = lo * PRIME_LO;
      hi = (Math.imul(hi, PRIME_LO) + (lo << 8) + ((product / TWO_32) >>> 0)) >>> 0;
      lo = product >>> 0;
    }
    this.hi = hi;
    this.lo = lo;
    return this;
  }

  /** Feeds a number's 8 float64 bytes, little-endian; every NaN feeds the canonical NaN, 0x7ff8000000000000. */
  number(x: number): this {
    if (x !== x) return this.uint32(0).uint32(0x7ff80000);
    scratch.setFloat64(0, x, true);
    return this.uint32(scratch.getUint32(0, true)).uint32(scratch.getUint32(4, true));
  }

  /** Feeds each number of a list or typed array, in order. */
  numbers(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.number(values[i]);
    return this;
  }

  /** Feeds raw bytes. */
  bytes(data: Uint8Array): this {
    for (let i = 0; i < data.length; i++) this.byte(data[i]);
    return this;
  }

  /** Feeds a string's UTF-8 bytes. */
  string(s: string): this {
    return this.bytes(utf8.encode(s));
  }

  /** Feeds any canonical value, type-tagged and length-prefixed, so `[1, [2]]` and `[[1], 2]` differ. */
  value(value: Canonical): this {
    /** A string as its tag (none for a key), its UTF-8 byte count, then its bytes. */
    const prefixed = (s: string, tag?: number) => {
      const bytes = utf8.encode(s);
      if (tag !== undefined) this.byte(tag);
      this.uint32(bytes.length).bytes(bytes);
    };
    walk(
      value,
      {
        scalar: (v) => {
          if (v === null || typeof v === 'boolean') this.byte(v === null ? TAG.null : v ? TAG.true : TAG.false);
          else if (typeof v === 'number') this.byte(TAG.number).number(v);
          else prefixed(v, TAG.string);
        },
        open: (kind, length) => this.byte(TAG[kind]).uint32(length),
        key: (key) => prefixed(key),
        close: () => {},
      },
      [],
    );
    return this;
  }

  /** The digest so far, as 16 lowercase hex digits (high word first). */
  hex(): string {
    return this.hi.toString(16).padStart(8, '0') + this.lo.toString(16).padStart(8, '0');
  }
}

/** murmur3's 32-bit finaliser: spreads every bit of an int over every bit of the unsigned result. */
export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The 64-bit FNV-1a digest of numbers by their float64 bits, as 16 hex digits: equal state, equal hash. */
export function hashNumbers(values: ArrayLike<number>): string {
  return new Fnv64().numbers(values).hex();
}

/** The 64-bit FNV-1a digest of a canonical value (plain data, keys in any order), as 16 hex digits. */
export function hashValue(value: Canonical): string {
  return new Fnv64().value(value).hex();
}

/**
 * The canonical text of a value: JSON with object keys sorted, no spaces, numbers exact (the shortest round-trip
 * form, `-0` kept), typed arrays and `toArray()` values as arrays. Equal values give equal text.
 */
export function serialize(value: Canonical): string {
  const parts: string[] = [];
  const opened: ('array' | 'object')[] = [];
  const counts: number[] = [];
  const comma = () => {
    const top = counts.length - 1;
    if (top >= 0 && opened[top] === 'array' && counts[top]++ > 0) parts.push(',');
  };
  walk(
    value,
    {
      scalar: (v, trail) => {
        comma();
        if (typeof v === 'number' && !Number.isFinite(v)) refuse(trail, String(v));
        parts.push(Object.is(v, -0) ? '-0' : JSON.stringify(v));
      },
      open: (kind) => {
        comma();
        parts.push(kind === 'array' ? '[' : '{');
        opened.push(kind);
        counts.push(0);
      },
      key: (key, index) => parts.push(`${index > 0 ? ',' : ''}${JSON.stringify(key)}:`),
      close: (kind) => {
        parts.push(kind === 'array' ? ']' : '}');
        opened.pop();
        counts.pop();
      },
    },
    [],
  );
  return parts.join('');
}

/** Reads text written by `serialize` back into plain data (arrays for typed arrays and math classes). */
export function deserialize(text: string): Canonical {
  return JSON.parse(text) as Canonical;
}
