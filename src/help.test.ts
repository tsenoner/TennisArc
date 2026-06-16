import { describe, it, expect } from "vitest";
import { renderHelp } from "./help";

describe("renderHelp", () => {
  it("renders nothing when closed and a modal dialog when open", () => {
    expect(renderHelp(false)).toBe("");
    const html = renderHelp(true);
    expect(html).toContain('class="help-scrim"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // scrim and close button both dismiss via the same toggle action
    expect(html).toMatch(/help-scrim[^>]*data-action="toggle-help"/);
    expect(html).toMatch(/help-close[^>]*data-action="toggle-help"/);
  });

  it("turns docs/HELP.md into an accordion — one open section per '## ' heading", () => {
    const html = renderHelp(true);
    // sections the doc defines, rendered as <details><summary>…
    for (const title of ["Elo ratings", "Win probability", "Tennis terms", "Data &amp; credit"]) {
      expect(html).toContain(`<summary>${title}</summary>`);
    }
    // the first section is expanded by default; the doc's H1 and the contract comment are stripped
    expect(html).toMatch(/<details class="help-sec" open><summary>About<\/summary>/);
    expect(html).not.toContain("SINGLE SOURCE OF TRUTH"); // maintenance comment never reaches the UI
    expect(html).not.toContain("TennisArc — Help</"); // the H1 title is dropped (panel has its own)
  });

  it("carries the verified Elo + win-probability formulas and the ⚡ explanation", () => {
    const html = renderHelp(true);
    expect(html).toContain("250 / (matchesPlayed + 5)^0.4");
    expect(html).toContain("0.5 * overallElo + 0.5 *");
    expect(html).toContain("P(A beats B) = 1 / (1 + 10^((eloB - eloA) / 400))");
    expect(html).toContain("⚡");
  });

  it("credits the data sources and opens every external link in a new tab safely", () => {
    const html = renderHelp(true);
    expect(html).toContain("CC BY-NC-SA 4.0");
    expect(html).toContain("github.com/JeffSackmann");
    expect(html).toContain("tennisabstract.com");
    // marked output is post-processed so external links never keep the opener
    const links = html.match(/<a href="https?:\/\/[^"]+"[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
  });
});
