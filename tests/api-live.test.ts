import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import handler from "../api/live";
import { fakeRes } from "./api-helpers";

const feed = readFileSync(fileURLToPath(new URL("../ingest/fixtures/flashscore-live.sample.txt", import.meta.url)), "utf8");

afterEach(() => vi.restoreAllMocks());

describe("/api/live handler", () => {
  it("returns parsed matches with a cache header on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => feed })));
    const res = fakeRes();
    await handler({ query: { tour: "atp", slam: "wimbledon" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).matches.map((m: any) => m.id)).toEqual(["aaa1", "aaa2", "aaa3", "aaa4"]);
    expect(res.headers["Cache-Control"]).toContain("s-maxage=25");
  });
  it("400s when params are missing", async () => {
    const res = fakeRes();
    await handler({ query: {} } as any, res as any);
    expect(res.statusCode).toBe(400);
  });
  it("fails soft to empty matches on upstream 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "" })));
    const res = fakeRes();
    await handler({ query: { tour: "atp", slam: "wimbledon" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).matches).toEqual([]);
  });
  it("fails soft on a thrown fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const res = fakeRes();
    await handler({ query: { tour: "wta", slam: "wimbledon" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).matches).toEqual([]);
  });
});
