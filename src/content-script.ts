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

const MAX_REFERENCE_CHECKS = 20;

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

async function fetchCrossrefMessage(doi: string): Promise<any | null> {
  if (!doi.startsWith("10.")) return null;

  const encodedIdPath = encodeURIComponent(doi).replace(/%2F/g, "/");
  const worksUrl = `https://api.crossref.org/v1/works/${encodedIdPath}`;
  const filterUrl = `https://api.crossref.org/v1/works?filter=doi:${encodeURIComponent(doi)}&rows=1`;

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

  let data: any | null = null;

  try {
    const primary = await fetchWork(worksUrl);
    logDebug("fetch worksUrl", worksUrl, "ok:", primary.ok, "status:", primary.status);
    data = primary.data;

    if (!data) {
      const fallback = await fetchWork(filterUrl);
      logDebug("fetch filterUrl", filterUrl, "ok:", fallback.ok, "status:", fallback.status);
      data = fallback.data;
      if (data?.message?.items?.length) {
        data = { message: data.message.items[0] };
      }
    }
  } catch (error) {
    logDebug("fetchCrossrefMessage error", error);
  }

  if (!data) return null;
  return data.message ?? null;
}

async function checkStatus(id: string): Promise<StatusResult> {
  // Only DOIs are handled via Crossref for now.
  if (!id.startsWith("10.")) return { status: "unknown" };

  const message = await fetchCrossrefMessage(id);
  if (!message) return { status: "unknown" };

  try {
    const assertions: unknown = message?.assertion ?? [];
    const updates: unknown = message?.["update-to"] ?? [];

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

interface ReferenceCheckResult {
  alerts: Array<{ id: string; status: ArticleStatus; noticeUrl?: string; label?: string }>;
  checked: number;
  totalFound: number;
}

async function checkReferences(doi: string): Promise<ReferenceCheckResult> {
  const message = await fetchCrossrefMessage(doi);
  if (!message) return { alerts: [], checked: 0, totalFound: 0 };

  const references: unknown = message.reference ?? [];
  const refList = Array.isArray(references) ? references : [];
  const dois = refList
    .map((ref) => {
      if (!ref || typeof ref !== "object") return null;
      const doiValue = (ref as { DOI?: string }).DOI;
      if (typeof doiValue === "string" && doiValue.startsWith("10.")) return doiValue;
      return null;
    })
    .filter((val): val is string => Boolean(val));

  const uniqueDois = Array.from(new Set(dois)).slice(0, MAX_REFERENCE_CHECKS);
  logDebug("checking references", { totalFound: dois.length, checking: uniqueDois.length });

  const results: Array<{ id: string; status: ArticleStatus; noticeUrl?: string; label?: string }> = [];
  let checked = 0;
  for (const refDoi of uniqueDois) {
    const status = await checkStatus(refDoi);
    checked += 1;
    updateReferenceProgress(checked, uniqueDois.length);
    if (ALERT_STATUSES.has(status.status)) {
      results.push({ id: refDoi, status: status.status, noticeUrl: status.noticeUrl, label: status.label });
    }
  }

  return { alerts: results, checked, totalFound: dois.length };
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

function injectReferencesBanner(alerts: Array<{ id: string; noticeUrl?: string }>, checked: number, totalFound: number): void {
  if (document.getElementById("retraction-alert-ref-banner")) return;

  const primary = document.getElementById("retraction-alert-banner");
  const offset = primary ? primary.getBoundingClientRect().height : 0;

  const banner = document.createElement("div");
  banner.id = "retraction-alert-ref-banner";
  banner.style.position = "fixed";
  banner.style.top = `${offset}px`;
  banner.style.left = "0";
  banner.style.right = "0";
  banner.style.zIndex = "999998";
  banner.style.display = "flex";
  banner.style.flexWrap = "wrap";
  banner.style.justifyContent = "center";
  banner.style.alignItems = "center";
  banner.style.gap = "0.4rem";
  banner.style.padding = "10px 14px";
  banner.style.backgroundColor = alerts.length ? "#8b0000" : "#1b5e20";
  banner.style.color = "#ffffff";
  banner.style.fontFamily = "Arial, sans-serif";
  banner.style.fontSize = "14px";
  banner.style.fontWeight = "bold";
  banner.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)";

  const text = document.createElement("span");
  if (alerts.length) {
    text.textContent = `⚠️ Cited retracted/flagged papers found (${alerts.length}).`;
  } else {
    text.textContent = `✅ Checked ${checked} of ${totalFound || checked} citations: no retractions found.`;
  }
  banner.appendChild(text);

  if (alerts.length) {
    const list = document.createElement("span");
    const links = alerts.slice(0, 5).map((alert) => {
      const a = document.createElement("a");
      a.href = alert.noticeUrl ?? `https://doi.org/${alert.id}`;
      a.textContent = alert.id;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.style.color = "#ffe082";
      a.style.textDecoration = "underline";
      return a;
    });

    links.forEach((link, idx) => {
      list.appendChild(link);
      if (idx < links.length - 1) {
        const sep = document.createTextNode(", ");
        list.appendChild(sep);
      }
    });

    banner.appendChild(list);
  }

  document.body.appendChild(banner);

  const bannerHeight = banner.getBoundingClientRect().height;
  const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
  const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
  document.body.style.paddingTop = `${parsedPadding + bannerHeight}px`;
}

function ensureReferenceProgressBanner(): HTMLDivElement {
  const existing = document.getElementById("retraction-alert-ref-progress") as HTMLDivElement | null;
  if (existing) return existing;

  const primary = document.getElementById("retraction-alert-banner");
  const offset = primary ? primary.getBoundingClientRect().height : 0;

  const wrapper = document.createElement("div");
  wrapper.id = "retraction-alert-ref-progress";
  wrapper.style.position = "fixed";
  wrapper.style.top = `${offset}px`;
  wrapper.style.left = "0";
  wrapper.style.right = "0";
  wrapper.style.zIndex = "999997";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "6px";
  wrapper.style.padding = "10px 14px";
  wrapper.style.backgroundColor = "#fbc02d";
  wrapper.style.color = "#000";
  wrapper.style.fontFamily = "Arial, sans-serif";
  wrapper.style.fontSize = "13px";
  wrapper.style.fontWeight = "bold";
  wrapper.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.2)";

  const label = document.createElement("div");
  label.id = "retraction-alert-ref-progress-label";
  label.textContent = "Checking citations...";
  wrapper.appendChild(label);

  const barOuter = document.createElement("div");
  barOuter.style.width = "320px";
  barOuter.style.maxWidth = "90vw";
  barOuter.style.height = "8px";
  barOuter.style.backgroundColor = "#ffe082";
  barOuter.style.borderRadius = "999px";
  barOuter.style.overflow = "hidden";

  const barInner = document.createElement("div");
  barInner.id = "retraction-alert-ref-progress-bar";
  barInner.style.height = "100%";
  barInner.style.width = "0%";
  barInner.style.backgroundColor = "#f57f17";
  barInner.style.transition = "width 0.2s ease-out";

  barOuter.appendChild(barInner);
  wrapper.appendChild(barOuter);

  document.body.appendChild(wrapper);

  const bannerHeight = wrapper.getBoundingClientRect().height;
  const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
  const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
  document.body.style.paddingTop = `${parsedPadding + bannerHeight}px`;

  return wrapper;
}

function updateReferenceProgress(done: number, total: number): void {
  if (total <= 0) return;
  const banner = ensureReferenceProgressBanner();
  const label = document.getElementById("retraction-alert-ref-progress-label");
  const bar = document.getElementById("retraction-alert-ref-progress-bar") as HTMLDivElement | null;
  if (label) {
    label.textContent = `Checking citations... (${done}/${total})`;
  }
  if (bar) {
    const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
    bar.style.width = `${pct}%`;
  }

  if (done >= total) {
    setTimeout(() => {
      banner.remove();
      const currentPaddingTop = window.getComputedStyle(document.body).paddingTop;
      const parsedPadding = Number.parseFloat(currentPaddingTop) || 0;
      const height = banner.getBoundingClientRect().height;
      document.body.style.paddingTop = `${Math.max(0, parsedPadding - height)}px`;
    }, 400);
  }
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

  if (id.startsWith("10.")) {
    const referenceResult = await checkReferences(id);
    injectReferencesBanner(referenceResult.alerts, referenceResult.checked, referenceResult.totalFound);
    if (referenceResult.alerts.length) {
      logDebug("Reference banner injected", referenceResult.alerts);
    } else {
      logDebug("No reference alerts", referenceResult);
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
