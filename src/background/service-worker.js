const DEFAULT_SETTINGS = {
  proxyUrl: "http://127.0.0.1:8787/summarize",
  summaryMode: "balanced",
  highlightKeyPoints: true
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const MIN_REQUEST_SPACING_MS = 1500;
let lastAiRequestAt = 0;

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedMessage(message)) {
    sendResponse({ ok: false, error: "Unsupported extension message." });
    return false;
  }

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected extension error."
      });
    });

  return true;
});

async function handleMessage(message, sender) {
  if (message.type === "GET_SETTINGS") {
    return { ok: true, settings: await getSettings() };
  }

  if (message.type === "SAVE_SETTINGS") {
    const settings = normalizeSettings(message.settings);
    await chrome.storage.local.set({ settings });
    return { ok: true, settings };
  }

  if (message.type === "CLEAR_SUMMARY") {
    await clearCacheEntry(message.url);
    return { ok: true };
  }

  if (message.type === "SUMMARIZE_PAGE") {
    return summarizePage(message.payload, sender);
  }

  return { ok: false, error: "Unknown message type." };
}

async function summarizePage(payload) {
  const page = normalizePagePayload(payload);
  if (page.text.length < 250) {
    throw new Error("This page does not contain enough readable text to summarize.");
  }

  const settings = await getSettings();
  const cacheKey = createCacheKey(page.url, settings.summaryMode);
  const cached = await getCachedSummary(cacheKey);
  if (cached) {
    return { ok: true, cached: true, summary: cached };
  }

  await waitForRateLimit();
  const summary = await requestAiSummary(page, settings);
  await chrome.storage.local.set({
    [cacheKey]: {
      createdAt: Date.now(),
      summary
    }
  });

  return { ok: true, cached: false, summary };
}

async function requestAiSummary(page, settings) {
  let response;
  try {
    response = await fetch(settings.proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: page.title,
        url: page.url,
        text: page.text,
        wordCount: page.wordCount,
        mode: settings.summaryMode
      })
    });
  } catch {
    throw new Error("Could not reach the AI proxy. Start it with `npm run proxy` and try again.");
  }

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(body?.error || `AI proxy returned HTTP ${response.status}.`);
  }

  return normalizeSummary(body);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeSummary(body) {
  const summary = {
    title: String(body?.title || "Summary"),
    bullets: asStringArray(body?.bullets).slice(0, 8),
    insights: asStringArray(body?.insights).slice(0, 6),
    readingTimeMinutes: Math.max(1, Number.parseInt(body?.readingTimeMinutes, 10) || 1),
    keyPhrases: asStringArray(body?.keyPhrases).slice(0, 8),
    model: String(body?.model || "AI"),
    provider: String(body?.provider || "unknown")
  };

  if (!summary.bullets.length) {
    throw new Error("The AI response did not include a usable summary.");
  }

  return summary;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

async function waitForRateLimit() {
  const now = Date.now();
  const waitMs = Math.max(0, MIN_REQUEST_SPACING_MS - (now - lastAiRequestAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastAiRequestAt = Date.now();
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return normalizeSettings(settings);
}

function normalizeSettings(settings = {}) {
  const proxyUrl = String(settings.proxyUrl || DEFAULT_SETTINGS.proxyUrl).trim();
  return {
    proxyUrl: isAllowedProxyUrl(proxyUrl) ? proxyUrl : DEFAULT_SETTINGS.proxyUrl,
    summaryMode: ["brief", "balanced", "detailed"].includes(settings.summaryMode)
      ? settings.summaryMode
      : DEFAULT_SETTINGS.summaryMode,
    highlightKeyPoints:
      typeof settings.highlightKeyPoints === "boolean"
        ? settings.highlightKeyPoints
        : DEFAULT_SETTINGS.highlightKeyPoints
  };
}

function isAllowedProxyUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

function normalizePagePayload(payload = {}) {
  const title = String(payload.title || "").trim().slice(0, 300);
  const url = String(payload.url || "").trim().slice(0, 2048);
  const text = String(payload.text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60000);
  const wordCount = Number.isFinite(payload.wordCount)
    ? Math.max(0, Math.round(payload.wordCount))
    : text.split(/\s+/).filter(Boolean).length;

  if (!/^https?:\/\//.test(url)) {
    throw new Error("Only regular web pages can be summarized.");
  }

  return { title, url, text, wordCount };
}

function createCacheKey(url, mode) {
  return `summary:${mode}:${url}`;
}

async function getCachedSummary(cacheKey) {
  const cached = await chrome.storage.local.get(cacheKey);
  const entry = cached[cacheKey];
  if (!entry?.summary || Date.now() - Number(entry.createdAt || 0) > CACHE_TTL_MS) {
    return null;
  }
  return entry.summary;
}

async function clearCacheEntry(url) {
  if (!url || !/^https?:\/\//.test(url)) return;
  const settings = await getSettings();
  await chrome.storage.local.remove(createCacheKey(url, settings.summaryMode));
}

function isTrustedMessage(message) {
  return Boolean(
    message &&
      typeof message === "object" &&
      typeof message.type === "string" &&
      [
        "GET_SETTINGS",
        "SAVE_SETTINGS",
        "CLEAR_SUMMARY",
        "SUMMARIZE_PAGE"
      ].includes(message.type)
  );
}
