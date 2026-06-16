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

/** Split the body on top-level "## " headings WITHOUT splitting inside fenced code blocks:
 *  a "## " line inside a ``` / ~~~ fence is code, not a new section. The accordion is
 *  regenerated from docs/HELP.md, whose maintenance contract invites editors to add content
 *  (including code samples), so a naive split-on-"## " would silently corrupt the panel the
 *  day someone writes a shell comment like "## build the board" inside a fence. */
function splitTopLevelSections(body: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    // A fence opener may be indented at most 3 spaces (CommonMark); 4+ spaces is an INDENTED code
    // block, NOT a fence, so it must NOT toggle — otherwise an unbalanced indented ``` swallows the
    // rest of the doc into one section. The "##" test matches a heading after a space OR tab (\s),
    // staying in lock-step with the per-chunk title regex below (which uses \s+).
    if (/^ {0,3}(```|~~~)/.test(line)) inFence = !inFence; // fences are balanced → toggle on each delimiter
    if (!inFence && /^##\s/.test(line) && cur.length) { out.push(cur.join("\n")); cur = []; }
    cur.push(line);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

/** Strip the leading maintenance-contract HTML comment and the H1 title, then split the
 *  remaining markdown on top-level "## " headings into one accordion section each. Exported
 *  (pure: markdown in, accordion HTML out) so the splitting/normalising edge cases are unit-
 *  testable without the bundled doc; renderHelp feeds it the real docs/HELP.md. */
export function renderSections(src: string): string {
  const body = src
    .replace(/\r\n?/g, "\n") // normalise CRLF / lone CR → LF: the title regex's `(.+?)\n` can't span a
                             // stray \r (JS `.` excludes it), and a CRLF doc would blank EVERY section
    .replace(/^\s*<!--[\s\S]*?-->\s*/, "") // leading maintenance-contract comment (editors only)
    .replace(/^#(?!#)[^\n]*\n/, "") // H1 title — the panel supplies its own chrome. (?!#) so a doc that
                                    // ever opens straight on "## " (no H1) keeps its first section.
    .trim();
  return splitTopLevelSections(body)
    .map((chunk, i) => {
      // Body is optional: a heading with no body, or a bare "## Title" as the doc's final line
      // (its trailing \n trimmed), still renders as an (empty) section instead of vanishing.
      const m = chunk.match(/^##\s+(.+?)(?:\n([\s\S]*))?$/);
      if (!m) return ""; // no loose preamble expected before the first "## "
      const [, title, section = ""] = m;
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
const helpSections = renderSections(helpMd);

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
