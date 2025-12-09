export type ProgressHandle = {
  container: HTMLDivElement;
  label: HTMLDivElement;
  bar: HTMLDivElement;
  update: (done: number, total: number, extraLabel?: string) => void;
};

type ProgressOptions = {
  id?: string;
  labelColor?: string;
  barColor?: string;
  trackColor?: string;
  width?: string;
  height?: string;
};

export function createProgressBar(
  parent: HTMLElement,
  options: ProgressOptions = {}
): ProgressHandle {
  const container = document.createElement("div");
  container.id = options.id ?? "";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.gap = "4px";
  container.style.width = "100%";
  container.style.marginTop = "6px";

  const label = document.createElement("div");
  label.id = options.id ? `${options.id}-label` : "";
  label.style.fontSize = "13px";
  label.style.fontWeight = "bold";
  if (options.labelColor) label.style.color = options.labelColor;
  container.appendChild(label);

  const barOuter = document.createElement("div");
  barOuter.style.width = options.width ?? "90%";
  barOuter.style.height = options.height ?? "6px";
  barOuter.style.background = options.trackColor ?? "#ffe082";
  barOuter.style.borderRadius = "999px";
  barOuter.style.overflow = "hidden";

  const bar = document.createElement("div");
  bar.id = options.id ? `${options.id}-bar` : "";
  bar.style.height = "100%";
  bar.style.width = "0%";
  bar.style.background = options.barColor ?? "#f57f17";
  bar.style.transition = "width 0.2s ease-out";

  barOuter.appendChild(bar);
  container.appendChild(barOuter);
  parent.appendChild(container);

  const update = (done: number, total: number, extraLabel?: string) => {
    const remaining = Math.max(total - done, 0);
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    label.textContent =
      extraLabel ??
      `Progress: ${done}/${total} checked • remaining ${remaining}`;
    bar.style.width = `${pct}%`;
  };

  return { container, label, bar, update };
}
