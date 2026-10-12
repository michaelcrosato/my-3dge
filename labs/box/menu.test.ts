/**
 * @file Unit tests for the box menu's memory (labs/box/menu.ts): it opens on a first visit and after being left
 * open, stays closed after being closed, and storage that throws (blocked site data, a full quota) or is absent
 * remembers nothing, so the menu opens and the page never fails. The panel itself is T2 (tests/e2e/box-menu.spec.ts).
 * @see labs/box/menu.ts
 */
import { describe, expect, it } from 'vitest';
import { MENU_STORAGE_KEY, menuStartsOpen, rememberMenu, type MenuStorage } from './menu';

/** An in-memory `localStorage`. */
function memory(): MenuStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

/** Storage that throws on every call, as a blocked or full `localStorage` does. */
const blocked: MenuStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('the box menu remembers its last toggle', () => {
  it('opens on a first visit', () => {
    expect(menuStartsOpen(memory())).toBe(true);
  });

  it('stays closed after being closed, and opens again after being opened', () => {
    const storage = memory();
    rememberMenu(storage, false);
    expect(storage.items.get(MENU_STORAGE_KEY)).toBe('closed');
    expect(menuStartsOpen(storage)).toBe(false);
    rememberMenu(storage, true);
    expect(storage.items.get(MENU_STORAGE_KEY)).toBe('open');
    expect(menuStartsOpen(storage)).toBe(true);
  });

  it('opens and never throws when storage is blocked, full or absent', () => {
    expect(() => rememberMenu(blocked, false)).not.toThrow();
    expect(menuStartsOpen(blocked)).toBe(true);
    expect(() => rememberMenu(null, false)).not.toThrow();
    expect(menuStartsOpen(null)).toBe(true);
  });
});
