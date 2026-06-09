import { get, set } from "idb-keyval";
import type { SlamIndex, Snapshot, Tour } from "./model";

export interface Store {
  getSnapshot(tour: Tour, year: number, slam: string): Promise<Snapshot | null>;
  setSnapshot(tour: Tour, year: number, slam: string, snap: Snapshot): Promise<void>;
  getIndex(): Promise<SlamIndex | null>;
  setIndex(index: SlamIndex): Promise<void>;
}

const snapKey = (tour: Tour, year: number, slam: string) => `snapshot:${tour}:${year}:${slam}`;
const INDEX_KEY = "slam-index";

/** IndexedDB-backed cache (offline-first). */
export function createIdbStore(): Store {
  return {
    async getSnapshot(tour, year, slam) { return (await get<Snapshot>(snapKey(tour, year, slam))) ?? null; },
    async setSnapshot(tour, year, slam, snap) { await set(snapKey(tour, year, slam), snap); },
    async getIndex() { return (await get<SlamIndex>(INDEX_KEY)) ?? null; },
    async setIndex(index) { await set(INDEX_KEY, index); },
  };
}

/** In-memory fallback (private mode / tests). */
export function createMemoryStore(): Store {
  const snaps = new Map<string, Snapshot>();
  let index: SlamIndex | null = null;
  return {
    async getSnapshot(tour, year, slam) { return snaps.get(snapKey(tour, year, slam)) ?? null; },
    async setSnapshot(tour, year, slam, snap) { snaps.set(snapKey(tour, year, slam), snap); },
    async getIndex() { return index; },
    async setIndex(i) { index = i; },
  };
}

/** Probe IndexedDB; fall back to memory if unavailable (e.g. private browsing). */
export async function createStore(): Promise<Store> {
  try {
    const probe = createIdbStore();
    await probe.getIndex(); // throws if IDB is blocked
    return probe;
  } catch {
    return createMemoryStore();
  }
}
