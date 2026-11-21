import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Local dev (no env vars set): a plain SQLite file next to this code.
// Production (Turso): set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, "pg_rent.db")}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient(authToken ? { url, authToken } : { url });

// Startup maintenance (schema, migration, seeding) must NEVER be able to take
// the whole API down. When several serverless instances cold-start at the same
// moment they all run this code at once and can collide (e.g. "duplicate column"
// or "UNIQUE constraint failed"). Every step below is therefore idempotent and
// wrapped, so a collision is logged and skipped instead of crashing every request.
async function safely(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`[startup] ${label} skipped:`, e.message);
  }
}

// ---------- SCHEMA (raw SQL) ----------
await safely("schema", () =>
  db.executeMultiple(`
CREATE TABLE IF NOT EXISTS tenants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  phone         TEXT,
  room_no       TEXT NOT NULL,
  joining_date  TEXT NOT NULL,
  rent_amount   REAL NOT NULL,
  next_due_date TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cycle_label   TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  amount_due    REAL NOT NULL,
  amount_paid   REAL NOT NULL DEFAULT 0,
  paid_date     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, cycle_label)
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_due_date ON payments(due_date);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`)
);

// ---------- MIGRATION: "role" column ----------
// Adds the column for databases created before read-only accounts existed.
// Checks for the column directly rather than parsing an error message.
await safely("role-column migration", async () => {
  const columns = await db.execute("PRAGMA table_info(users)");
  const hasRole = columns.rows.some((c) => c.name === "role");
  if (!hasRole) {
    await db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
    console.log('Migration: added "role" column to users table');
  }
});

// ---------- SEED: default accounts ----------
// INSERT OR IGNORE makes these safe to run any number of times, even
// simultaneously from several instances: the UNIQUE(username) constraint
// guarantees at most one row per account.
await safely("admin seed", async () => {
  const { rows } = await db.execute("SELECT COUNT(*) AS n FROM users");
  if (Number(rows[0].n) === 0) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
      args: ["admin", bcrypt.hashSync("admin123", 10)],
    });
    console.log('Seeded default login -> username: "admin"  password: "admin123" (please change this)');
  }
});

await safely("viewer seed", async () => {
  const existing = await db.execute({ sql: "SELECT id FROM users WHERE username = ?", args: ["viewer"] });
  if (existing.rows.length === 0) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, 'viewer')",
      args: ["viewer", bcrypt.hashSync(process.env.VIEWER_PASSWORD || "viewer123", 10)],
    });
    console.log('Seeded read-only login -> username: "viewer"');
  }
});

// The viewer account can't change its own password, so the owner controls it.
// Set VIEWER_PASSWORD in the environment (Vercel -> Settings -> Environment
// Variables) and it is applied to the "viewer" account on startup. If it isn't
// set, the existing password is left exactly as it is.
await safely("viewer password sync", async () => {
  const wanted = process.env.VIEWER_PASSWORD;
  if (!wanted) return;
  const { rows } = await db.execute({
    sql: "SELECT password_hash FROM users WHERE username = ?",
    args: ["viewer"],
  });
  if (rows.length && !bcrypt.compareSync(wanted, rows[0].password_hash)) {
    await db.execute({
      sql: "UPDATE users SET password_hash = ? WHERE username = ?",
      args: [bcrypt.hashSync(wanted, 10), "viewer"],
    });
    console.log("Viewer password updated from VIEWER_PASSWORD");
  }
});

export default db;
