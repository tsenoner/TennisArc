import { describe, it, expect } from "vitest";
import { nextTheme, loadTheme, saveTheme, applyTheme } from "./theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("theme", () => {
  it("toggles between dark and light", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });

  it("defaults to dark (absent a system light preference) and round-trips through storage", () => {
    expect(loadTheme(fakeStorage())).toBe("dark");
    const s = fakeStorage();
    saveTheme("light", s);
    expect(loadTheme(s)).toBe("light");
  });

  it("first visit follows the system preference; a stored choice always wins", () => {
    expect(loadTheme(fakeStorage(), () => true)).toBe("light");
    expect(loadTheme(fakeStorage(), () => false)).toBe("dark");
    expect(loadTheme(fakeStorage({ "tennisarc-theme": "dark" }), () => true)).toBe("dark");
    expect(loadTheme(fakeStorage({ "tennisarc-theme": "light" }), () => false)).toBe("light");
  });

  it("applies the theme as a data attribute on the given element", () => {
    const el = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyTheme("light", el);
    expect(el.dataset.theme).toBe("light");
  });
});
