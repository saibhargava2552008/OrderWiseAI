// Plan evaluation for the Stage 1 preview. This runs in the browser only so the
// shell has something real to show. From Stage 4 the server-side budget engine
// becomes the single source of truth and this file goes away.

import { percentOf, splitEvenly } from "./money.js";

/**
 * Cost and suitability of one restaurant's sample combination for the group.
 * The cost is split equally for now; custom splits arrive with the review step.
 */
export function evaluatePlan(restaurant, session, members) {
  const itemsById = new Map(restaurant.items.map((item) => [item.id, item]));

  const lines = restaurant.combo.map(({ itemId, qty }) => {
    const item = itemsById.get(itemId);
    if (!item) throw new Error(`Unknown item ${itemId} in ${restaurant.id}`);
    return { item, qty, linePaise: item.pricePaise * qty };
  });

  const subtotalPaise = lines.reduce((sum, line) => sum + line.linePaise, 0);
  const feesPaise = restaurant.deliveryFeePaise + restaurant.packagingFeePaise;
  const taxPaise = percentOf(subtotalPaise, session.taxPercent);
  const totalPaise = subtotalPaise + feesPaise + taxPaise;

  const shares = splitEvenly(totalPaise, members.length);
  const memberShares = members.map((member, i) => ({
    member,
    sharePaise: shares[i],
    overLimitPaise: Math.max(0, shares[i] - member.limitPaise),
  }));

  // Diet rule: each member's preferred diet must be represented.
// "both" members can eat either option, so they do not force both dishes.
const mainQty = (diet) =>
  lines
    .filter((line) => line.item.kind === "main" && line.item.diet === diet)
    .reduce((sum, line) => sum + line.qty, 0);

const needs = (diet) =>
  members.filter((member) => member.diet === diet).length;

const missingDiets = ["veg", "nonveg"].filter(
  (diet) => needs(diet) > 0 && mainQty(diet) < needs(diet),
);

  const overBudgetPaise = Math.max(0, totalPaise - session.budgetPaise);
  const overLimit = memberShares.filter((s) => s.overLimitPaise > 0);
  const cuisineMatches = members.filter((m) => m.cuisines.includes(restaurant.cuisine)).length;

  return {
    restaurant,
    lines,
    subtotalPaise,
    feesPaise,
    taxPaise,
    totalPaise,
    memberShares,
    remainingPaise: session.budgetPaise - totalPaise,
    overBudgetPaise,
    overLimit,
    missingDiets,
    cuisineMatches,
    fitsBudget: overBudgetPaise === 0,
    withinLimits: overLimit.length === 0,
    coversDiets: missingDiets.length === 0,
    worksForGroup: overBudgetPaise === 0 && overLimit.length === 0 && missingDiets.length === 0,
  };
}

export function rankPlans(plans, sortKey) {
  const copy = [...plans];
  if (sortKey === "lowest-total") {
    return copy.sort((a, b) => a.totalPaise - b.totalPaise);
  }
  // "best": plans that work first, then more cuisine matches, then cheaper.
  return copy.sort(
    (a, b) =>
      Number(b.worksForGroup) - Number(a.worksForGroup) ||
      b.cuisineMatches - a.cuisineMatches ||
      a.totalPaise - b.totalPaise,
  );
}
