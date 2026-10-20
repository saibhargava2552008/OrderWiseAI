import { h } from "../lib/dom.js";

/**
 * Cuisine chips, a "works for everyone" switch and a sort menu.
 * The controls are built once and updated in place, so keyboard focus is never lost.
 * `state` is mutated here; `onChange` re-renders the plan list.
 */
export function mountFilters(root, cuisines, state, onChange) {
  const chips = cuisines.map((cuisine) =>
    h(
      "button",
      {
        type: "button",
        class: "chip",
        "aria-pressed": "false",
        onclick: (event) => {
          const button = event.currentTarget;
          const pressed = button.getAttribute("aria-pressed") !== "true";
          button.setAttribute("aria-pressed", String(pressed));
          if (pressed) state.cuisines.add(cuisine);
          else state.cuisines.delete(cuisine);
          onChange();
        },
      },
      cuisine,
    ),
  );

  const onlyWorking = h("input", {
    type: "checkbox",
    id: "filter-working",
    onchange: (event) => {
      state.onlyWorking = event.currentTarget.checked;
      onChange();
    },
  });

  const sort = h(
    "select",
    {
      id: "filter-sort",
      onchange: (event) => {
        state.sort = event.currentTarget.value;
        onChange();
      },
    },
    h("option", { value: "best" }, "Best for the group"),
    h("option", { value: "lowest-total" }, "Lowest total"),
  );

  root.replaceChildren(
    h(
      "div",
      { class: "filters__group", role: "group", "aria-labelledby": "filter-cuisine-label" },
      h("span", { id: "filter-cuisine-label", class: "filters__label" }, "Cuisine"),
      h("div", { class: "chips" }, chips),
    ),
    h(
      "div",
      { class: "filters__row" },
      h("label", { class: "check", for: "filter-working" }, onlyWorking, "Only plans that work for everyone"),
      h("label", { class: "select", for: "filter-sort" }, "Sort by", sort),
    ),
  );

  /** Resets every control and the shared state; used by the empty state's "Clear filters" button. */
  return function reset() {
    state.cuisines.clear();
    state.onlyWorking = false;
    state.sort = "best";
    chips.forEach((chip) => chip.setAttribute("aria-pressed", "false"));
    onlyWorking.checked = false;
    sort.value = "best";
    onChange();
  };
}
