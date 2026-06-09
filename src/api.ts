import { type Snapshot, type SlamIndex, type Tour, snapshotFilename } from "./model";

const BASE = (import.meta as any).env?.VITE_DATA_BASE_URL as string | undefined;
const trim = (u: string): string => u.replace(/\/+$/, "");

async function tryFetch<T>(url: string, valid: (x: any) => boolean): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    return valid(data) ? (data as T) : null;
  } catch {
    return null;
  }
}

const validSnapshot = (s: any): boolean => typeof s?.schemaVersion === "number" && s.schemaVersion >= 1;
const validIndex = (i: any): boolean => typeof i?.schemaVersion === "number" && Array.isArray(i?.slams);

async function fetchData<T>(file: string, valid: (x: any) => boolean, baseUrl: string | undefined): Promise<T | null> {
  if (baseUrl) {
    const ext = await tryFetch<T>(`${trim(baseUrl)}/${file}`, valid);
    if (ext) return ext;
  }
  return tryFetch<T>(`/data/${file}`, valid);
}

/** Fetch the slam manifest (external base URL first, then same-origin seed). */
export function fetchIndex(baseUrl: string | undefined = BASE): Promise<SlamIndex | null> {
  return fetchData<SlamIndex>("index.json", validIndex, baseUrl);
}

/** Fetch one slam snapshot by tour/year/slam (external base URL first, then same-origin seed). */
export function fetchSnapshot(
  tour: Tour, year: number, slam: string, baseUrl: string | undefined = BASE,
): Promise<Snapshot | null> {
  return fetchData<Snapshot>(snapshotFilename(tour, year, slam), validSnapshot, baseUrl);
}
