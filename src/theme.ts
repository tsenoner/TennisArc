export type Theme = "dark" | "light";

const KEY = "tennisarc-theme";

type Getter = Pick<Storage, "getItem">;
type Setter = Pick<Storage, "setItem">;

export function nextTheme(t: Theme): Theme {
  return t === "dark" ? "light" : "dark";
}

// Non-browser environments (tests) and legacy engines have no matchMedia — treat as "no
// preference", which falls through to dark below.
const systemPrefersLight = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;

export function loadTheme(
  storage: Getter = localStorage,
  prefersLight: () => boolean = systemPrefersLight,
): Theme {
  const stored = storage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored; // an explicit choice always wins
  return prefersLight() ? "light" : "dark"; // first visit: follow the system, default dark
}

export function saveTheme(t: Theme, storage: Setter = localStorage): void {
  storage.setItem(KEY, t);
}

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement): void {
  el.dataset.theme = t;
  // Browser/PWA chrome follows --bg (a static manifest theme_color can't track the toggle).
  el.ownerDocument
    ?.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", t === "light" ? "#f6f4ef" : "#0d1014");
}
