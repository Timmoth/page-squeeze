const body = document.body;

const savedTheme = localStorage.getItem("theme");
const systemPrefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;

if (savedTheme === "light" || (!savedTheme && systemPrefersLight)) {
  body.classList.add("light");
}

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  if (!localStorage.getItem("theme")) {
    body.classList.toggle("light", e.matches);
  }
});

document.getElementById("theme").addEventListener("click", () => {
  body.classList.toggle("light");
  localStorage.setItem("theme", body.classList.contains("light") ? "light" : "dark");
});

const statusEl = document.getElementById("status");

function sanitizeFilename(value) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
}

async function extract() {
  try {
    statusEl.textContent = "running...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("no active tab");

    const options = {
      title: document.getElementById("opt-title").checked,
      meta: document.getElementById("opt-meta").checked,
      content: document.getElementById("opt-content").checked,
      links: document.getElementById("opt-links").checked
    };

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (opts) => {
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

        function getStructuredText(root) {
  const blocks = [];

  function clean(text) {
    return text
      .replace(/\r/g, "")
      .replace(/\n{2,}/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function isHidden(el) {
    const style = getComputedStyle(el);
    return (
      style.display === "none" ||
      style.visibility === "hidden"
    );
  }

  function extractInlineText(node) {
    let out = [];

    function walk(n) {
      if (!n) return;

      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.textContent.trim();
        if (t) out.push(t);
        return;
      }

      if (n.nodeType !== Node.ELEMENT_NODE) return;

      const el = n;
      if (isHidden(el)) return;

      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) return;

      for (const child of el.childNodes) walk(child);

      if (el.shadowRoot) {
        for (const child of el.shadowRoot.childNodes) {
          walk(child);
        }
      }
    }

    walk(node);
    return clean(out.join(" "));
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;
    if (isHidden(el)) return;

    const tag = el.tagName;

    // HEADINGS
    if (/^H[1-6]$/.test(tag)) {
      const text = extractInlineText(el);
      if (text) {
        const level = Number(tag[1]);
        blocks.push(`${"#".repeat(level)} ${text}`);
      }
      return;
    }

    // PARAGRAPHS (real ones only)
    if (tag === "P") {
      const text = extractInlineText(el);
      if (text) {
        blocks.push(text);
      }
      return;
    }

    // LIST ITEMS
    if (tag === "LI") {
      const text = extractInlineText(el);
      if (text) {
        blocks.push(`- ${text}`);
      }
      return;
    }

    // PRE / CODE blocks
    if (tag === "PRE") {
      const text = el.innerText || el.textContent;
      if (text) {
        blocks.push("```\n" + text.trim() + "\n```");
      }
      return;
    }

    // Traverse children ONLY (no container extraction)
    for (const child of el.childNodes) {
      walk(child);
    }

    if (el.shadowRoot) {
      for (const child of el.shadowRoot.childNodes) {
        walk(child);
      }
    }
  }

  walk(root);

  return clean(blocks.join("\n\n"));
}

        function pickMainNode() {
          return (
            document.querySelector("main") ||
            document.querySelector("article") ||
            document.querySelector('[role="main"]') ||
            document.body
          );
        }

        function extractMeta() {
          const keep = [
            "description",
            "keywords",
            "author",
            "og:title",
            "og:description"
          ];

          const meta = {};
          for (const tag of document.querySelectorAll("meta")) {
            const key = (tag.getAttribute("name") || tag.getAttribute("property") || "").toLowerCase();
            const value = (tag.getAttribute("content") || "").trim();
            if (key && value && keep.includes(key)) {
              meta[key] = value;
            }
          }
          return meta;
        }

function extractLinks(root, maxLinks = 100) {
  const out = [];
  const seen = new Set();

  function addLink(text, href) {
    if (!href || !text) return;

    const cleanText = text.trim().replace(/\s+/g, " ");
    if (cleanText.length < 2) return;

    try {
      href = new URL(href, location.href).href;
    } catch {}

    const key = `${cleanText}||${href}`;
    if (seen.has(key)) return;
    seen.add(key);

    out.push({ text: cleanText, href });
  }

  function walk(node) {
    if (!node) return;

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;

    // 1. Standard <a> links
    if (el.tagName === "A" && el.href) {
      addLink(el.innerText || el.textContent, el.href);
    }

    // 2. role="link"
    if (el.getAttribute("role") === "link") {
      addLink(el.innerText || el.textContent, el.getAttribute("href"));
    }

    // 3. data-href (common in frameworks)
    if (el.dataset?.href) {
      addLink(el.innerText || el.textContent, el.dataset.href);
    }

    // 4. onclick fallback (very rough but useful)
    const onclick = el.getAttribute("onclick");
    if (onclick && onclick.includes("http")) {
      const match = onclick.match(/https?:\/\/[^\s'"]+/);
      if (match) {
        addLink(el.innerText || el.textContent, match[0]);
      }
    }

    // Traverse children
    for (const child of el.childNodes) {
      walk(child);
    }

    // Traverse shadow DOM
    if (el.shadowRoot) {
      for (const child of el.shadowRoot.childNodes) {
        walk(child);
      }
    }
  }

  walk(root);

  return out.slice(0, maxLinks);
}

        function buildMarkdown(title, meta, content, links) {
          const parts = [];

          if (opts.title && title) {
            parts.push("# TITLE\n" + title);
          }

          if (opts.meta && Object.keys(meta).length) {
            parts.push("\n# META");
            for (const [k, v] of Object.entries(meta)) {
              parts.push(`- **${k}**: ${v}`);
            }
          }

          if (opts.content && content) {
            parts.push("\n# CONTENT\n" + content);
          }

          if (opts.links && links.length) {
            parts.push("\n# LINKS");
            for (const l of links) {
              parts.push(`- ${l.text}: ${l.href}`);
            }
          }

          return parts.join("\n");
        }

        const main = pickMainNode();
        const title = clean(document.title || "");
        const meta = extractMeta();
        const content = getStructuredText(main);
        const links = extractLinks(document.body);

        return {
          markdown: buildMarkdown(title, meta, content, links)
        };
      },
      args: [options]
    });

    if (!result?.markdown) throw new Error("no output");

    return result.markdown;
  } catch (err) {
    statusEl.textContent = `err: ${err.message}`;
    throw err;
  }
}

document.getElementById("download").addEventListener("click", async () => {
  try {
    const markdown = await extract();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    const filenameBase = sanitizeFilename(url.hostname + url.pathname) || "page";

    const blob = new Blob([markdown], { type: "text/markdown" });
    const downloadUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: downloadUrl,
      filename: `${filenameBase}.md`,
      saveAs: true
    });

    statusEl.textContent = "download started";
  } catch {}
});

document.getElementById("copy").addEventListener("click", async () => {
  try {
    const markdown = await extract();

    await navigator.clipboard.writeText(markdown);
    statusEl.textContent = "copied";
  } catch (err) {
    statusEl.textContent = `err: ${err.message}`;
  }
});