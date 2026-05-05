const form = document.querySelector("#settingsForm");
const proxyUrl = document.querySelector("#proxyUrl");
const summaryMode = document.querySelector("#summaryMode");
const highlightKeyPoints = document.querySelector("#highlightKeyPoints");
const status = document.querySelector("#status");

loadSettings();
form.addEventListener("submit", saveSettings);

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!response?.ok) {
    status.textContent = "Could not load settings.";
    return;
  }

  proxyUrl.value = response.settings.proxyUrl;
  summaryMode.value = response.settings.summaryMode;
  highlightKeyPoints.checked = response.settings.highlightKeyPoints;
}

async function saveSettings(event) {
  event.preventDefault();
  status.textContent = "Saving...";

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: {
      proxyUrl: proxyUrl.value,
      summaryMode: summaryMode.value,
      highlightKeyPoints: highlightKeyPoints.checked
    }
  });

  status.textContent = response?.ok
    ? "Settings saved."
    : response?.error || "Could not save settings.";
}
