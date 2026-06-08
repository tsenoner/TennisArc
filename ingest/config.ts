import type { Tour } from "../src/model";

export interface SlamConfig {
  slam: string; name: string; surface: string; year: number;
  unitournament: Record<Tour, number>; // SofaScore uniqueTournament ids
}

// The target Slam to ingest. Update `current` to switch tournaments (season ids auto-resolve).
export const SLAMS: Record<string, SlamConfig> = {
  "roland-garros": { slam: "roland-garros", name: "Roland Garros", surface: "Clay", year: 2026, unitournament: { ATP: 2480, WTA: 2577 } },
  wimbledon:       { slam: "wimbledon",     name: "Wimbledon",     surface: "Grass", year: 2026, unitournament: { ATP: 2361, WTA: 2600 } },
  "us-open":       { slam: "us-open",       name: "US Open",       surface: "Hard",  year: 2026, unitournament: { ATP: 2449, WTA: 2547 } },
  "australian-open": { slam: "australian-open", name: "Australian Open", surface: "Hard", year: 2026, unitournament: { ATP: 2363, WTA: 2521 } },
};

export const CURRENT_SLAM = "roland-garros";
export const DRAW_SIZE = 128;
