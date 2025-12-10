import {
  ALERT_STATUSES,
  MAX_REFERENCE_CONCURRENCY,
  MAX_REFERENCED_DOIS,
  getCrossrefUserAgent,
  CROSSREF_RATE_LIMIT_MS,
  CROSSREF_MAX_RETRIES,
  UNKNOWN_CACHE_TTL_MS,
} from "./constants";
import { getCache, setCache } from "./cache";
import { extractDoiFromHref } from "./doi";
import { logDebug } from "./log";
import { ArticleStatus, StatusResult, ReferenceCheckResult, AlertEntry } from "./types";

let lastRequestTime = 0;
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < CROSSREF_RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, CROSSREF_RATE_LIMIT_MS - elapsed)
    );
  }
  lastRequestTime = Date.now();
}

async function fetchWithBackoff(url: string): Promise<Response | null> {
  let attempt = 0;
  while (attempt <= CROSSREF_MAX_RETRIES) {
    await rateLimit();
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": getCrossrefUserAgent() },
      });
      if (res.status !== 429) return res;
      const retryAfter = res.headers.get("retry-after");
      const delayMs = retryAfter ? Number(retryAfter) * 1000 : 500;
      logDebug("crossref 429, backing off", { url, delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      logDebug("crossref fetch error", { url, error });
      return null;
    }
    attempt += 1;
  }
  return null;
}

async function fetchJsonViaBackground(
  url: string
): Promise<Record<string, unknown> | null> {
  const canMessage =
    typeof chrome !== "undefined" &&
    !!chrome.runtime?.id &&
    typeof chrome.runtime.sendMessage === "function";

  if (canMessage) {
    try {
      logDebug("crossref fetch via background", { url });
      const response = await chrome.runtime.sendMessage({
        type: "fetchJson",
        url,
      });
      if (response?.ok && response.data) {
        logDebug("crossref fetch via background success", {
          url,
          status: response.status,
        });
        return response.data as Record<string, unknown>;
      }
      logDebug("crossref fetch via background failed", {
        url,
        status: response?.status,
        error: response?.error,
      });
    } catch (error) {
      logDebug("crossref fetch via background error", { url, error });
    }
  }

  try {
    logDebug("crossref fetch direct", { url });
    const res = await fetchWithBackoff(url);
    if (!res) return null;
    if (!res.ok) {
      logDebug("crossref fetch direct failed", { url, status: res.status });
      return null;
    }
    logDebug("crossref fetch direct success", { url, status: res.status });
    const data = await res.json();
    return data as Record<string, unknown>;
  } catch (error) {
    logDebug("crossref fetch direct error", { url, error });
    return null;
  }
}

function mapStatusFromLabel(label: string): ArticleStatus {
  const normalized = label.toLowerCase();
  if (normalized.includes("retract")) return "retracted";
  if (normalized.includes("withdraw")) return "withdrawn";
  if (normalized.includes("expression of concern"))
    return "expression_of_concern";
  return "ok";
}

function findAlertInTexts(
  texts: string[]
): { status: ArticleStatus; match: string } | null {
  for (const text of texts) {
    if (!text) continue;
    const status = mapStatusFromLabel(text);
    if (status !== "ok") return { status, match: text };
  }
  return null;
}

export async function fetchCrossrefMessage(
  id: string
): Promise<Record<string, unknown> | null> {
  const normId = id.toLowerCase();
  try {
    const cached = await getCache<Record<string, unknown>>(
      `crossref:${normId}`
    );
    if (cached) return cached;

    // Crossref API expects the DOI path with slashes intact; encoding the entire
    // string turns "/" into %2F and triggers 400. Encode only exotic chars.
    const safeId = encodeURI(normId);
    const url = `https://api.crossref.org/v1/works/${safeId}`;
    const data = await fetchJsonViaBackground(url);
    if (!data) return null;
    const message =
      (data as { message?: Record<string, unknown> }).message ?? null;
    if (!message) return null;
    void setCache(`crossref:${normId}`, message);
    logDebug("parsed Crossref payload", {
      updateTo: (message as { "update-to"?: unknown })["update-to"],
      assertion: (message as { assertion?: unknown })["assertion"],
    });
    return message;
  } catch (error) {
    logDebug("fetchCrossrefMessage error", error);
    return null;
  }
}

function detectAlertFromMessage(message: Record<string, unknown>): StatusResult {
  const relation = (message as { relation?: unknown }).relation as
    | Record<string, unknown>
    | undefined;
  if (relation && typeof relation === "object") {
    for (const [key, value] of Object.entries(relation)) {
      const normalizedKey = key.toLowerCase();
      let status: ArticleStatus | null = null;
      if (normalizedKey.includes("retract")) status = "retracted";
      else if (normalizedKey.includes("withdraw")) status = "withdrawn";
      else if (normalizedKey.includes("expression")) status = "expression_of_concern";

      if (status) {
        const entries = Array.isArray(value) ? value : [];
        const doiEntry = entries.find(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof (entry as { "id-type"?: string })["id-type"] === "string" &&
            (entry as { "id-type": string })["id-type"].toLowerCase() === "doi"
        ) as { id?: string } | undefined;
        const idVal = doiEntry?.id;
        return {
          status,
          label: key,
          noticeUrl: typeof idVal === "string" ? idVal : undefined,
        };
      }
    }
  }

  const assertions =
    ((message as { assertion?: unknown }).assertion as unknown[]) ?? [];
  const updateTo =
    ((message as { "update-to"?: unknown })["update-to"] as unknown[]) ?? [];
  const texts: string[] = [];
  if (Array.isArray(assertions)) {
    for (const a of assertions) {
      if (a && typeof a === "object") {
        const label = (a as { label?: string }).label;
        const value = (a as { value?: string }).value;
        if (typeof label === "string") texts.push(label);
        if (typeof value === "string") texts.push(value);
      }
    }
  }
  if (Array.isArray(updateTo)) {
    for (const u of updateTo) {
      if (u && typeof u === "object") {
        const label = (u as { label?: string }).label;
        const type = (u as { type?: string }).type;
        const doi = (u as { DOI?: string }).DOI;
        const status = mapStatusFromLabel(label || type || "");
        if (status !== "ok") {
          return { status, label: label || type || "", noticeUrl: doi };
        }
      }
    }
  }
  const alert = findAlertInTexts(texts);
  if (alert) return { status: alert.status, label: alert.match };

  const policies = (message["update-policy"] as unknown) ?? [];
  const policiesArr = Array.isArray(policies) ? policies : [];
  const policyAlert = findAlertInTexts(policiesArr as string[]);
  if (policyAlert) return { status: policyAlert.status, label: policyAlert.match };

  return { status: "ok" };
}

export async function fetchWork(
  doi: string
): Promise<StatusResult & { title?: string }> {
  const safeDoi = encodeURI(doi.toLowerCase());
  const targetUrl = `https://api.crossref.org/v1/works/${safeDoi}`;
  try {
    const data = await fetchJsonViaBackground(targetUrl);
    if (!data) {
      logDebug("fetchWork error", targetUrl, "no data");
      return { status: "unknown" };
    }
    const message = data?.message as Record<string, unknown> | undefined;
    if (!message) return { status: "unknown" };

    const detected = detectAlertFromMessage(message);
    const title = Array.isArray(message.title)
      ? (message.title[0] as string | undefined)
      : undefined;
    if (detected.status !== "ok") {
      return { ...detected, title };
    }
    const updateTo = (message["update-to"] as unknown[]) ?? [];
    for (const u of updateTo) {
      if (u && typeof u === "object") {
        const type = (u as { type?: string }).type;
        const status = mapStatusFromLabel(type || "");
        if (status !== "ok") {
          return {
            status,
            label: (u as { label?: string }).label,
            noticeUrl: (u as { DOI?: string }).DOI,
            title,
          };
        }
      }
    }
    const assertions = (message.assertion as unknown[]) ?? [];
    for (const a of assertions) {
      if (a && typeof a === "object") {
        const label = (a as { label?: string }).label || "";
        const status = mapStatusFromLabel(label);
        if (status !== "ok") {
          return { status, label, title };
        }
      }
    }
    return { status: "ok", title };
  } catch (error) {
    logDebug("fetchWork error", targetUrl, error);
    return { status: "unknown" };
  }
}

export async function checkStatus(id: string): Promise<StatusResult> {
  if (!id.startsWith("10.")) return { status: "unknown" };
  const normalizedId = id.toLowerCase();
  if (normalizedId.includes("osf.io/")) {
    return { status: "unknown" };
  }

  const cached = await getCache<StatusResult>(`status:${normalizedId}`);
  if (cached) {
    logDebug("using cached status", id);
    return cached;
  }

  logDebug("checkStatus fetch start", { id });
  const message = await fetchCrossrefMessage(normalizedId);
  if (!message) {
    void setCache(`status:${normalizedId}`, { status: "unknown" }, UNKNOWN_CACHE_TTL_MS);
    return { status: "unknown" };
  }

  try {
    const detected = detectAlertFromMessage(message);
    logDebug("checkStatus result", { id, detected });
    if (detected.status !== "unknown") {
      void setCache(`status:${normalizedId}`, detected);
    } else {
      void setCache(`status:${normalizedId}`, detected, UNKNOWN_CACHE_TTL_MS);
    }
    return detected;
  } catch (error) {
    logDebug("checkStatus error", error);
    void setCache(`status:${normalizedId}`, { status: "unknown" }, UNKNOWN_CACHE_TTL_MS);
    return { status: "unknown" };
  }
}

export async function checkReferences(
  doi: string,
  onProgress: (done: number, total: number) => void,
  additionalDois: string[] = []
): Promise<ReferenceCheckResult> {
  const message = await fetchCrossrefMessage(doi);
  const references: unknown = message?.reference ?? [];
  const refList = Array.isArray(references) ? references : [];
  const crossrefDois = refList
    .map((ref) => {
      if (!ref || typeof ref !== "object") return null;
      const doiValue = (ref as { DOI?: string }).DOI;
      if (typeof doiValue === "string" && doiValue.startsWith("10."))
        return doiValue.toLowerCase();
      return null;
    })
    .filter((val): val is string => Boolean(val));

  const extraDois = (additionalDois || [])
    .filter((d) => d.startsWith("10."))
    .map((d) => d.toLowerCase());
  const combinedDois = Array.from(new Set([...crossrefDois, ...extraDois]));

  if (!message && combinedDois.length === 0) {
    return {
      alerts: [],
      checked: 0,
      totalFound: 0,
      failedChecks: 1,
      counts: {
        ok: 0,
        retracted: 0,
        withdrawn: 0,
        expression_of_concern: 0,
        unknown: 1,
      },
    };
  }

  logDebug("checking references", {
    totalFound: crossrefDois.length + extraDois.length,
    checking: combinedDois.length,
  });

  const results: AlertEntry[] = [];
  let checked = 0;
  let failedChecks = 0;
  let index = 0;
  const counts: Record<ArticleStatus, number> = {
    ok: 0,
    retracted: 0,
    withdrawn: 0,
    expression_of_concern: 0,
    unknown: 0,
  };

  const worker = async () => {
    while (index < combinedDois.length) {
      const current = index++;
      const refDoi = combinedDois[current];
      const cacheKey = `status:${refDoi.toLowerCase()}`;
      const cachedStatus = await getCache<StatusResult>(cacheKey);
      let status: StatusResult;
      if (cachedStatus && cachedStatus.status !== "unknown") {
        status = cachedStatus;
        logDebug("using cached status (reference)", refDoi);
      } else {
        status = await checkStatus(refDoi);
        if (status.status !== "unknown") {
          void setCache(cacheKey, status);
        } else {
          void setCache(cacheKey, status, UNKNOWN_CACHE_TTL_MS);
        }
      }
      checked += 1;
      if (status.status === "unknown") {
        failedChecks += 1;
        counts.unknown += 1;
      } else if (ALERT_STATUSES.has(status.status)) {
        counts[status.status] += 1;
        results.push({
          id: refDoi,
          status: status.status,
          noticeUrl: status.noticeUrl,
          label: status.label,
          title: status.title,
        });
      } else {
        counts.ok += 1;
      }
      onProgress(checked, combinedDois.length);
    }
  };

  const concurrency = Math.min(
    MAX_REFERENCE_CONCURRENCY,
    combinedDois.length || 1
  );
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return {
    alerts: results,
    checked,
    totalFound: crossrefDois.length + extraDois.length,
    failedChecks,
    counts,
  };
}
