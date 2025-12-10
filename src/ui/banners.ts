import { AlertEntry, ArticleStatus } from "../types";
import {
  SUPPORT_URL,
  DONATE_URL,
  ABOUT_URL,
  STORE_URL,
} from "../constants";
import { logDebug } from "../log";
import { clearCaches } from "../cache";

export type AlertItem = AlertEntry;
export type BannerAction = { label: string; href: string; title?: string };
type BannerLineColor = string | undefined;
import { COLORS } from "./colors";

const STATE = {
  basePadding: 0,
  wrapper: null as HTMLDivElement | null,
  articleBanner: null as HTMLDivElement | null,
  citationsBanner: null as HTMLDivElement | null,
  visible: true,
};

export function clearUiState(): void {
  STATE.wrapper = null;
  STATE.articleBanner = null;
  STATE.citationsBanner = null;
}

function recalcPadding(): void {
  if (!STATE.wrapper) return;
  if (!STATE.visible) {
    document.body.style.paddingTop = `${STATE.basePadding}px`;
    return;
  }
  const height = STATE.wrapper.getBoundingClientRect().height;
  document.body.style.paddingTop = `${STATE.basePadding + height}px`;
}

export function injectCacheClearButton(container: HTMLElement): void {
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  spacer.style.minWidth = "12px";

  const btn = document.createElement("button");
  btn.textContent = "Clear cache";
  btn.style.border = "none";
  btn.style.cursor = "pointer";
  btn.style.background = COLORS.link;
  btn.style.color = "#4e342e";
  btn.style.fontWeight = "bold";
  btn.style.padding = "6px 10px";
  btn.style.borderRadius = "6px";
  btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      clearCaches();
      logDebug("cache cleared");
      btn.textContent = "Cache cleared";
      setTimeout(() => {
        btn.textContent = "Clear cache";
      }, 1500);
    } catch (error) {
      logDebug("cache clear error", error);
    }
  });
  container.appendChild(spacer);
  container.appendChild(btn);
}

export function removeProgressBanner(): void {
  const banner = document.getElementById("retraction-alert-ref-progress");
  if (banner) {
    banner.remove();
    recalcPadding();
  }
}

export function setWrapperVisibility(visible: boolean): void {
  if (!STATE.wrapper) return;
  STATE.visible = visible;
  STATE.wrapper.style.display = visible ? "flex" : "none";
  recalcPadding();
}

function openAboutModal(): void {
  const existing = document.getElementById("retraction-alert-about-modal");
  if (existing) {
    existing.remove();
  }
  const overlay = document.createElement("div");
  overlay.id = "retraction-alert-about-modal";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.backgroundColor = "rgba(0,0,0,0.45)";
  overlay.style.zIndex = "999999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const modal = document.createElement("div");
  modal.style.background = "#fff";
  modal.style.color = "#222";
  modal.style.borderRadius = "10px";
  modal.style.padding = "16px 18px";
  modal.style.minWidth = "280px";
  modal.style.maxWidth = "360px";
  modal.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
  modal.style.fontFamily = "Arial, sans-serif";
  modal.style.textAlign = "center";

  const title = document.createElement("div");
  title.textContent = "Retraction Alert";
  title.style.fontWeight = "bold";
  title.style.fontSize = "16px";
  title.style.marginBottom = "8px";
  modal.appendChild(title);

  const desc = document.createElement("div");
  desc.textContent = "Learn more or support the extension:";
  desc.style.fontSize = "13px";
  desc.style.marginBottom = "12px";
  modal.appendChild(desc);

  const links = document.createElement("div");
  links.style.display = "flex";
  links.style.flexDirection = "column";
  links.style.gap = "8px";

  const linkBtn = (label: string, href: string) => {
    const a = document.createElement("a");
    a.textContent = label;
    a.href = href;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    a.style.background = COLORS.link;
    a.style.color = "#4e342e";
    a.style.padding = "8px 10px";
    a.style.borderRadius = "8px";
    a.style.fontWeight = "bold";
    a.style.textDecoration = "none";
    a.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
    return a;
  };

  links.appendChild(linkBtn("Chrome extension page", STORE_URL));
  links.appendChild(linkBtn("Support via donation", DONATE_URL));
  modal.appendChild(links);

  const close = document.createElement("button");
  close.textContent = "Close";
  close.style.marginTop = "14px";
  close.style.border = "none";
  close.style.cursor = "pointer";
  close.style.background = "#eee";
  close.style.color = "#222";
  close.style.padding = "6px 10px";
  close.style.borderRadius = "6px";
  close.style.fontWeight = "bold";
  close.addEventListener("click", () => overlay.remove());
  modal.appendChild(close);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export function ensureBanners(): {
  wrapper: HTMLDivElement;
  article: HTMLDivElement;
  citations: HTMLDivElement;
} {
  if (STATE.wrapper && STATE.articleBanner && STATE.citationsBanner) {
    return {
      wrapper: STATE.wrapper,
      article: STATE.articleBanner.querySelector("div") as HTMLDivElement,
      citations: STATE.citationsBanner.querySelector("div") as HTMLDivElement,
    };
  }

  if (!STATE.basePadding) {
    STATE.basePadding =
      Number.parseFloat(window.getComputedStyle(document.body).paddingTop) || 0;
  }

  const wrapper = document.createElement("div");
  wrapper.id = "retraction-alert-wrapper";
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "0";
  wrapper.style.right = "0";
  wrapper.style.zIndex = "999998";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "4px";

  const makeBanner = (): HTMLDivElement => {
    const div = document.createElement("div");
    div.style.minHeight = "44px";
    div.style.display = "flex";
    div.style.alignItems = "stretch";
    div.style.padding = "0";
    div.style.fontFamily = "Arial, sans-serif";
    div.style.fontSize = "14px";
    div.style.fontWeight = "bold";
    div.style.color = COLORS.textLight;
    div.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)";
    div.style.borderRadius = "0";

    const content = document.createElement("div");
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "4px";
    content.style.alignItems = "center";
    content.style.padding = "10px 14px";
    content.style.flex = "1";
    div.appendChild(content);

    const actions = document.createElement("div");
    actions.id = "retraction-alert-actions";
    actions.style.display = "flex";
    actions.style.flexDirection = "column";
    actions.style.gap = "6px";
    actions.style.alignItems = "stretch";
    actions.style.justifyContent = "center";
    actions.style.padding = "8px 12px";
    actions.style.backgroundColor = "inherit";
    actions.style.minWidth = "0";
    actions.style.width = "190px";
    actions.style.boxSizing = "border-box";

    const makeLinkButton = (label: string, href: string, title?: string) => {
      const a = document.createElement("a");
      a.textContent = label;
      a.href = href;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.style.background = COLORS.link;
      a.style.color = "#4e342e";
      a.style.padding = "6px 8px";
      a.style.borderRadius = "6px";
      a.style.fontWeight = "bold";
      a.style.fontSize = "13px";
      a.style.textDecoration = "none";
      a.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
      a.style.display = "block";
      a.style.width = "100%";
      a.style.boxSizing = "border-box";
      a.style.textAlign = "center";
      if (title) a.title = title;
      return a;
    };

    const bugBtn = makeLinkButton("Report bug", "https://Luca-Dellanna.com/contact", "Report an issue");

    const infoBtn = document.createElement("button");
    infoBtn.textContent = "About";
    infoBtn.style.background = COLORS.link;
    infoBtn.style.color = "#4e342e";
    infoBtn.style.padding = "6px 8px";
    infoBtn.style.borderRadius = "6px";
    infoBtn.style.fontWeight = "bold";
    infoBtn.style.fontSize = "13px";
    infoBtn.style.textDecoration = "none";
    infoBtn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
    infoBtn.style.border = "none";
    infoBtn.style.cursor = "pointer";
    infoBtn.style.display = "block";
    infoBtn.style.width = "100%";
    infoBtn.style.boxSizing = "border-box";
    infoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openAboutModal();
    });
    actions.appendChild(bugBtn);
    actions.appendChild(infoBtn);
    div.appendChild(actions);

    (div as unknown as { content?: HTMLElement }).content = content;
    (div as unknown as { actions?: HTMLElement }).actions = actions;
    return div;
  };

  const article = makeBanner();
  const citations = makeBanner();
  wrapper.appendChild(article);
  wrapper.appendChild(citations);
  document.body.appendChild(wrapper);

  STATE.wrapper = wrapper;
  STATE.articleBanner = article;
  STATE.citationsBanner = citations;

  recalcPadding();

  return {
    wrapper,
    article: article.querySelector("div") as HTMLDivElement,
    citations: citations.querySelector("div") as HTMLDivElement,
  };
}

export function ensureReferenceProgressBanner(): HTMLDivElement {
  const existing = document.getElementById(
    "retraction-alert-ref-progress"
  ) as HTMLDivElement | null;
  if (existing) return existing;

  const { wrapper } = ensureBanners();

  const container = document.createElement("div");
  container.id = "retraction-alert-ref-progress";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.gap = "6px";
  container.style.padding = "10px 14px";
  container.style.backgroundColor = COLORS.warning;
  container.style.color = "#000";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.fontSize = "13px";
  container.style.fontWeight = "bold";
  container.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.2)";

  const label = document.createElement("div");
  label.id = "retraction-alert-ref-progress-label";
  label.textContent = "Checking citations...";
  container.appendChild(label);

  const barOuter = document.createElement("div");
  barOuter.style.width = "320px";
  barOuter.style.maxWidth = "90vw";
  barOuter.style.height = "8px";
  barOuter.style.backgroundColor = COLORS.link;
  barOuter.style.borderRadius = "999px";
  barOuter.style.overflow = "hidden";

  const barInner = document.createElement("div");
  barInner.id = "retraction-alert-ref-progress-bar";
  barInner.style.height = "100%";
  barInner.style.width = "0%";
  barInner.style.backgroundColor = "#f57f17";
  barInner.style.transition = "width 0.2s ease-out";

  barOuter.appendChild(barInner);
  container.appendChild(barOuter);

  wrapper.appendChild(container);
  recalcPadding();
  return container;
}

export function updateReferenceProgress(done: number, total: number): void {
  if (total <= 0) return;
  const banner = ensureReferenceProgressBanner();
  const label = document.getElementById("retraction-alert-ref-progress-label");
  const bar = document.getElementById(
    "retraction-alert-ref-progress-bar"
  ) as HTMLDivElement | null;
  if (label) {
    label.textContent = `Checking citations... (${done}/${total})`;
  }
  if (bar) {
    const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
    bar.style.width = `${pct}%`;
  }

  if (done >= total) {
    setTimeout(() => {
      removeProgressBanner();
    }, 400);
  }
}

export function updateBanner(
  banner: HTMLDivElement,
  options: {
    bg: string;
    lines: string[];
    alerts?: AlertItem[];
    actions?: BannerAction[];
    textColor?: string;
    lineColors?: BannerLineColor[];
  }
): void {
  const parent = banner.parentElement as HTMLElement | null;
  if (parent) {
    parent.style.backgroundColor = options.bg;
    parent.style.color = options.textColor ?? COLORS.textLight;
  }
  banner.style.backgroundColor = options.bg;
  banner.style.color = options.textColor ?? COLORS.textLight;
  banner.style.display = "flex";
  banner.innerHTML = "";
  options.lines.forEach((line, idx) => {
    const div = document.createElement("div");
    div.textContent = line;
    div.style.textAlign = "center";
    const lineColor = options.lineColors?.[idx];
    if (lineColor) div.style.color = lineColor;
    banner.appendChild(div);
  });
  if (options.alerts && options.alerts.length) {
    banner.appendChild(buildAlertList(options.alerts));
  }
  if (options.actions && options.actions.length) {
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    actions.style.justifyContent = "center";

    options.actions.forEach((action) => {
      const link = document.createElement("a");
      link.href = action.href;
      link.textContent = action.label;
      if (action.title) link.title = action.title;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.style.background = COLORS.link;
      link.style.color = "#4e342e";
      link.style.padding = "6px 10px";
      link.style.borderRadius = "6px";
      link.style.fontWeight = "bold";
      link.style.textDecoration = "none";
      link.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";
      actions.appendChild(link);
    });

    banner.appendChild(actions);
  }
  recalcPadding();
}

export function statusLabel(status: ArticleStatus): string {
  switch (status) {
    case "retracted":
      return "Retracted";
    case "withdrawn":
      return "Withdrawn";
    case "expression_of_concern":
      return "Expression of concern";
    case "ok":
      return "OK";
    default:
      return "Unknown";
  }
}

export function countsSummary(
  label: string,
  counts: Record<ArticleStatus, number>,
  total: number,
  failed: number
): string {
  return `${label}: ${total} total • retracted ${
    counts.retracted
  } • withdrawn ${counts.withdrawn} • expression of concern ${
    counts.expression_of_concern
  } • unknown/failed ${Math.max(counts.unknown, failed)}`;
}

export function createEmailLink(
  id: string,
  target: string | undefined,
  alerts: AlertItem[]
): string {
  const subject = encodeURIComponent(`Retracted/flagged research noticed`);
  const lines: string[] = [];
  lines.push(`Article: ${id}`);
  lines.push("");
  if (alerts.length) {
    lines.push("Flagged citations:");
    for (const alert of alerts) {
      lines.push(
        `- ${alert.title ? `${alert.title} (${alert.id})` : alert.id} [${statusLabel(
          alert.status
        )}]`
      );
    }
  }
  lines.push("");
  lines.push("Via Retraction Alert.");
  lines.push(SUPPORT_URL);
  const body = encodeURIComponent(lines.join("\n"));
  return `mailto:${target ?? ""}?subject=${subject}&body=${body}`;
}

function buildAlertList(alerts: AlertItem[]): HTMLElement {
  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "4px";
  alerts.forEach((a) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "6px";
    row.style.alignItems = "center";
    row.style.color = COLORS.textLight;

    const badge = document.createElement("span");
    badge.textContent = statusLabel(a.status);
    badge.style.padding = "2px 6px";
    badge.style.borderRadius = "4px";
    badge.style.background =
      a.status === "ok"
        ? "#2e7d32"
        : a.status === "expression_of_concern"
        ? "#ef6c00"
        : COLORS.danger;
    badge.style.color = COLORS.textLight;
    badge.style.fontWeight = "bold";
    row.appendChild(badge);

    const link = document.createElement("a");
    link.href = `https://doi.org/${a.id}`;
    link.textContent = a.title ? `${a.title} (${a.id})` : a.id;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.style.color = COLORS.textLight;
    link.style.textDecoration = "underline";
    row.appendChild(link);

    if (a.noticeUrl) {
      const notice = document.createElement("a");
      notice.href = a.noticeUrl.startsWith("http")
        ? a.noticeUrl
        : `https://doi.org/${a.noticeUrl}`;
      notice.textContent = a.label ?? "Notice";
      notice.target = "_blank";
      notice.rel = "noreferrer noopener";
      notice.style.color = "#c5e1a5";
      notice.style.textDecoration = "underline";
      row.appendChild(notice);
    }

    list.appendChild(row);
  });
  return list;
}
