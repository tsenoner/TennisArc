import { describe, it, expect } from "vitest";
import { escapeHtml, formatDuration, renderControls, renderLegend, renderPanelFab } from "./render";
import type { SlamIndex } from "./model";

describe("formatDuration", () => {
  it("formats minutes under an hour and hours+minutes above", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(161 * 60)).toBe("2h41");
    expect(formatDuration(120 * 60)).toBe("2h00");
  });
});

describe("renderControls", () => {
  it("renders ATP/WTA, colour-dim and theme controls and marks the active ones", () => {
    const html = renderControls({ tour: "WTA", colorDim: "seed", theme: "dark" });
    expect(html).toContain('class="brand"');
    expect(html).toContain('src="/logo.svg"');
    expect(html).toContain('data-action="tour"');
    expect(html).toContain('data-tour="ATP"');
    expect(html).toContain('data-action="colordim"');
    expect(html).toContain('data-dim="time"');
    expect(html).toContain('data-action="theme"');
    expect(html).toMatch(/class="ctrl active"[^>]*data-tour="WTA"/);
    expect(html).toMatch(/class="ctrl active"[^>]*data-dim="seed"/);
  });

  it("renders the inline lens as only-wide and a closed lens dropdown as only-narrow", () => {
    const html = renderControls({ tour: "ATP", colorDim: "country", theme: "dark" });
    expect(html).toContain('class="seg lens-seg only-wide"');
    expect(html).toContain('class="dd dd-right only-narrow"');
    expect(html).toContain('data-action="toggle-menu" data-menu="lens" aria-haspopup="true" aria-expanded="false"');
    expect(html).not.toContain('role="menu"');           // closed → no popover rendered
  });

  it("opens the lens dropdown popover (with colordim buttons) when open=lens", () => {
    const html = renderControls({ tour: "ATP", colorDim: "time", theme: "dark", open: "lens" });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/<div class="dd-pop" role="menu">[\s\S]*data-action="colordim"/);
  });

  it("renders both inline (only-wide) and dropdown (only-narrow) slam switchers, dropdown closed by default", () => {
    const index: SlamIndex = {
      schemaVersion: 2, generatedAt: "t",
      slams: [{ tour: "ATP", year: 2026, slam: "wimbledon", name: "Wimbledon", surface: "Grass", status: "live", generatedAt: "t", drawSize: 128 }],
    };
    const html = renderControls({ tour: "ATP", colorDim: "time", theme: "dark", index, year: 2026, slam: "wimbledon" });
    expect(html).toContain('class="seg slam-switch only-wide"');
    expect(html).toContain('data-action="toggle-menu" data-menu="slam"');
    // the open slam dropdown still carries the same year/slam handlers
    const open = renderControls({ tour: "ATP", colorDim: "time", theme: "dark", index, year: 2026, slam: "wimbledon", open: "slam" });
    expect(open).toMatch(/dd-pop-slam[\s\S]*data-action="slam"/);
    expect(open).toMatch(/dd-pop-slam[\s\S]*data-action="year"/);
  });

  it("gives the open lens popover menu semantics — items are menuitemradio reflecting the active dim", () => {
    const html = renderControls({ tour: "ATP", colorDim: "seed", theme: "dark", open: "lens" });
    // each popover choice is a menuitemradio; the active dim is checked, the others not
    expect(html).toMatch(/role="menuitemradio" aria-checked="true" data-action="colordim" data-dim="seed"/);
    expect(html).toMatch(/role="menuitemradio" aria-checked="false" data-action="colordim" data-dim="time"/);
    // the inline (desktop) lens segment stays a plain button group — aria-pressed, NOT menu items
    expect(html).toMatch(/class="seg lens-seg only-wide"[\s\S]*aria-pressed="[^"]*" data-action="colordim"/);
    expect(html).not.toMatch(/lens-seg only-wide[^>]*>[^<]*<button[^>]*role="menuitem/);
  });

  it("gives the open slam popover menu semantics — slams are menuitemradio, year steppers are menuitem", () => {
    const index: SlamIndex = {
      schemaVersion: 2, generatedAt: "t",
      slams: [{ tour: "ATP", year: 2026, slam: "wimbledon", name: "Wimbledon", surface: "Grass", status: "live", generatedAt: "t", drawSize: 128 }],
    };
    const open = renderControls({ tour: "ATP", colorDim: "time", theme: "dark", index, year: 2026, slam: "wimbledon", open: "slam" });
    expect(open).toMatch(/data-action="slam"[^>]*role="menuitemradio" aria-checked="true"/); // active slam is checked
    expect(open).toMatch(/role="menuitem" data-action="year"/);                                // year steppers are menu items
    // the inline (only-wide) slam switcher keeps aria-current and carries no menu-item roles
    const inline = renderControls({ tour: "ATP", colorDim: "time", theme: "dark", index, year: 2026, slam: "wimbledon" });
    expect(inline).not.toContain('role="menuitem');
  });

  it("appends a GitHub issues link that opens in a new tab safely", () => {
    const html = renderControls({ tour: "ATP", colorDim: "time", theme: "dark" });
    expect(html).toContain('href="https://github.com/tsenoner/TennisArc/issues"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/issues-link[\s\S]*<\/header>/);   // it is the last child of the header
  });
});

describe("renderPanelFab", () => {
  it("names the active lens and carries the panel action", () => {
    expect(renderPanelFab("time")).toMatch(/data-action="panel"[\s\S]*Time on court/);
    expect(renderPanelFab("seed")).toContain("Seeds");
    expect(renderPanelFab("country")).toContain("Nations");
  });
  it("reflects the ELO sub-mode of the seed lens", () => {
    expect(renderPanelFab("seed", "elo")).toContain("ELO");
    expect(renderPanelFab("seed", "elo")).not.toContain(">Seeds<");
  });
});

describe("renderLegend", () => {
  it("returns a legend string for every dimension", () => {
    for (const dim of ["time", "seed", "country"] as const) {
      expect(renderLegend(dim)).toContain("legend");
    }
  });
  it("switches the seed legend wording between seed and ELO sub-modes", () => {
    expect(renderLegend("seed", "seed")).toContain("unseeded → top seed");
    expect(renderLegend("seed", "elo")).toContain("weaker → stronger (ELO)");
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters without double-encoding", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
    expect(escapeHtml("Renée O'Brien")).toBe("Renée O&#39;Brien");
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
});
