import { describe, it, expect } from "vitest";
import { SLAMS, activeSlam, drawDueAt, eventWindow, slamConfig } from "./config";

const SLAM_KEYS = Object.keys(SLAMS);
const DAY = 86_400_000;
/** Noon UTC on a month-day of `year` — mid-day so a boundary can never be a rounding artefact. */
const at = (year: number, md: string): Date => new Date(`${year}-${md}T12:00:00.000Z`);
/** `eventWindow` for a key that is definitely in SLAMS — its nullable contract is tested on its own
 *  below, and asserting it away at every other call site only hides what the test is about. */
const win = (slam: string, year: number): { from: number; to: number } => eventWindow(slam, year)!;

// Every `activeSlam` call below passes an explicit override. The parameter defaults to
// `process.env.SLAM`, so omitting it would let a developer with SLAM exported in their shell
// silently rewrite each expectation. `""` is falsy, i.e. "no override".
const OFF = "";

describe("eventWindow", () => {
  it("reparametrizes the configured month-day onto an arbitrary year", () => {
    expect(win("roland-garros", 2021)).toEqual({ from: Date.UTC(2021, 4, 18), to: Date.UTC(2021, 5, 16) });
    expect(win("us-open", 2020)).toEqual({ from: Date.UTC(2020, 7, 20), to: Date.UTC(2020, 8, 17) });
  });
  it("returns null for an unknown slam", () => {
    expect(eventWindow("not-a-slam", 2026)).toBeNull();
  });
  it("keeps every window inside one calendar year — the invariant activeSlam relies on", () => {
    // A window that wrapped New Year would make the start year differ from the edition year, so a
    // snapshot would be written under the wrong year and the same-season scan below would miss it.
    for (const year of [2019, 2027, 2028, 2031]) {
      for (const slam of SLAM_KEYS) {
        const w = win(slam, year);
        expect(w.from).toBeLessThan(w.to);
        expect(new Date(w.from).getUTCFullYear()).toBe(year);
        expect(new Date(w.to - 1).getUTCFullYear()).toBe(year);
      }
    }
  });
  it("never overlaps two slams — at most one window can contain an instant", () => {
    for (let year = 2009; year <= 2040; year++) {
      const ws = SLAM_KEYS.map((s) => win(s, year)).sort((a, b) => a.from - b.from);
      for (let i = 1; i < ws.length; i++) expect(ws[i - 1]!.to).toBeLessThanOrEqual(ws[i]!.from);
    }
  });
  it("round-trips every configured month-day through Date.UTC, leap year included", () => {
    // Date.UTC silently rolls an out-of-range month-day (Feb 29 becomes Mar 1 three years in four,
    // month 13 becomes next January), so a typo in SLAMS would shift a window instead of failing.
    for (const cfg of Object.values(SLAMS)) {
      for (const md of [cfg.from, cfg.to]) {
        for (const year of [2027, 2028]) {
          const d = new Date(Date.UTC(year, md.month - 1, md.day));
          expect([d.getUTCMonth() + 1, d.getUTCDate()]).toEqual([md.month, md.day]);
        }
      }
    }
  });
});

describe("SLAMS carries no season (issue #208)", () => {
  it("pins no season to a slam, in either shape the regression took", () => {
    // The regression itself: `year: 2026` on every row and ISO dates parsed with Date.parse, so no
    // window opened from 2027-01-01 on while the refresh reported success every cycle. The MonthDay
    // type makes both a compile error today; this asserts the same of the exported value, so it
    // still fires the day MonthDay is loosened back to a date-shaped string.
    for (const [key, t] of Object.entries(SLAMS)) {
      expect(t, key).not.toHaveProperty("year");
      for (const md of [t.from, t.to]) {
        expect(md, key).toEqual({ month: expect.any(Number), day: expect.any(Number) });
      }
    }
  });
});

describe("activeSlam", () => {
  it("names the edition in progress in a year the config was never edited for", () => {
    // 2027 is the deadline in issue #208 (the AO 2027 draw); 2031 is long after anyone remembers.
    for (const year of [2027, 2031]) {
      expect(activeSlam(at(year, "01-20"), OFF)).toEqual({ slam: "australian-open", year });
      expect(activeSlam(at(year, "05-25"), OFF)).toEqual({ slam: "roland-garros", year });
      expect(activeSlam(at(year, "06-30"), OFF)).toEqual({ slam: "wimbledon", year });
      expect(activeSlam(at(year, "09-01"), OFF)).toEqual({ slam: "us-open", year });
    }
  });

  it("returns null between Slams — nothing to refresh, data won't change", () => {
    for (const year of [2026, 2027, 2031]) {
      for (const md of ["01-01", "03-01", "06-20", "08-01", "12-25"]) {
        expect(activeSlam(at(year, md), OFF)).toBeNull();
      }
    }
  });

  it("is half-open: the opening instant is in, the closing instant is out", () => {
    const w = win("wimbledon", 2029);
    expect(activeSlam(new Date(w.from - 1), OFF)).toBeNull();
    expect(activeSlam(new Date(w.from), OFF)).toEqual({ slam: "wimbledon", year: 2029 });
    expect(activeSlam(new Date(w.to - 1), OFF)).toEqual({ slam: "wimbledon", year: 2029 });
    expect(activeSlam(new Date(w.to), OFF)).toBeNull();
  });

  it("dates every match to the window it matched, not just to `now`", () => {
    for (const year of [2027, 2031]) {
      for (const slam of SLAM_KEYS) {
        const w = win(slam, year);
        for (const t of [w.from, Math.floor((w.from + w.to) / 2), w.to - 1]) {
          expect(activeSlam(new Date(t), OFF)).toEqual({ slam, year });
        }
      }
    }
  });

  it("honours a valid SLAM override out of window, stamped with now's season", () => {
    expect(activeSlam(at(2031, "03-01"), "wimbledon")).toEqual({ slam: "wimbledon", year: 2031 });
  });
  it("ignores an override that isn't a slam, including an inherited property name", () => {
    expect(activeSlam(at(2027, "05-25"), "nonsense")).toEqual({ slam: "roland-garros", year: 2027 });
    expect(activeSlam(at(2027, "03-01"), "nonsense")).toBeNull();
    expect(activeSlam(at(2027, "03-01"), "toString")).toBeNull(); // `in SLAMS` would have said yes
  });
});

describe("the windows cover the real editions", () => {
  // Main-draw start and men's final, from Jeff Sackmann's tourney_date per slam (2009-2026), with
  // the Sunday-start editions corrected to their real first day. These are the dates the templates
  // in SLAMS are sized against; nobody re-tunes them per season now, so a change that clipped an
  // edition would otherwise only show up as a bracket frozen at the semis for a year.
  const REAL: Record<string, [number, string, string][]> = {
    "australian-open": [
      [2013, "01-14", "01-27"], [2014, "01-13", "01-26"], [2019, "01-14", "01-27"],
      [2020, "01-20", "02-02"], [2024, "01-14", "01-28"], [2025, "01-12", "01-26"],
      [2026, "01-18", "02-01"],
    ],
    "roland-garros": [
      [2012, "05-27", "06-11"], [2017, "05-28", "06-11"], [2019, "05-26", "06-09"],
      [2021, "05-30", "06-13"], [2023, "05-28", "06-11"], [2024, "05-26", "06-09"],
      [2025, "05-25", "06-08"], [2026, "05-24", "06-07"],
    ],
    wimbledon: [
      [2015, "06-29", "07-12"], [2017, "07-03", "07-16"], [2019, "07-01", "07-14"],
      [2023, "07-03", "07-16"], [2024, "07-01", "07-14"], [2025, "06-30", "07-13"],
      [2026, "06-29", "07-12"],
    ],
    "us-open": [
      [2009, "08-31", "09-14"], [2019, "08-26", "09-08"], [2024, "08-26", "09-08"],
      [2025, "08-24", "09-07"], [2026, "08-30", "09-13"],
    ],
  };

  it("opens before the first ball and closes after the final, with at least two days of slack", () => {
    for (const [slam, editions] of Object.entries(REAL)) {
      for (const [year, start, final] of editions) {
        const w = win(slam, year);
        const day = (md: string) => at(year, md).getTime() - 12 * 3600_000; // UTC midnight of that day
        expect.soft(day(start) - w.from, `${slam} ${year} opens too late`).toBeGreaterThanOrEqual(2 * DAY);
        // The final's own day must be fully covered, hence the extra day before the slack.
        expect.soft(w.to - day(final), `${slam} ${year} closes too early`).toBeGreaterThanOrEqual(3 * DAY);
      }
    }
  });

  it("puts drawBy after every observed start, so no real edition is ever called overdue early", () => {
    // drawBy is what lets a wide `from` be safe: before it an absent season or an empty bracket is
    // the lead-in and the cycle exits 0, after it the same state fails the ping. Set it too early
    // and a late-starting edition cries wolf every season; too late and the blind spot grows back.
    for (const [slam, editions] of Object.entries(REAL)) {
      for (const [year, start] of editions) {
        const due = drawDueAt(slamConfig(slam, year));
        const day = (md: string) => at(year, md).getTime() - 12 * 3600_000; // UTC midnight of that day
        // Two clear days after the first ball, so a draw that lands late still beats the deadline.
        expect.soft(due - day(start), `${slam} ${year} drawBy is too early`).toBeGreaterThanOrEqual(2 * DAY);
        // And inside the window it belongs to — a deadline past `to` could never fire.
        expect.soft(due, `${slam} ${year} drawBy outside its window`).toBeGreaterThan(win(slam, year).from);
        expect.soft(due, `${slam} ${year} drawBy outside its window`).toBeLessThan(win(slam, year).to);
      }
    }
  });

  it("cannot hold the COVID editions or the pre-2015 Wimbledon calendar — out of reach by design", () => {
    // The editions deliberately left out of REAL above, asserted rather than silently omitted, so
    // the table can't quietly grow to exclude whatever a future edit breaks.
    expect(Date.UTC(2021, 1, 8)).toBeGreaterThan(win("australian-open", 2021).to); // AO played in February
    expect(Date.UTC(2020, 8, 27)).toBeGreaterThan(win("roland-garros", 2020).to);  // RG played in September
    // Wimbledon ran a week earlier until 2015 (2011 started 06-20); covering that dead rule would
    // cost a week of pre-draw cycles every year for a calendar that no longer exists.
    expect(Date.UTC(2011, 5, 20)).toBeLessThan(win("wimbledon", 2011).from);
  });
});

describe("slamConfig", () => {
  it("binds a season-free template to the edition being ingested", () => {
    expect(slamConfig("us-open", 2031)).toMatchObject({
      slam: "us-open", name: "US Open", surface: "Hard", year: 2031,
      unitournament: { ATP: 2449, WTA: 2601 },
    });
  });
  it("throws on an unknown slam instead of minting an object of undefineds", () => {
    expect(() => slamConfig("not-a-slam", 2031)).toThrow(/unknown slam/);
  });
});
