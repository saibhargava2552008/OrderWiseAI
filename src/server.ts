
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import { mountFrontend } from "./frontend.js";
import { connectMongo, closeMongo } from "./db/mongodb.js";
import {
  DuplicateMemberNameError,
  GroupSessionNotFoundError,
  MemoryGroupSessionStore,
  MongoGroupSessionStore,
  type GroupSessionStore,
} from "./db/group-sessions.js";
import { MongoSwiggyStore } from "./swiggy/mongo-store.js";
import { mountSwiggyAuth } from "./swiggy/index.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

const useMongo =
  process.env.NODE_ENV === "production" ||
  process.env.PERSISTENCE_MODE?.trim().toLowerCase() === "mongodb";

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "20kb" }));

const memoryGroupStore = new MemoryGroupSessionStore();

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
    persistence: useMongo ? "mongodb" : "memory",
  });
});

async function startServer(): Promise<void> {
  let groupStore: GroupSessionStore = memoryGroupStore;
  let swiggyStore: MongoSwiggyStore | undefined;

  if (useMongo) {
    // Production must not start with an unavailable persistent database.
    const db = await connectMongo();
    groupStore = new MongoGroupSessionStore(db);
    swiggyStore = await MongoSwiggyStore.create(db);
    console.log(JSON.stringify({ event: "mongodb_persistence_ready" }));
  }

  mountSwiggyAuth(app, process.env, swiggyStore);
  mountFrontend(app);

  // Create a new group session.
  app.post("/api/sessions", async (req, res) => {
    const { title, location, budget, memberName, spendingLimit } =
      req.body ?? {};

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

    try {
      const session = await groupStore.create({
        title,
        location,
        budget,
        memberName,
        spendingLimit,
      });

      return res.status(201).json({
        message: "Session created successfully.",
        session,
      });
    } catch {
      console.error(
        JSON.stringify({ event: "group_session_create_failed" }),
      );
      return res.status(503).json({
        error: "session_service_unavailable",
      });
    }
  });

  // Join an existing group using its code.
  app.post("/api/sessions/join", async (req, res) => {
    const { code, memberName } = req.body ?? {};

    if (!validText(code, 20) || !validText(memberName, 50)) {
      return res.status(400).json({
        error: "Provide a valid session code and member name.",
      });
    }

    try {
      const result = await groupStore.join(
        code.trim().toUpperCase(),
        memberName,
      );

      return res.status(200).json({
        message: "Joined session successfully.",
        session: result.session,
        member: result.member,
      });
    } catch (error) {
      if (error instanceof GroupSessionNotFoundError) {
        return res.status(404).json({
          error: "Session not found. Check the code and try again.",
        });
      }

      if (error instanceof DuplicateMemberNameError) {
        return res.status(409).json({
          error: "That name is already in this session.",
        });
      }

      console.error(
        JSON.stringify({ event: "group_session_join_failed" }),
      );
      return res.status(503).json({
        error: "session_service_unavailable",
      });
    }
  });

  // Retrieve a session by its code.
  app.get("/api/sessions/:code", async (req, res) => {
    try {
      const session = await groupStore.get(req.params.code);

      if (!session) {
        return res.status(404).json({
          error: "Session not found.",
        });
      }

      return res.status(200).json({ session });
    } catch {
      console.error(
        JSON.stringify({ event: "group_session_read_failed" }),
      );
      return res.status(503).json({
        error: "session_service_unavailable",
      });
    }
  });

  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`OrderWise AI running on port ${port}`);
  });

  const shutdown = (signal: string): void => {
    console.log(JSON.stringify({ event: "server_shutdown", signal }));
    server.close(() => {
      void closeMongo()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

startServer().catch(async (error: unknown) => {
  console.error(
    JSON.stringify({
      event: "server_start_failed",
      error:
        error instanceof Error
          ? error.message
          : String(error),
    }),
  );

  await closeMongo().catch(() => undefined);
  process.exitCode = 1;
});