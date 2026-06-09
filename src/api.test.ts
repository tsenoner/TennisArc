import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSnapshot, fetchIndex } from "./api";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

afterEach(() => vi.unstubAllGlobals());

describe("fetchSnapshot", () => {
  it("fetches the same-origin per-slam file when no base URL", async () => {
    const snap = makeSyntheticSnapshot({ tour: "WTA", drawSize: 8, seed: 2 });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => snap } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("WTA", 2026, "roland-garros", undefined)).toEqual(snap);
    expect(fetchMock).toHaveBeenCalledWith("/data/wta-2026-roland-garros.json", { cache: "no-cache" });
  });

  it("prefers the external base URL (trailing slash trimmed)", async () => {
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => snap } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("ATP", 2025, "wimbledon", "https://cdn.example/")).toEqual(snap);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/atp-2025-wimbledon.json", { cache: "no-cache" });
  });

  it("falls back to the same-origin seed when the external URL fails", async () => {
    const seed = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 9 });
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://cdn.example")
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, json: async () => seed } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("ATP", 2026, "us-open", "https://cdn.example")).toEqual(seed);
    expect(fetchMock).toHaveBeenCalledWith("/data/atp-2026-us-open.json", { cache: "no-cache" });
  });

  it("returns null when both fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 } as Response)));
    expect(await fetchSnapshot("ATP", 2026, "roland-garros", "https://cdn.example")).toBeNull();
  });

  it("accepts schemaVersion 2 (and rejects 0)", async () => {
    const v2 = { ...makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 }), schemaVersion: 2 };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => v2 } as Response)));
    expect(await fetchSnapshot("ATP", 2026, "roland-garros", undefined)).toEqual(v2);
    const bad = { ...v2, schemaVersion: 0 };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bad } as Response)));
    expect(await fetchSnapshot("ATP", 2026, "roland-garros", undefined)).toBeNull();
  });
});

describe("fetchIndex", () => {
  const index = { schemaVersion: 2, generatedAt: "t", slams: [{ tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay", status: "complete", generatedAt: "t", drawSize: 128 }] };

  it("fetches index.json same-origin and validates shape", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => index } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchIndex(undefined)).toEqual(index);
    expect(fetchMock).toHaveBeenCalledWith("/data/index.json", { cache: "no-cache" });
  });

  it("rejects a malformed index (no slams array)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 2 }) } as Response)));
    expect(await fetchIndex(undefined)).toBeNull();
  });
});
