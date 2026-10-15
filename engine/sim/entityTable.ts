/**
 * @file The sim world's entity table (PLAN.md §6.5 item 4, WP 1.4): the live entities of engine/sim/world.ts
 * `createWorld`, in id order, with an id → entity map for lookups. `createEntityTable()` gives `order` (what every
 * iteration walks: queries, the state, the hash, a capture), `get` and `has`, `insert` (an entity joins in id order),
 * `removeAll` (the despawned leave; it returns their ids, whose streams the world drops), `live` (the entity, or
 * `SIM_NO_ENTITY` saying why it is not there) and `clear` (before a restore), and counts the next id (`nextId`, from 1,
 * never reused in a timeline).
 *
 * Invariants: `order` is always sorted by id, and the map serves lookups only (never iterated), so iteration order is
 * the same on every run whatever the map's own order. Split from world.ts to keep each under 400 lines (ADR-0014
 * amendment 16).
 *
 * @example
 * import { makeEntity } from './entities';
 * const table = createEntityTable();
 * table.insert(makeEntity(table.nextId++, {}));
 * table.insert(makeEntity(table.nextId++, {}));
 * table.removeAll([1]); // Set {1}
 * table.order.map((e) => e.id); // [2]
 * @see engine/sim/world.test.ts
 */
import { codeError } from '../core/log';
import { show } from '../core/schema';
import type { LiveEntity } from './entities';

/** The live entities of a world (see the file comment). */
export interface EntityTable {
  /** Live entities in id order. */
  readonly order: readonly LiveEntity[];
  /** The id the next spawn gets. */
  nextId: number;
  /** The live entity `id`, if any. */
  get(id: number): LiveEntity | undefined;
  /** Whether entity `id` lives. */
  has(id: number): boolean;
  /** Joins `entity`, keeping id order. */
  insert(entity: LiveEntity): void;
  /** Removes the live entities of `ids`; returns the ids it removed. */
  removeAll(ids: readonly number[]): Set<number>;
  /** The live entity `id`; else throws `SIM_NO_ENTITY`, saying it is `pending` (spawned this step), despawned or never made. */
  live(id: number, pending: (id: number) => boolean): LiveEntity;
  /** Empties it (a restore inserts its entities afterwards). */
  clear(): void;
}

/** An empty entity table, its next id 1. */
export function createEntityTable(): EntityTable {
  let order: LiveEntity[] = [];
  const byId = new Map<number, LiveEntity>();
  const table: EntityTable = {
    get order() {
      return order;
    },
    nextId: 1,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    insert(entity) {
      let at = order.length;
      if (at > 0 && order[at - 1].id > entity.id) at = order.findIndex((other) => other.id > entity.id);
      order.splice(at, 0, entity);
      byId.set(entity.id, entity);
    },
    removeAll(ids) {
      const gone = new Set(ids.filter((id) => byId.delete(id)));
      if (gone.size) order = order.filter((entity) => !gone.has(entity.id));
      return gone;
    },
    live(id, pending) {
      const entity = byId.get(id);
      if (entity) return entity;
      const why = pending(id)
        ? ': it was spawned during this step and joins the world at its end'
        : Number.isInteger(id) && id >= 1 && id < table.nextId
          ? ': it was despawned'
          : ': no spawn made it';
      throw codeError('SIM_NO_ENTITY', { id: show(id), why });
    },
    clear() {
      order = [];
      byId.clear();
    },
  };
  return table;
}
