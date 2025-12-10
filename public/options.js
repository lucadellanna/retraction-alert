const statusEl = document.getElementById("status");
const clearBtn = document.getElementById("clear");
const supportBtn = document.getElementById("support");
const donateBtn = document.getElementById("donate");
const privacyBtn = document.getElementById("privacy");
const versionEl = document.getElementById("version");

// Show version
try {
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = `${manifest.name} v${manifest.version}`;
} catch {
  versionEl.textContent = "Version info unavailable";
}

clearBtn.addEventListener("click", async () => {
  clearBtn.disabled = true;
  statusEl.textContent = "Clearing cache...";
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.clear();
    }
    statusEl.textContent = "Cache cleared.";
  } catch (err) {
    statusEl.textContent = "Failed to clear cache.";
    console.error("Cache clear error", err);
  } finally {
    setTimeout(() => {
      clearBtn.disabled = false;
    }, 800);
  }
});

supportBtn.addEventListener("click", () => {
  window.open("https://Luca-Dellanna.com/contact", "_blank", "noreferrer");
});

donateBtn.addEventListener("click", () => {
  window.open("https://Luca-Dellanna.com/donate", "_blank", "noreferrer");
});

privacyBtn.addEventListener("click", () => {
  window.open("https://raw.githubusercontent.com/lucadellanna/retraction-alert/main/privacy.md", "_blank", "noreferrer");
});
