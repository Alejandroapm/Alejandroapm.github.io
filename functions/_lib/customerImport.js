import { geocodeAddress, geocodeOneLineAddress } from "./geocode.js";
import { findAdminById, sleep } from "./db.js";

const DAY_ALIASES = new Map([
  ["domingo", 0], ["sunday", 0], ["sun", 0],
  ["lunes", 1], ["monday", 1], ["mon", 1],
  ["martes", 2], ["tuesday", 2], ["tue", 2], ["tues", 2],
  ["miercoles", 3], ["miércoles", 3], ["wednesday", 3], ["wed", 3],
  ["jueves", 4], ["thursday", 4], ["thu", 4], ["thurs", 4],
  ["viernes", 5], ["friday", 5], ["fri", 5],
  ["sabado", 6], ["sábado", 6], ["saturday", 6], ["sat", 6],
]);

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function parseServiceDay(raw) {
  const key = normalizeKey(raw);
  if (DAY_ALIASES.has(key)) return DAY_ALIASES.get(key);
  return null;
}

/** Parse a single CSV row respecting quoted fields. */
function parseCsvRow(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseCustomerCsv(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  for (const line of lines) {
    const cols = parseCsvRow(line);
    if (!cols.length) continue;
    const first = normalizeKey(cols[0]);
    if (first.includes("day of the week") || first === "day" || first.includes("dia")) continue;
    if (parseServiceDay(cols[0]) == null && cols.length < 3) continue;

    rows.push({
      dayLabel: cols[0] || "",
      name: cols[1] || "",
      address: cols[2] || "",
      phone: cols[3] || "",
      notes: cols[4] || "",
      cost: cols[5] || "",
    });
  }
  return rows;
}

export function parseImportAddress(raw) {
  const original = String(raw || "").trim();
  if (!original) return { street: "", city: "", state: "FL", zip: "", legacyAddress: "" };

  let work = original.replace(/\s+/g, " ").trim();
  const zipMatch = work.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch?.[1] || "";
  if (zipMatch) work = work.replace(zipMatch[0], "").replace(/,\s*$/, "").trim();

  work = work.replace(/,\s*Florida\b/i, "").replace(/,\s*FL\b/i, "").replace(/\bFL\b/i, "").trim();
  work = work.replace(/,\s*$/, "").trim();

  const parts = work.split(",").map((p) => p.trim()).filter(Boolean);
  let street = parts[0] || work;
  let city = parts[1] || "";

  if (!city && parts[0]) {
    const tokens = parts[0].split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (last && /^[A-Za-z]{3,}$/.test(last) && !/^\d/.test(last) && tokens.length > 2) {
      city = last;
      street = tokens.slice(0, -1).join(" ");
    }
  }

  const legacyAddress = zip
    ? `${street}, ${city}, FL ${zip}`.replace(/,\s*,/g, ",").replace(/^,\s*/, "").trim()
    : original;

  return { street, city, state: "FL", zip, legacyAddress };
}

function parseMonthlyRate(raw) {
  const s = String(raw || "").trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function extractEmail(text) {
  const m = String(text || "").match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m?.[0] || "";
}

function cleanPhone(raw) {
  const s = String(raw || "").trim();
  if (!s || /sin tel/i.test(s) || /^email:/i.test(s)) return "";
  return s;
}

function mergeNotes(notes, phone) {
  let note = String(notes || "").trim();
  const phoneStr = String(phone || "").trim();
  if (/^email:/i.test(phoneStr)) {
    note = note ? `${note}; ${phoneStr}` : phoneStr;
  }
  return note;
}

async function resolveAddressParts(rawAddress, env) {
  let parts = parseImportAddress(rawAddress);
  if (parts.street && parts.city && parts.zip) return parts;

  const geo = await geocodeOneLineAddress(rawAddress, env);
  if (geo) {
    parts = {
      street: geo.street || parts.street,
      city: geo.city || parts.city,
      state: "FL",
      zip: geo.zip || parts.zip,
      legacyAddress: geo.label || parts.legacyAddress || rawAddress,
      lat: geo.lat,
      lng: geo.lng,
      approximate: geo.approximate,
    };
  }
  return parts;
}

export async function importCustomersFromCsv(db, auth, csvText, targetUserId, env) {
  let ownerId = auth.userId;
  if (targetUserId != null) {
    if (!auth.isSuper) {
      const err = new Error("Super user access required.");
      err.status = 403;
      throw err;
    }
    ownerId = targetUserId;
    const target = await findAdminById(db, ownerId);
    if (!target) {
      const err = new Error("Team member not found.");
      err.status = 404;
      throw err;
    }
  }

  const parsed = parseCustomerCsv(csvText);
  if (!parsed.length) {
    const err = new Error("No customer rows found in the CSV.");
    err.status = 400;
    throw err;
  }

  const result = {
    imported: 0,
    geocoded: 0,
    skipped: [],
    needsReview: [],
  };

  const now = Date.now();

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    const serviceDay = parseServiceDay(row.dayLabel);
    const name = String(row.name || "").trim();
    if (!name) {
      result.skipped.push({ row: i + 1, reason: "Missing customer name." });
      continue;
    }
    if (serviceDay == null) {
      result.skipped.push({ row: i + 1, name, reason: `Unknown service day: ${row.dayLabel}` });
      continue;
    }
    if (!String(row.address || "").trim()) {
      result.skipped.push({ row: i + 1, name, reason: "Missing address." });
      continue;
    }

    const addr = await resolveAddressParts(row.address, env);
    if (!addr.street) {
      result.skipped.push({ row: i + 1, name, reason: "Could not parse address." });
      continue;
    }

    const phone = cleanPhone(row.phone);
    const email = extractEmail(row.notes) || extractEmail(row.phone);
    const notes = mergeNotes(row.notes, row.phone);
    const monthlyRate = parseMonthlyRate(row.cost);

    const insert = await db.prepare(`
      INSERT INTO customers (
        name, phone, email, address, street, city, state, zip,
        service_day_of_week, pool_type, monthly_rate, notes, active, owner_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pool', ?, ?, 1, ?, ?, ?)
    `).bind(
      name,
      phone,
      email,
      addr.legacyAddress || row.address.trim(),
      addr.street,
      addr.city || "",
      "FL",
      addr.zip || "",
      serviceDay,
      monthlyRate,
      notes,
      ownerId,
      now,
      now
    ).run();

    const id = insert.meta.last_row_id;
    result.imported += 1;

    let geocoded = false;
    if (addr.lat != null && addr.lng != null) {
      await db.prepare("UPDATE customers SET lat = ?, lng = ?, updated_at = ? WHERE id = ?")
        .bind(addr.lat, addr.lng, Date.now(), id).run();
      geocoded = true;
    } else if (addr.street && addr.city && addr.zip) {
      const coords = await geocodeAddress(
        { street: addr.street, city: addr.city, state: "FL", zip: addr.zip },
        env
      );
      if (coords) {
        await db.prepare("UPDATE customers SET lat = ?, lng = ?, updated_at = ? WHERE id = ?")
          .bind(coords.lat, coords.lng, Date.now(), id).run();
        geocoded = true;
      }
    }

    if (geocoded) {
      result.geocoded += 1;
    } else {
      result.needsReview.push({
        row: i + 1,
        name,
        address: row.address,
        reason: "Saved but not mapped — use Customer map → Re-locate all.",
      });
    }

    if (i < parsed.length - 1) await sleep(120);
  }

  return result;
}
