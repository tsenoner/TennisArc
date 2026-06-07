export type Theme = "dark" | "light";

const KEY = "tennisarc-theme";

type Getter = Pick<Storage, "getItem">;
type Setter = Pick<Storage, "setItem">;

export function nextTheme(t: Theme): Theme {
  return t === "dark" ? "light" : "dark";
}

export function loadTheme(storage: Getter = localStorage): Theme {
  return storage.getItem(KEY) === "light" ? "light" : "dark"; // default dark
}

export function saveTheme(t: Theme, storage: Setter = localStorage): void {
  storage.setItem(KEY, t);
}

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement): void {
  el.dataset.theme = t;
}
