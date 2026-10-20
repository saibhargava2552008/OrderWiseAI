
import { showToast } from "./toast.js";

const $ = (id) => document.getElementById(id);

const toWholeRupees = (text) =>
  /^\d{1,7}$/.test(text.trim()) ? Number(text.trim()) : null;

export function validateNewSession({ name, budget, limit }) {
  const errors = {};
  const trimmed = name.trim();

  if (trimmed.length < 2 || trimmed.length > 60) {
    errors.name = "Enter a name between 2 and 60 characters.";
  }

  const budgetRupees = toWholeRupees(budget);
  if (
    budgetRupees === null ||
    budgetRupees < 100 ||
    budgetRupees > 100000
  ) {
    errors.budget =
      "Enter a budget between ₹100 and ₹100,000.";
  }

  const limitRupees = toWholeRupees(limit);
  if (limitRupees === null || limitRupees < 50) {
    errors.limit = "Enter a per-person limit of at least ₹50.";
  } else if (
    budgetRupees !== null &&
    limitRupees > budgetRupees
  ) {
    errors.limit =
      "A person's limit can't exceed the shared budget.";
  }

  return errors;
}

export function validateJoinCode(code) {
  return /^[A-Z0-9]{6}$/.test(code.trim().toUpperCase())
    ? {}
    : { code: "Enter the 6-character session code, like 64D928." };
}

function showErrors(form, errors) {
  let firstInvalid = null;

  for (const input of form.querySelectorAll("input")) {
    const message = errors[input.name];
    const output = $(input.id + "-error");

    input.setAttribute("aria-invalid", message ? "true" : "false");

    if (output) {
      output.hidden = !message;
      output.textContent = message ?? "";
    }

    if (message && !firstInvalid) firstInvalid = input;
  }

  firstInvalid?.focus();
  return firstInvalid === null;
}

async function postJSON(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "The request failed.");
  }

  return result;
}

function askMemberName() {
  const value = window.prompt("What's your name?");
  if (value === null) return null;

  const name = value.trim();
  if (name.length < 1 || name.length > 50) {
    showToast("Enter a name between 1 and 50 characters.", {
      tone: "error",
    });
    return null;
  }

  return name;
}

function saveActiveSession(session, memberName) {
  localStorage.setItem(
    "orderwise-active-session",
    JSON.stringify({
      code: session.code,
      memberName,
    }),
  );
}

function wireNewSession() {
  const dialog = $("dialog-new");
  const form = $("form-new");

  $("open-new").addEventListener("click", () => {
    form.reset();
    showErrors(form, {});
    dialog.showModal();
    form.querySelector("input").focus();
  });

  dialog.querySelector("[data-close]").addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const values = Object.fromEntries(new FormData(form).entries());

    if (!showErrors(form, validateNewSession(values))) return;

    const memberName = askMemberName();
    if (!memberName) return;

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;

    try {
      const result = await postJSON("/api/sessions", {
      title: values.name.trim(),
      location: "Not set",
      budget: toWholeRupees(values.budget),
      spendingLimit: toWholeRupees(values.limit),
      memberName,
    }
);

      saveActiveSession(result.session, memberName);
      dialog.close();

      showToast(
        `Session created! Code: ${result.session.code}`,
        { tone: "success" },
      );

      window.location.reload();
    } catch (error) {
      showToast(error.message || "Could not create the session.", {
        tone: "error",
      });
    } finally {
      submit.disabled = false;
    }
  });
}

function wireJoinSession() {
  const dialog = $("dialog-join");
  const form = $("form-join");
  const codeInput = $("join-code");

  codeInput.placeholder = "64D928";
  codeInput.maxLength = 6;

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  });

  $("open-join").addEventListener("click", () => {
    form.reset();
    showErrors(form, {});
    dialog.showModal();
    codeInput.focus();
  });

  dialog.querySelector("[data-close]").addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const values = Object.fromEntries(new FormData(form).entries());
    const code = values.code.trim().toUpperCase();

    if (!showErrors(form, validateJoinCode(code))) return;

    const memberName = askMemberName();
    if (!memberName) return;

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;

    try {
      const result = await postJSON("/api/sessions/join", {
        code,
        memberName,
      });

      saveActiveSession(result.session, memberName);
      dialog.close();

      showToast("Joined the group successfully!", {
        tone: "success",
      });

      window.location.reload();
    } catch (error) {
      showToast(error.message || "Could not join the session.", {
        tone: "error",
      });
    } finally {
      submit.disabled = false;
    }
  });
}

export function initDialogs() {
  wireNewSession();
  wireJoinSession();
}
