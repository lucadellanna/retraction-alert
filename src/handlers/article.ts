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
import { countsSummary, updateBanner } from "../ui/banners";
import { COLORS } from "../ui/colors";
import { logDebug } from "../log";
import { createProgressBar, ProgressHandle } from "../ui/progress";
import { getCache } from "../cache";
import { highlightSentence } from "../ui/highlight";

function referenceRoots(): HTMLElement[] {
  return [
    document.querySelector('[data-section="references"]'),
    document.querySelector("#reference-list"),
    document.querySelector("#references"),
    document.querySelector(".ref-list"),
    document.querySelector(".references"),
  ].filter(Boolean) as HTMLElement[];
}

function buildReferenceIdToDoiMap(): Map<string, string> {
  const map = new Map<string, string>();
  referenceRoots().forEach((root) => {
    const entries = Array.from(root.querySelectorAll<HTMLElement>("[id]"));
    entries.forEach((entry) => {
      let doi: string | null = null;
      const anchors = Array.from(entry.querySelectorAll<HTMLAnchorElement>("a[href]"));
      for (const a of anchors) {
        const href = a.getAttribute("href") || a.href;
        doi =
          extractDoiFromHref(href) ||
          mapPublisherUrlToDoi(href) ||
          (() => {
            const text = a.textContent?.trim() || "";
            const match = text.match(/\b10\.[^\s)]+/i);
            return match?.[0]?.replace(/[).,]+$/, "") || null;
          })();
        if (doi) break;
      }
      if (!doi) {
        const text = entry.textContent || "";
        const match = text.match(/\b10\.[^\s)]+/i);
        if (match?.[0]) doi = match[0].replace(/[).,]+$/, "");
      }
      if (doi && entry.id) {
        map.set(entry.id.toLowerCase(), doi.toLowerCase());
      }
    });
  });
  return map;
}

function highlightCitingParagraphs(alerts: { id: string }[]): void {
  if (!alerts.length) return;
  const alertDois = new Set(alerts.map((a) => a.id.toLowerCase()));
  const refMap = buildReferenceIdToDoiMap();
  const refRoots = referenceRoots();
  const isInReferences = (el: Element) =>
    refRoots.some((root) => root.contains(el));

  const refIdForInline = (el: Element): string | null => {
    const attrs = [
      el.getAttribute("data-rid"),
      el.getAttribute("rid"),
      el.getAttribute("data-ref-id"),
      el.getAttribute("data-refid"),
      el.getAttribute("href")?.replace(/^#/, ""),
    ];
    for (const val of attrs) {
      if (val) return val.toLowerCase();
    }
    const sup = el.closest("sup");
    if (sup) {
      const supAttrs = [
        sup.getAttribute("data-rid"),
        sup.getAttribute("rid"),
        sup.getAttribute("data-ref-id"),
        sup.getAttribute("data-refid"),
        sup.getAttribute("id"),
      ];
      for (const val of supAttrs) {
        if (val) return val.toLowerCase();
      }
    }
    return null;
  };

  const highlighted = new Set<HTMLElement>();
  const highlightSentenceSafe = (el: Element | null) => {
    if (!el) return;
    if (isInReferences(el)) return;
    if (highlighted.has(el as HTMLElement)) return;
    highlightSentence(el);
    highlighted.add(el as HTMLElement);
  };

  // Direct DOI mentions in the article body
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  anchors.forEach((a) => {
    const href = a.getAttribute("href") || a.href;
    if (!href || isInReferences(a)) return;
    const doi =
      extractDoiFromHref(href)?.toLowerCase() ||
      mapPublisherUrlToDoi(href)?.toLowerCase();
    if (doi && alertDois.has(doi)) {
      highlightSentenceSafe(a);
      return;
    }
    const refId = refIdForInline(a);
    if (refId) {
      const mapped = refMap.get(refId);
      if (mapped && alertDois.has(mapped)) {
        highlightSentenceSafe(a);
      }
    }
  });

  // Inline citation links pointing to reference list items
  const citationAnchors = Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href^='#'], a[data-rid], a[title*='reference'], sup a, sup[data-rid], sup[role='doc-noteref']"
    )
  );
  citationAnchors.forEach((a) => {
    if (isInReferences(a)) return;
    const rid = refIdForInline(a);
    if (!rid) return;
    const doi = refMap.get(rid.toLowerCase());
    if (doi && alertDois.has(doi)) {
      highlightSentenceSafe(a);
    }
  });
}

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
  const initialLines = articleLine === "" ? [] : [articleLine];
  updateBanner(articleBanner, { bg: articleBg, lines: initialLines });
  logDebug("Article banner updated", result);

  if (!id.startsWith("10.")) return true;

  const progress: ProgressHandle = createProgressBar(articleBanner, {
    id: "retraction-alert-article-progress",
    labelColor: COLORS.textLight,
    trackColor: COLORS.link,
    barColor: "#f57f17",
    hideLabelIfEmpty: true,
  });

  let refTotal = 0;
  const referenceResult = await checkReferences(
    id,
    (done, total) => {
      refTotal = total;
      if (total > 0) {
        progress.update(
          done,
          total,
          `Checking citations... (${done}/${total})`
        );
      }
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

  const cachedStatuses = await getCache<Record<string, unknown>>(
    `status:${id.toLowerCase()}`
  );
  const referenceCachedCount = referenceResult.checked - referenceResult.failedChecks;

  let mailto: string | null = null;
  const correspondingEmail = (() => {
    const meta = document.querySelector('meta[name="citation_author_email"]');
    return meta?.getAttribute("content")?.trim() || null;
  })();
  if (referenceResult.alerts.length) {
    mailto = createEmailLink(
      id,
      correspondingEmail ?? "",
      referenceResult.alerts
    );
  }

  updateBanner(articleBanner, {
    bg: finalBg,
    textColor: referenceUnknown ? COLORS.textDark : undefined,
    lineColors:
      referenceUnknown && articleLine !== ""
        ? [COLORS.textDark, COLORS.textDark]
        : referenceUnknown
        ? [COLORS.textDark]
        : undefined,
    lines:
      referenceResult.alerts.length > 0
        ? [
            ...finalLines,
            "This page cites one or more retracted/flagged papers:",
          ]
        : finalLines,
    alerts: referenceResult.alerts,
  });
  if (referenceResult.alerts.length) {
    highlightCitingParagraphs(referenceResult.alerts);
  }
  if (mailto && referenceResult.alerts.length) {
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    actions.style.justifyContent = "center";
    actions.style.alignItems = "center";
    actions.style.marginTop = "8px";

    const button = document.createElement("a");
    button.href = mailto;
    button.textContent = "Email corresponding author";
    button.target = "_blank";
    button.rel = "noreferrer noopener";
    button.style.background = COLORS.link;
    button.style.color = "#4e342e";
    button.style.padding = "8px 14px";
    button.style.borderRadius = "8px";
    button.style.fontWeight = "bold";
    button.style.textDecoration = "none";
    button.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";

    const note = document.createElement("span");
    note.textContent =
      "Prefilled draft—review before sending. Helps keep citations tidy.";
    note.style.fontSize = "12px";
    note.style.color = COLORS.textLight;

    actions.appendChild(button);
    actions.appendChild(note);
    articleBanner.appendChild(actions);
  }
  progress.update(
    refTotal || referenceResult.checked,
    refTotal || referenceResult.checked,
    `Citations checked (${referenceCachedCount}/${refTotal || referenceResult.checked} from cache)`
  );
  logDebug("Reference banner updated", referenceResult);
  return true;
}
import { createEmailLink } from "../ui/banners";
