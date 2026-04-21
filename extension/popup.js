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
           const semantic =
             document.querySelector("main") ||
             document.querySelector("article") ||
             document.querySelector('[role="main"]');

           if (semantic && (semantic.innerText || "").length > 500) {
             return semantic;
           }

           const candidates = [];
           const walker = document.createTreeWalker(
             document.body,
             NodeFilter.SHOW_ELEMENT,
             null
           );

           function getDepth(el) {
             let depth = 0;
             while (el.parentElement) {
               depth++;
               el = el.parentElement;
             }
             return depth;
           }

           while (walker.nextNode()) {
             const el = walker.currentNode;

             if (
               ["NAV", "FOOTER", "HEADER", "ASIDE", "SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)
             ) continue;

             const style = getComputedStyle(el);
             if (style.display === "none" || style.visibility === "hidden") continue;

             const text = (el.innerText || "").trim();
             const textLength = text.length;

             if (textLength < 200) continue;

             const links = el.querySelectorAll("a").length;
             const linkDensity = links / (textLength / 1000 + 1);

             const depth = getDepth(el);

             const className = (el.className || "").toLowerCase();
             const elId = (el.id || "").toLowerCase();
             const uiPenalty = [
               "nav", "menu", "footer", "sidebar", "header", "toolbar",
               "skip-link", "cookie", "banner", "modal", "dialog", "popup"
             ].some(k => className.includes(k) || elId.includes(k)) ? 1000 : 0;

             const tagBoost = ["ARTICLE", "SECTION", "MAIN", "CONTENT"].includes(el.tagName) ? 500 : 0;

             const score =
               textLength * 1.0 +
               depth * 20 -
               linkDensity * 500 -
               uiPenalty +
               tagBoost;

             candidates.push({ el, score });
           }

           if (!candidates.length) return document.body;

           candidates.sort((a, b) => b.score - a.score);

           return candidates[0].el;
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

const galleryContainer = document.getElementById("gallery-container");
const galleryGrid = document.getElementById("gallery-grid");
const galleryCount = document.getElementById("gallery-count");
const markdownSection = document.getElementById("markdown-section");
const imageSection = document.getElementById("image-section");
const ocrSection = document.getElementById("ocr-section");
const ocrStatusEl = document.getElementById("ocr-status");
const previewOverlay = document.getElementById("preview-overlay");
const previewImg = document.getElementById("preview-img");
const previewInfo = document.getElementById("preview-info");
const previewFormat = document.getElementById("preview-format");
const previewDownload = document.getElementById("preview-download");
const previewClose = document.getElementById("preview-close");

let currentImageData = null;
let imagesLoaded = false;



document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const tabName = tab.dataset.tab;
    if (tabName === "markdown") {
      markdownSection.classList.add("active");
      imageSection.classList.remove("active");
      ocrSection.classList.remove("active");
      adjustPopupHeight();
    } else if (tabName === "ocr") {
      markdownSection.classList.remove("active");
      imageSection.classList.remove("active");
      ocrSection.classList.add("active");
      showOcrStatus("drag on page to copy visible text");
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          injectOcrOverlay(tabs[0].id).catch((err) => {
            showOcrStatus(`err: ${err.message}`);
            return;
          }).then(() => {
            window.close();
          });
        }
      });
    } else {
      markdownSection.classList.remove("active");
      imageSection.classList.add("active");
      ocrSection.classList.remove("active");
      loadGallery();
      adjustPopupHeight();
    }
  });
});

function getPopupHeight() {
  body.style.height = "auto";
  void body.offsetHeight;
  const isActiveTab = markdownSection.classList.contains("active") || imageSection.classList.contains("active") || ocrSection.classList.contains("active");
  const scrollHeight = body.scrollHeight + (isActiveTab ? 0 : 0);
  return Math.min(scrollHeight, 600);
}

function adjustPopupHeight() {
  body.style.height = "auto";
  void body.offsetHeight;
  const newHeight = getPopupHeight();
  try {
    chrome.action.setPopupHeight({ height: newHeight });
  } catch {
    body.style.height = newHeight + "px";
  }
}

async function loadGallery() {
  if (imagesLoaded) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  galleryGrid.innerHTML = '<div class="gallery-loading">loading...</div>';

  try {
    const [{ result: images }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const images = [];
        const seen = new Set();

        document.querySelectorAll("img").forEach((img) => {
          if (!img.src || img.complete === false) return;
          const w = img.naturalWidth || Math.round(img.getBoundingClientRect().width);
          const h = img.naturalHeight || Math.round(img.getBoundingClientRect().height);
          if (w < 4 || h < 4) return;
          if (getComputedStyle(img).display === "none") return;

          let src = img.currentSrc || img.src;
          if (!src) return;
          try { src = new URL(src, location.href).href; } catch { return; }
          if (seen.has(src)) return;
          seen.add(src);

          images.push({
            src,
            width: w,
            height: h,
            alt: (img.alt || "").trim(),
            isSvg: src.endsWith(".svg")
          });
        });

        return images;
      }
    });

    if (!images || !images.length) {
      galleryGrid.innerHTML = '<div class="gallery-loading">no images found</div>';
      return;
    }

    galleryCount.textContent = `${images.length} image${images.length > 1 ? "s" : ""}`;
    galleryGrid.innerHTML = "";

    images.forEach((imgData, index) => {
      const thumb = document.createElement("img");
      thumb.className = "gallery-thumb";
      thumb.src = imgData.src;
      thumb.alt = imgData.alt || "";
      thumb.loading = "lazy";
      thumb.addEventListener("click", () => showPreview(imgData, index));
      galleryGrid.appendChild(thumb);
    });

    imagesLoaded = true;
  } catch (err) {
    galleryGrid.innerHTML = `<div class="gallery-loading">err: ${err.message}</div>`;
  }
}

previewOverlay.addEventListener("click", (e) => {
  if (e.target === previewOverlay) closePreview();
});

previewClose.addEventListener("click", closePreview);

previewFormat.addEventListener("change", () => {
  if (currentImageData) {
    updatePreviewFormat();
  }
});

async function updatePreviewFormat() {
  if (!currentImageData || !previewFormat.value) return;

  const format = previewFormat.value;
  const imgData = currentImageData;

  if (format === "original" || imgData.isSvg) {
    previewInfo.textContent = `${imgData.width} x ${imgData.height}px • ${imgData.alt || "untitled"} • ${format === "original" ? "original" : "svg"} • download will keep original format`;
    previewDownload.style.display = "inline-block";
    previewDownload.textContent = "Download";
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const execResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (src, targetFormat) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            const maxW = Math.min(img.naturalWidth, 1920);
            const scale = maxW / img.naturalWidth;
            canvas.width = maxW;
            canvas.height = img.naturalHeight * scale;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            try {
              const quality = targetFormat === "image/png" ? undefined : 0.92;
              const dataUrl = canvas.toDataURL(targetFormat, quality);
              const size = Math.round((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75);
              const sizeStr = size > 1048576 ? (size / 1048576).toFixed(1) + " MB" : (size / 1024).toFixed(0) + " KB";
              resolve({ success: true, dataUrl, w: canvas.width, h: canvas.height, sizeStr, format: targetFormat });
            } catch (e) {
              resolve({ success: false, error: e.message });
            }
          };
          img.onerror = () => resolve({ success: false, error: "cors" });
          img.src = src;
        });
      },
      args: [imgData.src, format]
    });

    const result = execResults?.[0]?.result;
    if (!result) throw new Error("script execution failed");

    if (result.success) {
      previewImg.src = result.dataUrl;
      previewInfo.textContent = `${result.w} x ${result.h}px • ${result.format === "image/png" ? "png" : "jpeg"} • ${result.sizeStr} • download will convert to ${result.format === "image/png" ? "png" : "jpeg"}`;
      previewDownload.style.display = "inline-block";
    } else {
      previewInfo.textContent = `conversion failed (cross-origin) • will download original ${imgData.width} x ${imgData.height}px`;
      previewDownload.style.display = "inline-block";
    }
  } catch {
    previewInfo.textContent = `conversion failed • will download original`;
    previewDownload.style.display = "inline-block";
  }
}

function showPreview(imgData, index) {
  currentImageData = imgData;
  previewFormat.value = "image/jpeg";
  previewImg.src = imgData.src;
  previewDownload.style.display = "none";
  previewInfo.textContent = "loading preview...";

  previewOverlay.classList.add("visible");
  updatePreviewFormat();
}

function closePreview() {
  previewOverlay.classList.remove("visible");
  previewImg.src = "";
  currentImageData = null;
}

previewDownload.addEventListener("click", async () => {
  if (!currentImageData) return;

  const imgData = currentImageData;
  const format = previewFormat.value;

  try {
    let filename = sanitizeFilename(imgData.src.split("/").pop().split("?")[0]) || "image";
    filename = filename || "image";
    const extMatch = filename.match(/^(.+)\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i);
    if (extMatch) {
      filename = extMatch[1];
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("no active tab");

    const execResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (src, targetFormat) => {
        function processImage(src, targetFormat) {
          return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              const canvas = document.createElement("canvas");
              const ctx = canvas.getContext("2d");
              const maxW = Math.min(img.naturalWidth, 1920);
              const scale = maxW / img.naturalWidth;
              canvas.width = maxW;
              canvas.height = img.naturalHeight * scale;
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              try {
                const quality = targetFormat === "image/png" ? undefined : 0.92;
                const dataUrl = canvas.toDataURL(targetFormat, quality);
                resolve({ dataUrl, tainted: false });
              } catch (e) {
                resolve({ tainted: true, error: e.message });
              }
            };
            img.onerror = () => {
              resolve({ tainted: true, error: "cors failed" });
            };
            img.src = src;
          });
        }

        if (targetFormat === "original") {
          return fetch(src).then(r => r.blob()).then(b => {
            const u = URL.createObjectURL(b);
            return { originalUrl: u, tainted: false };
          }).catch(e => ({ tainted: true, error: e.message }));
        } else {
          return processImage(src, targetFormat);
        }
      },
      args: [imgData.src, format]
    });

    const result = execResults?.[0]?.result;
    if (!result) throw new Error("script execution failed");

    if (result.tainted) {
      statusEl.textContent = `download: original (cross-origin)`;
      await chrome.downloads.download({
        url: imgData.src,
        filename: `${filename}.${format === "original" ? (imgData.isSvg ? "svg" : "jpg") : format === "image/png" ? "png" : "jpg"}`,
        saveAs: true
      });
    } else if (result.originalUrl) {
      statusEl.textContent = "image downloaded";
      await chrome.downloads.download({
        url: result.originalUrl,
        filename: `${filename}.${imgData.isSvg ? "svg" : "jpg"}`,
        saveAs: true
      });
    } else {
      statusEl.textContent = "image downloaded";
      await chrome.downloads.download({
        url: result.dataUrl,
        filename: `${filename}.${format === "image/png" ? "png" : "jpg"}`,
        saveAs: true
      });
    }
  } catch (err) {
    statusEl.textContent = `err: ${err.message}`;
  }
});

// ─── OCR / Area Selection ───────────────────────────────────────────────

function showOcrStatus(msg) {
  if (!ocrStatusEl) return;
  ocrStatusEl.textContent = msg;
}

function injectOcrOverlay(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: () => {
      if (window.__ocrOverlayActive) return;
      window.__ocrOverlayActive = true;

      function normalizeText(text) {
        return (text || "").replace(/\s+/g, " ").trim();
      }

      function intersects(a, b) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }

      function isHidden(el) {
        if (!el) return true;
        const style = getComputedStyle(el);
        return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
      }

      function isSkippedElement(el) {
        return ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"].includes(el.tagName);
      }

      function getBlockElement(el) {
        let current = el;
        while (current && current !== document.body) {
          const display = getComputedStyle(current).display;
          if (
            /^(P|LI|H1|H2|H3|H4|H5|H6|PRE|CODE|BLOCKQUOTE|TD|TH|ARTICLE|SECTION|MAIN|DIV)$/.test(current.tagName) ||
            ["block", "list-item", "table-cell", "table-row"].includes(display)
          ) {
            return current;
          }
          current = current.parentElement;
        }
        return el;
      }

      function collectTextFromSelection(selectionRect) {
        const seen = new Set();
        const blocks = [];

        function visit(node) {
          if (!node) return;

          if (node.nodeType === Node.TEXT_NODE) {
            const text = normalizeText(node.textContent);
            const parent = node.parentElement;

            if (!text || !parent || isHidden(parent) || isSkippedElement(parent)) return;

            const range = document.createRange();
            range.selectNodeContents(node);
            const rects = Array.from(range.getClientRects());

            if (!rects.some((rect) => rect.width > 0 && rect.height > 0 && intersects(rect, selectionRect))) {
              return;
            }

            const block = getBlockElement(parent);
            if (seen.has(block)) return;

            const blockText = normalizeText(block.innerText || block.textContent);
            if (!blockText) return;

            seen.add(block);
            blocks.push(blockText);
            return;
          }

          if (node.nodeType !== Node.ELEMENT_NODE) return;

          const el = node;
          if (isHidden(el) || isSkippedElement(el)) return;

          for (const child of el.childNodes) visit(child);
          if (el.shadowRoot) {
            for (const child of el.shadowRoot.childNodes) visit(child);
          }
        }

        visit(document.body);

        return blocks.join("\n\n");
      }

      function showToast(message) {
        let toast = document.getElementById("__ocr_toast");
        if (!toast) {
          toast = document.createElement("div");
          toast.id = "__ocr_toast";
          Object.assign(toast.style, {
            position: "fixed",
            bottom: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: "2147483647",
            color: "#fff",
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontSize: "13px",
            padding: "8px 14px",
            background: "rgba(0,0,0,0.78)",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            pointerEvents: "none"
          });
          document.body.appendChild(toast);
        }
        toast.textContent = message;
      }

      let selectionUiRemoved = false;

      function removeSelectionUi() {
        if (selectionUiRemoved) return;
        selectionUiRemoved = true;
        overlay.remove();
        selRect.remove();
        hint.remove();
        cursorBadge.remove();
        window.removeEventListener("keydown", onKey, true);
        document.documentElement.style.overflow = prevOverflow;
        document.documentElement.style.cursor = prevHtmlCursor;
        document.body.style.cursor = prevBodyCursor;
      }

      function finish(removeToast = false) {
        removeSelectionUi();
        window.__ocrOverlayActive = false;

        if (removeToast) {
          const toast = document.getElementById("__ocr_toast");
          if (toast) toast.remove();
        }
      }

      const prevOverflow = document.documentElement.style.overflow;
      const prevHtmlCursor = document.documentElement.style.cursor;
      const prevBodyCursor = document.body.style.cursor;

      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        cursor: "crosshair",
        background: "rgba(0,0,0,0.28)",
        userSelect: "none",
        WebkitUserSelect: "none"
      });

      const selRect = document.createElement("div");
      Object.assign(selRect.style, {
        position: "fixed",
        zIndex: "2147483647",
        border: "2px dashed #4a9eff",
        background: "rgba(74,158,255,0.10)",
        pointerEvents: "none",
        display: "none"
      });

      const hint = document.createElement("div");
      Object.assign(hint.style, {
        position: "fixed",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "13px",
        padding: "8px 16px",
        background: "rgba(0,0,0,0.6)",
        borderRadius: "6px",
        pointerEvents: "none",
        whiteSpace: "nowrap"
      });
      hint.textContent = "drag to select · esc to cancel";

      const cursorBadge = document.createElement("div");
      Object.assign(cursorBadge.style, {
        position: "fixed",
        zIndex: "2147483647",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "12px",
        padding: "4px 8px",
        background: "rgba(0,0,0,0.72)",
        borderRadius: "999px",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
      });
      cursorBadge.textContent = "click and drag";

      document.body.appendChild(overlay);
      document.body.appendChild(selRect);
      document.body.appendChild(hint);
      document.body.appendChild(cursorBadge);
      document.documentElement.style.overflow = "hidden";
      document.documentElement.style.cursor = "crosshair";
      document.body.style.cursor = "crosshair";

      let startX = 0;
      let startY = 0;
      let drawing = false;
      const dpr = window.devicePixelRatio || 1;

      function onKey(e) {
        if (e.key === "Escape") {
          finish();
          showToast("selection cancelled");
          setTimeout(() => finish(true), 1600);
        }
      }

      function updateCursorUi(x, y, message) {
        cursorBadge.style.left = Math.min(x + 14, window.innerWidth - 120) + "px";
        cursorBadge.style.top = Math.max(8, y + 14) + "px";
        cursorBadge.textContent = message;
      }

      updateCursorUi(window.innerWidth / 2, window.innerHeight / 2, "click and drag");

      window.addEventListener("keydown", onKey, true);

      overlay.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        drawing = true;
        startX = e.clientX;
        startY = e.clientY;
        selRect.style.display = "none";
        hint.style.display = "none";
        updateCursorUi(e.clientX, e.clientY, "0 x 0");
      });

      overlay.addEventListener("mousemove", (e) => {
        if (!drawing) {
          updateCursorUi(e.clientX, e.clientY, "click and drag");
          return;
        }

        const left = Math.min(startX, e.clientX);
        const top = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);

        selRect.style.left = left + "px";
        selRect.style.top = top + "px";
        selRect.style.width = width + "px";
        selRect.style.height = height + "px";
        selRect.style.display = "block";
        updateCursorUi(e.clientX, e.clientY, `${Math.round(width)} x ${Math.round(height)}`);
      });

      overlay.addEventListener("mouseup", (e) => {
        if (!drawing) return;
        drawing = false;

        const left = Math.min(startX, e.clientX);
        const top = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);

        removeSelectionUi();

        if (width < 20 || height < 20) {
          showToast("selection too small");
          setTimeout(() => finish(true), 1600);
          return;
        }

        showToast("collecting text...");

        const text = collectTextFromSelection({
          left,
          top,
          right: left + width,
          bottom: top + height
        });

        if (!text) {
          showToast("no text found");
          setTimeout(() => finish(true), 2200);
          return;
        }

        navigator.clipboard.writeText(text).then(() => {
          showToast("copied");
          setTimeout(() => finish(true), 2200);
        }).catch(() => {
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.left = "-999999px";
            ta.style.top = "-999999px";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            showToast(ok ? "copied" : "copy failed");
          } catch {
            showToast("copy failed");
          }
          setTimeout(() => finish(true), 2200);
        });
      });

      overlay.addEventListener("dblclick", () => {
        finish();
        showToast("selection cancelled");
        setTimeout(() => finish(true), 1600);
      });
    }
  });
}
