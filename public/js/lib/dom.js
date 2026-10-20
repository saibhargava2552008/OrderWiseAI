// Tiny DOM helpers. Text always goes in through text nodes, never innerHTML,
// so user-supplied values cannot inject markup.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * h("button", { class: "btn", type: "button", onclick: fn }, "Label")
 * - `false`, `null` and `undefined` props are skipped.
 * - `on…` props with function values become event listeners.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === false || value == null) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Icon from the inline SVG sprite in index.html (symbols are named i-<name>). */
export function svgIcon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
