const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const USER_AGENT = "MSGPoolServices/1.0 (admin route planner)";

import {
  isInFlorida,
  isFloridaNominatimItem,
  floridaSearchParams,
} from "./florida.js";

/** Common US street-type abbreviations → full names (helps OpenStreetMap matching). */
const STREET_ABBR = {
  st: "Street", str: "Street", ave: "Avenue", av: "Avenue", blvd: "Boulevard",
  rd: "Road", dr: "Drive", ln: "Lane", ct: "Court", cir: "Circle", crcl: "Circle",
  pl: "Place", ter: "Terrace", terr: "Terrace", trl: "Trail", pkwy: "Parkway",
  hwy: "Highway", sq: "Square", cv: "Cove", xing: "Crossing", pt: "Point",
  plz: "Plaza", bnd: "Bend", crk: "Creek", spg: "Spring", spgs: "Springs",
  mnr: "Manor", grn: "Green", gln: "Glen", vw: "View", vly: "Valley",
  expy: "Expressway", fwy: "Freeway", loop: "Loop", run: "Run", way: "Way",
};

/** Expand street-type abbreviations (skips the leading token, usually the house number). */
function expandStreet(street) {
  const tokens = String(street || "").trim().split(/\s+/);
  return tokens
    .map((tok, i) => {
      if (i === 0) return tok;
      const key = tok.replace(/\.$/, "").toLowerCase();
      return STREET_ABBR[key] || tok;
    })
    .join(" ");
}

/** US Census geocoder — free, no key, very reliable for exact US residential addresses. */
async function censusGeocode({ street, city, state, zip }) {
  const oneline = `${street}, ${city}, ${state || "FL"} ${zip}`.trim();
  const params = new URLSearchParams({
    address: oneline,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  let res;
  try {
    res = await fetch(`${CENSUS}?${params}`, { headers: { Accept: "application/json" } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const match = data?.result?.addressMatches?.[0];
  const lng = Number(match?.coordinates?.x);
  const lat = Number(match?.coordinates?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!isInFlorida(lat, lng)) return null;
  return { lat, lng, approximate: false };
}

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

async function safeNominatim(params) {
  try {
    return await nominatimFetch(params);
  } catch {
    return [];
  }
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

  // 1) US Census geocoder first — best hit rate for exact US residential addresses.
  const census = await censusGeocode({ street, city, state: "FL", zip });
  if (census) return census;

  // 2) OpenStreetMap / Nominatim, trying both the raw and the abbreviation-expanded street.
  const variants = [street];
  const expanded = expandStreet(street);
  if (expanded && expanded.toLowerCase() !== street.toLowerCase()) variants.push(expanded);

  for (const s of variants) {
    const structured = floridaSearchParams({
      street: s,
      city,
      state: "Florida",
      postalcode: zip,
      country: "United States",
      limit: "5",
    });
    let results = await safeNominatim(structured);
    let best = pickBestFloridaResult(results, s);
    if (best) {
      const coords = resultToCoords(best, false);
      if (coords) return coords;
    }

    const freeform = floridaSearchParams({
      q: `${s}, ${city}, FL ${zip}, USA`,
      limit: "5",
    });
    results = await safeNominatim(freeform);
    best = pickBestFloridaResult(results, s);
    if (best) {
      const coords = resultToCoords(best, false);
      if (coords) return coords;
    }
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
