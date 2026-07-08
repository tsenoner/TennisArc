import { describe, it, expect } from "vitest";
import { flashSigKey, sigKey } from "./names";

describe("flashSigKey", () => {
  it("matches sigKey of the equivalent full name (simple)", () => {
    expect(flashSigKey("Fritz T.")).toBe("fritz:t");
    expect(flashSigKey("Fritz T.")).toBe(sigKey("Taylor Fritz"));
  });
  it("uses the last surname token for compound surnames", () => {
    expect(flashSigKey("Van Uytvanck A.")).toBe("uytvanck:a");
    expect(flashSigKey("Van Uytvanck A.")).toBe(sigKey("Alison Van Uytvanck"));
  });
  it("splits hyphenated surnames like nameTokens", () => {
    expect(flashSigKey("Auger-Aliassime F.")).toBe("aliassime:f");
    expect(flashSigKey("Auger-Aliassime F.")).toBe(sigKey("Felix Auger-Aliassime"));
  });
  it("returns '' when it can't be keyed", () => {
    expect(flashSigKey("Fritz")).toBe("");
    expect(flashSigKey("")).toBe("");
  });
});
