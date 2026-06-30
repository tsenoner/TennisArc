/** Pull a SofaScore team/participant's ISO alpha-3 country (e.g. "USA"), or null — SofaScore nests
 *  it at `.country.alpha3`. The single place that knows that shape: shared by enrichMatch (event
 *  detail) and fetchTeamCountry (team endpoint) so the parse lives once. Kept dependency-free so the
 *  pure enrich transform can use it without pulling in the Playwright-backed scraper module. */
export const alpha3Of = (team?: { country?: { alpha3?: string } }): string | null =>
  team?.country?.alpha3 ?? null;
