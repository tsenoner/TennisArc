export const eventSample = {
  customId: "vGHbscHHb", slug: "clement-tabur-jannik-sinner", startTimestamp: 1779820200,
  status: { code: 100, description: "Ended", type: "finished" }, winnerCode: 1,
  time: { period1: 1822, period2: 2463, period3: 3450 },
  homeTeam: { country: { alpha3: "ITA" } },
  awayTeam: { country: { alpha3: "FRA" } },
  homeScore: { period1: 6, period2: 6, period3: 6 },
  awayScore: { period1: 1, period2: 3, period3: 4 },
};

export const statsSample = {
  statistics: [
    { period: "ALL", groups: [
      { groupName: "Service", statisticsItems: [
        { key: "aces", name: "Aces", home: "8", away: "2", homeValue: 8, awayValue: 2 },
        { key: "doubleFaults", name: "Double faults", home: "1", away: "2", homeValue: 1, awayValue: 2 },
        { key: "firstServe", name: "First serve", home: "61/96 (64%)", away: "70/110 (64%)", homeValue: 64, awayValue: 64 },
      ] },
      { groupName: "Return", statisticsItems: [
        { key: "breakPointsConverted", name: "Break points converted", home: "4/9", away: "0/1", homeValue: 4, awayValue: 0 },
      ] },
    ] },
  ],
};

export const liveEventSample = {
  customId: "LIVE123", slug: "x-vs-y", startTimestamp: 1780905934,
  status: { code: 8, description: "1st set", type: "inprogress" }, winnerCode: 0,
  time: {},
  homeTeam: { country: { alpha3: "GER" } }, awayTeam: { country: { alpha3: "CZE" } },
  homeScore: { period1: 4 }, awayScore: { period1: 4 },
};
