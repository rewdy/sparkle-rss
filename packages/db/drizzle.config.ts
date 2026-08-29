import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url =
  process.env.DRIZZLE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/sparkle_dev";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url, ssl: url.includes("dsql") },
});
