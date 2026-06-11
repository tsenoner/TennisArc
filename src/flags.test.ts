import { describe, it, expect } from "vitest";
import { iso3to2, flagEmoji, flagAssetUrl, ISO3_TO_2 } from "./flags";
import { FLAG_URLS } from "./flag-assets.gen";

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

describe("flagAssetUrl", () => {
  it("resolves a bundled SVG url for mapped codes (incl. IOC aliases), null otherwise", () => {
    expect(flagAssetUrl("ESP")).toMatch(/\.svg$/);
    expect(flagAssetUrl("SUI")).toBe(flagAssetUrl("CHE")); // IOC alias → same asset
    expect(flagAssetUrl("???")).toBeNull();
  });
  it("ships an asset for EVERY code in the ISO3→2 map (regenerate with scripts/gen-flag-assets.mjs)", () => {
    // derive straight from the live map: adding a code without rerunning the generator
    // leaves it unresolved here and fails CI — no hand-maintained list to drift out of sync
    for (const iso3 of Object.keys(ISO3_TO_2)) {
      expect(flagAssetUrl(iso3), `missing flag asset for ${iso3} — run scripts/gen-flag-assets.mjs`).toBeTruthy();
    }
    // and the generated module carries exactly the map's distinct iso2 codes — no strays
    expect(Object.keys(FLAG_URLS).length).toBe(new Set(Object.values(ISO3_TO_2)).size);
  });
});
