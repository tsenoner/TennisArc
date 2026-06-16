import { describe, it, expect } from "vitest";
import { renderHelp, renderSections } from "./help";

describe("renderSections — accordion splitting is robust to editor edits", () => {
  const titles = (html: string) => [...html.matchAll(/<summary>(.*?)<\/summary>/g)].map((m) => m[1]);
  const doc = (body: string) => `# Title\n\n${body}`; // renderSections strips the leading H1

  it("splits one <details> per top-level '## ', first section open", () => {
    const html = renderSections(doc("## A\n\nalpha\n\n## B\n\nbeta"));
    expect(titles(html)).toEqual(["A", "B"]);
    expect((html.match(/<details/g) ?? []).length).toBe(2);
    expect(html).toMatch(/<details class="help-sec" open><summary>A<\/summary>/);
  });

  it("does NOT split on a '## ' line inside a fenced code block (#7)", () => {
    const html = renderSections(doc("## A\n\n```\n## not a heading\necho hi\n```\n\n## B\n\nb"));
    expect(titles(html)).toEqual(["A", "B"]);            // not ["A", "not a heading", "B"]
    expect(html).toContain("## not a heading");           // the fence content survives verbatim
  });

  it("treats a 4-space-indented ``` as an indented code block, not a fence (R3)", () => {
    // A SINGLE 4-space-indented ``` is an indented code block, never a fence. The old /^\s*/ regex
    // wrongly toggled fence-state ON here and, with no matching close, swallowed "## B" into A;
    // /^ {0,3}/ does not toggle, so B stays its own section. (This unbalanced fixture FAILS under
    // the old regex — a balanced pair would have passed either way and not pinned the fix.)
    const html = renderSections(doc("## A\n\nalpha\n\n    ```\n\n## B\n\nbeta"));
    expect(titles(html)).toEqual(["A", "B"]);
  });

  it("recognises a heading with a TAB after '##' (R5: split test matches title test)", () => {
    const html = renderSections(doc("## A\n\nalpha\n\n##\tTabbed\n\nbeta"));
    expect(titles(html)).toEqual(["A", "Tabbed"]);
  });

  it("survives CRLF line endings instead of blanking every section (R4)", () => {
    const html = renderSections("# Title\r\n\r\n## A\r\n\r\nalpha\r\n\r\n## B\r\n\r\nbeta");
    expect(titles(html)).toEqual(["A", "B"]);
    expect(html).toContain("alpha");
  });

  it("renders a heading with no body / a bare final heading instead of dropping it", () => {
    expect(titles(renderSections(doc("## A\n\n## B\n\nbeta")))).toEqual(["A", "B"]); // empty body
    expect(titles(renderSections(doc("## A\n\nalpha\n\n## B")))).toEqual(["A", "B"]); // bare final heading
  });

  it("does not eat the first section when the doc has no H1", () => {
    expect(titles(renderSections("## A\n\nalpha\n\n## B\n\nbeta"))).toEqual(["A", "B"]);
  });
});

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
