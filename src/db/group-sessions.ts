
import { randomBytes } from "node:crypto";
import type { Collection, Db, Document } from "mongodb";

export type GroupMember = {
  id: string;
  name: string;
  dietaryPreference: "veg" | "non-veg" | "both";
  cuisines: string[];
  spendingLimit: number;
};

export type GroupSession = {
  code: string;
  title: string;
  location: string;
  budget: number;
  createdAt: string;
  members: GroupMember[];
};

export type CreateGroupSessionInput = {
  title: string;
  location: string;
  budget: number;
  memberName: string;
  spendingLimit: number;
};

export type JoinGroupSessionResult = {
  session: GroupSession;
  member: GroupMember;
};

export class GroupSessionNotFoundError extends Error {
  constructor() {
    super("Session not found.");
    this.name = "GroupSessionNotFoundError";
  }
}

export class DuplicateMemberNameError extends Error {
  constructor() {
    super("That name is already in this session.");
    this.name = "DuplicateMemberNameError";
  }
}

export interface GroupSessionStore {
  create(input: CreateGroupSessionInput): Promise<GroupSession>;
  join(code: string, memberName: string): Promise<JoinGroupSessionResult>;
  get(code: string): Promise<GroupSession | undefined>;
}

type StoredMember = GroupMember & {
  nameKey: string;
};

type GroupSessionDocument = Document & {
  _id: string;
  title: string;
  location: string;
  budget: number;
  createdAt: string;
  members: StoredMember[];
};

/** In-memory implementation for tests and non-persistent development. */
export class MemoryGroupSessionStore implements GroupSessionStore {
  private readonly sessions = new Map<string, GroupSession>();

  async create(input: CreateGroupSessionInput): Promise<GroupSession> {
    let code: string;

    do {
      code = randomBytes(3).toString("hex").toUpperCase();
    } while (this.sessions.has(code));

    const session: GroupSession = {
      code,
      title: input.title.trim(),
      location: input.location.trim(),
      budget: input.budget,
      createdAt: new Date().toISOString(),
      members: [
        {
          id: randomBytes(8).toString("hex"),
          name: input.memberName.trim(),
          dietaryPreference: "both",
          cuisines: [],
          spendingLimit: input.spendingLimit,
        },
      ],
    };

    this.sessions.set(code, session);
    return session;
  }

  async join(
    code: string,
    memberName: string,
  ): Promise<JoinGroupSessionResult> {
    const session = this.sessions.get(code.toUpperCase());

    if (!session) {
      throw new GroupSessionNotFoundError();
    }

    const name = memberName.trim();
    const nameKey = name.toLowerCase();

    if (
      session.members.some(
        (member) => member.name.toLowerCase() === nameKey,
      )
    ) {
      throw new DuplicateMemberNameError();
    }

    const member: GroupMember = {
      id: randomBytes(8).toString("hex"),
      name,
      dietaryPreference: "both",
      cuisines: [],
      spendingLimit: session.budget,
    };

    session.members.push(member);

    return { session, member };
  }

  async get(code: string): Promise<GroupSession | undefined> {
    return this.sessions.get(code.toUpperCase());
  }
}

/** MongoDB implementation. Member-name checks are atomic across requests. */
export class MongoGroupSessionStore implements GroupSessionStore {
  constructor(private readonly db: Db) {}

  private collection(): Collection<GroupSessionDocument> {
    return this.db.collection<GroupSessionDocument>("group_sessions");
  }

  async create(input: CreateGroupSessionInput): Promise<GroupSession> {
    // Retry if two requests happen to generate the same six-character code.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomBytes(3).toString("hex").toUpperCase();

      const session: GroupSession = {
        code,
        title: input.title.trim(),
        location: input.location.trim(),
        budget: input.budget,
        createdAt: new Date().toISOString(),
        members: [
          {
            id: randomBytes(8).toString("hex"),
            name: input.memberName.trim(),
            dietaryPreference: "both",
            cuisines: [],
            spendingLimit: input.spendingLimit,
          },
        ],
      };

      const document: GroupSessionDocument = {
        _id: code,
        title: session.title,
        location: session.location,
        budget: session.budget,
        createdAt: session.createdAt,
        members: session.members.map((member) => ({
          ...member,
          nameKey: member.name.toLowerCase(),
        })),
      };

      try {
        await this.collection().insertOne(document);
        return session;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error("Could not generate a unique group session code.");
  }

  async join(
    code: string,
    memberName: string,
  ): Promise<JoinGroupSessionResult> {
    const normalizedCode = code.toUpperCase();
    const name = memberName.trim();
    const nameKey = name.toLowerCase();

    const member: StoredMember = {
      id: randomBytes(8).toString("hex"),
      name,
      nameKey,
      dietaryPreference: "both",
      cuisines: [],
      // This placeholder is replaced with the group's budget below.
      spendingLimit: 0,
    };

    const existing = await this.collection().findOne({
      _id: normalizedCode,
    });

    if (!existing) {
      throw new GroupSessionNotFoundError();
    }

    member.spendingLimit = existing.budget;

    const update: Document = {
      $push: { members: member },
    };

    const updated = await this.collection().findOneAndUpdate(
      {
        _id: normalizedCode,
        "members.nameKey": { $ne: nameKey },
      },
      update,
      { returnDocument: "after" },
    );


    if (!updated) {
      const stillExists = await this.collection().findOne({
        _id: normalizedCode,
      });

      if (!stillExists) {
        throw new GroupSessionNotFoundError();
      }

      throw new DuplicateMemberNameError();
    }

    const session = toPublicSession(updated);
    const joinedMember = session.members.find(
      (item) => item.id === member.id,
    );

    if (!joinedMember) {
      throw new Error("Joined member could not be retrieved.");
    }

    return { session, member: joinedMember };
  }

  async get(code: string): Promise<GroupSession | undefined> {
    const document = await this.collection().findOne({
      _id: code.toUpperCase(),
    });

    return document ? toPublicSession(document) : undefined;
  }
}

function toPublicSession(document: GroupSessionDocument): GroupSession {
  return {
    code: document._id,
    title: document.title,
    location: document.location,
    budget: document.budget,
    createdAt: document.createdAt,
    members: document.members.map(
      ({ nameKey: _nameKey, ...member }) => member,
    ),
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
