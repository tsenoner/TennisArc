import { get, set } from "idb-keyval";
import type { Snapshot, Tour } from "./model";

export interface Store {
  getSnapshot(tour: Tour): Promise<Snapshot | null>;
  setSnapshot(tour: Tour, snap: Snapshot): Promise<void>;
}

const key = (tour: Tour) => `snapshot:${tour}`;

/** IndexedDB-backed snapshot cache (offline-first). */
export function createIdbStore(): Store {
  return {
    async getSnapshot(tour) { return (await get<Snapshot>(key(tour))) ?? null; },
    async setSnapshot(tour, snap) { await set(key(tour), snap); },
  };
}

/** In-memory fallback (private mode / tests). */
export function createMemoryStore(): Store {
  const m = new Map<Tour, Snapshot>();
  return {
    async getSnapshot(tour) { return m.get(tour) ?? null; },
    async setSnapshot(tour, snap) { m.set(tour, snap); },
  };
}

/** Probe IndexedDB; fall back to memory if unavailable (e.g. private browsing). */
export async function createStore(): Promise<Store> {
  try {
    const probe = createIdbStore();
    await probe.getSnapshot("ATP"); // throws if IDB is blocked
    return probe;
  } catch {
    return createMemoryStore();
  }
}
