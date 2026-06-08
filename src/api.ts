import type { Snapshot, Tour } from "./model";

async function tryFetch(url: string): Promise<Snapshot | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const snap = (await res.json()) as Snapshot;
    return snap?.schemaVersion === 1 ? snap : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the published snapshot for a tour. Tries the external data base URL when
 * configured (env `VITE_DATA_BASE_URL`, e.g. the GitHub `data` branch), then falls
 * back to the same-origin committed seed in `public/data/`. Returns null only if both fail.
 */
export async function fetchSnapshot(
  tour: Tour,
  baseUrl: string | undefined = (import.meta as any).env?.VITE_DATA_BASE_URL,
): Promise<Snapshot | null> {
  const file = `${tour.toLowerCase()}.json`;
  if (baseUrl) {
    const ext = await tryFetch(`${baseUrl.replace(/\/+$/, "")}/${file}`);
    if (ext) return ext;
  }
  return tryFetch(`/data/${file}`);
}
