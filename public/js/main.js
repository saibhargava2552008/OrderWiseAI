
import {
  session as demoSession,
  members as demoMembers,
  restaurants,
  cuisines,
} from "./data/demoData.js";
import { evaluatePlan, rankPlans } from "./lib/plan.js";
import { h } from "./lib/dom.js";
import { createRail } from "./ui/rail.js";
import { renderMembers } from "./ui/members.js";
import { mountFilters } from "./ui/filters.js";
import { renderPlanList } from "./ui/plans.js";
import { initDialogs } from "./ui/dialogs.js";
import { showToast } from "./ui/toast.js";
import { generateSmartBasket } from "./lib/basket.js";

const $ = (id) => document.getElementById(id);

const COLORS = ["indigo", "turmeric", "beetroot", "teal", "tamarind"];

async function loadActiveGroup() {
  try {
    const saved = localStorage.getItem("orderwise-active-session");
    if (!saved) return null;

    const active = JSON.parse(saved);
    if (!active?.code) return null;

    const response = await fetch(
      `/api/sessions/${encodeURIComponent(active.code)}`,
    );

    if (!response.ok) {
      localStorage.removeItem("orderwise-active-session");
      return null;
    }

    const result = await response.json();
    const serverSession = result.session;

    const session = {
      code: serverSession.code,
      name: serverSession.title,
      place: serverSession.location,
      budgetPaise: serverSession.budget * 100,
      taxPercent: 5,
    };

    const members = serverSession.members.map((member, index) => ({
      id: member.id,
      name: member.name,
      diet:
        member.dietaryPreference === "non-veg"
          ? "nonveg"
          : member.dietaryPreference === "veg"
            ? "veg"
            : "both",
      limitPaise: member.spendingLimit * 100,
      cuisines: member.cuisines ?? [],
      color: COLORS[index % COLORS.length],
    }));

    return { session, members };
  } catch (error) {
    console.error("Could not load the active group:", error);
    return null;
  }
}

async function boot() {
  const activeGroup = await loadActiveGroup();
  const session = activeGroup?.session ?? demoSession;
  const members = activeGroup?.members ?? demoMembers;
  const usingRealSession = Boolean(activeGroup);

  
const plans = restaurants.map((restaurant) => {
  const smartPlan = generateSmartBasket(
    restaurant,
    session,
    members,
  );

  return (
    smartPlan ??
    evaluatePlan(restaurant, session, members)
  );
});

const plansById = new Map(
  plans.map((plan) => [plan.restaurant.id, plan]),
);


  const working = plans.filter((plan) => plan.worksForGroup);
  const cheapestWorking = working.length
    ? working.reduce((a, b) =>
        b.totalPaise < a.totalPaise ? b : a,
      )
    : null;

  const state = {
    selectedId: rankPlans(plans, "best")[0].restaurant.id,
    cuisines: new Set(),
    onlyWorking: true,
    sort: "best",
  };

  $("session-title").textContent = session.name;
  $("session-sub").textContent = usingRealSession
    ? `${members.length} people in ${session.place}. Session code ${session.code}. Restaurant recommendations still use demo data.`
    : `${members.length} people in ${session.place}. Session code ${session.code} is a sample.`;

  const updateRail = createRail($("rail-root"), session, members);
  const planList = $("plan-list");

  function showSelected() {
    const plan = plansById.get(state.selectedId);
    updateRail(plan);
    renderMembers(
      $("ledger-body"),
      $("ledger-foot"),
      plan,
      session,
    );
  }

  function visiblePlans() {
    let list = plans;

    if (state.cuisines.size > 0) {
      list = list.filter((plan) =>
        state.cuisines.has(plan.restaurant.cuisine),
      );
    }

    if (state.onlyWorking) {
      list = list.filter((plan) => plan.worksForGroup);
    }

    return rankPlans(list, state.sort);
  }

  let resetFilters = () => {};

  function showPlans() {
    const visible = visiblePlans();

    $("plan-count").textContent =
      visible.length === 0
        ? "No plans match your filters."
        : visible.length === plans.length
          ? `${plans.length} plans, shown in order.`
          : `Showing ${visible.length} of ${plans.length} plans.`;

    renderPlanList(planList, visible, {
      selectedId: state.selectedId,
      cheapestWorkingId: cheapestWorking?.restaurant.id ?? null,
      session,
      memberCount: members.length,
      onClear: () => resetFilters(),
    });
  }

  resetFilters = mountFilters($("filters"), cuisines, state, showPlans);

  planList.addEventListener("change", (event) => {
    if (
      !(event.target instanceof HTMLInputElement) ||
      event.target.name !== "plan"
    ) {
      return;
    }

    state.selectedId = event.target.value;
    showSelected();

    showToast(
      `Now planning with ${plansById.get(state.selectedId).restaurant.name}.`,
      { tone: "success" },
    );
  });

  initDialogs();
  showSelected();
  showPlans();
  $("boot")?.remove();
}

function showFatal(error) {
  console.error(error);

  const main = $("main");

  main.replaceChildren(
    h(
      "section",
      { class: "shell fatal", role: "alert" },
      h("h1", {}, "The group plan didn't load"),
      h("p", {}, "Something went wrong while building this page. Reload to try again."),
      h(
        "p",
        { class: "fatal__detail" },
        `Details: ${error instanceof Error ? error.message : String(error)}`,
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn--primary",
          onclick: () => location.reload(),
        },
        "Reload page",
      ),
    ),
  );
}

boot().catch(showFatal);
