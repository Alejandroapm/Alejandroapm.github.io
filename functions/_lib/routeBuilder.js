import { publicCustomer, ensureCustomerCoords, sleep } from "./db.js";
import { optimizeStopOrder, fetchDrivingRoute, DEFAULT_DEPOT } from "./routing.js";

export async function buildOptimizedRoute(db, customers, depotInput = DEFAULT_DEPOT, env = null) {
  const depot = depotInput?.lat != null && depotInput?.lng != null ? depotInput : DEFAULT_DEPOT;
  const geocoded = [];

  for (const c of customers) {
    const coords = await ensureCustomerCoords(db, c, env);
    if (coords) {
      geocoded.push({
        ...publicCustomer({ ...c, lat: coords.lat, lng: coords.lng }),
        lat: coords.lat,
        lng: coords.lng,
      });
    } else {
      geocoded.push({ ...publicCustomer(c), lat: null, lng: null, geocodeError: true });
    }
    await sleep(250);
  }

  const mappable = geocoded.filter((c) => c.lat != null && c.lng != null);
  const ordered = optimizeStopOrder(mappable, depot);
  const routePoints = [depot, ...ordered.map((s) => ({ lat: s.lat, lng: s.lng }))];
  const driving = await fetchDrivingRoute(routePoints);

  return {
    depot,
    stops: ordered,
    unmapped: geocoded.filter((c) => c.geocodeError),
    geometry: driving.geometry,
    distanceMiles: driving.distanceM ? +(driving.distanceM / 1609.34).toFixed(1) : null,
    durationMinutes: driving.durationS ? Math.round(driving.durationS / 60) : null,
  };
}
