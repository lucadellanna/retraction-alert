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
} from "../ui/banners";
import { COLORS } from "../ui/colors";
import { logDebug } from "../log";
import { createProgressBar, ProgressHandle } from "../ui/progress";

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
  citationsBanner.style.display = "none";

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
      : "";
  const initialLines =
    articleLine === ""
      ? ["Checking citations..."]
      : [articleLine, "Checking citations..."];
  updateBanner(articleBanner, { bg: articleBg, lines: initialLines });
  logDebug("Article banner updated", result);

  if (!id.startsWith("10.")) return true;

  const progress: ProgressHandle = createProgressBar(articleBanner, {
    id: "retraction-alert-article-progress",
    labelColor: COLORS.textLight,
    trackColor: COLORS.link,
    barColor: "#f57f17",
  });

  let refTotal = 0;
  const referenceResult = await checkReferences(
    id,
    (done, total) => {
      refTotal = total;
      progress.update(
        done,
        total,
        `Checking citations... (${done}/${total || "?"})`
      );
    },
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
  const citationsLine = referenceUnknown
    ? `Citations: ${
        referenceResult.totalFound || referenceResult.checked
      } total • retracted ${referenceResult.counts.retracted} • withdrawn ${
        referenceResult.counts.withdrawn
      } • expression of concern ${
        referenceResult.counts.expression_of_concern
      } • unknown/failed ${referenceUnknown}`
    : countsSummary(
        "Citations",
        referenceResult.counts,
        referenceResult.totalFound || referenceResult.checked,
        referenceResult.failedChecks
      );

  const finalBg =
    result.status === "retracted" ||
    result.status === "withdrawn" ||
    result.status === "expression_of_concern" ||
    referenceResult.alerts.length
      ? COLORS.danger
      : referenceUnknown
      ? COLORS.neutral
      : result.status === "unknown"
      ? COLORS.warning
      : COLORS.ok;

  const finalLines =
    articleLine === "" ? [citationsLine] : [articleLine, citationsLine];

  updateBanner(articleBanner, {
    bg: finalBg,
    textColor: referenceUnknown ? COLORS.textDark : undefined,
    lineColors:
      referenceUnknown && articleLine !== ""
        ? [COLORS.textDark, COLORS.textDark]
        : referenceUnknown
        ? [COLORS.textDark]
        : undefined,
    lines: finalLines,
    alerts: referenceResult.alerts,
  });
  progress.update(
    refTotal || referenceResult.checked,
    refTotal || referenceResult.checked,
    "Citations checked"
  );
  logDebug("Reference banner updated", referenceResult);
  return true;
}
