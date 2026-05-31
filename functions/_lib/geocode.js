const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "MSGPoolServices/1.0 (admin route planner)";

import {
  isInFlorida,
  isFloridaNominatimItem,
  floridaSearchParams,
} from "./florida.js";

export function formatAddress(row) {
  if (row.street && row.city && row.state && row.zip) {
    return `${row.street}, ${row.city}, ${row.state} ${row.zip}`;
  }
  return row.street || row.address || "";
}

async function nominatimFetch(params) {
  const url = `${NOMINATIM}?${params}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Geocoding service unavailable.");
  return res.json();
}

function pickBestFloridaResult(results, street) {
  const fl = results.filter(isFloridaNominatimItem);
  if (!fl.length) return null;

  const houseNum = String(street || "").match(/^(\d+[A-Za-z]?)/)?.[1];
  if (houseNum) {
    const exact = fl.find((r) => r.address?.house_number === houseNum);
    if (exact) return exact;
  }

  const withHouse = fl.find((r) => r.address?.house_number && r.address?.road);
  return withHouse || fl[0];
}

function resultToCoords(item, approximate = false) {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!isInFlorida(lat, lng)) return null;
  return { lat, lng, approximate };
}

export async function geocodeAddress({ street, city, state, zip }) {
  if (state && state.toUpperCase() !== "FL") return null;
  if (!street || !city || !zip) return null;

  const structured = floridaSearchParams({
    street,
    city,
    state: "Florida",
    postalcode: zip,
    country: "United States",
    limit: "5",
  });

  let results = await nominatimFetch(structured);
  let best = pickBestFloridaResult(results, street);
  if (best) {
    const coords = resultToCoords(best, false);
    if (coords) return coords;
  }

  const freeform = floridaSearchParams({
    q: `${street}, ${city}, FL ${zip}, USA`,
    limit: "5",
  });
  results = await nominatimFetch(freeform);
  best = pickBestFloridaResult(results, street);
  if (best) {
    const coords = resultToCoords(best, false);
    if (coords) return coords;
  }

  return null;
}

export async function ensureCustomerCoords(db, customerRow, { force = false } = {}) {
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

  const cachedLat = customerRow.lat;
  const cachedLng = customerRow.lng;

  if (!force && cachedLat != null && cachedLng != null && isInFlorida(cachedLat, cachedLng)) {
    return { lat: cachedLat, lng: cachedLng, approximate: false };
  }

  if (cachedLat != null && cachedLng != null && !isInFlorida(cachedLat, cachedLng)) {
    db.prepare("UPDATE customers SET lat = NULL, lng = NULL, updated_at = ? WHERE id = ?").run(
      Date.now(),
      customerRow.id
    );
  }

  const result = await geocodeAddress({ street, city, state, zip });
  if (!result) return null;

  db.prepare("UPDATE customers SET lat = ?, lng = ?, updated_at = ? WHERE id = ?").run(
    result.lat,
    result.lng,
    Date.now(),
    customerRow.id
  );

  return result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { sleep };
