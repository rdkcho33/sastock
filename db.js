import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "sastock.db"));

// Enable WAL mode and set busy timeout to fix "database locked" errors
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT 'gemini',
    key_value TEXT NOT NULL,
    label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

const apiKeysColumns = db.prepare("PRAGMA table_info(api_keys)").all();
const hasProviderColumn = apiKeysColumns.some((column) => column.name === "provider");

if (!hasProviderColumn) {
  db.exec("ALTER TABLE api_keys ADD COLUMN provider TEXT NOT NULL DEFAULT 'gemini'");
}

db.exec("CREATE INDEX IF NOT EXISTS idx_api_keys_user_provider ON api_keys (user_id, provider, id)");

export default db;
