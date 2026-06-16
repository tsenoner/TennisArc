// In-app Help, rendered from the single source of truth at docs/HELP.md.
//
// The doc is bundled at build time (Vite `?raw`), so the panel shows the exact bytes
// committed to the repo — app and doc can never drift, and it works fully offline.
// Each top-level "## " heading in the doc becomes one collapsible accordion section.
import { marked } from "marked";
import helpMd from "../docs/HELP.md?raw";

marked.setOptions({ gfm: true });

// marked's parse/parseInline are synchronous with the default (no async) options, but typed
// as `string | Promise<string>`. Our content is first-party and bundled — never user input —
// so a straight cast is safe here.
const md = (src: string): string => marked.parse(src) as string;
const mdInline = (src: string): string => marked.parseInline(src) as string;

// Every link in the doc is external → open in a new tab, severing the opener for safety.
const externalize = (html: string): string =>
  html.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"');

/** Strip the leading maintenance-contract HTML comment and the H1 title, then split the
 *  remaining markdown on top-level "## " headings into one accordion section each. */
function renderSections(): string {
  const body = helpMd
    .replace(/^\s*<!--[\s\S]*?-->\s*/, "") // leading maintenance-contract comment (editors only)
    .replace(/^#[^\n]*\n/, "") // H1 title — the panel supplies its own chrome
    .trim();
  return body
    .split(/\n(?=## )/)
    .map((chunk, i) => {
      const m = chunk.match(/^##\s+(.+?)\n([\s\S]*)$/);
      if (!m) return ""; // no loose preamble expected before the first "## "
      const [, title, section] = m;
      return (
        `<details class="help-sec"${i === 0 ? " open" : ""}>` +
        `<summary>${mdInline(title.trim())}</summary>` +
        `<div class="help-body">${externalize(md(section.trim()))}</div>` +
        `</details>`
      );
    })
    .join("");
}

// Built once at module load — the doc is static for the life of the bundle.
const helpSections = renderSections();

/** The Help overlay: a real modal dialog (centred card on desktop, bottom sheet on phones).
 *  Returns "" when closed so it leaves the DOM entirely. */
export function renderHelp(open: boolean): string {
  if (!open) return "";
  return (
    `<div class="help-scrim" data-action="toggle-help" aria-hidden="true"></div>` +
    `<aside class="help-sheet" role="dialog" aria-modal="true" aria-label="Help" tabindex="-1">` +
    `<div class="help-bar"><h2 class="help-title">Help</h2>` +
    `<button class="help-close" data-action="toggle-help" aria-label="Close help">✕</button></div>` +
    `<div class="help-content">${helpSections}</div>` +
    `</aside>`
  );
}
