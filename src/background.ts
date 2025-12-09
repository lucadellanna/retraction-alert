chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "fetchJson") return undefined;
  try {
    const url = new URL(String(message.url));
    const allowedHosts = new Set(["api.crossref.org"]);
    if (!allowedHosts.has(url.hostname)) {
      sendResponse({ ok: false, status: 0, error: "forbidden" });
      return;
    }
    fetch(url.toString(), { cache: "no-store" })
      .then(async (res) => {
        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          // ignore json parse errors
        }
        sendResponse({ ok: res.ok, status: res.status, data });
      })
      .catch((err) => {
        sendResponse({ ok: false, status: 0, error: String(err) });
      });
  } catch (error) {
    sendResponse({ ok: false, status: 0, error: String(error) });
  }
  return true;
});
