// Convert the committed legacy seed (public/data/{atp,wta}.json, schemaVersion 1) into the
// multi-slam layout the app now reads: v2 per-slam files + index.json. This is a LOCAL-DEV
// stopgap so the app renders without a live ingest — players get elo:null (real surface ELO
// arrives when `pnpm ingest` runs from a residential IP). Safe to re-run; overwrites outputs.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(process.cwd(), "public/data");
const tours = ["atp", "wta"];
const entries = [];

for (const tour of tours) {
  const snap = JSON.parse(readFileSync(resolve(DIR, `${tour}.json`), "utf8"));
  snap.schemaVersion = 2;
  for (const p of Object.values(snap.players)) if (p.elo === undefined) p.elo = null;
  const { slam, year, name, surface, drawSize } = snap.tournament;
  const file = `${tour}-${year}-${slam}.json`;
  writeFileSync(resolve(DIR, file), JSON.stringify(snap));
  entries.push({
    tour: snap.tour, year, slam, name, surface,
    status: "complete", generatedAt: snap.generatedAt || new Date().toISOString(), drawSize,
  });
  console.log(`wrote ${file}`);
}

entries.sort((a, b) => b.year - a.year || a.slam.localeCompare(b.slam) || a.tour.localeCompare(b.tour));
writeFileSync(
  resolve(DIR, "index.json"),
  JSON.stringify({ schemaVersion: 2, generatedAt: new Date().toISOString(), slams: entries }),
);
console.log(`wrote index.json (${entries.length} slams)`);
