// Verbatim df_mhs (current-game) feed shape, captured live 2026-07-10 (Sinner–Djokovic Wimbledon
// SF, between games). Shared by ingest/flashscore.test.ts and api/pbp.test.ts so both exercise the
// same real feed shape rather than an ad-hoc string; each derives its own .replace() variants locally.
export const BETWEEN_GAMES =
  "TS÷GR¬PT÷TI¬PV÷notab¬TS÷TA¬TS÷HD¬PT÷VA¬PV÷Current game¬TE÷HD¬TS÷RWP¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷0¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷0¬TE÷SC¬" +
  "TE÷RWP¬TE÷TA¬TE÷GR¬A1÷559e897e9099399799bb8fe726208ada¬~";

// Verbatim df_mhs feed captured live 2026-07-11 (Muchova–Noskova Wimbledon FINAL, mid-game after
// several deuces). The IN-PLAY shape is the current game's full POINT PROGRESSION in chronological
// order — pair after pair (0-15, 0-30, 0-40, 15-40, 30-40, 40-40, 40-A, 40-40) — interleaved with
// `TS÷TXS¬PT÷VA¬PV÷BB/SB` marker rows (Flashscore's own break-ball / set-ball flags) and `~`-glued
// block starts ("¬~TS÷…"). The CURRENT score is the LAST pair (here 40-40), not the first.
export const IN_PLAY =
  "TS÷GR¬PT÷TI¬PV÷notab¬TS÷TA¬TS÷HD¬PT÷VA¬PV÷Current game¬TE÷HD¬TS÷RWP¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷0¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷15¬TE÷SC¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷0¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷30¬TE÷SC¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷0¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷40¬TE÷SC¬" +
  "TS÷TXS¬PT÷VA¬PV÷BB¬TE÷TXS¬~TS÷TXS¬PT÷VA¬PV÷SB¬TE÷TXS¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷15¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷40¬TE÷SC¬" +
  "TS÷TXS¬PT÷VA¬PV÷BB¬TE÷TXS¬TS÷TXS¬PT÷VA¬PV÷SB¬TE÷TXS¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷30¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷40¬TE÷SC¬" +
  "TS÷TXS¬PT÷VA¬PV÷BB¬TE÷TXS¬TS÷TXS¬PT÷VA¬PV÷SB¬TE÷TXS¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷40¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷40¬TE÷SC¬" +
  "~TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷40¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷A¬TE÷SC¬" +
  "TS÷TXS¬PT÷VA¬PV÷BB¬TE÷TXS¬TS÷TXS¬PT÷VA¬PV÷SB¬TE÷TXS¬" +
  "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷40¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷40¬TE÷SC¬" +
  "TE÷RWP¬TE÷TA¬TE÷GR¬A1÷0dac30d7156a8788ee191f983f46ffab¬~";
