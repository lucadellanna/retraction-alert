import {
  fetchOrcidDois,
  checkOrcidWorks,
  checkCitedRetractedFromWorks,
} from "../orcid";
import {
  countsSummary,
  setWrapperVisibility,
  updateBanner,
} from "../ui/banners";
import { extractDoiFromHref } from "../doi";
import { ALERT_STATUSES } from "../constants";
import { AlertEntry } from "../types";
import { logDebug } from "../log";
import { COLORS } from "../ui/colors";

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
    const doi = extractDoiFromHref(href) || extractDoiFromHref(text);
    if (!doi) return;
    const alert = alertMap.get(doi.toLowerCase());
    if (!alert) return;
    const target =
      (anchor.closest("[data-work-id]") as HTMLElement | null) ||
      (anchor.closest("li") as HTMLElement | null) ||
      anchor;
    if (!target || target.dataset.retractionAlertMarked) return;
    target.dataset.retractionAlertMarked = "1";
    target.style.borderLeft = `4px solid ${COLORS.badge}`;
    target.style.backgroundColor = "#ffebee";
    target.style.paddingLeft = "8px";
    const badge = document.createElement("span");
    badge.textContent = "Retracted";
    badge.style.background = COLORS.badge;
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

export async function handleOrcidProfile(
  articleBanner: HTMLDivElement,
  citationsBanner: HTMLDivElement,
  orcidId: string
): Promise<boolean> {
  if (!orcidId) return false;

  logDebug("Detected ORCID", orcidId);
  updateBanner(articleBanner, {
    bg: COLORS.warning,
    lines: ["Checking ORCID works..."],
  });
  updateBanner(citationsBanner, {
    bg: COLORS.warning,
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
  updateBanner(articleBanner, {
    bg: worksHasEoc
      ? COLORS.danger
      : worksResult.failedChecks
      ? COLORS.warning
      : COLORS.ok,
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
  updateBanner(citationsBanner, {
    bg:
      citationsHasEoc || citationsResult.alerts.length
        ? COLORS.danger
        : citationsUnknown
        ? COLORS.neutral
        : COLORS.ok,
      textColor: citationsUnknown ? COLORS.textDark : undefined,
      lineColors: citationsUnknown
        ? [COLORS.textDark, COLORS.ok, COLORS.danger]
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
  setWrapperVisibility(true);
  return true;
}
