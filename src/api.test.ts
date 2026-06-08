import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSnapshot } from "./api";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

afterEach(() => vi.unstubAllGlobals());

describe("fetchSnapshot", () => {
  it("fetches and returns a snapshot for the tour from the same-origin data file", async () => {
    const snap = makeSyntheticSnapshot({ tour: "WTA", drawSize: 8, seed: 2 });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/data/wta.json");
      return { ok: true, json: async () => snap } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("WTA")).toEqual(snap);
  });

  it("prefers the external base URL when configured", async () => {
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://cdn.example/atp.json");
      return { ok: true, json: async () => snap } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("ATP", "https://cdn.example")).toEqual(snap);
  });

  it("returns null on a failed response instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 } as Response)));
    expect(await fetchSnapshot("ATP")).toBeNull();
  });

  it("returns null when fetch itself rejects (offline)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchSnapshot("ATP")).toBeNull();
  });
});
