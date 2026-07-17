import { loadConfig } from "./config/env.js";
import { createDbClient } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createDbClient(config.DB_PATH);
  runMigrations(db);

  const app = await buildApp({ db, config });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
