import { h, svgIcon } from "../lib/dom.js";

/** Short confirmation message. The #toasts region is a polite live region, so screen readers announce it. */
export function showToast(message, { tone = "info", duration = 6000 } = {}) {
  const region = document.getElementById("toasts");
  if (!region) return;
  const toast = h(
    "div",
    { class: `toast toast--${tone}` },
    svgIcon(tone === "success" ? "check" : "info"),
    h("span", {}, message),
  );
  region.append(toast);
  while (region.children.length > 3) region.firstElementChild.remove();
  setTimeout(() => toast.remove(), duration);
}
