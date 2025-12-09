// tests/crossref.test.ts
import { strict as assert } from "node:assert";

// src/constants.ts
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var CROSSREF_USER_AGENT = "RetractionAlert/0.3.0 (mailto:info@Luca-Dellanna.com)";
var CROSSREF_RATE_LIMIT_MS = 100;
var CROSSREF_MAX_RETRIES = 2;

// src/cache.ts
var memoryCache = /* @__PURE__ */ new Map();
function isFresh(entry) {
  if (!entry) return false;
  return Date.now() - entry.ts < CACHE_TTL_MS;
}
async function getCache(key) {
  try {
    if (chrome?.storage?.local) {
      const result = await chrome.storage.local.get([key]);
      const entry = result[key];
      if (entry && isFresh(entry)) return entry.value;
    } else if (memoryCache.has(key)) {
      const entry = memoryCache.get(key);
      if (isFresh(entry)) return entry?.value ?? null;
    }
  } catch (error) {
  }
  return null;
}
async function setCache(key, value) {
  const entry = { value, ts: Date.now() };
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [key]: entry });
    } else {
      memoryCache.set(key, entry);
    }
  } catch {
  }
}

// src/log.ts
function logDebug(...args) {
  console.debug("[RetractionAlert]", ...args);
}

// src/crossref.ts
var lastRequestTime = 0;
async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < CROSSREF_RATE_LIMIT_MS) {
    await new Promise(
      (resolve) => setTimeout(resolve, CROSSREF_RATE_LIMIT_MS - elapsed)
    );
  }
  lastRequestTime = Date.now();
}
async function fetchWithBackoff(url) {
  let attempt = 0;
  while (attempt <= CROSSREF_MAX_RETRIES) {
    await rateLimit();
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": CROSSREF_USER_AGENT }
      });
      if (res.status !== 429) return res;
      const retryAfter = res.headers.get("retry-after");
      const delayMs = retryAfter ? Number(retryAfter) * 1e3 : 500;
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
async function fetchJsonViaBackground(url) {
  const canMessage = typeof chrome !== "undefined" && !!chrome.runtime?.id && typeof chrome.runtime.sendMessage === "function";
  if (canMessage) {
    try {
      logDebug("crossref fetch via background", { url });
      const response = await chrome.runtime.sendMessage({
        type: "fetchJson",
        url
      });
      if (response?.ok && response.data) {
        logDebug("crossref fetch via background success", {
          url,
          status: response.status
        });
        return response.data;
      }
      logDebug("crossref fetch via background failed", {
        url,
        status: response?.status,
        error: response?.error
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
    return data;
  } catch (error) {
    logDebug("crossref fetch direct error", { url, error });
    return null;
  }
}
function mapStatusFromLabel(label) {
  const normalized = label.toLowerCase();
  if (normalized.includes("retract")) return "retracted";
  if (normalized.includes("withdraw")) return "withdrawn";
  if (normalized.includes("expression of concern"))
    return "expression_of_concern";
  return "ok";
}
function findAlertInTexts(texts) {
  for (const text of texts) {
    if (!text) continue;
    const status = mapStatusFromLabel(text);
    if (status !== "ok") return { status, match: text };
  }
  return null;
}
async function fetchCrossrefMessage(id) {
  try {
    const cached = await getCache(`crossref:${id}`);
    if (cached) return cached;
    const safeId = encodeURI(id);
    const url = `https://api.crossref.org/v1/works/${safeId}`;
    const data = await fetchJsonViaBackground(url);
    if (!data) return null;
    const message = data.message ?? null;
    if (!message) return null;
    void setCache(`crossref:${id}`, message);
    logDebug("parsed Crossref payload", {
      updateTo: message["update-to"],
      assertion: message["assertion"]
    });
    return message;
  } catch (error) {
    logDebug("fetchCrossrefMessage error", error);
    return null;
  }
}
function detectAlertFromMessage(message) {
  const relation = message.relation;
  if (relation && typeof relation === "object") {
    for (const [key, value] of Object.entries(relation)) {
      const normalizedKey = key.toLowerCase();
      let status = null;
      if (normalizedKey.includes("retract")) status = "retracted";
      else if (normalizedKey.includes("withdraw")) status = "withdrawn";
      else if (normalizedKey.includes("expression")) status = "expression_of_concern";
      if (status) {
        const entries = Array.isArray(value) ? value : [];
        const doiEntry = entries.find(
          (entry) => entry && typeof entry === "object" && typeof entry["id-type"] === "string" && entry["id-type"].toLowerCase() === "doi"
        );
        const idVal = doiEntry?.id;
        return {
          status,
          label: key,
          noticeUrl: typeof idVal === "string" ? idVal : void 0
        };
      }
    }
  }
  const assertions = message.assertion ?? [];
  const updateTo = message["update-to"] ?? [];
  const texts = [];
  if (Array.isArray(assertions)) {
    for (const a of assertions) {
      if (a && typeof a === "object") {
        const label = a.label;
        const value = a.value;
        if (typeof label === "string") texts.push(label);
        if (typeof value === "string") texts.push(value);
      }
    }
  }
  if (Array.isArray(updateTo)) {
    for (const u of updateTo) {
      if (u && typeof u === "object") {
        const label = u.label;
        const type = u.type;
        const doi = u.DOI;
        const status = mapStatusFromLabel(label || type || "");
        if (status !== "ok") {
          return { status, label: label || type || "", noticeUrl: doi };
        }
      }
    }
  }
  const alert = findAlertInTexts(texts);
  if (alert) return { status: alert.status, label: alert.match };
  const policies = message["update-policy"] ?? [];
  const policiesArr = Array.isArray(policies) ? policies : [];
  const policyAlert = findAlertInTexts(policiesArr);
  if (policyAlert) return { status: policyAlert.status, label: policyAlert.match };
  return { status: "ok" };
}
async function checkStatus(id) {
  if (!id.startsWith("10.")) return { status: "unknown" };
  const normalizedId = id.toLowerCase();
  if (normalizedId.includes("osf.io/")) {
    return { status: "unknown" };
  }
  const cached = await getCache(`status:${id}`);
  if (cached) {
    logDebug("using cached status", id);
    return cached;
  }
  logDebug("checkStatus fetch start", { id });
  const message = await fetchCrossrefMessage(id);
  if (!message) return { status: "unknown" };
  try {
    const detected = detectAlertFromMessage(message);
    logDebug("checkStatus result", { id, detected });
    if (detected.status !== "unknown") {
      void setCache(`status:${id}`, detected);
    }
    return detected;
  } catch (error) {
    logDebug("checkStatus error", error);
    return { status: "unknown" };
  }
}

// tests/crossref.test.ts
async function run() {
  const doi = "10.1038/s41586-024-07219-0";
  const result = await checkStatus(doi);
  assert.equal(
    result.status,
    "retracted",
    `expected retracted, got ${result.status} (${result.label ?? "no label"})`
  );
  console.log("\u2713 crossref status check passed for", doi);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  void run();
}
export {
  run
};
