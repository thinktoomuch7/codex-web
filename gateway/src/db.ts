import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  turn_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  decision TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_places (
  thread_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  cwd TEXT NOT NULL,
  branch TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_queue (
  id INTEGER PRIMARY KEY,
  thread_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_grants (
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (thread_id, kind)
);
CREATE TABLE IF NOT EXISTS thread_settings (
  thread_id TEXT PRIMARY KEY,
  title TEXT,
  model TEXT,
  sandbox TEXT,
  approval_policy TEXT
);
`;

export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(`${dataDir}/app.db`);
  db.exec(SCHEMA);
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!taskColumns.some((column) => column.name === "error")) db.exec("ALTER TABLE tasks ADD COLUMN error TEXT");
  return db;
}

export function tableNames(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return rows.map((row) => row.name);
}
