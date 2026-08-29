import "dotenv/config";
import { createDsqlClient } from "./client";
import { ensureMigrationJournal } from "./dsql-journal";
import { migrateDsql } from "./dsql-migrator";

const endpoint = process.env.DSQL_ENDPOINT;
if (!endpoint) throw new Error("DSQL_ENDPOINT required");

const client = await createDsqlClient({
  endpoint,
  region: process.env.AWS_REGION ?? "us-east-1",
});

try {
  await ensureMigrationJournal(client);
  await migrateDsql(client, new URL("../drizzle", import.meta.url).pathname);
  console.log("migrations applied to DSQL");
} finally {
  await client.end();
}
