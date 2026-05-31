const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const USER_AGENT = "MSGPoolServices/1.0 (address autocomplete)";

import {
  floridaSearchParams,
  isFloridaNominatimItem,
  nominatimStateFromAddress,
  isInFlorida,
} from "./florida.js";

/** US Census fallback for full street addresses Nominatim doesn't have (free, no key). */
async function censusSuggest(query) {
  const params = new URLSearchParams({
    address: `${query}, FL`,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  let res;
  try {
    res = await fetch(`${CENSUS}?${params}`, { headers: { Accept: "application/json" } });
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

  return (data?.result?.addressMatches || [])
    .slice(0, 5)
    .map((m) => {
      const c = m.addressComponents || {};
      const lat = Number(m.coordinates?.y);
      const lng = Number(m.coordinates?.x);
      const streetName = [c.preDirection, c.preType, c.streetName, c.suffixType, c.suffixDirection]
        .filter(Boolean)
        .join(" ")
        .trim();
      const street = [c.fromAddress, streetName].filter(Boolean).join(" ").trim()
        || String(m.matchedAddress || "").split(",")[0];
      return {
        street,
        city: c.city || String(m.matchedAddress || "").split(",")[1]?.trim() || "",
        state: "FL",
        zip: String(c.zip || "").slice(0, 5),
        label: m.matchedAddress || street,
        lat,
        lng,
      };
    })
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && isInFlorida(s.lat, s.lng) && (s.street || s.city));
}

export function parseNominatimResult(item) {
  const a = item.address || {};
  const house = a.house_number || "";
  const road = a.road || a.street || a.pedestrian || a.residential || "";
  const street = [house, road].filter(Boolean).join(" ") || "";
  const city =
    a.city || a.town || a.village || a.hamlet || a.municipality || a.county || "";
  const state = nominatimStateFromAddress(a) || "FL";
  const zip = String(a.postcode || "").split("-")[0].slice(0, 5);

  return {
    street,
    city,
    state: "FL",
    zip,
    label: item.display_name || `${street}, ${city}, FL ${zip}`.replace(/,\s*,/g, ",").trim(),
    lat: Number(item.lat),
    lng: Number(item.lon),
  };
}

async function nominatimSuggest(q) {
  const params = floridaSearchParams({ q: `${q}, Florida, USA`, limit: "8" });
  let res;
  try {
    res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
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
  return data
    .filter(isFloridaNominatimItem)
    .map(parseNominatimResult)
    .filter((item) => item.state === "FL" && (item.street || item.city));
}

export async function suggestAddresses(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];

  // Query OpenStreetMap always; also query the US Census geocoder whenever the text
  // starts with a house number, since OSM frequently misses exact US residences.
  const hasHouseNumber = /^\s*\d/.test(q);
  const [osm, census] = await Promise.all([
    nominatimSuggest(q),
    hasHouseNumber ? censusSuggest(q) : Promise.resolve([]),
  ]);

  // Census results first (more accurate for residential addresses), then OSM. Dedupe.
  const seen = new Set();
  const merged = [];
  for (const item of [...census, ...osm]) {
    const key = `${(item.street || "").toLowerCase()}|${(item.city || "").toLowerCase()}|${item.zip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, 8);
}
