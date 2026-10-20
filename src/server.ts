
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import { mountFrontend } from "./frontend.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

type Member = {
  id: string;
  name: string;
  dietaryPreference: "veg" | "non-veg" | "both";
  cuisines: string[];
  spendingLimit: number;
};

type Session = {
  code: string;
  title: string;
  location: string;
  budget: number;
  createdAt: string;
  members: Member[];
};

const sessions = new Map<string, Session>();

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "20kb" }));

mountFrontend(app);

function createSessionCode(): string {
  let code = "";

  do {
    code = randomBytes(3).toString("hex").toUpperCase();
  } while (sessions.has(code));

  return code;
}

function validText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function validBudget(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 1_000_000
  );
}

// Health check.
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "OrderWise AI",
    integration: "not-connected",
  });
});

// Create a new group session.
app.post("/api/sessions", (req, res) => {
  const {
    title,
    location,
    budget,
    memberName,
    spendingLimit,
  } = req.body ?? {};

  if (
    !validText(title, 80) ||
    !validText(location, 120) ||
    !validBudget(budget) ||
    !validText(memberName, 50) ||
    !validBudget(spendingLimit) ||
    spendingLimit < 50 ||
    spendingLimit > budget
  ) {
    return res.status(400).json({
      error:
        "Provide a valid title, location, member name and budget. The per-person limit must be at least ₹50 and cannot exceed the group budget.",
    });
  }

  const code = createSessionCode();

  const session: Session = {
    code,
    title: title.trim(),
    location: location.trim(),
    budget,
    createdAt: new Date().toISOString(),
    members: [
      {
        id: randomBytes(8).toString("hex"),
        name: memberName.trim(),
        dietaryPreference: "both",
        cuisines: [],
        spendingLimit,
      },
    ],
  };

  sessions.set(code, session);

  return res.status(201).json({
    message: "Session created successfully.",
    session,
  });
});

// Join an existing group using its code.
app.post("/api/sessions/join", (req, res) => {
  const { code, memberName } = req.body ?? {};

  if (!validText(code, 20) || !validText(memberName, 50)) {
    return res.status(400).json({
      error: "Provide a valid session code and member name.",
    });
  }

  const session = sessions.get(code.trim().toUpperCase());

  if (!session) {
    return res.status(404).json({
      error: "Session not found. Check the code and try again.",
    });
  }

  const normalizedName = memberName.trim();

  if (
    session.members.some(
      (member) =>
        member.name.toLowerCase() === normalizedName.toLowerCase(),
    )
  ) {
    return res.status(409).json({
      error: "That name is already in this session.",
    });
  }

  const member: Member = {
    id: randomBytes(8).toString("hex"),
    name: normalizedName,
    dietaryPreference: "both",
    cuisines: [],
    spendingLimit: session.budget,
  };

  session.members.push(member);

  return res.status(200).json({
    message: "Joined session successfully.",
    session,
    member,
  });
});

// Retrieve a session by its code.
app.get("/api/sessions/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  const session = sessions.get(code);

  if (!session) {
    return res.status(404).json({
      error: "Session not found.",
    });
  }

  return res.status(200).json({ session });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`OrderWise AI running on port ${port}`);
});
