
import { Db, MongoClient } from "mongodb";

let client: MongoClient | undefined;
let connectionPromise: Promise<Db> | undefined;

export function connectMongo(): Promise<Db> {
  if (connectionPromise) {
    return connectionPromise;
  }

  const uri = process.env.MONGODB_URI?.trim();
  const dbName = process.env.MONGODB_DB_NAME?.trim();

  if (!uri || !dbName) {
    return Promise.reject(
      new Error("MONGODB_URI and MONGODB_DB_NAME must be configured."),
    );
  }

  const mongoClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    appName: "OrderWiseAI",
  });

  client = mongoClient;

  connectionPromise = mongoClient
    .connect()
    .then(() => mongoClient.db(dbName))
    .catch(async (error: unknown) => {
      connectionPromise = undefined;
      client = undefined;
      await mongoClient.close().catch(() => undefined);
      throw error;
    });

  return connectionPromise;
}

export async function closeMongo(): Promise<void> {
  const currentClient = client;

  client = undefined;
  connectionPromise = undefined;

  if (currentClient) {
    await currentClient.close();
  }
}
