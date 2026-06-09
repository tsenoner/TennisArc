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
