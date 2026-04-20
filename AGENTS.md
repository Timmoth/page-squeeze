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

## Image gallery

Toggle `opt-images` checkbox → injected script collects `<img>` elements from target page, filtering by size (≥50px), visibility, and deduplication. Thumbnails render as a 3-column grid in the popup. Clicking a thumbnail opens a fullscreen overlay with preview + format selector (Original / JPEG / PNG). Format conversion uses an offscreen canvas (max 1920px width, JPEG quality 0.92).

**CORS caveat:** Cross-origin images may taint the canvas. Conversion silently falls back to downloading the original. SVG images skip conversion entirely. Both `fetch` and `new Image()` use `crossOrigin = "anonymous"` as best-effort; if the server doesn't send CORS headers, fallback applies.

## Key constraints

- Permissions needed: `activeTab`, `scripting`, `downloads`, `clipboardWrite`
- Popup height: `default_height: 200`, `max_height: 600` (manifest). Adjusted dynamically via `chrome.action.setPopupHeight` with body.scrollHeight fallback
- Content script injection uses `allFrames: true` (line 45)
- Shadow DOM is traversed in both `getStructuredText` and `extractLinks`
- Link deduplication uses a `Set` keyed on `text||href`
- Max 100 links returned
- Filename sanitized to 180 chars, alphanumeric + `_`, `.`, `-`
- Theme preference stored in `localStorage` as `"theme"` (light/dark)
