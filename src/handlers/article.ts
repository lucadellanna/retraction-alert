import { ALERT_STATUSES } from "../constants";
import {
  extractLancetDoiFromPath,
  extractDoiFromUrlPath,
  extractDoiFromDoiOrg,
  extractMetaDoi,
  mapPublisherUrlToDoi,
  extractDoiFromHref,
} from "../doi";
import { checkStatus, checkReferences } from "../crossref";
import {
  countsSummary,
  updateBanner,
  updateReferenceProgress,
} from "../ui/banners";
import { COLORS } from "../ui/colors";
import { logDebug } from "../log";

function extractNatureDoiFromPath(loc: Location): string | null {
  if (!loc.hostname.endsWith("nature.com")) return null;
  const match = loc.pathname.match(/\/articles\/([^/?#]+)/);
  if (!match) return null;
  const suffix = match[1];
  if (!suffix) return null;
  return `10.1038/${suffix}`;
}

function extractPmid(loc: Location): string | null {
  if (!loc.hostname.endsWith("pubmed.ncbi.nlm.nih.gov")) return null;
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
    const anchors = Array.from(
      root.querySelectorAll("a[href]")
    ) as HTMLAnchorElement[];
    anchors.forEach((anchor) => {
      const href = anchor.getAttribute("href") || anchor.href;
      if (!href) return;
      try {
        const url = new URL(href, location.href);
        let doi = extractDoiFromHref(url.href) || mapPublisherUrlToDoi(url.href);
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

export async function handleArticlePage(
  articleBanner: HTMLDivElement,
  citationsBanner: HTMLDivElement,
  loc: Location
): Promise<boolean> {
  const id =
    extractDoiFromDoiOrg(loc) ??
    extractMetaDoi(document) ??
    extractNatureDoiFromPath(loc) ??
    extractLancetDoiFromPath(loc) ??
    extractDoiFromUrlPath(loc.href) ??
    extractPmid(loc);

  if (!id) {
    logDebug("No DOI/PMID found on this page");
    updateBanner(articleBanner, {
      bg: COLORS.ok,
      lines: ["No identifier found on this page."],
    });
    updateBanner(citationsBanner, {
      bg: COLORS.ok,
      lines: ["No citations checked."],
    });
    return true;
  }

  logDebug("Detected identifier", id, "hostname:", loc.hostname);
  updateBanner(articleBanner, {
    bg: COLORS.warning,
    lines: ["Checking article status..."],
  });
  updateBanner(citationsBanner, {
    bg: COLORS.warning,
    lines: ["Checking citations..."],
  });

  const additionalPubmedDois =
    loc.hostname.endsWith("pubmed.ncbi.nlm.nih.gov")
      ? collectPubmedReferenceDois()
      : [];

  const result = await checkStatus(id);
  const articleBg = ALERT_STATUSES.has(result.status)
    ? COLORS.danger
    : result.status === "unknown"
    ? COLORS.warning
    : COLORS.ok;
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
  updateBanner(articleBanner, { bg: articleBg, lines: [articleLine] });
  logDebug("Article banner updated", result);

  if (!id.startsWith("10.")) return true;

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
  updateBanner(citationsBanner, {
    bg: referenceResult.alerts.length
      ? COLORS.danger
      : referenceUnknown
      ? COLORS.neutral
      : COLORS.ok,
    textColor: referenceUnknown ? COLORS.textDark : undefined,
    lineColors: referenceUnknown
      ? [COLORS.textDark, COLORS.ok, COLORS.danger]
      : undefined,
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
  const articleHasCitationAlerts =
    referenceResult.alerts.length > 0 || referenceResult.failedChecks > 0;

  if (articleOkNoAlerts) {
    updateBanner(articleBanner, {
      bg: COLORS.ok,
      lines: ["✅ Article OK and citations clear."],
    });
  } else if (result.status === "ok" && articleHasCitationAlerts) {
    updateBanner(articleBanner, {
      bg: COLORS.danger,
      lines: ["⚠️ Article cites retracted/flagged or incomplete citations check."],
    });
  }
  return true;
}
