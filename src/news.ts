import { AlertEntry, ArticleStatus } from "./types";
import {
  ALERT_STATUSES,
  NEWS_CONTACTS,
  SUPPORT_URL,
  SCIENCE_HOSTS,
  NEWS_HOSTS,
} from "./constants";
import {
  countsSummary,
  updateBanner,
  setWrapperVisibility,
} from "./ui/banners";
import { COLORS } from "./ui/colors";
import { checkStatus, checkReferences } from "./crossref";
import { extractDoiFromHref, mapPublisherUrlToDoi } from "./doi";
import { logDebug } from "./log";
import { createProgressBar, ProgressHandle } from "./ui/progress";
import { highlightSentence } from "./ui/highlight";

export async function handleNewsPage(
  hostname: string,
  articleBanner: HTMLDivElement,
  citations: HTMLDivElement
): Promise<boolean> {
  const isNews = NEWS_HOSTS.some((h) => hostname.includes(h));
  const isScienceHost = SCIENCE_HOSTS.some((h) => hostname.includes(h));
  if (!isNews) return false;
  // If a host is classified as both news and science (e.g., nih.gov), treat it
  // as science so we run the article workflow instead of the news flow.
  if (isScienceHost) return false;

  // Hide the article banner for news pages to avoid an empty/transparent bar.
  articleBanner.style.display = "none";

  const scanAndRender = async (): Promise<boolean> => {
    logDebug("news scan start", { hostname });
    const anchors = Array.from(
      document.querySelectorAll("a[href]")
    ) as HTMLAnchorElement[];

    const candidateDois = new Set<string>();
    anchors.forEach((a) => {
      try {
        const url = new URL(a.href, location.href);
        if (SCIENCE_HOSTS.some((h) => url.hostname.includes(h))) {
          let doi =
            extractDoiFromHref(url.href) || mapPublisherUrlToDoi(url.href);
          if (!doi) {
            const redirect = url.searchParams.get("redirect_uri");
            if (redirect) {
              const decoded = decodeURIComponent(redirect);
              doi =
                extractDoiFromHref(decoded) || mapPublisherUrlToDoi(decoded);
            }
          }
          if (doi) candidateDois.add(doi);
        }
      } catch {
        // ignore malformed URLs
      }
    });

    if (candidateDois.size === 0) {
      setWrapperVisibility(false);
      logDebug("news scan found no candidate DOIs");
      return false;
    }

    setWrapperVisibility(true);
    citations.style.display = "flex";
    updateBanner(citations, {
      bg: COLORS.warning,
      lines: ["Checking linked articles..."],
    });
    let progress: ProgressHandle | null = null;
    progress = createProgressBar(citations, {
      id: "retraction-alert-news-progress",
      labelColor: COLORS.textLight,
      trackColor: COLORS.link,
      barColor: "#f57f17",
    });
    const totalCandidates = candidateDois.size;
    let processed = 0;
    const updateProgress = () => {
      const remaining = Math.max(totalCandidates - processed, 0);
      progress?.update(
        processed,
        totalCandidates,
        `Linked articles: ${processed}/${totalCandidates} checked • remaining ${remaining}`
      );
    };
    updateProgress();

    const results: AlertEntry[] = [];
    const referenceAlerts: AlertEntry[] = [];
    let referenceFailedChecks = 0;
    let unknown = 0;

    for (const doi of candidateDois) {
      const status = await checkStatus(doi);
      if (status.status === "unknown") {
        unknown += 1;
      } else if (ALERT_STATUSES.has(status.status)) {
        results.push({
          id: doi,
          status: status.status,
          noticeUrl: status.noticeUrl,
          title: status.title,
        });
      }

      const referenceResult = await checkReferences(doi, () => {});
      referenceFailedChecks += referenceResult.failedChecks;
      if (referenceResult.alerts.length) {
        referenceAlerts.push(
          ...referenceResult.alerts.map((alert) => ({
            id: alert.id,
            status: alert.status,
            noticeUrl: alert.noticeUrl,
            title: alert.title
              ? `${alert.title} (cited by ${doi})`
              : `${alert.id} (cited by ${doi})`,
          }))
        );
      }
      processed += 1;
      updateProgress();
    }

    const counts: Record<ArticleStatus, number> = {
      ok: candidateDois.size - results.length - unknown,
      retracted: results.filter((r) => r.status === "retracted").length,
      withdrawn: results.filter((r) => r.status === "withdrawn").length,
      expression_of_concern: results.filter(
        (r) => r.status === "expression_of_concern"
      ).length,
      unknown,
    };

    const allAlerts = [...results, ...referenceAlerts];
    let mailto: string | null = null;
    if (allAlerts.length) {
      const newsDomain =
        NEWS_HOSTS.find((h) => hostname.includes(h)) || hostname;
      const recipient =
        Object.entries(NEWS_CONTACTS).find(([host]) =>
          newsDomain.includes(host)
        )?.[1] ?? "";
      const subject = `Retracted/flagged study linked on ${newsDomain}`;
      const bodyLines = [
        `Hi,`,
        "",
        `On ${newsDomain} page: ${location.href}`,
        `These linked studies appear retracted/flagged:`,
        ...allAlerts.map(
          (r) => `- ${r.title || r.id} (${r.status}): https://doi.org/${r.id}`
        ),
        "",
        "Sent via Retraction Alert",
        SUPPORT_URL,
      ];
      const body = bodyLines.join("\n");
      mailto = `mailto:${encodeURIComponent(
        recipient
      )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
        body
      )}`;
    }

    updateBanner(citations, {
      bg: allAlerts.length
        ? COLORS.danger
        : unknown || referenceFailedChecks
        ? COLORS.warning
        : COLORS.ok,
      lines: [
        `Linked articles: ${candidateDois.size} total • retracted ${counts.retracted} • withdrawn ${counts.withdrawn} • expression of concern ${counts.expression_of_concern} • unknown/failed ${unknown + referenceFailedChecks}`,
        ...(referenceAlerts.length
          ? [`Flagged references found in linked papers: ${referenceAlerts.length}`]
          : []),
      ],
      alerts: allAlerts,
    });

    // Highlight sentences containing flagged links
    const alertDois = new Set(allAlerts.map((a) => a.id.toLowerCase()));
    if (alertDois.size) {
      const anchorsAll = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[href]")
      );
      anchorsAll.forEach((a) => {
        const href = a.getAttribute("href") || a.href || "";
        const doi =
          extractDoiFromHref(href)?.toLowerCase() ||
          mapPublisherUrlToDoi(href)?.toLowerCase();
        if (doi && alertDois.has(doi)) {
          highlightSentence(a);
        }
      });
    }

    progress?.update(
      totalCandidates,
      totalCandidates,
      `Linked articles: ${candidateDois.size} checked`
    );

    if (mailto) {
      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.justifyContent = "center";
      actions.style.width = "100%";
      actions.style.marginTop = "6px";

      const button = document.createElement("button");
      button.textContent = "Email editor";
      button.style.border = "none";
      button.style.cursor = "pointer";
      button.style.background = COLORS.link;
      button.style.color = "#4e342e";
      button.style.fontWeight = "bold";
      button.style.padding = "6px 10px";
      button.style.borderRadius = "6px";
      button.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
      button.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.href = mailto!;
      });

      actions.appendChild(button);
      citations.appendChild(actions);
    }

    logDebug("News page processed", {
      candidateDois: candidateDois.size,
      alerts: allAlerts.length,
    });
    return true;
  };

  const initialHandled = await scanAndRender();
  if (!initialHandled && hostname.includes("linkedin.com")) {
    // LinkedIn loads anchors dynamically; observe and retry a few times.
    let scanning = false;
    const observer = new MutationObserver(() => {
      if (scanning) return;
      scanning = true;
      setTimeout(async () => {
        const handled = await scanAndRender();
        scanning = false;
        if (handled) observer.disconnect();
      }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Timed retries to catch late content without relying solely on mutations.
    const retries = [500, 1500, 3000, 6000];
    retries.forEach((delay) => {
      setTimeout(async () => {
        if (observer.disconnect) {
          const handled = await scanAndRender();
          if (handled) observer.disconnect();
        }
      }, delay);
    });
    // Stop observing after 8 seconds to avoid leaks
    setTimeout(() => observer.disconnect(), 8000);
  }
  return true;
}
