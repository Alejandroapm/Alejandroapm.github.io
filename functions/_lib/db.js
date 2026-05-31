import bcrypt from "bcryptjs";
import { formatAddress, geocodeAddress } from "./geocode.js";
import { isInFlorida } from "./florida.js";
import { DEFAULT_DEPOT } from "./routing.js";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function publicAdmin(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name };
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

/** Creates D1 tables on first use (matches schema.sql). Safe to call every request. */
export async function ensureSchema(db) {
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
    db.prepare("CREATE INDEX IF NOT EXISTS idx_customers_day ON customers(service_day_of_week)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_overrides_date ON service_overrides(date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_message_logs_created ON message_logs(created_at)"),
  ]);
}

const BCRYPT_COST = 12;

/**
 * Keeps the admin account in sync with the ADMIN_EMAIL / ADMIN_PASSWORD env vars,
 * which are the single source of truth. Safe to call on every request:
 * - removes any admin row that doesn't match the configured email
 * - creates the admin if missing
 * - re-hashes the password only when it actually changed (no needless rehashing,
 *   and the plaintext password is never logged or returned)
 */
export async function ensureAdminSeed(db, env) {
  await ensureSchema(db);
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = String(env.ADMIN_PASSWORD || "");
  if (!adminEmail || !adminPassword) return;

  await db.prepare("DELETE FROM admins WHERE lower(email) <> ?").bind(adminEmail).run();

  const existing = await findAdminByEmail(db, adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, BCRYPT_COST);
    await db.prepare(`
      INSERT INTO admins (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)
    `).bind(adminEmail, hash, "Administrator", Date.now()).run();
    return;
  }

  if (!bcrypt.compareSync(adminPassword, existing.password_hash)) {
    const hash = bcrypt.hashSync(adminPassword, BCRYPT_COST);
    await db.prepare("UPDATE admins SET password_hash = ? WHERE id = ?")
      .bind(hash, existing.id).run();
  }
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

export async function getActiveCustomers(db) {
  const { results } = await db.prepare("SELECT * FROM customers WHERE active = 1 ORDER BY name ASC").all();
  return results || [];
}

export async function customersForDate(db, dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return [];

  const dow = d.getDay();
  const customers = await getActiveCustomers(db);
  const { results: overrides } = await db.prepare("SELECT * FROM service_overrides WHERE date = ?").bind(dateStr).all();
  const list = overrides || [];

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

export async function calendarSummary(db, year, month) {
  const end = new Date(year, month, 0);
  const summary = {};
  for (let day = 1; day <= end.getDate(); day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const list = await customersForDate(db, dateStr);
    summary[dateStr] = { count: list.length, customers: list };
  }
  return summary;
}

export async function getRouteStartSetting(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'route_start'").first();
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

export async function saveRouteStartSetting(db, parts, pickedCoords = null, env = null) {
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
    INSERT INTO settings (key, value, updated_at) VALUES ('route_start', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(JSON.stringify(saved), Date.now()).run();
  return saved;
}

export async function getRouteDepot(db) {
  const start = await getRouteStartSetting(db);
  if (start.lat == null || start.lng == null) {
    return { ...DEFAULT_DEPOT, label: start.label || DEFAULT_DEPOT.label };
  }
  return { lat: start.lat, lng: start.lng, label: start.label || "Route start" };
}
