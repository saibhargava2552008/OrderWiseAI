
import { percentOf, splitEvenly } from "./money.js";
import { mealPairings } from "../data/demoData.js";

/**
 * Search small menu combinations and return the lowest-cost basket
 * that satisfies the group budget, individual limits and dietary needs.
 * This uses demo menu data only.
 */
export function generateSmartBasket(restaurant, session, members) {
  if (!members.length) return null;

  const mainNeeds = {
    veg: members.filter((m) => m.diet === "veg").length,
    nonveg: members.filter((m) => m.diet === "nonveg").length,
  };


  const candidates = [];

  // Search up to 5 units of each available dish.
  function search(index, quantities) {
    if (index === restaurant.items.length) {
      const lines = restaurant.items
        .map((item, i) => ({
          item,
          qty: quantities[i],
          linePaise: item.pricePaise * quantities[i],
        }))
        .filter((line) => line.qty > 0);

      if (!lines.length) return;
      
const selectedIds = new Set(lines.map((line) => line.item.id));

const mainLines = lines.filter(
  (line) => line.item.kind === "main",
);

if (!mainLines.length) return;

// Every main dish must include its required accompaniment.
const hasRequiredPairings = mainLines.every((line) => {
  const required = mealPairings[line.item.id] ?? [];

  return required.every((itemId) => selectedIds.has(itemId));
});

if (!hasRequiredPairings) return;


      const mainQty = (diet) =>
        lines
          .filter((line) => line.item.kind === "main" && line.item.diet === diet)
          .reduce((sum, line) => sum + line.qty, 0);

      if (
        (mainNeeds.veg > 0 && mainQty("veg") < mainNeeds.veg) ||
        (mainNeeds.nonveg > 0 && mainQty("nonveg") < mainNeeds.nonveg)
      ) {
        return;
      }

      const subtotalPaise = lines.reduce(
        (sum, line) => sum + line.linePaise,
        0,
      );
      const feesPaise =
        restaurant.deliveryFeePaise + restaurant.packagingFeePaise;
      const taxPaise = percentOf(subtotalPaise, session.taxPercent);
      const totalPaise = subtotalPaise + feesPaise + taxPaise;

      if (totalPaise > session.budgetPaise) return;

      const shares = splitEvenly(totalPaise, members.length);
      if (shares.some((share, i) => share > members[i].limitPaise)) return;

      candidates.push({
        restaurant,
        lines,
        subtotalPaise,
        feesPaise,
        taxPaise,
        totalPaise,
        memberShares: members.map((member, i) => ({
          member,
          sharePaise: shares[i],
          overLimitPaise: 0,
        })),
        remainingPaise: session.budgetPaise - totalPaise,
        overBudgetPaise: 0,
        overLimit: [],
        missingDiets: [],
        cuisineMatches: members.filter((m) =>
          m.cuisines.includes(restaurant.cuisine),
        ).length,
        fitsBudget: true,
        withinLimits: true,
        coversDiets: true,
        worksForGroup: true,
      });

      return;
    }

    const item = restaurant.items[index];
    const maxQty = 5;

    // Zero quantity is allowed for optional items.
    for (let qty = 0; qty <= maxQty; qty++) {
      quantities[index] = qty;
      search(index + 1, quantities);
    }
  }

  search(0, Array(restaurant.items.length).fill(0));

  candidates.sort(
    (a, b) =>
      b.cuisineMatches - a.cuisineMatches ||
      a.totalPaise - b.totalPaise,
  );

  return candidates[0] ?? null;
}
