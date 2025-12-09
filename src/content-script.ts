import { ArticleStatus, AlertEntry } from "./types";
import { ALERT_STATUSES } from "./constants";
import { logDebug } from "./log";
import {
  extractLancetDoiFromPath,
  extractDoiFromUrlPath,
  extractDoiFromDoiOrg,
  extractMetaDoi,
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
      bg: citationsHasEoc
        ? "#8b0000"
        : citationsResult.alerts.length
        ? "#8b0000"
        : citationsResult.failedChecks
        ? "#fbc02d"
        : "#1b5e20",
      lines: [
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
    const referenceResult = await checkReferences(id, updateReferenceProgress);
    updateBanner(citations, {
      bg: referenceResult.alerts.length
        ? "#8b0000"
        : referenceResult.failedChecks
        ? "#fbc02d"
        : "#1b5e20",
      lines: [
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
