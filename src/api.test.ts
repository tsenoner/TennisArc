import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSnapshot } from "./api";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

afterEach(() => vi.unstubAllGlobals());

describe("fetchSnapshot", () => {
  it("fetches the same-origin data file when no base URL", async () => {
    const snap = makeSyntheticSnapshot({ tour: "WTA", drawSize: 8, seed: 2 });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => snap } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("WTA", undefined)).toEqual(snap);
    expect(fetchMock).toHaveBeenCalledWith("/data/wta.json", { cache: "no-cache" });
  });

  it("prefers the external base URL (trailing slash trimmed)", async () => {
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => snap } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("ATP", "https://cdn.example/")).toEqual(snap);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/atp.json", { cache: "no-cache" });
  });

  it("falls back to the same-origin seed when the external URL fails", async () => {
    const seed = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 9 });
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://cdn.example")
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, json: async () => seed } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("ATP", "https://cdn.example")).toEqual(seed);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/atp.json", { cache: "no-cache" });
    expect(fetchMock).toHaveBeenCalledWith("/data/atp.json", { cache: "no-cache" });
  });

  it("returns null when both external and same-origin fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 } as Response)));
    expect(await fetchSnapshot("ATP", "https://cdn.example")).toBeNull();
  });

  it("returns null when fetch rejects (offline) and no cache", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchSnapshot("ATP", undefined)).toBeNull();
  });
});
