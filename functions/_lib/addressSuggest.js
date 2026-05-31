const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "MSGPoolServices/1.0 (address autocomplete)";

import {
  floridaSearchParams,
  isFloridaNominatimItem,
  nominatimStateFromAddress,
} from "./florida.js";

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

export async function suggestAddresses(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];

  const params = floridaSearchParams({
    q: `${q}, Florida, USA`,
    limit: "8",
  });

  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Address lookup unavailable.");

  const data = await res.json();
  const seen = new Set();

  return data
    .filter(isFloridaNominatimItem)
    .map(parseNominatimResult)
    .filter((item) => item.state === "FL" && (item.street || item.city))
    .filter((item) => {
      const key = `${item.street}|${item.city}|${item.zip}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
