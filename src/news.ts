import { AlertEntry, ArticleStatus } from "./types";
import {
  ALERT_STATUSES,
  NEWS_CONTACTS,
  SUPPORT_URL,
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

export const NEWS_HOSTS = [
  "abc.net.au",
  "elpais.com",
  "elmundo.es",
  "lavanguardia.com",
  "faz.net",
  "globo.com",
  "corriere.it",
  "lemonde.fr",
  "lefigaro.fr",
  "lastampa.it",
  "repubblica.it",
  "bild.de",
  "zeit.de",
  "spiegel.de",
  "theage.com.au",
  "telegraph.co.uk",
  "independent.co.uk",
  "thetimes.co.uk",
  "wsj.com",
  "theguardian.com",
  "nytimes.com",
  "washingtonpost.com",
  "economist.com",
  "ft.com",
  "bbc.com",
  "reuters.com",
  "latimes.com",
  "nbcnews.com",
  "cnn.com",
];

export const SCIENCE_HOSTS = [
  "doi.org",
  "nature.com",
  "thelancet.com",
  "science.org",
  "sciencedirect.com",
  "link.springer.com",
  "onlinelibrary.wiley.com",
  "tandfonline.com",
  "jamanetwork.com",
  "nejm.org",
  "bmj.com",
  "journals.plos.org",
  "pubs.acs.org",
  "ieeexplore.ieee.org",
  "dl.acm.org",
  "arxiv.org",
  "biorxiv.org",
  "medrxiv.org",
  "academic.oup.com",
  "psycnet.apa.org",
  "cambridge.org",
];

export async function handleNewsPage(
  hostname: string,
  citations: HTMLDivElement
): Promise<boolean> {
  const isNews = NEWS_HOSTS.some((h) => hostname.includes(h));
  if (!isNews) return false;

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
    return true;
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
    mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
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

  logDebug("News page processed", { candidateDois: candidateDois.size, alerts: allAlerts.length });
  return true;
}
