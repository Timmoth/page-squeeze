(() => {
  function clean(text) {
    return text
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function absoluteUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return href;
    }
  }

  function removeOverlays() {
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[data-testid*="cookie"]',
      '[id*="cookie"]',
      '[class*="cookie"]',
      '[id*="consent"]',
      '[class*="consent"]',
      '[id*="modal"]',
      '[class*="modal"]'
    ];

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        el.remove();
      }
    }

    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const style = window.getComputedStyle(el);
      const z = parseInt(style.zIndex || "0", 10);

      const isLikelyOverlay =
        style.position === "fixed" ||
        style.position === "sticky" ||
        z >= 1000;

      const rect = el.getBoundingClientRect();
      const coversLargeArea =
        rect.width > window.innerWidth * 0.35 &&
        rect.height > window.innerHeight * 0.15;

      if (isLikelyOverlay && coversLargeArea) {
        el.remove();
      }
    }
  }

  function pickMainNode() {
    const candidates = [
      document.querySelector("main"),
      document.querySelector("article"),
      document.querySelector('[role="main"]'),
      document.querySelector("#content"),
      document.querySelector(".content"),
      document.body
    ].filter(Boolean);

    let bestNode = candidates[0] || document.body;
    let bestScore = -1;

    for (const node of candidates) {
      const text = clean(node.innerText || "");
      const links = node.querySelectorAll("a[href]").length;
      const score = text.length - links * 20;

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    return bestNode;
  }

  function extractMeta() {
    const keep = [
      "description",
      "keywords",
      "author",
      "og:title",
      "og:description",
      "article:published_time",
      "article:modified_time"
    ];

    const meta = {};
    for (const tag of document.querySelectorAll("meta")) {
      const key = (tag.getAttribute("name") || tag.getAttribute("property") || "").toLowerCase().trim();
      const value = (tag.getAttribute("content") || "").trim();
      if (key && value && keep.includes(key)) {
        meta[key] = value;
      }
    }
    return meta;
  }

  function extractLinks(root, maxLinks = 50) {
    const out = [];
    const seen = new Set();

    for (const a of root.querySelectorAll("a[href]")) {
      const text = clean(a.innerText || a.textContent || "");
      if (text.length < 3) continue;

      const href = absoluteUrl(a.getAttribute("href"));
      const key = `${text}||${href}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ text, href });
      if (out.length >= maxLinks) break;
    }

    return out;
  }

  function buildMarkdown(title, meta, content, links) {
    const opts = window.__pageSqueezeOptions || {};
    const includeTitle = opts.title !== false;
    const includeMeta = opts.meta !== false;
    const includeContent = opts.content !== false;
    const includeLinks = opts.links !== false;

    const parts = [];

    if (includeTitle && title) {
      parts.push("# TITLE");
      parts.push(title);
    }

    if (includeMeta) {
      const metaEntries = Object.entries(meta);
      if (metaEntries.length > 0) {
        parts.push("\n# META");
        for (const [k, v] of metaEntries) {
          parts.push(`- **${k}**: ${v}`);
        }
      }
    }

    if (includeContent && content) {
      parts.push("\n# CONTENT");
      parts.push(content);
    }

    if (includeLinks && links.length > 0) {
      parts.push("\n# LINKS");
      for (const link of links) {
        parts.push(`- ${link.text}: ${link.href}`);
      }
    }

    return parts.join("\n");
  }

  removeOverlays();

  const main = pickMainNode();
  const title = clean(document.title || "");
  const meta = extractMeta();
  const content = clean(main.innerText || "");
  const links = extractLinks(main);

  return {
    title,
    meta,
    content,
    links,
    markdown: buildMarkdown(title, meta, content, links)
  };
})();