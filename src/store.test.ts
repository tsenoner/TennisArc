import { describe, it, expect } from "vitest";
import { createMemoryStore } from "./store";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

describe("createMemoryStore", () => {
  it("round-trips a snapshot per tour and returns null when absent", async () => {
    const store = createMemoryStore();
    expect(await store.getSnapshot("ATP")).toBeNull();
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    await store.setSnapshot("ATP", snap);
    expect(await store.getSnapshot("ATP")).toEqual(snap);
    expect(await store.getSnapshot("WTA")).toBeNull();
  });
});
