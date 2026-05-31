import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  findAdminByEmail,
  findAdminById,
  publicAdmin,
  publicCustomer,
  parseAddressBody,
  coordsFromBody,
  geocodeAndSaveCustomer,
  ensureSchema,
  ensureAdminSeed,
  customersForDate,
  calendarSummary,
  DAY_NAMES,
  getRouteStartSetting,
  saveRouteStartSetting,
  getRouteDepot,
  ensureCustomerCoords,
  sleep,
} from "./db.js";
import {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAdmin,
  bcrypt,
} from "./auth.js";
import { suggestAddresses } from "./addressSuggest.js";
import { buildOptimizedRoute } from "./routeBuilder.js";

const app = new Hono();

app.use("/api/*", cors({ origin: (origin) => origin || "*", credentials: true }));

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function withAdmin(c, handler) {
  await ensureSchema(c.env.DB);
  const auth = await requireAdmin(c.req.raw, c.env);
  if (auth.error) return json({ error: auth.error }, auth.status);
  return handler(c, auth);
}

const LANG_NAMES = { en: "English", es: "Spanish" };

function buildRefinePrompt(targetName) {
  return (
    `You are a professional bilingual assistant for a residential pool and hot tub cleaning business. ` +
    `The business owner sends you a short note, usually typed quickly in informal Spanish that may contain ` +
    `spelling mistakes, missing accents, slang, or grammar errors. ` +
    `Your job: understand what the owner actually means, then rewrite it as a single polished message to the customer, written in ${targetName}. ` +
    `Fix all spelling and grammar, correct obvious typos (for example "hecho" meaning "echo"), and make the tone warm, courteous, and professional. ` +
    `Keep every concrete detail the owner included (timing like "tomorrow" or "next week", reasons, the service such as adding double chemicals). ` +
    `Do not invent details that were not implied, do not add greetings or signatures unless present, and keep it concise like a friendly customer text message. ` +
    `Respond with ONLY the final ${targetName} message text — no quotes, no labels, no explanations, no alternatives.`
  );
}

/** Clean up and translate an owner's note using a Workers AI LLM; MyMemory is a last-resort fallback. */
async function refineMessage(env, text, target) {
  const targetName = LANG_NAMES[target] || "English";

  if (env.AI && typeof env.AI.run === "function") {
    try {
      const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: buildRefinePrompt(targetName) },
          { role: "user", content: text },
        ],
        max_tokens: 512,
        temperature: 0.3,
      });
      let out = (res?.response || "").trim();
      out = out.replace(/^["'\s]+|["'\s]+$/g, "").trim();
      if (out) return out;
    } catch {
      // fall through to the fallback below
    }
  }

  if (target === "es") return text;

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=es|en`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const data = await r.json();
      const out = data?.responseData?.translatedText;
      if (out && out.trim()) return out.trim();
    }
  } catch {
    // ignore and report unavailable below
  }

  return null;
}

app.get("/api/health", async (c) => {
  await ensureAdminSeed(c.env.DB, c.env);
  return json({ ok: true });
});

app.post("/api/auth/login", async (c) => {
  await ensureAdminSeed(c.env.DB, c.env);
  const body = await c.req.json();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const rememberDevice = !!body.rememberDevice;

  const admin = await findAdminByEmail(c.env.DB, email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return json({ error: "Invalid email or password." }, 401);
  }

  const token = await signToken(c.env, { id: admin.id, email: admin.email });
  const secure = new URL(c.req.url).protocol === "https:";
  return json(
    { ok: true, admin: publicAdmin(admin) },
    200,
    { "Set-Cookie": setAuthCookie(token, rememberDevice, secure) }
  );
});

app.post("/api/auth/logout", (c) => {
  const secure = new URL(c.req.url).protocol === "https:";
  return json({ ok: true }, 200, { "Set-Cookie": clearAuthCookie(secure) });
});

app.get("/api/auth/me", async (c) =>
  withAdmin(c, async (ctx, auth) => {
    const admin = await findAdminById(ctx.env.DB, auth.userId);
    if (!admin) return json({ error: "Admin not found." }, 404);
    return json({ admin: publicAdmin(admin) });
  })
);

app.get("/api/admin/address/suggest", async (c) =>
  withAdmin(c, async (ctx) => {
    const q = String(ctx.req.query("q") || "").trim();
    if (q.length < 3) return json({ suggestions: [] });
    try {
      const suggestions = await suggestAddresses(q);
      return json({ suggestions });
    } catch {
      return json({ error: "Address lookup failed." }, 500);
    }
  })
);

app.get("/api/admin/customers", async (c) =>
  withAdmin(c, async (ctx) => {
    const all = ctx.req.query("all") === "1";
    const sql = all
      ? "SELECT * FROM customers ORDER BY active DESC, name ASC"
      : "SELECT * FROM customers WHERE active = 1 ORDER BY name ASC";
    const { results } = await ctx.env.DB.prepare(sql).all();
    return json({ customers: (results || []).map(publicCustomer) });
  })
);

app.get("/api/admin/customers/:id", async (c) =>
  withAdmin(c, async (ctx) => {
    const row = await ctx.env.DB.prepare("SELECT * FROM customers WHERE id = ?")
      .bind(Number(ctx.req.param("id"))).first();
    if (!row) return json({ error: "Customer not found." }, 404);
    return json({ customer: publicCustomer(row) });
  })
);

app.post("/api/admin/customers", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    const name = String(body.name || "").trim();
    const serviceDayOfWeek = Number(body.serviceDayOfWeek);
    const addr = parseAddressBody(body);
    if (!name) return json({ error: "Customer name is required." }, 400);
    if (addr.error) return json({ error: addr.error }, 400);
    if (Number.isNaN(serviceDayOfWeek) || serviceDayOfWeek < 0 || serviceDayOfWeek > 6) {
      return json({ error: "Select a valid service day (Sun–Sat)." }, 400);
    }
    const now = Date.now();
    const result = await ctx.env.DB.prepare(`
      INSERT INTO customers (
        name, phone, email, address, street, city, state, zip,
        service_day_of_week, pool_type, monthly_rate, notes, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(
      name, String(body.phone || "").trim(), String(body.email || "").trim(),
      addr.legacyAddress, addr.street, addr.city, addr.state, addr.zip,
      serviceDayOfWeek, String(body.poolType || "pool"),
      body.monthlyRate ? Number(body.monthlyRate) : null,
      String(body.notes || "").trim(), now, now
    ).run();
    const id = result.meta.last_row_id;
    await geocodeAndSaveCustomer(ctx.env.DB, id, addr, coordsFromBody(body));
    const row = await ctx.env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
    return json({ customer: publicCustomer(row) }, 201);
  })
);

app.put("/api/admin/customers/:id", async (c) =>
  withAdmin(c, async (ctx) => {
    const id = Number(ctx.req.param("id"));
    const existing = await ctx.env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "Customer not found." }, 404);

    const body = await ctx.req.json();
    const name = String(body.name ?? existing.name).trim();
    const addr = parseAddressBody(body, existing);
    const serviceDayOfWeek = body.serviceDayOfWeek !== undefined
      ? Number(body.serviceDayOfWeek) : existing.service_day_of_week;
    if (!name) return json({ error: "Customer name is required." }, 400);
    if (addr.error) return json({ error: addr.error }, 400);

    const addressChanged =
      addr.street !== existing.street || addr.city !== existing.city ||
      addr.state !== existing.state || addr.zip !== existing.zip;

    await ctx.env.DB.prepare(`
      UPDATE customers SET
        name = ?, phone = ?, email = ?,
        address = ?, street = ?, city = ?, state = ?, zip = ?,
        service_day_of_week = ?, pool_type = ?, monthly_rate = ?,
        notes = ?, active = ?, updated_at = ?,
        lat = CASE WHEN ? THEN NULL ELSE lat END,
        lng = CASE WHEN ? THEN NULL ELSE lng END
      WHERE id = ?
    `).bind(
      name,
      String(body.phone ?? existing.phone ?? "").trim(),
      String(body.email ?? existing.email ?? "").trim(),
      addr.legacyAddress, addr.street, addr.city, addr.state, addr.zip,
      serviceDayOfWeek,
      String(body.poolType ?? existing.pool_type ?? "pool"),
      body.monthlyRate !== undefined ? (body.monthlyRate ? Number(body.monthlyRate) : null) : existing.monthly_rate,
      String(body.notes ?? existing.notes ?? "").trim(),
      body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
      Date.now(),
      addressChanged ? 1 : 0, addressChanged ? 1 : 0, id
    ).run();

    if (addressChanged) await geocodeAndSaveCustomer(ctx.env.DB, id, addr, coordsFromBody(body));
    else {
      const picked = coordsFromBody(body);
      if (picked) await geocodeAndSaveCustomer(ctx.env.DB, id, addr, picked);
      else if (existing.lat == null) await geocodeAndSaveCustomer(ctx.env.DB, id, addr);
    }

    const row = await ctx.env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
    return json({ customer: publicCustomer(row) });
  })
);

app.patch("/api/admin/customers/:id/deactivate", async (c) =>
  withAdmin(c, async (ctx) => {
    const id = Number(ctx.req.param("id"));
    const existing = await ctx.env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "Customer not found." }, 404);
    await ctx.env.DB.prepare("UPDATE customers SET active = 0, updated_at = ? WHERE id = ?")
      .bind(Date.now(), id).run();
    return json({ ok: true });
  })
);

app.delete("/api/admin/customers/:id", async (c) =>
  withAdmin(c, async (ctx) => {
    const id = Number(ctx.req.param("id"));
    const existing = await ctx.env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "Customer not found." }, 404);
    await ctx.env.DB.prepare("DELETE FROM service_overrides WHERE customer_id = ?").bind(id).run();
    await ctx.env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(id).run();
    return json({ ok: true });
  })
);

app.get("/api/admin/calendar", async (c) =>
  withAdmin(c, async (ctx) => {
    const year = Number(ctx.req.query("year"));
    const month = Number(ctx.req.query("month"));
    if (!year || !month || month < 1 || month > 12) {
      return json({ error: "Provide year and month query params." }, 400);
    }
    const summary = await calendarSummary(ctx.env.DB, year, month);
    const counts = {};
    for (const [date, data] of Object.entries(summary)) counts[date] = data.count;
    return json({ year, month, counts });
  })
);

app.get("/api/admin/day", async (c) =>
  withAdmin(c, async (ctx) => {
    const date = String(ctx.req.query("date") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: "Provide date as YYYY-MM-DD." }, 400);
    }
    const d = new Date(`${date}T12:00:00`);
    return json({ date, dayName: DAY_NAMES[d.getDay()], customers: await customersForDate(ctx.env.DB, date) });
  })
);

app.get("/api/admin/route", async (c) =>
  withAdmin(c, async (ctx) => {
    const date = String(ctx.req.query("date") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: "Provide date as YYYY-MM-DD." }, 400);
    }
    const d = new Date(`${date}T12:00:00`);
    const scheduled = await customersForDate(ctx.env.DB, date);
    const scheduledIds = new Set(scheduled.map((c) => c.id));
    const { results: rawCustomers } = await ctx.env.DB.prepare(
      "SELECT * FROM customers WHERE active = 1"
    ).all();
    const scheduledRows = (rawCustomers || []).filter((c) => scheduledIds.has(c.id));

    if (!scheduledRows.length) {
      return json({
        date, dayName: DAY_NAMES[d.getDay()], scheduledCount: 0,
        depot: await getRouteDepot(ctx.env.DB), stops: [], unmapped: [],
        geometry: null, distanceMiles: null, durationMinutes: null,
      });
    }
    try {
      const depot = await getRouteDepot(ctx.env.DB);
      const route = await buildOptimizedRoute(ctx.env.DB, scheduledRows, depot);
      return json({ date, dayName: DAY_NAMES[d.getDay()], scheduledCount: scheduledRows.length, ...route });
    } catch {
      return json({ error: "Could not build optimized route." }, 500);
    }
  })
);

app.get("/api/admin/settings/route-start", async (c) =>
  withAdmin(c, async (ctx) => json({ routeStart: await getRouteStartSetting(ctx.env.DB) }))
);

app.put("/api/admin/settings/route-start", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    const addr = parseAddressBody(body);
    if (addr.error) return json({ error: addr.error }, 400);
    try {
      const saved = await saveRouteStartSetting(ctx.env.DB, addr, coordsFromBody(body));
      if (saved.lat == null || saved.lng == null) {
        return json({ error: "Could not locate that start address on the map." }, 400);
      }
      return json({ routeStart: saved });
    } catch {
      return json({ error: "Could not save route start address." }, 500);
    }
  })
);

app.post("/api/admin/map/geocode", async (c) =>
  withAdmin(c, async (ctx) => {
    const { results: rows } = await ctx.env.DB.prepare(`
      SELECT * FROM customers WHERE active = 1 AND (lat IS NULL OR lng IS NULL)
    `).all();
    let geocoded = 0;
    for (const row of rows || []) {
      const coords = await ensureCustomerCoords(ctx.env.DB, row);
      if (coords) geocoded += 1;
      await sleep(250);
    }
    const { results: updated } = await ctx.env.DB.prepare(
      "SELECT * FROM customers WHERE active = 1 ORDER BY name ASC"
    ).all();
    return json({ geocoded, attempted: (rows || []).length, customers: (updated || []).map(publicCustomer) });
  })
);

app.post("/api/admin/overrides", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    const customerId = Number(body.customerId);
    const date = String(body.date || "");
    const type = String(body.type || "");
    if (!customerId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: "customerId and date required." }, 400);
    }
    if (!["skip", "extra"].includes(type)) return json({ error: "type must be skip or extra." }, 400);
    await ctx.env.DB.prepare(`
      INSERT INTO service_overrides (customer_id, date, type, note, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(customer_id, date, type) DO UPDATE SET note = excluded.note
    `).bind(customerId, date, type, String(body.note || "").trim(), Date.now()).run();
    return json({ ok: true, customers: await customersForDate(ctx.env.DB, date) });
  })
);

app.delete("/api/admin/overrides", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    await ctx.env.DB.prepare(`
      DELETE FROM service_overrides WHERE customer_id = ? AND date = ? AND type = ?
    `).bind(Number(body.customerId), String(body.date), String(body.type)).run();
    return json({ ok: true, customers: await customersForDate(ctx.env.DB, String(body.date)) });
  })
);

app.get("/api/admin/stats", async (c) =>
  withAdmin(c, async (ctx) => {
    const totalRow = await ctx.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM customers WHERE active = 1"
    ).first();
    const { results: byDay } = await ctx.env.DB.prepare(`
      SELECT service_day_of_week AS day, COUNT(*) AS count
      FROM customers WHERE active = 1 GROUP BY service_day_of_week
    `).all();
    const routeLoad = DAY_NAMES.map((name, i) => ({
      day: i,
      dayName: name,
      count: (byDay || []).find((r) => r.day === i)?.count || 0,
    }));
    return json({ totalActive: totalRow?.n || 0, routeLoad });
  })
);

app.post("/api/admin/translate", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    const text = String(body.text || "").trim();
    const target = String(body.target || "en").toLowerCase() === "es" ? "es" : "en";
    if (!text) return json({ error: "Enter a message to translate." }, 400);

    const translated = await refineMessage(ctx.env, text, target);
    if (translated == null) {
      return json({ error: "Translation service is unavailable right now. Try again in a moment." }, 502);
    }
    return json({ translated, target });
  })
);

const MSG_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MSG_LOG_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

app.get("/api/admin/messages", async (c) =>
  withAdmin(c, async (ctx) => {
    const cutoff = Date.now() - MSG_LOG_WINDOW_MS;
    const { results } = await ctx.env.DB.prepare(
      "SELECT * FROM message_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500"
    ).bind(cutoff).all();
    return json({ messages: results || [] });
  })
);

app.post("/api/admin/messages/log", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    const originalText = String(body.originalText || "").trim();
    const sentText = String(body.sentText || "").trim();
    const language = String(body.language || "en").toLowerCase() === "es" ? "es" : "en";
    if (!sentText) return json({ error: "Nothing to log." }, 400);

    const now = Date.now();
    await ctx.env.DB.prepare(`
      INSERT INTO message_logs (customer_id, customer_name, phone, original_text, sent_text, language, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.customerId ? Number(body.customerId) : null,
      String(body.customerName || "").trim(),
      String(body.phone || "").trim(),
      originalText, sentText, language, now
    ).run();

    await ctx.env.DB.prepare("DELETE FROM message_logs WHERE created_at < ?")
      .bind(now - MSG_LOG_RETENTION_MS).run();

    return json({ ok: true });
  })
);

app.all("/api/*", () => json({ error: "Not found." }, 404));

export default app;
