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
import { geocodeAddress } from "./geocode.js";
import {
  startWorkday,
  getActiveWorkday,
  logNavigate,
  startJob,
  completeJob,
  skipStop,
  saveStopNotes,
  endWorkday,
  exportWorkdaysCsv,
} from "./workday.js";

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
    `The owner sends a short note, usually written quickly in informal Spanish that may contain spelling mistakes, ` +
    `missing accents, slang, or grammar errors.\n\n` +
    `Do the following:\n` +
    `1. Work out the exact, literal meaning of the note.\n` +
    `2. Translate it FAITHFULLY into ${targetName}, preserving every detail and the original intent. ` +
    `Do NOT add apologies, promises, greetings, or any idea that is not in the original, and do NOT drop information. ` +
    `Translate what was actually said, not a nicer version of it.\n` +
    `3. Fix only spelling, grammar, and obvious typos (for example "hecho" used for "echo", "vacuum" meaning the pool vacuum). ` +
    `Keep the wording simple, clear, courteous and professional — plain everyday language, no heavy jargon, no embellishment.\n` +
    `4. Keep the length and tone close to the original.\n` +
    `5. Rate the fidelity from 0 to 100: how completely and accurately your message preserves the original meaning ` +
    `(100 = nothing added, removed, or guessed; lower it whenever you had to guess intent or could not convey something exactly).\n\n` +
    `Respond with ONLY a single-line JSON object, no markdown and no extra text, exactly like:\n` +
    `{"message":"<final message in ${targetName}>","fidelity":<integer 0-100>}`
  );
}

function parseRefineOutput(raw) {
  if (!raw) return null;
  let jsonText = String(raw).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) jsonText = jsonText.slice(start, end + 1);

  try {
    const obj = JSON.parse(jsonText);
    const message = typeof obj.message === "string" ? obj.message.trim() : "";
    let score = Number(obj.fidelity);
    score = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
    if (message) return { message, score };
  } catch {
    // not valid JSON — fall back to treating the whole response as the message
  }

  const message = String(raw).replace(/^["'\s]+|["'\s]+$/g, "").trim();
  return message ? { message, score: null } : null;
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
        max_tokens: 600,
        temperature: 0.2,
      });
      const parsed = parseRefineOutput(res?.response || "");
      if (parsed?.message) return parsed;
    } catch {
      // fall through to the fallback below
    }
  }

  if (target === "es") return { message: text, score: null };

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=es|en`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const data = await r.json();
      const out = data?.responseData?.translatedText;
      if (out && out.trim()) return { message: out.trim(), score: null };
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
      const suggestions = await suggestAddresses(q, ctx.env);
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
    await geocodeAndSaveCustomer(ctx.env.DB, id, addr, coordsFromBody(body), ctx.env);
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

    if (addressChanged) await geocodeAndSaveCustomer(ctx.env.DB, id, addr, coordsFromBody(body), ctx.env);
    else {
      const picked = coordsFromBody(body);
      if (picked) await geocodeAndSaveCustomer(ctx.env.DB, id, addr, picked, ctx.env);
      else if (existing.lat == null) await geocodeAndSaveCustomer(ctx.env.DB, id, addr, null, ctx.env);
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
      const route = await buildOptimizedRoute(ctx.env.DB, scheduledRows, depot, ctx.env);
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
      const saved = await saveRouteStartSetting(ctx.env.DB, addr, coordsFromBody(body), ctx.env);
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
    // ?force=1 re-geocodes every active customer (used to refresh stale pins
    // after adding the Google Maps key); otherwise only fills in missing ones.
    if (ctx.req.query("force") === "1") {
      await ctx.env.DB.prepare("UPDATE customers SET lat = NULL, lng = NULL WHERE active = 1").run();
    }
    const { results: rows } = await ctx.env.DB.prepare(`
      SELECT * FROM customers WHERE active = 1 AND (lat IS NULL OR lng IS NULL)
    `).all();
    let geocoded = 0;
    for (const row of rows || []) {
      const coords = await ensureCustomerCoords(ctx.env.DB, row, ctx.env);
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

app.post("/api/admin/suggest-day", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    let lat = body.lat != null && body.lat !== "" ? Number(body.lat) : null;
    let lng = body.lng != null && body.lng !== "" ? Number(body.lng) : null;

    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
      const addr = parseAddressBody(body);
      if (addr.error) return json({ error: "Pick or enter a valid Florida address first." }, 400);
      const coords = await geocodeAddress(addr, ctx.env);
      if (!coords) return json({ error: "Could not locate that address on the map yet." }, 400);
      lat = coords.lat;
      lng = coords.lng;
    }

    const { results } = await ctx.env.DB.prepare("SELECT * FROM customers WHERE active = 1").all();
    const customers = results || [];

    const perDay = DAY_NAMES.map((dayName, day) => {
      const onDay = customers.filter((c) => c.service_day_of_week === day);
      const located = onDay.filter((c) => c.lat != null && c.lng != null);
      let nearest = null;
      for (const c of located) {
        const d = haversineMiles(lat, lng, c.lat, c.lng);
        if (nearest == null || d < nearest) nearest = d;
      }
      return {
        day,
        dayName,
        count: onDay.length,
        located: located.length,
        nearestMiles: nearest != null ? Number(nearest.toFixed(1)) : null,
      };
    });

    const withStops = perDay.filter((d) => d.nearestMiles != null);
    let suggested;
    let reason;
    if (withStops.length) {
      withStops.sort((a, b) => a.nearestMiles - b.nearestMiles || a.count - b.count);
      suggested = withStops[0];
      reason =
        `The closest pool you already service is about ${suggested.nearestMiles} mi away on ${suggested.dayName}, ` +
        `so adding this one to ${suggested.dayName} keeps the route tight with little extra driving.`;
    } else {
      const byLoad = [...perDay].sort((a, b) => a.count - b.count);
      suggested = byLoad[0];
      reason = `No mapped pools yet, so ${suggested.dayName} (your lightest day) is a good place to start.`;
    }

    return json({ suggestedDay: suggested.day, suggestedDayName: suggested.dayName, reason, perDay });
  })
);

app.post("/api/admin/translate", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    const text = String(body.text || "").trim();
    const target = String(body.target || "en").toLowerCase() === "es" ? "es" : "en";
    if (!text) return json({ error: "Enter a message to translate." }, 400);

    const result = await refineMessage(ctx.env, text, target);
    if (result == null) {
      return json({ error: "Translation service is unavailable right now. Try again in a moment." }, 502);
    }
    return json({ translated: result.message, score: result.score, target });
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

app.delete("/api/admin/messages/:id", async (c) =>
  withAdmin(c, async (ctx) => {
    const id = Number(ctx.req.param("id"));
    if (!id) return json({ error: "Invalid message id." }, 400);
    await ctx.env.DB.prepare("DELETE FROM message_logs WHERE id = ?").bind(id).run();
    return json({ ok: true });
  })
);

// ---- Work day ----
app.get("/api/admin/workday/active", async (c) =>
  withAdmin(c, async (ctx) => json({ workday: await getActiveWorkday(ctx.env.DB) }))
);

app.post("/api/admin/workday/start", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json();
    const date = String(body.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Provide date as YYYY-MM-DD." }, 400);
    try {
      const { workday, resumed } = await startWorkday(ctx.env.DB, ctx.env, date, coordsFromBody(body));
      return json({ workday, resumed });
    } catch {
      return json({ error: "Could not start the work day." }, 500);
    }
  })
);

app.post("/api/admin/workday/:id/navigate", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const workday = await logNavigate(
      ctx.env.DB,
      Number(ctx.req.param("id")),
      body.stopId ? Number(body.stopId) : null,
      coordsFromBody(body)
    );
    if (!workday) return json({ error: "Work day not found." }, 404);
    return json({ workday });
  })
);

app.post("/api/admin/workday/:id/end", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const workday = await endWorkday(ctx.env.DB, Number(ctx.req.param("id")), coordsFromBody(body));
    if (!workday) return json({ error: "Work day not found." }, 404);
    return json({ workday });
  })
);

app.post("/api/admin/workday/stop/:stopId/start", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const workday = await startJob(ctx.env.DB, Number(ctx.req.param("stopId")), coordsFromBody(body));
    if (!workday) return json({ error: "Stop not found." }, 404);
    return json({ workday });
  })
);

app.post("/api/admin/workday/stop/:stopId/complete", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const notes = body.notes != null ? String(body.notes) : null;
    const workday = await completeJob(ctx.env.DB, Number(ctx.req.param("stopId")), coordsFromBody(body), notes);
    if (!workday) return json({ error: "Stop not found." }, 404);
    return json({ workday });
  })
);

app.post("/api/admin/workday/stop/:stopId/skip", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const workday = await skipStop(ctx.env.DB, Number(ctx.req.param("stopId")), coordsFromBody(body));
    if (!workday) return json({ error: "Stop not found." }, 404);
    return json({ workday });
  })
);

app.post("/api/admin/workday/stop/:stopId/notes", async (c) =>
  withAdmin(c, async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const workday = await saveStopNotes(ctx.env.DB, Number(ctx.req.param("stopId")), body.notes || "");
    if (!workday) return json({ error: "Stop not found." }, 404);
    return json({ workday });
  })
);

app.get("/api/admin/workday/export.csv", async (c) =>
  withAdmin(c, async (ctx) => {
    const csv = await exportWorkdaysCsv(ctx.env.DB);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="workday-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  })
);

app.all("/api/*", () => json({ error: "Not found." }, 404));

export default app;
