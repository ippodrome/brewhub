import type Database from "better-sqlite3";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
}

export function getUserByUsername(db: Database.Database, username: string): UserRow | null {
  return (
    db.prepare<[string], UserRow>("SELECT * FROM users WHERE username = ?").get(username) ?? null
  );
}

export function createUser(db: Database.Database, username: string, passwordHash: string): UserRow {
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(
    username,
    passwordHash,
  );
  const user = getUserByUsername(db, username);
  if (!user) throw new Error(`Failed to read back created user ${username}`);
  return user;
}

export function countUsers(db: Database.Database): number {
  const row = db.prepare<[], { count: number }>("SELECT COUNT(*) as count FROM users").get();
  return row?.count ?? 0;
}
