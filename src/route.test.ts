import { describe, it, expect } from "vitest";
import { parseRoute, buildRoute, type Route } from "./route";
import type { ColorDim } from "./color";
import type { SeedSort } from "./state";

describe("parseRoute — path (the resource)", () => {
  it("reads tour/year/slam from a bare path", () => {
    expect(parseRoute("/atp/2025/wimbledon", "")).toEqual({
      tour: "ATP", year: 2025, slam: "wimbledon",
    });
  });

  it("uppercases the tour (case-insensitive)", () => {
    expect(parseRoute("/WtA/2024/roland-garros", "").tour).toBe("WTA");
  });

  it("ignores a trailing slash", () => {
    expect(parseRoute("/atp/2025/us-open/", "")).toEqual({
      tour: "ATP", year: 2025, slam: "us-open",
    });
  });

  it("leaves unknown tour unset", () => {
    expect(parseRoute("/xyz/2025/wimbledon", "").tour).toBeUndefined();
  });

  it("leaves a non-4-digit year unset", () => {
    expect(parseRoute("/atp/25/wimbledon", "").year).toBeUndefined();
    expect(parseRoute("/atp/abcd/wimbledon", "").year).toBeUndefined();
  });

  it("leaves an unknown slam unset", () => {
    expect(parseRoute("/atp/2025/not-a-slam", "").slam).toBeUndefined();
  });

  it("parses each path field independently (a bad middle segment doesn't poison the rest)", () => {
    expect(parseRoute("/atp/notyear/wimbledon", "")).toEqual({
      tour: "ATP", slam: "wimbledon",
    });
  });

  it("ignores extra path segments", () => {
    expect(parseRoute("/atp/2025/wimbledon/extra/stuff", "")).toEqual({
      tour: "ATP", year: 2025, slam: "wimbledon",
    });
  });

  it("returns empty for the bare root", () => {
    expect(parseRoute("/", "")).toEqual({});
  });
});

describe("parseRoute — query (the view)", () => {
  it("reads view and sub", () => {
    expect(parseRoute("/atp/2025/wimbledon", "?view=seed&sub=elo")).toEqual({
      tour: "ATP", year: 2025, slam: "wimbledon", view: "seed", sub: "elo",
    });
  });

  it("is order-independent", () => {
    const a = parseRoute("/atp/2025/wimbledon", "?view=seed&sub=elo");
    const b = parseRoute("/atp/2025/wimbledon", "?sub=elo&view=seed");
    expect(a).toEqual(b);
  });

  it("tolerates a missing leading '?'", () => {
    expect(parseRoute("/atp/2025/wimbledon", "view=country").view).toBe("country");
  });

  it("leaves an unknown view unset", () => {
    expect(parseRoute("/atp/2025/wimbledon", "?view=bogus").view).toBeUndefined();
  });

  it("leaves an unknown sub unset", () => {
    expect(parseRoute("/atp/2025/wimbledon", "?view=seed&sub=bogus").sub).toBeUndefined();
  });

  it("accepts sub under a non-seed view (inert — caller drops it on canonicalize)", () => {
    expect(parseRoute("/atp/2025/wimbledon", "?view=time&sub=elo")).toMatchObject({
      view: "time", sub: "elo",
    });
  });

  it("ignores unknown query keys", () => {
    expect(parseRoute("/atp/2025/wimbledon", "?utm_source=x&view=seed")).toEqual({
      tour: "ATP", year: 2025, slam: "wimbledon", view: "seed",
    });
  });
});

describe("buildRoute — canonical emission", () => {
  const base = { tour: "ATP", year: 2025, slam: "wimbledon" } as const;

  it("omits the query entirely for the default view (time)", () => {
    expect(buildRoute({ ...base, view: "time", sub: "seed" })).toBe("/atp/2025/wimbledon");
  });

  it("lowercases the tour", () => {
    expect(buildRoute({ tour: "WTA", year: 2024, slam: "roland-garros", view: "time", sub: "seed" }))
      .toBe("/wta/2024/roland-garros");
  });

  it("emits view=seed but omits the default sub", () => {
    expect(buildRoute({ ...base, view: "seed", sub: "seed" })).toBe("/atp/2025/wimbledon?view=seed");
  });

  it("emits both view and sub for the seed/elo combination, view first", () => {
    expect(buildRoute({ ...base, view: "seed", sub: "elo" })).toBe("/atp/2025/wimbledon?view=seed&sub=elo");
  });

  it("emits view=country", () => {
    expect(buildRoute({ ...base, view: "country", sub: "seed" })).toBe("/atp/2025/wimbledon?view=country");
  });

  it("never emits sub on a non-seed view, even when sub=elo", () => {
    expect(buildRoute({ ...base, view: "time", sub: "elo" })).toBe("/atp/2025/wimbledon");
    expect(buildRoute({ ...base, view: "country", sub: "elo" })).toBe("/atp/2025/wimbledon?view=country");
  });
});

describe("round-trip: build∘parse is identity on canonical URLs", () => {
  // Apply the same time/seed defaults the app's resolve step uses, so a parsed
  // Partial becomes a full Route to feed back into buildRoute.
  const fill = (p: ReturnType<typeof parseRoute>): Route => ({
    tour: p.tour ?? "ATP", year: p.year ?? 2025, slam: p.slam ?? "wimbledon",
    view: (p.view ?? "time") as ColorDim, sub: (p.sub ?? "seed") as SeedSort,
  });
  const split = (url: string): [string, string] => {
    const i = url.indexOf("?");
    return i < 0 ? [url, ""] : [url.slice(0, i), url.slice(i)];
  };

  const canonical = [
    "/atp/2025/wimbledon",
    "/wta/2024/roland-garros",
    "/atp/2025/wimbledon?view=seed",
    "/atp/2025/wimbledon?view=seed&sub=elo",
    "/atp/2025/wimbledon?view=country",
    "/wta/2026/australian-open?view=country",
  ];

  for (const url of canonical) {
    it(`recovers ${url}`, () => {
      expect(buildRoute(fill(parseRoute(...split(url))))).toBe(url);
    });
  }
});
