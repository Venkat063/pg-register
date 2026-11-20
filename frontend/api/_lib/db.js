
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url =
  process.env.TURSO_DATABASE_URL ||
  `file:${path.join(__dirname, "pg_rent.db")}`;

const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient(
  authToken ? { url, authToken } : { url }
);

// ---------- SAFE STARTUP ----------
async function safely(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`[startup] ${label} skipped:`, e.message);
  }
}

// ---------- SCHEMA ----------
await safely("schema", () =>
  db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      room_no TEXT NOT NULL,
      joining_date TEXT NOT NULL,
      rent_amount REAL NOT NULL,
      next_due_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      cycle_label TEXT NOT NULL,
      due_date TEXT NOT NULL,
      amount_due REAL NOT NULL,
      amount_paid REAL NOT NULL DEFAULT 0,
      paid_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, cycle_label)
    );

    CREATE INDEX IF NOT EXISTS idx_payments_tenant
      ON payments(tenant_id);

    CREATE INDEX IF NOT EXISTS idx_payments_due_date
      ON payments(due_date);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
);

// ---------- ROLE MIGRATION ----------
await safely("role-column migration", async () => {
  const columns = await db.execute("PRAGMA table_info(users)");
  const hasRole = columns.rows.some(c => c.name === "role");

  if (!hasRole) {
    await db.execute(`
      ALTER TABLE users
      ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
    `);
  }
});

// ---------- ADMIN SEED ----------
await safely("admin seed", async () => {
  const { rows } = await db.execute(
    "SELECT COUNT(*) AS n FROM users"
  );

  if (Number(rows[0].n) === 0) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO users
        (username, password_hash, role)
        VALUES (?, ?, 'admin')`,
      args: ["admin", bcrypt.hashSync("admin123", 10)],
    });

    console.log("Default admin account created.");
  }
});

// ---------- VIEWER SEED ----------
await safely("viewer seed", async () => {
  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE username = ?",
    args: ["viewer"],
  });

  if (existing.rows.length === 0) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO users
        (username, password_hash, role)
        VALUES (?, ?, 'viewer')`,
      args: ["viewer", bcrypt.hashSync("viewer123", 10)],
    });
  }

  await db.execute({
    sql: "UPDATE users SET role = 'viewer' WHERE username = ?",
    args: ["viewer"],
  });

  console.log("Viewer account ready.");
});

// ---------- PERMISSIONS ----------
export const hasPermission = (user, action) => {
  if (!user) return false;

  if (user.role === "admin") return true;

  if (user.role === "viewer") {
    return action === "view";
  }

  return false;
};

// ---------- HIDE PHONE NUMBERS ----------
export function hideViewerPhoneNumbers(user, data) {
  if (user?.role !== "viewer") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item =>
      hideViewerPhoneNumbers(user, item)
    );
  }

  if (data && typeof data === "object") {
    const safeData = {};

    for (const [key, value] of Object.entries(data)) {
      // Hide phone and mobile fields
      if (
        /phone|mobile|contact_number|telephone/i.test(key)
      ) {
        continue;
      }

      safeData[key] = hideViewerPhoneNumbers(user, value);
    }

    return safeData;
  }

  return data;
}

// ---------- SAFE API RESPONSE ----------
export function viewerSafeResponse(user, data) {
  return hideViewerPhoneNumbers(user, data);
}

// ---------- EXPRESS READ-ONLY MIDDLEWARE ----------
export function requireReadOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  if (!hasPermission(req.user, "view")) {
    return res.status(403).json({
      message: "Access denied",
    });
  }

  if (
    req.user.role === "viewer" &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
  ) {
    return res.status(403).json({
      message: "Viewer access is read-only",
    });
  }

  next();
}

export default db;
