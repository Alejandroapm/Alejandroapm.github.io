import { customersForDayOfWeekForOwner, getRouteDepot } from "./db.js";
import { buildOptimizedRoute } from "./routeBuilder.js";
import { fetchDrivingRoute } from "./routing.js";

export async function getSavedRouteOrder(db, ownerId, dayOfWeek) {
  const { results } = await db
    .prepare(
      `SELECT customer_id, seq FROM route_stop_orders
       WHERE owner_id = ? AND day_of_week = ?
       ORDER BY seq ASC`
    )
    .bind(ownerId, Number(dayOfWeek))
    .all();
  return results || [];
}

export async function saveRouteOrder(db, ownerId, dayOfWeek, customerIds) {
  const dow = Number(dayOfWeek);
  await db
    .prepare("DELETE FROM route_stop_orders WHERE owner_id = ? AND day_of_week = ?")
    .bind(ownerId, dow)
    .run();
  if (!customerIds.length) return;
  await db.batch(
    customerIds.map((customerId, index) =>
      db
        .prepare(
          `INSERT INTO route_stop_orders (owner_id, day_of_week, customer_id, seq, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(ownerId, dow, customerId, index + 1, Date.now())
    )
  );
}

export function applySavedStopOrder(stops, savedRows) {
  if (!savedRows?.length || !stops?.length) return stops || [];
  const rank = new Map(savedRows.map((r) => [r.customer_id, r.seq]));
  return [...stops].sort((a, b) => {
    const ar = rank.get(a.id) ?? 9999;
    const br = rank.get(b.id) ?? 9999;
    if (ar !== br) return ar - br;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

/** Apply a weekly saved order to today's scheduled stops; extras append at the end. */
export function orderStopsForWorkday(mappableStops, savedRows, scheduledIds) {
  const stops = mappableStops || [];
  if (!stops.length) return [];

  let ordered = savedRows?.length
    ? applySavedStopOrder(stops, savedRows).filter((s) => scheduledIds.has(s.id))
    : [...stops];

  const seen = new Set(ordered.map((s) => s.id));
  for (const s of stops) {
    if (!seen.has(s.id)) ordered.push(s);
  }
  return ordered;
}

async function finishRoute(depot, ordered, unmapped, savedCount) {
  let geometry = null;
  let distanceMiles = null;
  let durationMinutes = null;

  if (ordered.length) {
    const routePoints = [depot, ...ordered.map((s) => ({ lat: s.lat, lng: s.lng }))];
    const driving = await fetchDrivingRoute(routePoints);
    geometry = driving.geometry;
    distanceMiles = driving.distanceM
      ? +(driving.distanceM / 1609.34).toFixed(1)
      : null;
    durationMinutes = driving.durationS
      ? Math.round(driving.durationS / 60)
      : null;
  }

  return {
    depot,
    stops: ordered.map((s, i) => ({ ...s, order: i + 1 })),
    unmapped,
    geometry,
    distanceMiles,
    durationMinutes,
    manualOrder: savedCount > 0,
    saved: savedCount > 0,
  };
}

export async function buildRouteForDayOfWeek(db, env, dayOfWeek, ownerId, opts = {}) {
  const dow = Number(dayOfWeek);
  const scheduled = await customersForDayOfWeekForOwner(db, dow, ownerId);
  if (!scheduled.length) {
    return {
      depot: await getRouteDepot(db, ownerId),
      stops: [],
      unmapped: [],
      geometry: null,
      distanceMiles: null,
      durationMinutes: null,
      manualOrder: false,
      saved: false,
    };
  }

  const depot = await getRouteDepot(db, ownerId);
  const route = await buildOptimizedRoute(db, scheduled, depot, env, opts);
  const saved = await getSavedRouteOrder(db, ownerId, dow);
  const useSaved = saved.length > 0 && !opts.rebuild;
  const ordered = useSaved ? applySavedStopOrder(route.stops || [], saved) : route.stops || [];
  const unmapped = route.unmapped || [];

  return finishRoute(depot, ordered, unmapped, useSaved ? saved.length : 0);
}
