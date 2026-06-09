import { describe, it, expect } from "vitest";
import { normalizeName } from "./elo";

describe("normalizeName", () => {
  it("strips diacritics, case, spaces and punctuation", () => {
    expect(normalizeName("Jannik Sinner")).toBe("janniksinner");
    expect(normalizeName("Juan Manuel Cerúndolo")).toBe("juanmanuelcerundolo");
    expect(normalizeName("Félix Auger-Aliassime")).toBe("felixaugeraliassime");
    expect(normalizeName("Jakub Menšík")).toBe("jakubmensik");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEloTable } from "./elo";

describe("parseEloTable", () => {
  const html = readFileSync(resolve(__dirname, "fixtures/elo-sample.html"), "utf8");
  const map = parseEloTable(html);

  it("parses overall + surface ELO and age, keyed by normalized name", () => {
    const sinner = map.get("janniksinner");
    expect(sinner).toMatchObject({
      name: "Jannik Sinner", ageYears: 24.7,
      elo: { overall: 2319.8, hard: 2263.2, clay: 2215.7, grass: 2088.3 },
    });
  });

  it("represents missing surface ratings as null", () => {
    const f = map.get("joaofonseca");
    expect(f?.elo).toEqual({ overall: 1854.0, hard: 1800.0, clay: null, grass: null });
  });
});
