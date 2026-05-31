import { publicCustomer, ensureCustomerCoords, sleep } from "./db.js";
import { optimizeStopOrder, fetchDrivingRoute, DEFAULT_DEPOT } from "./routing.js";
import { isInFlorida } from "./florida.js";

/**
 * @param {{ geocode?: boolean, driving?: boolean }} opts
 *   geocode — call external geocoders for stops missing coords (slow; use on route planner only)
 *   driving — fetch OSRM road geometry (slow; not needed to start a work day)
 */
export async function buildOptimizedRoute(db, customers, depotInput = DEFAULT_DEPOT, env = null, opts = {}) {
  const geocode = opts.geocode !== false;
  const driving = opts.driving !== false;
  const depot = depotInput?.lat != null && depotInput?.lng != null ? depotInput : DEFAULT_DEPOT;
  const geocoded = [];

  for (const c of customers) {
    const hadCoords = c.lat != null && c.lng != null && isInFlorida(c.lat, c.lng);
    if (hadCoords) {
      geocoded.push({
        ...publicCustomer(c),
        lat: c.lat,
        lng: c.lng,
      });
      continue;
    }

    if (geocode) {
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
    } else {
      geocoded.push({ ...publicCustomer(c), lat: null, lng: null, geocodeError: true });
    }
  }

  const mappable = geocoded.filter((c) => c.lat != null && c.lng != null);
  const ordered = optimizeStopOrder(mappable, depot);
  const routePoints = [depot, ...ordered.map((s) => ({ lat: s.lat, lng: s.lng }))];
  const routeDriving = driving ? await fetchDrivingRoute(routePoints) : { geometry: null, distanceM: 0, durationS: 0 };

  return {
    depot,
    stops: ordered,
    unmapped: geocoded.filter((c) => c.geocodeError),
    geometry: routeDriving.geometry,
    distanceMiles: routeDriving.distanceM ? +(routeDriving.distanceM / 1609.34).toFixed(1) : null,
    durationMinutes: routeDriving.durationS ? Math.round(routeDriving.durationS / 60) : null,
  };
}
