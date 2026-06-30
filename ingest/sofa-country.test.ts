import { describe, it, expect } from "vitest";
import { alpha3Of } from "./sofa-country";

describe("alpha3Of", () => {
  it("pulls the nested ISO alpha-3 code", () => {
    expect(alpha3Of({ country: { alpha3: "USA" } })).toBe("USA");
  });

  it("returns null when the team, country, or code is absent", () => {
    expect(alpha3Of(undefined)).toBeNull();
    expect(alpha3Of({})).toBeNull();
    expect(alpha3Of({ country: {} })).toBeNull();
  });

  it("maps a present-but-empty code to null (honours the `string | null` contract)", () => {
    expect(alpha3Of({ country: { alpha3: "" } })).toBeNull();
  });
});
