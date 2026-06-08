import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSnapshot } from "./api";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

afterEach(() => vi.unstubAllGlobals());

function mockOk(snap: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => snap } as Response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchSnapshot", () => {
  it("fetches from the same-origin data file when no base URL", async () => {
    const snap = makeSyntheticSnapshot({ tour: "WTA", drawSize: 8, seed: 2 });
    const fetchMock = mockOk(snap);
    expect(await fetchSnapshot("WTA", undefined)).toEqual(snap);
    expect(fetchMock).toHaveBeenCalledWith("/data/wta.json", { cache: "no-cache" });
  });

  it("prefers the external base URL and trims a trailing slash", async () => {
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const fetchMock = mockOk(snap);
    expect(await fetchSnapshot("ATP", "https://cdn.example/")).toEqual(snap);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/atp.json", { cache: "no-cache" });
  });

  it("returns null on a failed response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 } as Response)));
    expect(await fetchSnapshot("ATP", undefined)).toBeNull();
  });

  it("returns null when fetch rejects (offline)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchSnapshot("ATP", undefined)).toBeNull();
  });
});
