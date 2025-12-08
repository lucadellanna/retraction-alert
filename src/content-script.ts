type ArticleStatus = "ok" | "retracted" | "expression_of_concern" | "withdrawn" | "unknown";

interface StatusResult {
  status: ArticleStatus;
  label?: string;
  noticeUrl?: string;
}

const ALERT_STATUSES: Set<ArticleStatus> = new Set([
  "retracted",
  "withdrawn",
  "expression_of_concern"
]);

function logDebug(...args: unknown[]): void {
  // Prefix to make filtering easy in DevTools.
  console.debug("[RetractionAlert]", ...args);
}

function mapStatusFromLabel(label: string): ArticleStatus {
  const normalized = label.toLowerCase();
  if (normalized.includes("retract")) return "retracted";
  if (normalized.includes("withdraw")) return "withdrawn";
  if (normalized.includes("expression of concern")) return "expression_of_concern";
  return "ok";
}

function findAlertInTexts(texts: string[]): { status: ArticleStatus; match: string } | null {
  for (const text of texts) {
    if (!text) continue;
    const status = mapStatusFromLabel(text);
    if (status !== "ok") return { status, match: text };
  }
  return null;
}

async function checkStatus(id: string): Promise<StatusResult> {
  // Only DOIs are handled via Crossref for now.
  if (!id.startsWith("10.")) return { status: "unknown" };

  const encodedIdPath = encodeURIComponent(id).replace(/%2F/g, "/");
  const worksUrl = `https://api.crossref.org/v1/works/${encodedIdPath}`;
  const filterUrl = `https://api.crossref.org/v1/works?filter=doi:${encodeURIComponent(id)}&rows=1`;

  async function fetchWork(targetUrl: string): Promise<{ ok: boolean; status: number; data: any | null }> {
    try {
      const res = await fetch(targetUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) return { ok: false, status: res.status, data: null };
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (error) {
      logDebug("fetchWork error", targetUrl, error);
      return { ok: false, status: 0, data: null };
    }
  }

  try {
    let { ok, data, status } = await fetchWork(worksUrl);
    logDebug("fetch worksUrl", worksUrl, "ok:", ok, "status:", status);

    // Fallback path: query by filter if direct works endpoint responds with error.
    if (!data) {
      const fallback = await fetchWork(filterUrl);
      logDebug("fetch filterUrl", filterUrl, "ok:", fallback.ok, "status:", fallback.status);
      data = fallback.data;
      if (data?.message?.items?.length) {
        data = { message: data.message.items[0] };
      }
    }

    if (!data) return { status: "unknown" };

    const assertions: unknown = data.message?.assertion ?? [];
    const updates: unknown = data.message?.["update-to"] ?? [];

    const assertionList = Array.isArray(assertions) ? assertions : [];
    const updateList = Array.isArray(updates) ? updates : [];

    logDebug("parsed Crossref payload", {
      assertionCount: assertionList.length,
      updateCount: updateList.length
    });

    let mappedStatus: ArticleStatus = "ok";
    let labelSource = "";
    let noticeUrl: string | undefined;
    let assertionHit: Record<string, unknown> | undefined;
    let updateHit: Record<string, unknown> | undefined;

    for (const item of assertionList) {
      if (!item || typeof item !== "object") continue;
      const label = (item as { label?: string }).label ?? "";
      const value = (item as { value?: string }).value ?? "";
      const name = (item as { name?: string }).name ?? "";
      const candidate = findAlertInTexts([label, value, name]);
      if (candidate) {
        mappedStatus = candidate.status;
        labelSource = candidate.match;
        noticeUrl =
          (item as { URL?: string }).URL ??
          (item as { url?: string }).url ??
          (value.startsWith("http") ? value : undefined);
        assertionHit = item as Record<string, unknown>;
        break;
      }
    }

    if (mappedStatus === "ok") {
      for (const item of updateList) {
        if (!item || typeof item !== "object") continue;
        const type = (item as { type?: string }).type ?? "";
        const label = (item as { label?: string }).label ?? "";
        const candidate = findAlertInTexts([type, label]);
        if (candidate) {
          mappedStatus = candidate.status;
          labelSource = candidate.match;
          const updateDoi = (item as { DOI?: string }).DOI;
          noticeUrl =
            (item as { URL?: string }).URL ??
            (item as { url?: string }).url ??
            (typeof updateDoi === "string" ? `https://doi.org/${updateDoi}` : undefined);
          updateHit = item as Record<string, unknown>;
          break;
        }
      }
    }

    logDebug("checkStatus result", {
      id,
      mappedStatus,
      labelSource,
      noticeUrl,
      assertionHit,
      updateHit
    });

    if (mappedStatus !== "ok") {
      return {
        status: mappedStatus,
        label: labelSource || undefined,
        noticeUrl
      };
    }

    return { status: "ok" };
  } catch (error) {
    logDebug("checkStatus error", error);
    return { status: "unknown" };
  }
}

function extractDoiFromDoiOrg(): string | null {
  if (!location.hostname.endsWith("doi.org")) return null;
  const doi = decodeURIComponent(location.pathname.replace(/^\//, "")).trim();
  return doi ? doi : null;
}

function extractMetaDoi(): string | null {
  const meta = document.querySelector('meta[name="citation_doi"]');
  const doi = meta?.getAttribute("content")?.trim() ?? "";
  return doi || null;
}

function extractNatureDoiFromPath(): string | null {
  if (!location.hostname.endsWith("nature.com")) return null;
  const match = location.pathname.match(/\/articles\/([^/?#]+)/);
  if (!match) return null;
  const suffix = match[1];
  if (!suffix) return null;
  return `10.1038/${suffix}`;
}

function extractPmid(): string | null {
  if (!location.hostname.endsWith("pubmed.ncbi.nlm.nih.gov")) return null;
  const meta = document.querySelector('meta[name="citation_pmid"]');
  const pmid = meta?.getAttribute("content")?.trim() ?? "";
  return pmid || null;
}

function injectBanner(result: StatusResult): void {
  if (document.getElementById("retraction-alert-banner")) return;

  const banner = document.createElement("div");
  banner.id = "retraction-alert-banner";
  banner.textContent = "⚠️ This article has been retracted.";
  banner.style.position = "fixed";
  banner.style.top = "0";
  banner.style.left = "0";
  banner.style.right = "0";
  banner.style.zIndex = "999999";
  banner.style.display = "flex";
  banner.style.justifyContent = "center";
  banner.style.alignItems = "center";
  banner.style.gap = "0.5rem";
  banner.style.padding = "12px 16px";
  banner.style.backgroundColor = "#b00020";
  banner.style.color = "#ffffff";
  banner.style.fontFamily = "Arial, sans-serif";
  banner.style.fontSize = "16px";
  banner.style.fontWeight = "bold";
  banner.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)";

  if (result.noticeUrl) {
    const link = document.createElement("a");
    link.href = result.noticeUrl;
    link.textContent = result.label ?? "View notice";
    link.style.color = "#ffe082";
    link.style.textDecoration = "underline";
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    banner.appendChild(link);
  }

  document.body.appendChild(banner);

  const bannerHeight = banner.getBoundingClientRect().height;
  const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
  const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
  document.body.style.paddingTop = `${parsedPadding + bannerHeight}px`;
}

async function run(): Promise<void> {
  const id = extractDoiFromDoiOrg() ?? extractMetaDoi() ?? extractNatureDoiFromPath() ?? extractPmid();
  if (!id) {
    logDebug("No DOI/PMID found on this page");
    return;
  }

  logDebug("Detected identifier", id, "hostname:", location.hostname);

  const result = await checkStatus(id);
  if (ALERT_STATUSES.has(result.status)) {
    injectBanner(result);
    logDebug("Banner injected");
  } else {
    logDebug("Status not alerting", result);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void run();
  });
} else {
  void run();
}
