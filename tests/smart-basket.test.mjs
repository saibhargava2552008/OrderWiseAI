// Regression guard for the Smart Basket. It checks the rules the basket promises,
// using the same demo data the page uses.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { members, restaurants, session } from "../public/js/data/demoData.js";
import { generateSmartBasket } from "../public/js/lib/basket.js";

describe("Smart Basket", () => {
  const plans = restaurants.map((r) => ({ r, plan: generateSmartBasket(r, session, members) }));

  it("finds a working basket for at least one demo restaurant", () => {
    assert.ok(plans.some(({ plan }) => plan !== null));
  });

  for (const { r, plan } of plans) {
    if (!plan) continue;
    it(`${r.name}: basket respects budget, personal limits, diets and shares`, () => {
      assert.ok(plan.totalPaise <= session.budgetPaise);
      assert.equal(plan.memberShares.reduce((s, m) => s + m.sharePaise, 0), plan.totalPaise);
      plan.memberShares.forEach((m, i) => assert.ok(m.sharePaise <= members[i].limitPaise));
      const mainQty = (diet) =>
        plan.lines.filter((l) => l.item.kind === "main" && l.item.diet === diet).reduce((n, l) => n + l.qty, 0);
      assert.ok(mainQty("veg") >= members.filter((m) => m.diet === "veg").length);
      assert.ok(mainQty("nonveg") >= members.filter((m) => m.diet === "nonveg").length);
      assert.equal(plan.worksForGroup, true);
    });
  }

  it("returns null for an empty group and when nothing fits the budget", () => {
    assert.equal(generateSmartBasket(restaurants[0], session, []), null);
    assert.equal(generateSmartBasket(restaurants[0], { ...session, budgetPaise: 100 }, members), null);
  });
});
