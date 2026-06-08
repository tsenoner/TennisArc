import type { Snapshot, Tour } from "./model";

/**
 * Fetch the published snapshot for a tour. Uses the external data base URL when given
 * (the GitHub `data` branch via env `VITE_DATA_BASE_URL`), else the same-origin seed
 * file in `public/data/`. Returns null on any failure (the caller falls back to cache).
 */
export async function fetchSnapshot(
  tour: Tour,
  baseUrl: string | undefined = (import.meta as any).env?.VITE_DATA_BASE_URL,
): Promise<Snapshot | null> {
  const file = `${tour.toLowerCase()}.json`;
  const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/${file}` : `/data/${file}`;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as Snapshot;
  } catch {
    return null;
  }
}
