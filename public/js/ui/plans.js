import { h, svgIcon } from "../lib/dom.js";
import { formatMoney } from "../lib/money.js";

const DIET_WORD = { veg: "veg", nonveg: "non-veg" };

function check(tone, text) {
  return h("li", { class: `check-item check-item--${tone}` }, svgIcon(tone === "ok" ? "check" : tone === "bad" ? "alert" : "info"), text);
}

function checks(plan, session, memberCount) {
  const budget = formatMoney(session.budgetPaise);
  return h(
    "ul",
    { class: "check-list" },
    plan.fitsBudget
      ? check("ok", `Fits the ${budget} budget, with ${formatMoney(plan.remainingPaise)} left`)
      : check("bad", `${formatMoney(plan.overBudgetPaise)} over the ${budget} budget`),
    plan.withinLimits
      ? check("ok", "Everyone stays within their limit")
      : check("bad", `Over the limit for ${plan.overLimit.map((s) => s.member.name).join(", ")}`),
    plan.coversDiets
  ? check(
      "ok",
      plan.missingDiets.length === 0
        ? "Meets the group's dietary needs"
        : "Has the required main dishes",
    )
  : check(
      "bad",
      `Not enough ${plan.missingDiets.map((d) => DIET_WORD[d]).join(" and ")} main dishes`,
    ),
    check("info", `Matches ${plan.cuisineMatches} of ${memberCount} cuisine picks`),
  );
}

function receiptRow(label, paise, className) {
  return h("tr", { class: className }, h("th", { scope: "row" }, label), h("td", { class: "num" }, formatMoney(paise)));
}

function receipt(plan, session, memberCount) {
  return h(
    "table",
    { class: "receipt" },
    h("caption", {}, `Sample basket for ${memberCount} people`),
    h("thead", { class: "sr-only" }, h("tr", {}, h("th", { scope: "col" }, "Item"), h("th", { scope: "col" }, "Amount"))),
    h(
      "tbody",
      {},
      plan.lines.map((line) =>
        h("tr", {}, h("td", {}, `${line.qty} × ${line.item.name}`), h("td", { class: "num" }, formatMoney(line.linePaise))),
      ),
    ),
    h(
      "tbody",
      { class: "receipt__sum" },
      receiptRow("Food subtotal", plan.subtotalPaise),
      receiptRow("Delivery and packaging", plan.feesPaise),
      receiptRow(`Tax (${session.taxPercent}%, sample rate)`, plan.taxPaise),
    ),
    h(
      "tfoot",
      {},
      receiptRow("Total", plan.totalPaise, "receipt__total"),
      receiptRow("Each person pays about", plan.memberShares[0].sharePaise),
    ),
  );
}

function planItem(plan, ctx) {
  const r = plan.restaurant;
  const id = `plan-${r.id}`;
  return h(
    "li",
    { class: "plan" },
    h("input", {
      class: "plan__radio",
      type: "radio",
      name: "plan",
      id,
      value: r.id,
      checked: r.id === ctx.selectedId,
      "aria-labelledby": `${id}-name`,
      "aria-describedby": `${id}-meta`,
    }),
    h(
      "div",
      { class: "plan__body" },
      h(
        "div",
        { class: "plan__head" },
        h("h3", { class: "plan__name", id: `${id}-name` }, r.name),
        h("span", { class: "badge badge--demo" }, "Demo"),
      ),
      h(
        "p",
        { class: "plan__meta", id: `${id}-meta` },
        `${r.cuisine}. Sample rating ${r.rating.toFixed(1)}. ${r.etaMinutes[0]} to ${r.etaMinutes[1]} minutes.`,
      ),
      plan.worksForGroup || r.id === ctx.cheapestWorkingId
        ? h(
            "p",
            { class: "plan__tags" },
            plan.worksForGroup ? h("span", { class: "badge badge--ok" }, svgIcon("check"), "Works for everyone") : null,
            r.id === ctx.cheapestWorkingId ? h("span", { class: "badge badge--low" }, "Lowest total that works") : null,
          )
        : null,
      checks(plan, ctx.session, ctx.memberCount),
      receipt(plan, ctx.session, ctx.memberCount),
      h(
        "p",
        { class: "plan__choose" },
        h("span", { class: "plan__choose-off" }, "Plan with this"),
        h("span", { class: "plan__choose-on" }, svgIcon("check"), "Planning with this"),
      ),
    ),
  );
}

/** Replaces the plan cards, or shows the empty state when filters leave nothing. */
export function renderPlanList(root, plans, ctx) {
  if (plans.length === 0) {
    root.replaceChildren(
      h(
        "li",
        { class: "empty" },
        h("h3", {}, "No plans match these filters"),
        h("p", {}, "Remove a cuisine, or turn off “Only plans that work for everyone”, to see plans again."),
        h("button", { type: "button", class: "btn btn--secondary", onclick: ctx.onClear }, "Clear filters"),
      ),
    );
    return;
  }
  root.replaceChildren(...plans.map((plan) => planItem(plan, ctx)));
}
