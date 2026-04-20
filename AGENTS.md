# page-squeeze — Agent Notes

## Repo structure

- `extension/manifest.json` — Manifest V3 entrypoint
- `extension/popup.html` — Popup UI (inline CSS, no framework)
- `extension/popup.js` — All logic (popup handler + injected content script)

No build tooling, no package manager, no tests, no lint. Just raw files.

## Architecture

The core extraction logic runs in the **target page's context**, not the popup.

`popup.js` defines functions inside the callback passed to `chrome.scripting.executeScript` (line 44–313). These are injected into the active tab:

- `getStructuredText(root)` — walks the DOM tree, extracts headings, paragraphs, lists, pre/code blocks into markdown
- `extractLinks(root)` — collects links from `<a>`, `role="link"`, `data-href`, and onclick URLs
- `extractMeta()` — pulls meta tags matching `[name|property]` in `[description, keywords, author, og:title, og:description]`
- `buildMarkdown(title, meta, content, links)` — assembles the final output

The popup itself only handles UI (theme toggle, checkboxes, status text) and triggers extraction via `chrome.downloads.download` or `navigator.clipboard.writeText`.

## Testing

Load unpacked in Chrome dev mode:

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click **Load unpacked** → select `extension/`

There are no test commands or scripts.

## Key constraints

- Permissions needed: `activeTab`, `scripting`, `downloads`, `clipboardWrite`
- Content script injection uses `allFrames: true` (line 45)
- Shadow DOM is traversed in both `getStructuredText` and `extractLinks`
- Link deduplication uses a `Set` keyed on `text||href`
- Max 100 links returned
- Filename sanitized to 180 chars, alphanumeric + `_`, `.`, `-`
- Theme preference stored in `localStorage` as `"theme"` (light/dark)
