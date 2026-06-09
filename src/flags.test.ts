import { describe, it, expect } from "vitest";
import { iso3to2, flagEmoji } from "./flags";

describe("iso3to2", () => {
  it("maps ISO-3 (and common IOC variants) to ISO-2", () => {
    expect(iso3to2("ESP")).toBe("ES");
    expect(iso3to2("DEU")).toBe("DE");
    expect(iso3to2("GBR")).toBe("GB");
    expect(iso3to2("CHE")).toBe("CH");
    expect(iso3to2("SUI")).toBe("CH"); // IOC alias
    expect(iso3to2("zzz")).toBeNull();
  });
});

describe("flagEmoji", () => {
  it("produces the regional-indicator flag, or a white flag fallback", () => {
    expect(flagEmoji("ESP")).toBe("🇪🇸");
    expect(flagEmoji("USA")).toBe("🇺🇸");
    expect(flagEmoji("???")).toBe("🏳");
  });
});
