import { h } from "../lib/dom.js";
import { formatMoney } from "../lib/money.js";

/**
 * The plate rail: the shared budget drawn as one bar, split into each person's
 * share of the selected plan. Hatched space is budget left over. If the plan
 * costs more than the budget, the bar stretches and a marker shows where the
 * budget ends.
 */
export function createRail(root, session, members) {
  const segments = new Map(
    members.map((m) => [
      m.id,
      h("span", { class: `rail__seg rail__seg--${m.color}` }, h("span", { "aria-hidden": "true" }, m.name[0])),
    ]),
  );
  const left = h("span", { class: "rail__left" });
  const over = h("span", { class: "rail-over" });
  const limit = h(
    "span",
    { class: "rail-limit" },
    h("span", { class: "rail-limit__label" }, `Budget ${formatMoney(session.budgetPaise)}`),
  );
  const rail = h("div", { class: "rail" }, [...segments.values()], left);
  const wrap = h("div", { class: "rail-wrap", role: "img" }, rail, over, limit);
  const summary = h("p", { class: "rail-summary" });
  root.replaceChildren(wrap, summary);

  let hasRendered = false;
  let latestApply = () => {};

  return function update(plan) {
    const { totalPaise, remainingPaise, overBudgetPaise, memberShares, restaurant } = plan;
    const scale = Math.max(session.budgetPaise, totalPaise);
    const pct = (paise) => `${((paise / scale) * 100).toFixed(3)}%`;

    const applyWidths = () => {
      for (const { member, sharePaise } of memberShares) {
        segments.get(member.id).style.setProperty("--w", pct(sharePaise));
      }
      left.style.setProperty("--w", pct(Math.max(0, remainingPaise)));
      wrap.style.setProperty("--x", pct(session.budgetPaise));
    };
    // First paint starts from zero so the bar grows in once; later updates animate between plans.
    // The delayed first call always applies the newest plan, never a stale one.
    latestApply = applyWidths;
    if (hasRendered) applyWidths();
    else requestAnimationFrame(() => requestAnimationFrame(() => latestApply()));
    hasRendered = true;

    wrap.classList.toggle("is-over", overBudgetPaise > 0);

    const eachPays = formatMoney(memberShares[0].sharePaise);
    wrap.setAttribute(
      "aria-label",
      `Shared budget ${formatMoney(session.budgetPaise)}. ${restaurant.name} costs ${formatMoney(totalPaise)}. ` +
        memberShares.map((s) => `${s.member.name} pays ${formatMoney(s.sharePaise)}`).join(", ") +
        (overBudgetPaise > 0
          ? `. ${formatMoney(overBudgetPaise)} over budget.`
          : `. ${formatMoney(remainingPaise)} left in the budget.`),
    );

    // replaceChildren does not flatten nested arrays, so build one flat list of nodes.
    const budgetSentence =
      overBudgetPaise > 0
        ? [h("strong", { class: "is-bad" }, formatMoney(overBudgetPaise)), ` is over the ${formatMoney(session.budgetPaise)} budget. `]
        : [`That leaves `, h("strong", {}, formatMoney(remainingPaise)), ` of the ${formatMoney(session.budgetPaise)} budget. `];

    summary.replaceChildren(
      h("strong", {}, restaurant.name),
      ` costs `,
      h("strong", {}, formatMoney(totalPaise)),
      ` with delivery and tax. `,
      ...budgetSentence,
      `Split equally, each person pays about `,
      h("strong", {}, eachPays),
      `.`,
    );
  };
}
