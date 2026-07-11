// Verbatim df_mhs (current-game) feed shape, captured live 2026-07-10 (Sinner–Djokovic Wimbledon
// SF, between games). Shared by ingest/flashscore.test.ts and api/pbp.test.ts so both exercise the
// same real feed shape rather than an ad-hoc string; each derives its own .replace() variants locally.
export const BETWEEN_GAMES =
  "TS÷GR¬PT÷TI¬PV÷notab¬TS÷TA¬TS÷HD¬PT÷VA¬PV÷Current game¬TE÷HD¬TS÷RWP¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷0¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷0¬TE÷SC¬" +
  "TE÷RWP¬TE÷TA¬TE÷GR¬A1÷559e897e9099399799bb8fe726208ada¬~";
