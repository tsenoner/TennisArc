import { describe, it, expect } from "vitest";
import { createMemoryStore } from "./store";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

describe("createMemoryStore", () => {
  it("round-trips a snapshot per tour+year+slam and isolates keys", async () => {
    const store = createMemoryStore();
    expect(await store.getSnapshot("ATP", 2026, "roland-garros")).toBeNull();
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    await store.setSnapshot("ATP", 2026, "roland-garros", snap);
    expect(await store.getSnapshot("ATP", 2026, "roland-garros")).toEqual(snap);
    expect(await store.getSnapshot("ATP", 2025, "roland-garros")).toBeNull();
    expect(await store.getSnapshot("WTA", 2026, "roland-garros")).toBeNull();
  });

  it("round-trips the slam index", async () => {
    const store = createMemoryStore();
    expect(await store.getIndex()).toBeNull();
    const idx = { schemaVersion: 2, generatedAt: "t", slams: [] };
    await store.setIndex(idx);
    expect(await store.getIndex()).toEqual(idx);
  });
});
