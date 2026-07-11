import { describe, it, expect, vi, afterEach } from "vitest";
import handler from "../api/pbp";
import { fakeRes } from "./api-helpers";
import { BETWEEN_GAMES } from "../ingest/fixtures/flashscore-mhs.sample";

afterEach(() => vi.restoreAllMocks());

describe("/api/pbp handler", () => {
  it("returns the parsed current game with a cache header on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => BETWEEN_GAMES })));
    const res = fakeRes();
    await handler({ query: { mid: "nkXJ8mYa" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ home: "0", away: "0" });
    expect(res.headers["Cache-Control"]).toBe("public, s-maxage=5, stale-while-revalidate=15");
  });

  it("400s on an invalid mid without hitting upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const mid of ["abc", "nkXJ8mYa!"]) {
      const res = fakeRes();
      await handler({ query: { mid } } as any, res as any);
      expect(res.statusCode).toBe(400);
      expect(typeof (res.body as any).error).toBe("string");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails soft to {} on an upstream non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "" })));
    const res = fakeRes();
    await handler({ query: { mid: "nkXJ8mYa" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({});
    expect(res.headers["Cache-Control"]).toBe("public, s-maxage=5");
  });

  it("fails soft to {} on a thrown fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const res = fakeRes();
    await handler({ query: { mid: "nkXJ8mYa" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({});
    expect(res.headers["Cache-Control"]).toBe("public, s-maxage=5");
  });
});
