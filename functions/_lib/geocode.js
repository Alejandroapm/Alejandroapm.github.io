const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const GOOGLE_GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";
const USER_AGENT = "MSGPoolServices/1.0 (admin route planner)";
// ~50-mile bias box around Orlando for the Google Geocoding API.
const ORLANDO_BOUNDS = "27.82,-82.20|29.26,-80.56";

import {
  isInFlorida,
  isFloridaNominatimItem,
  floridaSearchParams,
  withinServiceArea,
} from "./florida.js";

/** Parse a Google Geocoding result into our address shape. */
function parseGoogleResult(r) {
  const comp = {};
  for (const c of r.address_components || []) {
    for (const t of c.types || []) comp[t] = c;
  }
  const streetNumber = comp.street_number?.long_name || "";
  const route = comp.route?.long_name || "";
  const city =
    comp.locality?.long_name ||
    comp.sublocality?.long_name ||
    comp.administrative_area_level_3?.long_name ||
    comp.postal_town?.long_name ||
    "";
  const zip = comp.postal_code?.long_name || "";
  const lat = Number(r.geometry?.location?.lat);
  const lng = Number(r.geometry?.location?.lng);
  return {
    street: [streetNumber, route].filter(Boolean).join(" "),
    city,
    state: "FL",
    zip: String(zip).slice(0, 5),
    label: r.formatted_address || "",
    lat,
    lng,
  };
}

/** Google Geocoding (only when GOOGLE_MAPS_API_KEY is configured). Returns parsed candidates. */
async function googleGeocodeRaw(env, addressText) {
  const key = env?.GOOGLE_MAPS_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({
    address: addressText,
    key,
    region: "us",
    components: "administrative_area:FL|country:US",
    bounds: ORLANDO_BOUNDS,
  });
  let res;
  try {
    res = await fetch(`${GOOGLE_GEOCODE}?${params}`, { headers: { Accept: "application/json" } });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  if (data.status !== "OK" || !Array.isArray(data.results)) return [];
  return data.results
    .map(parseGoogleResult)
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
}

/** Google-backed address suggestions within the service area (for autocomplete). */
export async function googleSuggest(env, query) {
  const results = await googleGeocodeRaw(env, `${query}, FL, USA`);
  return results.filter((x) => withinServiceArea(x.lat, x.lng) && (x.street || x.city));
}

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
  if (!withinServiceArea(lat, lng)) return null;
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
  if (!withinServiceArea(lat, lng)) return null;
  return { lat, lng, approximate };
}

export async function geocodeAddress({ street, city, state, zip }, env = null) {
  if (state && state.toUpperCase() !== "FL") return null;
  if (!street || !city || !zip) return null;

  // 1) Google Geocoding first when an API key is configured — best quality.
  const oneline = `${street}, ${city}, FL ${zip}`;
  for (const g of await googleGeocodeRaw(env, oneline)) {
    if (withinServiceArea(g.lat, g.lng)) return { lat: g.lat, lng: g.lng, approximate: false };
  }

  // 2) US Census geocoder — strong hit rate for exact US residential addresses.
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

/** Geocode a free-form Florida address string; fills parsed fields when possible. */
export async function geocodeOneLineAddress(text, env = null) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const query = /\bFL\b|Florida/i.test(raw) ? raw : `${raw}, FL, USA`;

  for (const g of await googleGeocodeRaw(env, query)) {
    if (withinServiceArea(g.lat, g.lng) && g.street && g.city && g.zip) {
      return {
        lat: g.lat,
        lng: g.lng,
        street: g.street,
        city: g.city,
        zip: g.zip,
        label: g.label || raw,
        approximate: false,
      };
    }
    if (withinServiceArea(g.lat, g.lng)) {
      return {
        lat: g.lat,
        lng: g.lng,
        street: g.street || raw.split(",")[0]?.trim() || raw,
        city: g.city || "",
        zip: g.zip || "",
        label: g.label || raw,
        approximate: true,
      };
    }
  }

  const results = await safeNominatim(floridaSearchParams({ q: query, limit: "5" }));
  const best = pickBestFloridaResult(results, raw);
  if (!best) return null;
  const coords = resultToCoords(best, true);
  if (!coords) return null;

  const a = best.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ") || raw.split(",")[0]?.trim() || raw;
  const city =
    a.city || a.town || a.village || a.municipality || a.county || "";
  const zip = String(a.postcode || "").slice(0, 5);

  return {
    ...coords,
    street,
    city,
    zip,
    label: best.display_name || raw,
    approximate: true,
  };
}
