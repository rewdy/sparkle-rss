import { config } from "dotenv";

config(); // packages/db/.env
config({ path: "../../.env" }); // repo root .env (shared local config)

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createLocalPool } from "./client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required");

const pool = createLocalPool({ connectionString: databaseUrl });
const db = drizzle(pool);

try {
  await migrate(db, {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
  console.log("migrations applied to local Postgres");
} finally {
  await pool.end();
}
