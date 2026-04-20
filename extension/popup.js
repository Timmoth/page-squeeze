const body = document.body;

const savedTheme = localStorage.getItem("theme");
const systemPrefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;

if (savedTheme === "light" || (!savedTheme && systemPrefersLight)) {
  body.classList.add("light");
}

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  if (localStorage.getItem("theme") !== "dark" && localStorage.getItem("theme") !== "light") {
    body.classList.toggle("light", e.matches);
  }
});

document.getElementById("theme").addEventListener("click", () => {
  body.classList.toggle("light");
  localStorage.setItem("theme", body.classList.contains("light") ? "light" : "dark");
});

const statusEl = document.getElementById("status");

async function extract() {
  try {
    statusEl.textContent = "running...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("no active tab");
    }

    const options = {
      title: document.getElementById("opt-title").checked,
      meta: document.getElementById("opt-meta").checked,
      content: document.getElementById("opt-content").checked,
      links: document.getElementById("opt-links").checked
    };

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (opts) => {
        window.__pageSqueezeOptions = opts;
      },
      args: [options]
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    const result = results?.[0]?.result;
    if (!result || !result.markdown) {
      throw new Error("no output");
    }

    return result.markdown;
  } catch (err) {
    statusEl.textContent = `err: ${err.message}`;
    throw err;
  }
}

function sanitizeFilename(value) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
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

    const ta = document.createElement("textarea");
    ta.value = markdown;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);

    statusEl.textContent = "copied";
  } catch (err) {
    statusEl.textContent = `err: ${err.message}`;
  }
});
