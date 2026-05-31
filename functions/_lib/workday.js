import { milesBetween } from "./florida.js";
import { buildOptimizedRoute } from "./routeBuilder.js";
import { customersForDate, getRouteDepot, DAY_NAMES, findAdminById } from "./db.js";
import { assertWorkdayAccess } from "./scope.js";

function publicStop(s) {
  return {
    id: s.id,
    customerId: s.customer_id,
    name: s.customer_name || "",
    address: s.address || "",
    phone: s.phone || "",
    lat: s.lat,
    lng: s.lng,
    seq: s.seq,
    status: s.status,
    arrivedAt: s.arrived_at,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    milesFromPrev: s.miles_from_prev,
    notes: s.notes || "",
    customerNotes: s.customer_notes || "",
    navigable: s.lat != null && s.lng != null,
  };
}

export function publicWorkday(w, stops) {
  if (!w) return null;
  const d = new Date(`${w.date}T12:00:00`);
  return {
    id: w.id,
    date: w.date,
    dayName: DAY_NAMES[d.getDay()] || "",
    status: w.status,
    startedAt: w.started_at,
    endedAt: w.ended_at,
    totalMiles: w.total_miles != null ? +Number(w.total_miles).toFixed(2) : 0,
    stops: (stops || []).map(publicStop),
  };
}

async function stopsFor(db, workDayId) {
  const { results } = await db
    .prepare("SELECT * FROM work_stops WHERE work_day_id = ? ORDER BY seq ASC")
    .bind(workDayId)
    .all();
  return results || [];
}

export async function getWorkdayById(db, id) {
  const w = await db.prepare("SELECT * FROM work_days WHERE id = ?").bind(id).first();
  if (!w) return null;
  return publicWorkday(w, await stopsFor(db, id));
}

export async function getActiveWorkday(db, auth) {
  const w = await db
    .prepare("SELECT * FROM work_days WHERE status = 'active' AND owner_id = ? ORDER BY started_at DESC LIMIT 1")
    .bind(auth.userId)
    .first();
  if (!w) return null;
  return publicWorkday(w, await stopsFor(db, w.id));
}

/**
 * Records a tracking event and accumulates approximate miles driven by measuring
 * the straight-line distance from the previous GPS point recorded that day.
 * Returns the miles added for this hop (0 when no coordinates are available).
 */
async function logEvent(db, workDayId, { type, stopId = null, customerId = null, coords = null, meta = null }) {
  let miles = 0;
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    const last = await db
      .prepare(
        "SELECT lat, lng FROM work_events WHERE work_day_id = ? AND lat IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1"
      )
      .bind(workDayId)
      .first();
    if (last) miles = milesBetween(last.lat, last.lng, coords.lat, coords.lng);
  }

  await db
    .prepare(
      `INSERT INTO work_events (work_day_id, stop_id, customer_id, type, lat, lng, miles, ts, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      workDayId,
      stopId,
      customerId,
      type,
      coords?.lat ?? null,
      coords?.lng ?? null,
      miles,
      Date.now(),
      meta ? JSON.stringify(meta) : null
    )
    .run();

  if (miles > 0) {
    await db
      .prepare("UPDATE work_days SET total_miles = COALESCE(total_miles, 0) + ? WHERE id = ?")
      .bind(miles, workDayId)
      .run();
  }
  return miles;
}

export async function startWorkday(db, env, dateStr, auth, coords = null) {
  const existing = await getActiveWorkday(db, auth);
  if (existing) return { workday: existing, resumed: true };

  const scheduled = await customersForDate(db, dateStr, auth);
  const notesById = new Map(scheduled.map((c) => [c.id, c.notes || ""]));

  let ordered = [];
  let unmapped = [];
  if (scheduled.length) {
    const depot = await getRouteDepot(db, auth.userId);
    const route = await buildOptimizedRoute(db, scheduled, depot, env, { geocode: false, driving: false });
    ordered = route.stops || [];
    unmapped = route.unmapped || [];
  }

  const now = Date.now();
  let workDayId;
  try {
    const res = await db
      .prepare(
        `INSERT INTO work_days (date, status, started_at, start_lat, start_lng, total_miles, owner_id, created_at)
         VALUES (?, 'active', ?, ?, ?, 0, ?, ?)`
      )
      .bind(dateStr, now, coords?.lat ?? null, coords?.lng ?? null, auth.userId, now)
      .run();
    workDayId = res.meta.last_row_id;
  } catch {
    const resumed = await getActiveWorkday(db, auth);
    if (resumed) return { workday: resumed, resumed: true };
    throw new Error("Could not start the work day.");
  }

  const inserts = [];
  let seq = 0;
  const addStop = (c, lat, lng) => {
    seq += 1;
    inserts.push(
      db
        .prepare(
          `INSERT INTO work_stops (work_day_id, customer_id, customer_name, address, phone, lat, lng, seq, status, customer_notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .bind(
          workDayId,
          c.id,
          c.name || "",
          c.fullAddress || c.address || "",
          c.phone || "",
          lat,
          lng,
          seq,
          notesById.get(c.id) || c.notes || "",
          now
        )
    );
  };
  for (const s of ordered) addStop(s, s.lat, s.lng);
  for (const u of unmapped) addStop(u, null, null);
  if (inserts.length) await db.batch(inserts);

  await logEvent(db, workDayId, { type: "start_day", coords });
  return { workday: await getWorkdayById(db, workDayId), resumed: false };
}

export async function logNavigate(db, workDayId, auth, stopId = null, coords = null) {
  const w = await assertWorkdayAccess(db, workDayId, auth);
  if (!w) return null;
  const stop = stopId
    ? await db.prepare("SELECT customer_id FROM work_stops WHERE id = ?").bind(stopId).first()
    : null;
  await logEvent(db, workDayId, { type: "navigate", stopId: stopId || null, customerId: stop?.customer_id ?? null, coords });
  return getWorkdayById(db, workDayId);
}

async function workdayForStop(db, stopId, auth) {
  const stop = await db.prepare("SELECT * FROM work_stops WHERE id = ?").bind(stopId).first();
  if (!stop) return null;
  const w = await assertWorkdayAccess(db, stop.work_day_id, auth);
  if (!w) return null;
  return stop;
}

export async function startJob(db, stopId, auth, coords = null) {
  const stop = await workdayForStop(db, stopId, auth);
  if (!stop) return null;
  const now = Date.now();
  const miles = await logEvent(db, stop.work_day_id, {
    type: "start_job",
    stopId,
    customerId: stop.customer_id,
    coords,
  });
  await db
    .prepare(
      `UPDATE work_stops
       SET status = 'in_progress', arrived_at = COALESCE(arrived_at, ?), started_at = ?,
           miles_from_prev = COALESCE(miles_from_prev, 0) + ?
       WHERE id = ?`
    )
    .bind(now, now, miles, stopId)
    .run();
  return getWorkdayById(db, stop.work_day_id);
}

export async function completeJob(db, stopId, auth, coords = null, notes = null) {
  const stop = await workdayForStop(db, stopId, auth);
  if (!stop) return null;
  const now = Date.now();
  await logEvent(db, stop.work_day_id, {
    type: "complete_job",
    stopId,
    customerId: stop.customer_id,
    coords,
  });
  await db
    .prepare("UPDATE work_stops SET status = 'completed', completed_at = ?, notes = COALESCE(?, notes) WHERE id = ?")
    .bind(now, notes != null ? String(notes) : null, stopId)
    .run();
  return getWorkdayById(db, stop.work_day_id);
}

export async function skipStop(db, stopId, auth, coords = null) {
  const stop = await workdayForStop(db, stopId, auth);
  if (!stop) return null;
  await logEvent(db, stop.work_day_id, { type: "skip", stopId, customerId: stop.customer_id, coords });
  await db.prepare("UPDATE work_stops SET status = 'skipped' WHERE id = ?").bind(stopId).run();
  return getWorkdayById(db, stop.work_day_id);
}

export async function saveStopNotes(db, stopId, auth, notes) {
  const stop = await workdayForStop(db, stopId, auth);
  if (!stop) return null;
  await db.prepare("UPDATE work_stops SET notes = ? WHERE id = ?").bind(String(notes || ""), stopId).run();
  return getWorkdayById(db, stop.work_day_id);
}

export async function endWorkday(db, workDayId, auth, coords = null) {
  const w = await assertWorkdayAccess(db, workDayId, auth);
  if (!w) return null;
  await logEvent(db, workDayId, { type: "end_day", coords });
  await db.prepare("UPDATE work_days SET status = 'ended', ended_at = ? WHERE id = ?").bind(Date.now(), workDayId).run();
  return getWorkdayById(db, workDayId);
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmtET(ts) {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString();
  }
}

function fmtETDate(ts) {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

function slugFilename(s) {
  return String(s || "workday")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workday";
}

function minutesBetween(start, end) {
  if (!start || !end) return "";
  return Math.max(0, Math.round((end - start) / 60000));
}

/**
 * Tax-oriented work log for the signed-in team member only (never combined across users).
 * Returns UTF-8 CSV with a header block, detail rows, and summary totals.
 */
export async function exportWorkdaysCsv(db, auth, targetUserId = null) {
  let exportUserId = auth.userId;
  if (targetUserId != null) {
    if (!auth.isSuper) {
      const err = new Error("Super user access required.");
      err.status = 403;
      throw err;
    }
    exportUserId = targetUserId;
    const target = await findAdminById(db, exportUserId);
    if (!target) {
      const err = new Error("Team member not found.");
      err.status = 404;
      throw err;
    }
  }

  const adminRow = await findAdminById(db, exportUserId);
  const memberName = adminRow?.name || "";
  const businessName = adminRow?.business_name || "";
  const memberEmail = adminRow?.email || "";

  const { results: days } = await db
    .prepare(`SELECT * FROM work_days WHERE owner_id = ? ORDER BY started_at ASC, id ASC`)
    .bind(exportUserId)
    .all();

  const generatedAt = fmtET(Date.now());
  const periodStart = days?.length ? days[0].date : "";
  const periodEnd = days?.length ? days[days.length - 1].date : "";

  let totalMiles = 0;
  let totalJobMinutes = 0;
  let totalOnRoadMinutes = 0;
  let totalCompleted = 0;
  let totalSkipped = 0;
  let totalWorkDays = days?.length || 0;

  const metaRows = [
    ["WorkDay Mileage and Service Log"],
    ["Team member", memberName],
    ["Business name", businessName],
    ["Email", memberEmail],
    ["Report generated (ET)", generatedAt],
    ["Period start", periodStart],
    ["Period end", periodEnd],
    [],
    ["Notes"],
    ["Miles are straight-line GPS estimates between logged events (start, navigate, job, end)."],
    ["Use with your tax preparer; verify the current IRS standard mileage rate for your tax year."],
    [],
  ];

  const header = [
    "Service date",
    "Day of week",
    "Team member",
    "Business name",
    "Team email",
    "Work day ID",
    "Work day status",
    "Stop #",
    "Customer ID",
    "Customer name",
    "Customer phone",
    "Service address",
    "Stop latitude",
    "Stop longitude",
    "Stop status",
    "Arrived (ET)",
    "Job start (ET)",
    "Job complete (ET)",
    "Job duration (minutes)",
    "Travel miles to stop",
    "Technician job notes",
    "Customer account notes",
    "Day start (ET)",
    "Day end (ET)",
    "Day on-road (minutes)",
    "Day total miles",
    "Day stops completed",
    "Day stops skipped",
    "Day stops total",
  ];

  const dataRows = [];

  for (const w of days || []) {
    const d = new Date(`${w.date}T12:00:00`);
    const dayName = DAY_NAMES[d.getDay()] || "";
    const dayMin = minutesBetween(w.started_at, w.ended_at);
    const dayMiles = Number(w.total_miles || 0);
    totalMiles += dayMiles;
    if (dayMin !== "") totalOnRoadMinutes += dayMin;

    const stops = await stopsFor(db, w.id);
    const completed = stops.filter((s) => s.status === "completed").length;
    const skipped = stops.filter((s) => s.status === "skipped").length;
    totalCompleted += completed;
    totalSkipped += skipped;

    if (!stops.length) {
      dataRows.push([
        w.date, dayName, memberName, businessName, memberEmail,
        w.id, w.status, "", "", "", "", "", "", "", "no stops",
        "", "", "", "", "", "", "",
        fmtET(w.started_at), fmtET(w.ended_at), dayMin, dayMiles.toFixed(2),
        0, 0, 0,
      ]);
      continue;
    }

    for (const s of stops) {
      const jobMin = minutesBetween(s.started_at, s.completed_at);
      if (jobMin !== "" && s.status === "completed") totalJobMinutes += jobMin;
      dataRows.push([
        w.date,
        dayName,
        memberName,
        businessName,
        memberEmail,
        w.id,
        w.status,
        s.seq,
        s.customer_id ?? "",
        s.customer_name || "",
        s.phone || "",
        s.address || "",
        s.lat != null ? Number(s.lat).toFixed(6) : "",
        s.lng != null ? Number(s.lng).toFixed(6) : "",
        s.status,
        fmtET(s.arrived_at),
        fmtET(s.started_at),
        fmtET(s.completed_at),
        jobMin,
        s.miles_from_prev != null ? Number(s.miles_from_prev).toFixed(2) : "",
        s.notes || "",
        s.customer_notes || "",
        fmtET(w.started_at),
        fmtET(w.ended_at),
        dayMin,
        dayMiles.toFixed(2),
        completed,
        skipped,
        stops.length,
      ]);
    }
  }

  const summaryRows = [
    [],
    ["SUMMARY TOTALS"],
    ["Total work days logged", totalWorkDays],
    ["Total stops completed", totalCompleted],
    ["Total stops skipped", totalSkipped],
    ["Total job minutes (completed stops)", totalJobMinutes],
    ["Total on-road minutes (day start to end)", totalOnRoadMinutes],
    ["Total miles logged", totalMiles.toFixed(2)],
  ];

  const lines = [
    ...metaRows.map((row) => row.map(csvEscape).join(",")),
    header.map(csvEscape).join(","),
    ...dataRows.map((row) => row.map(csvEscape).join(",")),
    ...summaryRows.map((row) => row.map(csvEscape).join(",")),
  ];

  const label = businessName || memberName || memberEmail.split("@")[0] || "workday";
  const range =
    periodStart && periodEnd && periodStart !== periodEnd
      ? `${periodStart}-to-${periodEnd}`
      : periodStart || fmtETDate(Date.now());
  const filename = `${slugFilename(label)}-work-log-${range}.csv`;

  return { csv: `\uFEFF${lines.join("\n")}`, filename };
}
