import { ensureBanners, setWrapperVisibility, clearUiState } from "./ui/banners";
import { routePage } from "./router";
import { logDebug } from "./log";

async function run(): Promise<void> {
  logDebug("Content script start", { href: location.href, host: location.hostname });
  const { article, citations } = ensureBanners();
  const handled = await routePage({
    article,
    citations,
    location: window.location,
  });
  if (!handled) {
    setWrapperVisibility(false);
    logDebug("No handler matched this page");
  } else {
    logDebug("Handler matched", { href: location.href });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void run();
  });
} else {
  void run();
}

let navWatcherStarted = false;
function startNavigationWatcher(): void {
  if (navWatcherStarted) return;
  navWatcherStarted = true;
  let lastUrl = location.href;
  const handleChange = (): void => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    clearUiState();
    void run();
  };
  const origPush = history.pushState;
  history.pushState = function (...args) {
    const ret = origPush.apply(this, args as [any, string, string | URL | null | undefined]);
    handleChange();
    return ret;
  };
  const origReplace = history.replaceState;
  history.replaceState = function (...args) {
    const ret = origReplace.apply(this, args as [any, string, string | URL | null | undefined]);
    handleChange();
    return ret;
  };
  window.addEventListener("popstate", handleChange);
}

startNavigationWatcher();
