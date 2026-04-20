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
      adjustPopupHeight();
    } else {
      markdownSection.classList.remove("active");
      imageSection.classList.add("active");
      loadGallery();
      adjustPopupHeight();
    }
  });
});

function getPopupHeight() {
  body.style.height = "auto";
  void body.offsetHeight;
  const isActiveTab = markdownSection.classList.contains("active") || imageSection.classList.contains("active");
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