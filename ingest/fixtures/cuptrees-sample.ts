// Trimmed to SofaScore's real cuptrees shape. 4 entrants → SF round + Final.
export const cuptreesSample = {
  cupTrees: [
    {
      rounds: [
        {
          description: "Semifinal",
          blocks: [
            {
              finished: true, eventInProgress: false, order: 1, result: "2:0",
              homeTeamScore: "2", awayTeamScore: "0", events: [9001], blockId: 1,
              participants: [
                { order: 1, winner: true, teamSeed: "1", team: { id: 100, name: "Aaa Aaa", slug: "aaa-aaa", ranking: 1, nameCode: "AAA" } },
                { order: 2, winner: false, teamSeed: "WC", team: { id: 101, name: "Bbb Bbb", slug: "bbb-bbb", ranking: 80, nameCode: "BBB" } },
              ],
            },
            {
              finished: false, eventInProgress: true, order: 2, result: "1:1",
              homeTeamScore: "1", awayTeamScore: "1", events: [9002], blockId: 2,
              participants: [
                { order: 1, winner: false, teamSeed: "3", team: { id: 102, name: "Ccc Ccc", slug: "ccc-ccc", ranking: 3, nameCode: "CCC" } },
                { order: 2, winner: false, teamSeed: "Q", team: { id: 103, name: "Ddd Ddd", slug: "ddd-ddd", ranking: 120, nameCode: "DDD" } },
              ],
            },
          ],
        },
        {
          description: "Final",
          blocks: [
            {
              finished: false, eventInProgress: false, order: 1, result: "0:0",
              homeTeamScore: "0", awayTeamScore: "0", events: [9003], blockId: 3,
              participants: [
                { order: 1, winner: false, teamSeed: "1", team: { id: 100, name: "Aaa Aaa", slug: "aaa-aaa", ranking: 1, nameCode: "AAA" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};
