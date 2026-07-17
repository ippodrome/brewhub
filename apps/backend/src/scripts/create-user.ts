import { loadConfig } from "../config/env.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createUser, getUserByUsername } from "../db/repositories/users.repo.js";
import { hashPassword } from "../auth/password.js";

function parseArgs(argv: string[]): { username: string; password: string } {
  let username: string | undefined;
  let password: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--username") username = argv[++i];
    if (argv[i] === "--password") password = argv[++i];
  }

  if (!username || !password) {
    console.error("Usage: create-user -- --username <username> --password <password>");
    process.exit(1);
  }

  return { username, password };
}

function main(): void {
  const { username, password } = parseArgs(process.argv.slice(2));

  const config = loadConfig();
  const db = createDbClient(config.DB_PATH);
  runMigrations(db);

  if (getUserByUsername(db, username)) {
    console.error(`User "${username}" already exists.`);
    process.exit(1);
  }

  const user = createUser(db, username, hashPassword(password));
  console.log(`Created user "${user.username}" (id ${user.id}).`);
}

main();
