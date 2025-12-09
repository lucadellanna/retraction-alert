import { ArticleStatus, AlertEntry } from "./types";
import { ALERT_STATUSES } from "./constants";
import { logDebug } from "./log";
import {
  extractLancetDoiFromPath,
  extractDoiFromUrlPath,
  extractDoiFromDoiOrg,
  extractMetaDoi,
  mapPublisherUrlToDoi,
  extractDoiFromHref,
} from "./doi";
import { checkStatus, checkReferences } from "./crossref";
import {
  fetchOrcidDois,
  checkOrcidWorks,
  checkCitedRetractedFromWorks,
} from "./orcid";
import {
  ensureBanners,
  updateBanner,
  countsSummary,
  updateReferenceProgress,
  setWrapperVisibility,
  clearUiState,
} from "./ui/banners";
import { handleNewsPage } from "./news";
import { handleGoogleScholarProfile } from "./google-scholar";

function extractNatureDoiFromPath(): string | null {
  if (!location.hostname.endsWith("nature.com")) return null;
  const match = location.pathname.match(/\/articles\/([^/?#]+)/);
  if (!match) return null;
  const suffix = match[1];
  if (!suffix) return null;
  return `10.1038/${suffix}`;
}

function extractOrcidId(): string | null {
  if (!location.hostname.endsWith("orcid.org")) return null;
  const match = location.pathname.match(
    /\/(\d{4}-\d{4}-\d{4}-[\dX]{3}[\dX]?)/i
  );
  return match ? match[1] : null;
}

function extractPmid(): string | null {
  if (!location.hostname.endsWith("pubmed.ncbi.nlm.nih.gov")) return null;
  const meta = document.querySelector('meta[name="citation_pmid"]');
  const pmid = meta?.getAttribute("content")?.trim() ?? "";
  return pmid || null;
}

function collectPubmedReferenceDois(): string[] {
  const roots = [
    document.querySelector('[data-section="references"]'),
    document.querySelector("#reference-list"),
    document.querySelector("#references"),
  ].filter(Boolean) as HTMLElement[];
  if (!roots.length) return [];

  const dois = new Set<string>();
  roots.forEach((root) => {
    const anchors = Array.from(root.querySelectorAll("a[href]")) as HTMLAnchorElement[];
    anchors.forEach((anchor) => {
      const href = anchor.getAttribute("href") || anchor.href;
      if (!href) return;
      try {
        const url = new URL(href, location.href);
        let doi =
          extractDoiFromHref(url.href) ||
          mapPublisherUrlToDoi(url.href);
        if (!doi) {
          const text = anchor.textContent?.trim() || "";
          const match = text.match(/\b10\.[^\s)]+/i);
          if (match?.[0]) {
            doi = match[0].replace(/[).,]+$/, "");
          }
        }
        if (doi && doi.startsWith("10.")) {
          dois.add(doi);
        }
      } catch {
        // ignore malformed URLs
      }
    });
  });
  return Array.from(dois);
}

function highlightOrcidAlerts(alerts: AlertEntry[]): void {
  if (!alerts.length) return;
  const alertMap = new Map<string, AlertEntry>(
    alerts.map((a) => [a.id.toLowerCase(), a])
  );
  const anchors = Array.from(
    document.querySelectorAll("a[href]")
  ) as HTMLAnchorElement[];
  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href") || anchor.href || "";
    const text = anchor.textContent || "";
    const doi =
      extractDoiFromHref(href) || extractDoiFromHref(text);
    if (!doi) return;
    const alert = alertMap.get(doi.toLowerCase());
    if (!alert) return;
    const target =
      (anchor.closest("[data-work-id]") as HTMLElement | null) ||
      (anchor.closest("li") as HTMLElement | null) ||
      anchor;
    if (!target || target.dataset.retractionAlertMarked) return;
    target.dataset.retractionAlertMarked = "1";
    target.style.borderLeft = "4px solid #b71c1c";
    target.style.backgroundColor = "#ffebee";
    target.style.paddingLeft = "8px";
    const badge = document.createElement("span");
    badge.textContent = "Retracted";
    badge.style.background = "#b71c1c";
    badge.style.color = "#fff";
    badge.style.fontSize = "12px";
    badge.style.fontWeight = "bold";
    badge.style.padding = "2px 6px";
    badge.style.borderRadius = "4px";
    badge.style.marginLeft = "8px";
    badge.style.display = "inline-block";
    anchor.insertAdjacentElement("afterend", badge);
  });
  logDebug("highlighted orcid alerts", { count: alerts.length });
}

async function run(): Promise<void> {
  const { article, citations } = ensureBanners();
  const isOrcidHost = location.hostname.endsWith("orcid.org");
  const handledScholar = handleGoogleScholarProfile(
    article,
    citations,
    window.location
  );
  if (handledScholar) return;
  const handledNews = await handleNewsPage(location.hostname, citations);
  if (handledNews) return;
  const orcidId = extractOrcidId();
  if (isOrcidHost && !orcidId) {
    setWrapperVisibility(false);
    logDebug("Non-profile ORCID page; skipping banners.");
    return;
  }
  if (orcidId) {
    logDebug("Detected ORCID", orcidId);
    updateBanner(article, {
      bg: "#fbc02d",
      lines: ["Checking ORCID works..."],
    });
    updateBanner(citations, {
      bg: "#fbc02d",
      lines: ["Checking cited works..."],
    });
    const worksResult = await checkOrcidWorks(orcidId);
    const allDois = await fetchOrcidDois(orcidId);
    const citationsResult = await checkCitedRetractedFromWorks(allDois);
    const citationsUnknown = Math.max(
      citationsResult.counts.unknown,
      citationsResult.failedChecks
    );
    highlightOrcidAlerts(worksResult.alerts);
    const worksHasEoc = worksResult.alerts.some(
      (a) => a.status === "expression_of_concern"
    );
    const citationsHasEoc = citationsResult.alerts.some(
      (a) => a.status === "expression_of_concern"
    );
    updateBanner(article, {
      bg: worksHasEoc
        ? "#8b0000"
        : worksResult.failedChecks
        ? "#fbc02d"
        : "#1b5e20",
      lines: [
        countsSummary(
          "Works",
          worksResult.counts,
          worksResult.totalFound || worksResult.checked,
          worksResult.failedChecks
        ),
      ],
      alerts: worksResult.alerts,
    });
    updateBanner(citations, {
      bg:
        citationsHasEoc || citationsResult.alerts.length
          ? "#8b0000"
          : citationsUnknown
          ? "#ffffff"
          : "#1b5e20",
      textColor: citationsUnknown ? "#000000" : undefined,
      lineColors: citationsUnknown
        ? [
            "#000000",
            "#1b5e20",
            "#8b0000",
          ]
        : undefined,
      lines: citationsUnknown
        ? [
            `Citations: ${
              citationsResult.totalFound || citationsResult.checked
            } total`,
            `retracted ${citationsResult.counts.retracted} • withdrawn ${citationsResult.counts.withdrawn} • expression of concern ${citationsResult.counts.expression_of_concern}`,
            `unknown/failed ${citationsUnknown}`,
          ]
        : [
            countsSummary(
              "Citations",
              citationsResult.counts,
              citationsResult.totalFound || citationsResult.checked,
              citationsResult.failedChecks
            ),
          ],
      alerts: citationsResult.alerts,
    });
    logDebug("ORCID banner updated", {
      works: worksResult,
      citations: citationsResult,
    });
    return;
  }

  const id =
    extractDoiFromDoiOrg(window.location) ??
    extractMetaDoi(document) ??
    extractNatureDoiFromPath() ??
    extractLancetDoiFromPath(window.location) ??
    extractDoiFromUrlPath(window.location.href) ??
    extractPmid();
  if (!id) {
    logDebug("No DOI/PMID found on this page");
    updateBanner(article, {
      bg: "#1b5e20",
      lines: ["No identifier found on this page."],
    });
    updateBanner(citations, {
      bg: "#1b5e20",
      lines: ["No citations checked."],
    });
    return;
  }

  logDebug("Detected identifier", id, "hostname:", location.hostname);
  updateBanner(article, {
    bg: "#fbc02d",
    lines: ["Checking article status..."],
  });
  updateBanner(citations, {
    bg: "#fbc02d",
    lines: ["Checking citations..."],
  });

  const additionalPubmedDois =
    location.hostname.endsWith("pubmed.ncbi.nlm.nih.gov")
      ? collectPubmedReferenceDois()
      : [];

  const result = await checkStatus(id);
  const articleBg = ALERT_STATUSES.has(result.status)
    ? "#8b0000"
    : result.status === "unknown"
    ? "#fbc02d"
    : "#1b5e20";
  const articleLine =
    result.status === "retracted"
      ? "⚠️ This article has been retracted."
      : result.status === "withdrawn"
      ? "⚠️ This article has been withdrawn."
      : result.status === "expression_of_concern"
      ? "⚠️ This article has an expression of concern."
      : result.status === "unknown"
      ? "Article status unknown."
      : "🟡 Article OK; citations pending.";
  updateBanner(article, { bg: articleBg, lines: [articleLine] });
  logDebug("Article banner updated", result);

  if (id.startsWith("10.")) {
    const referenceResult = await checkReferences(
      id,
      updateReferenceProgress,
      additionalPubmedDois
    );
    if (additionalPubmedDois.length) {
      logDebug("added PubMed-only DOIs to reference check", {
        count: additionalPubmedDois.length,
        sample: additionalPubmedDois.slice(0, 3),
      });
    }
    const referenceUnknown = Math.max(
      referenceResult.counts.unknown,
      referenceResult.failedChecks
    );
    updateBanner(citations, {
      bg: referenceResult.alerts.length
        ? "#8b0000"
        : referenceUnknown
        ? "#ffffff"
        : "#1b5e20",
      textColor: referenceUnknown ? "#000000" : undefined,
      lineColors: referenceUnknown ? ["#000000", "#1b5e20", "#8b0000"] : undefined,
      lines: referenceUnknown
        ? [
            `Citations: ${
              referenceResult.totalFound || referenceResult.checked
            } total`,
            `retracted ${referenceResult.counts.retracted} • withdrawn ${referenceResult.counts.withdrawn} • expression of concern ${referenceResult.counts.expression_of_concern}`,
            `unknown/failed ${referenceUnknown}`,
          ]
        : [
            countsSummary(
              "Citations",
              referenceResult.counts,
              referenceResult.totalFound || referenceResult.checked,
              referenceResult.failedChecks
            ),
          ],
      alerts: referenceResult.alerts,
    });
    logDebug("Reference banner updated", referenceResult);

    const articleOkNoAlerts =
      result.status === "ok" &&
      referenceResult.alerts.length === 0 &&
      referenceResult.failedChecks === 0;
    const articleHasCitationAlerts = referenceResult.alerts.length > 0 || referenceResult.failedChecks > 0;

    if (articleOkNoAlerts) {
      updateBanner(article, {
        bg: "#1b5e20",
        lines: ["✅ Article OK and citations clear."],
      });
    } else if (result.status === "ok" && articleHasCitationAlerts) {
      updateBanner(article, {
        bg: "#8b0000",
        lines: ["⚠️ Article cites retracted/flagged or incomplete citations check."],
      });
    }
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
