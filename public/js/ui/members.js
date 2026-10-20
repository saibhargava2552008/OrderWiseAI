import { h, svgIcon } from "../lib/dom.js";
import { formatMoney } from "../lib/money.js";

const DIET_LABEL = { veg: "Veg", nonveg: "Non-veg" };

/** Fills the member ledger for the selected plan: each person's limit, share and whether they stay within it. */
export function renderMembers(tbody, tfoot, plan, session) {
  tbody.replaceChildren(
    ...plan.memberShares.map(({ member, sharePaise, overLimitPaise }) => {
      const isOver = overLimitPaise > 0;
      return h(
        "tr",
        {},
        h(
          "th",
          { scope: "row", class: "person" },
          h(
            "span",
            { class: "person__name" },
            h("span", { class: `swatch swatch--${member.color}`, "aria-hidden": "true" }),
            member.name,
          ),
          h(
            "span",
            { class: "person__line" },
            h("span", { class: `diet diet--${member.diet}`, "aria-hidden": "true" }),
            DIET_LABEL[member.diet],
          ),
          h("span", { class: "person__line" }, member.cuisines.join(", ")),
        ),
        h("td", { class: "num" }, formatMoney(member.limitPaise)),
        h(
          "td",
          { class: "num" },
          h("span", { class: "pay" }, formatMoney(sharePaise)),
          h(
            "span",
            { class: `status ${isOver ? "status--bad" : "status--ok"}` },
            svgIcon(isOver ? "alert" : "check"),
            isOver ? `${formatMoney(overLimitPaise)} over` : "Within limit",
          ),
        ),
      );
    }),
  );

  tfoot.replaceChildren(
    h(
      "tr",
      {},
      h("th", { scope: "row" }, "Group"),
      h("td", { class: "num" }, formatMoney(session.budgetPaise)),
      h(
        "td",
        { class: "num" },
        h("span", { class: "pay" }, formatMoney(plan.totalPaise)),
        h(
          "span",
          { class: `status ${plan.fitsBudget ? "status--ok" : "status--bad"}` },
          svgIcon(plan.fitsBudget ? "check" : "alert"),
          plan.fitsBudget ? "Within budget" : `${formatMoney(plan.overBudgetPaise)} over`,
        ),
      ),
    ),
  );
}
