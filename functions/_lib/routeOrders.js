import { customersForDateForOwner, getRouteDepot } from "./db.js";
import { buildOptimizedRoute } from "./routeBuilder.js";
import { fetchDrivingRoute } from "./routing.js";

export async function getSavedRouteOrder(db, ownerId, dateStr) {
  const { results } = await db
    .prepare(
      `SELECT customer_id, seq FROM route_stop_orders
       WHERE owner_id = ? AND date = ?
       ORDER BY seq ASC`
    )
    .bind(ownerId, dateStr)
    .all();
  return results || [];
}

export async function saveRouteOrder(db, ownerId, dateStr, customerIds) {
  await db
    .prepare("DELETE FROM route_stop_orders WHERE owner_id = ? AND date = ?")
    .bind(ownerId, dateStr)
    .run();
  if (!customerIds.length) return;
  await db.batch(
    customerIds.map((customerId, index) =>
      db
        .prepare(
          `INSERT INTO route_stop_orders (owner_id, date, customer_id, seq, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(ownerId, dateStr, customerId, index + 1, Date.now())
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

export async function buildRouteForOwner(db, env, dateStr, ownerId, opts = {}) {
  const scheduled = await customersForDateForOwner(db, dateStr, ownerId);
  if (!scheduled.length) {
    return {
      depot: await getRouteDepot(db, ownerId),
      stops: [],
      unmapped: [],
      geometry: null,
      distanceMiles: null,
      durationMinutes: null,
      manualOrder: false,
    };
  }

  const depot = await getRouteDepot(db, ownerId);
  const route = await buildOptimizedRoute(db, scheduled, depot, env, opts);
  const saved = await getSavedRouteOrder(db, ownerId, dateStr);
  const ordered = applySavedStopOrder(route.stops || [], saved);
  const unmapped = route.unmapped || [];

  let geometry = route.geometry;
  let distanceMiles = route.distanceMiles;
  let durationMinutes = route.durationMinutes;

  if (ordered.length) {
    const routePoints = [depot, ...ordered.map((s) => ({ lat: s.lat, lng: s.lng }))];
    const driving = await fetchDrivingRoute(routePoints);
    geometry = driving.geometry;
    distanceMiles = driving.distanceM
      ? +(driving.distanceM / 1609.34).toFixed(1)
      : distanceMiles;
    durationMinutes = driving.durationS
      ? Math.round(driving.durationS / 60)
      : durationMinutes;
  }

  return {
    depot,
    stops: ordered.map((s, i) => ({ ...s, order: i + 1 })),
    unmapped,
    geometry,
    distanceMiles,
    durationMinutes,
    manualOrder: saved.length > 0,
  };
}
