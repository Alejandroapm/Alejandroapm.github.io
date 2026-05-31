import { Router } from "express";
import {
  db,
  publicCustomer,
  customersForDate,
  calendarSummary,
  DAY_NAMES,
  parseAddressBody,
  geocodeAndSaveCustomer,
  getRouteStartSetting,
  saveRouteStartSetting,
  getRouteDepot,
  coordsFromBody,
} from "../db.js";
import { buildOptimizedRoute } from "../routeBuilder.js";
import { suggestAddresses } from "../addressSuggest.js";
import { requireAuth, requireAdmin } from "../auth.js";

const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/address/suggest", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 3) return res.json({ suggestions: [] });

  try {
    const suggestions = await suggestAddresses(q);
    res.json({ suggestions });
  } catch {
    res.status(500).json({ error: "Address lookup failed." });
  }
});

router.get("/customers", (req, res) => {
  const rows = req.query.all === "1"
    ? db.prepare("SELECT * FROM customers ORDER BY active DESC, name ASC").all()
    : db.prepare("SELECT * FROM customers WHERE active = 1 ORDER BY name ASC").all();
  res.json({ customers: rows.map(publicCustomer) });
});

router.get("/customers/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Customer not found." });
  res.json({ customer: publicCustomer(row) });
});

router.post("/customers", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const serviceDayOfWeek = Number(req.body.serviceDayOfWeek);
  const addr = parseAddressBody(req.body);

  if (!name) return res.status(400).json({ error: "Customer name is required." });
  if (addr.error) return res.status(400).json({ error: addr.error });
  if (Number.isNaN(serviceDayOfWeek) || serviceDayOfWeek < 0 || serviceDayOfWeek > 6) {
    return res.status(400).json({ error: "Select a valid service day (Sun–Sat)." });
  }

  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO customers (
      name, phone, email, address, street, city, state, zip,
      service_day_of_week, pool_type, monthly_rate, notes, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    name,
    String(req.body.phone || "").trim(),
    String(req.body.email || "").trim(),
    addr.legacyAddress,
    addr.street,
    addr.city,
    addr.state,
    addr.zip,
    serviceDayOfWeek,
    String(req.body.poolType || "pool"),
    req.body.monthlyRate ? Number(req.body.monthlyRate) : null,
    String(req.body.notes || "").trim(),
    now,
    now
  );

  const id = result.lastInsertRowid;
  await geocodeAndSaveCustomer(id, addr, coordsFromBody(req.body));

  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  res.status(201).json({ customer: publicCustomer(row) });
});

router.put("/customers/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Customer not found." });

  const name = String(req.body.name ?? existing.name).trim();
  const addr = parseAddressBody(req.body, existing);
  const serviceDayOfWeek = req.body.serviceDayOfWeek !== undefined
    ? Number(req.body.serviceDayOfWeek)
    : existing.service_day_of_week;

  if (!name) return res.status(400).json({ error: "Customer name is required." });
  if (addr.error) return res.status(400).json({ error: addr.error });

  const addressChanged =
    addr.street !== existing.street ||
    addr.city !== existing.city ||
    addr.state !== existing.state ||
    addr.zip !== existing.zip;

  db.prepare(`
    UPDATE customers SET
      name = ?, phone = ?, email = ?,
      address = ?, street = ?, city = ?, state = ?, zip = ?,
      service_day_of_week = ?, pool_type = ?, monthly_rate = ?,
      notes = ?, active = ?, updated_at = ?,
      lat = CASE WHEN ? THEN NULL ELSE lat END,
      lng = CASE WHEN ? THEN NULL ELSE lng END
    WHERE id = ?
  `).run(
    name,
    String(req.body.phone ?? existing.phone ?? "").trim(),
    String(req.body.email ?? existing.email ?? "").trim(),
    addr.legacyAddress,
    addr.street,
    addr.city,
    addr.state,
    addr.zip,
    serviceDayOfWeek,
    String(req.body.poolType ?? existing.pool_type ?? "pool"),
    req.body.monthlyRate !== undefined ? (req.body.monthlyRate ? Number(req.body.monthlyRate) : null) : existing.monthly_rate,
    String(req.body.notes ?? existing.notes ?? "").trim(),
    req.body.active !== undefined ? (req.body.active ? 1 : 0) : existing.active,
    Date.now(),
    addressChanged ? 1 : 0,
    addressChanged ? 1 : 0,
    id
  );

  if (addressChanged) await geocodeAndSaveCustomer(id, addr, coordsFromBody(req.body));
  else {
    const picked = coordsFromBody(req.body);
    if (picked) await geocodeAndSaveCustomer(id, addr, picked);
    else if (existing.lat == null) await geocodeAndSaveCustomer(id, addr);
  }

  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  res.json({ customer: publicCustomer(row) });
});

router.patch("/customers/:id/deactivate", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Customer not found." });

  db.prepare("UPDATE customers SET active = 0, updated_at = ? WHERE id = ?").run(Date.now(), id);
  res.json({ ok: true });
});

router.delete("/customers/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Customer not found." });

  db.prepare("DELETE FROM service_overrides WHERE customer_id = ?").run(id);
  db.prepare("DELETE FROM customers WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.get("/calendar", (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: "Provide year and month query params." });
  }

  const summary = calendarSummary(year, month);
  const counts = {};
  for (const [date, data] of Object.entries(summary)) counts[date] = data.count;
  res.json({ year, month, counts });
});

router.get("/day", (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Provide date as YYYY-MM-DD." });
  }

  const d = new Date(`${date}T12:00:00`);
  res.json({
    date,
    dayName: DAY_NAMES[d.getDay()],
    customers: customersForDate(date),
  });
});

router.get("/route", async (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Provide date as YYYY-MM-DD." });
  }

  const d = new Date(`${date}T12:00:00`);
  const rawCustomers = db.prepare(`
    SELECT * FROM customers WHERE id IN (
      SELECT id FROM customers WHERE active = 1
    )
  `).all();

  const scheduledIds = new Set(customersForDate(date).map((c) => c.id));
  const scheduledRows = rawCustomers.filter((c) => scheduledIds.has(c.id));

  if (!scheduledRows.length) {
    return res.json({
      date,
      dayName: DAY_NAMES[d.getDay()],
      scheduledCount: 0,
      depot: getRouteDepot(),
      stops: [],
      unmapped: [],
      geometry: null,
      distanceMiles: null,
      durationMinutes: null,
    });
  }

  try {
    const depot = getRouteDepot();
    const route = await buildOptimizedRoute(db, scheduledRows, depot);
    res.json({
      date,
      dayName: DAY_NAMES[d.getDay()],
      scheduledCount: scheduledRows.length,
      ...route,
    });
  } catch (err) {
    console.error("Route build failed:", err);
    res.status(500).json({ error: "Could not build optimized route." });
  }
});

router.get("/settings/route-start", (_req, res) => {
  res.json({ routeStart: getRouteStartSetting() });
});

router.put("/settings/route-start", async (req, res) => {
  const addr = parseAddressBody(req.body);
  if (addr.error) return res.status(400).json({ error: addr.error });

  try {
    const saved = await saveRouteStartSetting(addr, coordsFromBody(req.body));
    if (saved.lat == null || saved.lng == null) {
      return res.status(400).json({ error: "Could not locate that start address on the map. Check the address and try again." });
    }
    res.json({ routeStart: saved });
  } catch {
    res.status(500).json({ error: "Could not save route start address." });
  }
});

router.get("/map/customers", (req, res) => {
  const rows = db.prepare("SELECT * FROM customers WHERE active = 1 ORDER BY name ASC").all();
  res.json({ customers: rows.map(publicCustomer) });
});

router.post("/map/geocode", async (req, res) => {
  const { ensureCustomerCoords, sleep } = await import("../geocode.js");
  const rows = db.prepare(`
    SELECT * FROM customers WHERE active = 1 AND (lat IS NULL OR lng IS NULL)
  `).all();

  let geocoded = 0;
  for (const row of rows) {
    const coords = await ensureCustomerCoords(db, row);
    if (coords) geocoded += 1;
    await sleep(250);
  }

  const updated = db.prepare("SELECT * FROM customers WHERE active = 1 ORDER BY name ASC").all();
  res.json({ geocoded, attempted: rows.length, customers: updated.map(publicCustomer) });
});

router.post("/overrides", (req, res) => {
  const customerId = Number(req.body.customerId);
  const date = String(req.body.date || "");
  const type = String(req.body.type || "");

  if (!customerId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "customerId and date required." });
  }
  if (!["skip", "extra"].includes(type)) {
    return res.status(400).json({ error: "type must be skip or extra." });
  }

  db.prepare(`
    INSERT INTO service_overrides (customer_id, date, type, note, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(customer_id, date, type) DO UPDATE SET note = excluded.note
  `).run(customerId, date, type, String(req.body.note || "").trim(), Date.now());

  res.json({ ok: true, customers: customersForDate(date) });
});

router.delete("/overrides", (req, res) => {
  const { customerId, date, type } = req.body;
  db.prepare(`
    DELETE FROM service_overrides WHERE customer_id = ? AND date = ? AND type = ?
  `).run(Number(customerId), String(date), String(type));

  res.json({ ok: true, customers: customersForDate(String(date)) });
});

router.get("/stats", (_req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS n FROM customers WHERE active = 1").get().n;
  const byDay = db.prepare(`
    SELECT service_day_of_week AS day, COUNT(*) AS count
    FROM customers WHERE active = 1 GROUP BY service_day_of_week
  `).all();

  const routeLoad = DAY_NAMES.map((name, i) => ({
    day: i,
    dayName: name,
    count: byDay.find((r) => r.day === i)?.count || 0,
  }));

  res.json({ totalActive: total, routeLoad });
});

export default router;
