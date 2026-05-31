import bcrypt from "bcryptjs";
import { formatAddress, geocodeAddress } from "./geocode.js";
import { isInFlorida } from "./florida.js";
import { DEFAULT_DEPOT } from "./routing.js";
import { ownerClause } from "./scope.js";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function publicAdmin(row) {
  if (!row) return null;
  const role = row.role || "user";
  return {
    id: row.id,
    email: row.email,
    name: row.name || "",
    businessName: row.business_name || "",
    role,
    isSuper: role === "super",
    active: row.active == null ? true : !!row.active,
  };
}

export function publicCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || "",
    email: row.email || "",
    street: row.street || row.address || "",
    city: row.city || "",
    state: row.state || "FL",
    zip: row.zip || "",
    fullAddress: formatAddress(row),
    lat: row.lat,
    lng: row.lng,
    serviceDayOfWeek: row.service_day_of_week,
    poolType: row.pool_type || "pool",
    monthlyRate: row.monthly_rate,
    notes: row.notes || "",
    active: !!row.active,
    ownerId: row.owner_id ?? null,
    ownerName: row.owner_name || row.owner_email || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseAddressBody(body, existing = null) {
  const street = String(body.street ?? existing?.street ?? existing?.address ?? "").trim();
  const city = String(body.city ?? existing?.city ?? "").trim();
  const zip = String(body.zip ?? existing?.zip ?? "").trim();
  const state = "FL";
  if (!street || !city || !zip) return { error: "Street, city, and ZIP are required." };
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return { error: "Enter a valid ZIP code." };
  return { street, city, state, zip, legacyAddress: `${street}, ${city}, ${state} ${zip}` };
}

export function coordsFromBody(body) {
  const lat = body.lat != null && body.lat !== "" ? Number(body.lat) : null;
  const lng = body.lng != null && body.lng !== "" ? Number(body.lng) : null;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

export async function findAdminByEmail(db, email) {
  return db.prepare("SELECT * FROM admins WHERE lower(email) = lower(?)").bind(email.trim()).first();
}

export async function findAdminById(db, id) {
  return db.prepare("SELECT * FROM admins WHERE id = ?").bind(id).first();
}

let schemaInitialized = false;

/** Creates D1 tables on first use (matches schema.sql). Safe to call every request. */
export async function ensureSchema(db) {
  if (schemaInitialized) return;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        street TEXT,
        city TEXT,
        state TEXT DEFAULT 'FL',
        zip TEXT,
        lat REAL,
        lng REAL,
        service_day_of_week INTEGER NOT NULL,
        pool_type TEXT DEFAULT 'pool',
        monthly_rate REAL,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS service_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        UNIQUE(customer_id, date, type)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        customer_name TEXT,
        phone TEXT,
        original_text TEXT NOT NULL,
        sent_text TEXT NOT NULL,
        language TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS work_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        started_at INTEGER,
        ended_at INTEGER,
        start_lat REAL,
        start_lng REAL,
        total_miles REAL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS work_stops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_day_id INTEGER NOT NULL,
        customer_id INTEGER,
        customer_name TEXT,
        address TEXT,
        phone TEXT,
        lat REAL,
        lng REAL,
        seq INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        arrived_at INTEGER,
        started_at INTEGER,
        completed_at INTEGER,
        miles_from_prev REAL,
        notes TEXT,
        customer_notes TEXT,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS work_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_day_id INTEGER NOT NULL,
        stop_id INTEGER,
        customer_id INTEGER,
        type TEXT NOT NULL,
        lat REAL,
        lng REAL,
        miles REAL DEFAULT 0,
        ts INTEGER NOT NULL,
        meta TEXT
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_customers_day ON customers(service_day_of_week)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_overrides_date ON service_overrides(date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_message_logs_created ON message_logs(created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_work_days_status ON work_days(status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_work_stops_day ON work_stops(work_day_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_work_events_day ON work_events(work_day_id)"),
  ]);
  await runMigrations(db, null);
  schemaInitialized = true;
}

async function columnExists(db, table, column) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return (results || []).some((c) => c.name === column);
}

async function addColumn(db, table, column, definition) {
  if (!(await columnExists(db, table, column))) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

/** End duplicate active work days so the per-owner unique index can be created. */
async function dedupeActiveWorkdays(db) {
  const { results } = await db
    .prepare(`
      SELECT id, owner_id FROM work_days
      WHERE status = 'active' AND owner_id IS NOT NULL
      ORDER BY owner_id ASC, started_at DESC, id DESC
    `)
    .all();
  const keepOwner = new Set();
  for (const row of results || []) {
    if (keepOwner.has(row.owner_id)) {
      await db
        .prepare("UPDATE work_days SET status = 'ended', ended_at = ? WHERE id = ?")
        .bind(Date.now(), row.id)
        .run();
    } else {
      keepOwner.add(row.owner_id);
    }
  }
}

/** Adds multi-user columns and backfills existing rows to the super admin. */
export async function runMigrations(db, env) {
  await addColumn(db, "admins", "role", "TEXT NOT NULL DEFAULT 'user'");
  await addColumn(db, "admins", "active", "INTEGER NOT NULL DEFAULT 1");
  await addColumn(db, "admins", "business_name", "TEXT");
  await addColumn(db, "customers", "owner_id", "INTEGER");
  await addColumn(db, "work_days", "owner_id", "INTEGER");
  await addColumn(db, "message_logs", "owner_id", "INTEGER");
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_work_days_owner ON work_days(owner_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_message_logs_owner ON message_logs(owner_id)").run();
  await dedupeActiveWorkdays(db);
  try {
    await db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_work_days_one_active_per_owner
      ON work_days(owner_id) WHERE status = 'active'
    `).run();
  } catch {
    // Existing duplicates or a partial index conflict must not block login.
  }

  const superEmail = String(env?.ADMIN_EMAIL || "").trim().toLowerCase();
  if (superEmail) {
    await db.prepare("UPDATE admins SET role = 'super' WHERE lower(email) = ?").bind(superEmail).run();
  }

  const superRow = await db
    .prepare("SELECT id FROM admins WHERE role = 'super' ORDER BY id ASC LIMIT 1")
    .first();
  if (superRow?.id) {
    await db.prepare("UPDATE customers SET owner_id = ? WHERE owner_id IS NULL").bind(superRow.id).run();
    await db.prepare("UPDATE work_days SET owner_id = ? WHERE owner_id IS NULL").bind(superRow.id).run();
    await db.prepare("UPDATE message_logs SET owner_id = ? WHERE owner_id IS NULL").bind(superRow.id).run();
  }
}

const BCRYPT_COST = 12;

/**
 * Ensures the env-configured super admin exists and stays in sync with ADMIN_EMAIL / ADMIN_PASSWORD.
 * Other team accounts are managed by the super user and are never deleted here.
 */
export async function ensureAdminSeed(db, env) {
  await ensureSchema(db);
  await runMigrations(db, env);
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = String(env.ADMIN_PASSWORD || "");
  if (!adminEmail || !adminPassword) return;

  const existing = await findAdminByEmail(db, adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, BCRYPT_COST);
    await db.prepare(`
      INSERT INTO admins (email, password_hash, name, role, active, created_at)
      VALUES (?, ?, ?, 'super', 1, ?)
    `).bind(adminEmail, hash, "Super Admin", Date.now()).run();
    return;
  }

  const hash = bcrypt.compareSync(adminPassword, existing.password_hash)
    ? existing.password_hash
    : bcrypt.hashSync(adminPassword, BCRYPT_COST);
  await db.prepare(`
    UPDATE admins SET password_hash = ?, role = 'super', active = 1 WHERE id = ?
  `).bind(hash, existing.id).run();
}

export async function geocodeAndSaveCustomer(db, id, addressParts, pickedCoords = null, env = null) {
  if (pickedCoords && isInFlorida(pickedCoords.lat, pickedCoords.lng)) {
    await db.prepare("UPDATE customers SET lat = ?, lng = ?, updated_at = ? WHERE id = ?")
      .bind(pickedCoords.lat, pickedCoords.lng, Date.now(), id).run();
    return { ...pickedCoords, approximate: false };
  }
  try {
    const result = await geocodeAddress(addressParts, env);
    if (result) {
      await db.prepare("UPDATE customers SET lat = ?, lng = ?, updated_at = ? WHERE id = ?")
        .bind(result.lat, result.lng, Date.now(), id).run();
    }
    return result;
  } catch {
    return null;
  }
}

export async function ensureCustomerCoords(db, customerRow, env = null) {
  if (customerRow.lat != null && customerRow.lng != null && isInFlorida(customerRow.lat, customerRow.lng)) {
    return { lat: customerRow.lat, lng: customerRow.lng, approximate: false };
  }

  let street = customerRow.street || customerRow.address;
  let city = customerRow.city;
  let zip = customerRow.zip;
  const state = "FL";

  if (street && (!city || !zip)) {
    const parsed = street.match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2}),?\s*(\d{5}(?:-\d{4})?)\s*$/);
    if (parsed) {
      street = parsed[1].trim();
      city = parsed[2].trim();
      zip = parsed[4];
    }
  }
  if (!street || !city || !zip) return null;

  const result = await geocodeAddress({ street, city, state, zip }, env);
  if (!result) return null;

  await db.prepare("UPDATE customers SET lat = ?, lng = ?, updated_at = ? WHERE id = ?")
    .bind(result.lat, result.lng, Date.now(), customerRow.id).run();
  return result;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getActiveCustomers(db, auth) {
  const scope = ownerClause(auth, "customers");
  const { results } = await db
    .prepare(`SELECT customers.* FROM customers WHERE customers.active = 1${scope.sql} ORDER BY customers.name ASC`)
    .bind(...scope.binds)
    .all();
  return results || [];
}

export async function customersForDate(db, dateStr, auth) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return [];

  const dow = d.getDay();
  const customers = await getActiveCustomers(db, auth);
  const customerIds = new Set(customers.map((c) => c.id));
  const { results: overrides } = await db.prepare("SELECT * FROM service_overrides WHERE date = ?").bind(dateStr).all();
  const list = (overrides || []).filter((o) => customerIds.has(o.customer_id));

  const skipIds = new Set(list.filter((o) => o.type === "skip").map((o) => o.customer_id));
  const extraIds = list.filter((o) => o.type === "extra").map((o) => o.customer_id);

  const scheduled = customers.filter((c) => c.service_day_of_week === dow && !skipIds.has(c.id));
  for (const id of extraIds) {
    if (!scheduled.find((c) => c.id === id)) {
      const extra = customers.find((c) => c.id === id);
      if (extra) scheduled.push(extra);
    }
  }
  scheduled.sort((a, b) => a.name.localeCompare(b.name));

  return scheduled.map((c) => ({
    ...publicCustomer(c),
    overrides: list.filter((o) => o.customer_id === c.id).map((o) => ({ type: o.type, note: o.note || "" })),
  }));
}

function countCustomersForDate(customers, overridesForDate, dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 0;

  const dow = d.getDay();
  const skipIds = new Set(overridesForDate.filter((o) => o.type === "skip").map((o) => o.customer_id));
  const extraIds = overridesForDate.filter((o) => o.type === "extra").map((o) => o.customer_id);
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const scheduledIds = new Set(
    customers.filter((c) => c.service_day_of_week === dow && !skipIds.has(c.id)).map((c) => c.id)
  );
  for (const id of extraIds) {
    if (customerById.has(id)) scheduledIds.add(id);
  }
  return scheduledIds.size;
}

export async function calendarSummary(db, year, month, auth) {
  const customers = await getActiveCustomers(db, auth);
  const customerIds = new Set(customers.map((c) => c.id));
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

  const { results: monthOverrides } = await db
    .prepare("SELECT * FROM service_overrides WHERE date >= ? AND date <= ?")
    .bind(monthStart, monthEnd)
    .all();

  const overridesByDate = new Map();
  for (const o of monthOverrides || []) {
    if (!customerIds.has(o.customer_id)) continue;
    if (!overridesByDate.has(o.date)) overridesByDate.set(o.date, []);
    overridesByDate.get(o.date).push(o);
  }

  const summary = {};
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const count = countCustomersForDate(customers, overridesByDate.get(dateStr) || [], dateStr);
    summary[dateStr] = { count };
  }
  return summary;
}

function routeStartKey(ownerId) {
  return `route_start_${ownerId}`;
}

export async function getRouteStartSetting(db, ownerId) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(routeStartKey(ownerId)).first();
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      return {
        street: parsed.street || "",
        city: parsed.city || "",
        state: parsed.state || "FL",
        zip: parsed.zip || "",
        lat: parsed.lat ?? DEFAULT_DEPOT.lat,
        lng: parsed.lng ?? DEFAULT_DEPOT.lng,
        label: parsed.label || formatAddress(parsed) || DEFAULT_DEPOT.label,
      };
    } catch { /* default */ }
  }
  return {
    street: "",
    city: "Kissimmee",
    state: "FL",
    zip: "34741",
    lat: DEFAULT_DEPOT.lat,
    lng: DEFAULT_DEPOT.lng,
    label: DEFAULT_DEPOT.label,
  };
}

export async function saveRouteStartSetting(db, ownerId, parts, pickedCoords = null, env = null) {
  let lat = null;
  let lng = null;
  if (pickedCoords && isInFlorida(pickedCoords.lat, pickedCoords.lng)) {
    lat = pickedCoords.lat;
    lng = pickedCoords.lng;
  } else {
    const result = await geocodeAddress(parts, env);
    lat = result?.lat ?? null;
    lng = result?.lng ?? null;
  }
  const saved = {
    street: parts.street,
    city: parts.city,
    state: "FL",
    zip: parts.zip,
    lat,
    lng,
    label: `${parts.street}, ${parts.city}, FL ${parts.zip}`,
  };
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(routeStartKey(ownerId), JSON.stringify(saved), Date.now()).run();
  return saved;
}

export async function getRouteDepot(db, ownerId) {
  const start = await getRouteStartSetting(db, ownerId);
  if (start.lat == null || start.lng == null) {
    return { ...DEFAULT_DEPOT, label: start.label || DEFAULT_DEPOT.label };
  }
  return { lat: start.lat, lng: start.lng, label: start.label || "Route start" };
}

export async function listCustomers(db, auth, all = false) {
  const scope = ownerClause(auth, "customers");
  const activeClause = all ? "" : " AND customers.active = 1";
  const sql = auth.isSuper
    ? `SELECT customers.*, admins.name AS owner_name, admins.email AS owner_email
       FROM customers
       LEFT JOIN admins ON admins.id = customers.owner_id
       WHERE 1=1${activeClause}${scope.sql}
       ORDER BY customers.active DESC, customers.name ASC`
    : `SELECT customers.* FROM customers WHERE 1=1${activeClause}${scope.sql} ORDER BY customers.name ASC`;
  const { results } = await db.prepare(sql).bind(...scope.binds).all();
  return (results || []).map(publicCustomer);
}

export async function getCustomerRow(db, customerId, auth) {
  const row = await db.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
  if (!row) return null;
  if (!auth.isSuper && row.owner_id !== auth.userId) return null;
  if (!auth.isSuper) return row;
  const owner = row.owner_id
    ? await db.prepare("SELECT name, email FROM admins WHERE id = ?").bind(row.owner_id).first()
    : null;
  return { ...row, owner_name: owner?.name || "", owner_email: owner?.email || "" };
}

export async function listTeamUsers(db) {
  const { results } = await db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM customers c WHERE c.owner_id = a.id AND c.active = 1) AS active_customers
    FROM admins a
    ORDER BY CASE WHEN a.role = 'super' THEN 0 ELSE 1 END, a.email ASC
  `).all();
  return (results || []).map((r) => ({
    ...publicAdmin(r),
    activeCustomers: r.active_customers || 0,
  }));
}

export async function createTeamUser(db, { email, password, name, businessName }) {
  const normalized = String(email || "").trim().toLowerCase();
  const pwd = String(password || "");
  const biz = String(businessName || "").trim();
  if (!normalized || !pwd) throw new Error("Email and password are required.");
  if (!biz) throw new Error("Business name is required.");
  if (await findAdminByEmail(db, normalized)) throw new Error("An account with that email already exists.");
  const hash = bcrypt.hashSync(pwd, BCRYPT_COST);
  const res = await db.prepare(`
    INSERT INTO admins (email, password_hash, name, business_name, role, active, created_at)
    VALUES (?, ?, ?, ?, 'user', 1, ?)
  `).bind(normalized, hash, String(name || "").trim(), biz, Date.now()).run();
  return findAdminById(db, res.meta.last_row_id);
}

export async function updateTeamUser(db, id, { name, email, businessName, password, active }) {
  const user = await findAdminById(db, id);
  if (!user) return null;
  if (user.role === "super" && active === false) throw new Error("Cannot restrict the super account.");

  const fields = [];
  const binds = [];
  if (name !== undefined) {
    fields.push("name = ?");
    binds.push(String(name || "").trim());
  }
  if (businessName !== undefined) {
    const biz = String(businessName || "").trim();
    if (!biz) throw new Error("Business name is required.");
    fields.push("business_name = ?");
    binds.push(biz);
  }
  if (password) {
    fields.push("password_hash = ?");
    binds.push(bcrypt.hashSync(String(password), BCRYPT_COST));
  }
  if (email !== undefined) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) throw new Error("Email is required.");
    const conflict = await findAdminByEmail(db, normalized);
    if (conflict && conflict.id !== id) throw new Error("An account with that email already exists.");
    fields.push("email = ?");
    binds.push(normalized);
  }
  if (active !== undefined && user.role !== "super") {
    fields.push("active = ?");
    binds.push(active ? 1 : 0);
  }
  if (!fields.length) return user;

  binds.push(id);
  await db.prepare(`UPDATE admins SET ${fields.join(", ")} WHERE id = ?`).bind(...binds).run();
  return findAdminById(db, id);
}

export async function deleteTeamUser(db, id) {
  const user = await findAdminById(db, id);
  if (!user) return false;
  if (user.role === "super") throw new Error("Cannot delete the super account.");

  const superRow = await db
    .prepare("SELECT id FROM admins WHERE role = 'super' ORDER BY id ASC LIMIT 1")
    .first();
  if (!superRow) throw new Error("No super account found to reassign data.");

  await db.batch([
    db.prepare("UPDATE customers SET owner_id = ? WHERE owner_id = ?").bind(superRow.id, id),
    db.prepare("UPDATE work_days SET owner_id = ? WHERE owner_id = ?").bind(superRow.id, id),
    db.prepare("UPDATE message_logs SET owner_id = ? WHERE owner_id = ?").bind(superRow.id, id),
    db.prepare("DELETE FROM admins WHERE id = ?").bind(id),
  ]);
  return true;
}
