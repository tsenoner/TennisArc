import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePlayersCsv, applyBirthdates } from "./players";
import type { Player } from "../src/model";

const csv = readFileSync(resolve(__dirname, "fixtures/players-sample.csv"), "utf8");
const player = (name: string): Player => ({
  id: name, name, country: "", seed: null, entry: null, ranking: null, sofaSlug: null, elo: null, birthdate: null,
});

describe("parsePlayersCsv", () => {
  const map = parsePlayersCsv(csv);
  it("keys DOB by full normalized name (ISO) and resolves namesakes", () => {
    expect(map.get("janniksinner")).toBe("2001-08-16");
    expect(map.get("martinsinner")).toBe("1968-02-07");
    expect(map.get("carlosalcaraz")).toBe("2003-05-05");
  });
  it("skips rows with no dob", () => {
    expect(map.get("nodobplayer")).toBeUndefined();
  });
});

describe("applyBirthdates", () => {
  it("sets birthdate on matched players, leaves others null", () => {
    const players: Record<string, Player> = { a: player("Jannik Sinner"), b: player("Nobody Here") };
    const res = applyBirthdates(players, parsePlayersCsv(csv));
    expect(players.a.birthdate).toBe("2001-08-16");
    expect(players.b.birthdate).toBeNull();
    expect(res.matched).toBe(1);
  });
});
