import { describe, it, expect } from "vitest";
import { iso3to2, flagEmoji, flagAssetUrl } from "./flags";
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
    // exercise every mapped iso3: each must resolve to a bundled url, never the emoji fallback
    for (const iso3 of ["ESP", "FRA", "ITA", "DEU", "GER", "GBR", "USA", "SRB", "RUS", "CHE", "SUI", "AUT", "AUS", "ARG", "BRA", "CAN", "CHN", "JPN", "KAZ", "GRC", "NOR", "DNK", "DEN", "SWE", "NLD", "NED", "BEL", "POL", "CZE", "SVK", "HRV", "CRO", "BGR", "BUL", "HUN", "ROU", "PRT", "POR", "FIN", "UKR", "BLR", "GEO", "CHL", "COL", "PER", "URY", "PRY", "ECU", "BOL", "VEN", "MEX", "IND", "KOR", "TWN", "TPE", "THA", "HKG", "ISR", "TUR", "EGY", "TUN", "MAR", "ZAF", "RSA", "NZL", "MDA", "BIH", "SVN", "SLO", "EST", "LVA", "LTU", "CYP", "LUX", "MCO", "SMR", "SAU", "UZB", "LBN", "JOR"]) {
      expect(flagAssetUrl(iso3), `missing flag asset for ${iso3}`).toBeTruthy();
    }
    // and the generated module carries exactly the distinct iso2 codes (no strays)
    expect(Object.keys(FLAG_URLS).length).toBe(70);
  });
});
