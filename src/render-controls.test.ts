import { describe, it, expect } from "vitest";
import { escapeHtml, formatDuration, renderControls, renderLegend } from "./render";

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
});

describe("renderLegend", () => {
  it("returns a legend string for every dimension", () => {
    for (const dim of ["time", "seed", "country"] as const) {
      expect(renderLegend(dim)).toContain("legend");
    }
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters without double-encoding", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
    expect(escapeHtml("Renée O'Brien")).toBe("Renée O&#39;Brien");
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
});
