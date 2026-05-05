const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  settingsButton: document.querySelector("#settingsButton"),
  summaryMode: document.querySelector("#summaryMode"),
  highlightToggle: document.querySelector("#highlightToggle"),
  summarizeButton: document.querySelector("#summarizeButton"),
  summarizeLabel: document.querySelector("#summarizeLabel"),
  clearButton: document.querySelector("#clearButton"),
  copyButton: document.querySelector("#copyButton"),
  statusMessage: document.querySelector("#statusMessage"),
  errorMessage: document.querySelector("#errorMessage"),
  summaryPanel: document.querySelector("#summaryPanel"),
  summaryList: document.querySelector("#summaryList"),
  insightsList: document.querySelector("#insightsList"),
  readingTime: document.querySelector("#readingTime"),
  cacheBadge: document.querySelector("#cacheBadge")
};

let currentTab;
let currentPage;
let currentSummary;

init();

async function init() {
  bindEvents();
  setStatus("Reading page details...");

  try {
    currentTab = await getActiveTab();
    elements.pageTitle.textContent = currentTab?.title || "Current page";
    const settingsResponse = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (settingsResponse?.ok) {
      elements.summaryMode.value = settingsResponse.settings.summaryMode;
      elements.highlightToggle.checked = settingsResponse.settings.highlightKeyPoints;
    }
    setStatus("Ready.");
  } catch (error) {
    showError(error);
  }
}

function bindEvents() {
  elements.summarizeButton.addEventListener("click", summarizeCurrentPage);
  elements.clearButton.addEventListener("click", clearSummary);
  elements.copyButton.addEventListener("click", copySummary);
  elements.settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.summaryMode.addEventListener("change", savePopupSettings);
  elements.highlightToggle.addEventListener("change", savePopupSettings);
}

async function summarizeCurrentPage() {
  setLoading(true);
  hideError();
  setStatus("Extracting readable content...");

  try {
    currentPage = await requestPageExtraction();
    elements.pageTitle.textContent = currentPage.title || currentTab.title || "Current page";
    setStatus(`Summarizing ${currentPage.wordCount.toLocaleString()} words...`);

    const response = await chrome.runtime.sendMessage({
      type: "SUMMARIZE_PAGE",
      payload: currentPage
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not summarize this page.");
    }

    currentSummary = response.summary;
    renderSummary(currentSummary, response.cached);
    setStatus(response.cached ? "Loaded cached summary." : "Summary ready.");

    if (elements.highlightToggle.checked) {
      await sendTabMessage({
        type: "HIGHLIGHT_KEY_POINTS",
        phrases: currentSummary.keyPhrases
      });
    } else {
      await sendTabMessage({ type: "CLEAR_HIGHLIGHTS" });
    }
  } catch (error) {
    showError(error);
  } finally {
    setLoading(false);
  }
}

async function requestPageExtraction() {
  let response = await sendTabMessage({ type: "EXTRACT_PAGE" }).catch(() => null);
  if (!response?.ok) {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ["src/content/content-script.js"]
    });
    response = await sendTabMessage({ type: "EXTRACT_PAGE" });
  }

  if (!response?.ok || !response.page) {
    throw new Error("Could not extract this page. Refresh the tab and try again.");
  }
  return response.page;
}

async function sendTabMessage(message) {
  if (!currentTab?.id) {
    throw new Error("No active tab is available.");
  }
  return chrome.tabs.sendMessage(currentTab.id, message);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) {
    throw new Error("Open a regular web page before summarizing.");
  }
  return tab;
}

function renderSummary(summary, cached) {
  elements.summaryPanel.hidden = false;
  elements.cacheBadge.hidden = !cached;
  elements.readingTime.textContent = `${summary.readingTimeMinutes} min read`;
  renderList(elements.summaryList, summary.bullets);
  renderList(elements.insightsList, summary.insights);
}

function renderList(list, items) {
  list.replaceChildren();
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  });
}

async function clearSummary() {
  hideError();
  currentSummary = null;
  elements.summaryPanel.hidden = true;
  elements.cacheBadge.hidden = true;
  elements.summaryList.replaceChildren();
  elements.insightsList.replaceChildren();
  setStatus("Cleared.");

  if (currentPage?.url) {
    await chrome.runtime.sendMessage({ type: "CLEAR_SUMMARY", url: currentPage.url });
  }
  if (currentTab?.id) {
    await sendTabMessage({ type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
  }
}

async function copySummary() {
  if (!currentSummary) return;
  const text = [
    "Summary",
    ...currentSummary.bullets.map((item) => `- ${item}`),
    "",
    "Key insights",
    ...currentSummary.insights.map((item) => `- ${item}`)
  ].join("\n");

  await navigator.clipboard.writeText(text);
  setStatus("Copied summary.");
}

async function savePopupSettings() {
  const existing = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  const settings = {
    ...(existing?.settings || {}),
    summaryMode: elements.summaryMode.value,
    highlightKeyPoints: elements.highlightToggle.checked
  };
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
}

function setLoading(isLoading) {
  elements.summarizeButton.disabled = isLoading;
  elements.summarizeButton.classList.toggle("is-loading", isLoading);
  elements.summarizeLabel.textContent = isLoading ? "Summarizing..." : "Summarize Page";
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function showError(error) {
  elements.errorMessage.hidden = false;
  elements.errorMessage.textContent =
    error instanceof Error ? error.message : "Something went wrong.";
  setStatus("");
}

function hideError() {
  elements.errorMessage.hidden = true;
  elements.errorMessage.textContent = "";
}
