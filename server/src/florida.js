/** Florida geographic bounds for validating geocode results */
export const FL_BOUNDS = {
  minLat: 24.4,
  maxLat: 31.1,
  minLng: -87.7,
  maxLng: -79.8,
};

/** Nominatim viewbox: left, top, right, bottom (lon/lat) */
export const FL_VIEWBOX = "-87.70,31.10,-79.80,24.40";

export function isInFlorida(lat, lng) {
  return (
    lat >= FL_BOUNDS.minLat &&
    lat <= FL_BOUNDS.maxLat &&
    lng >= FL_BOUNDS.minLng &&
    lng <= FL_BOUNDS.maxLng
  );
}

export function isFloridaState(state) {
  if (!state) return false;
  const s = String(state).trim().toUpperCase();
  return s === "FL" || s === "FLORIDA";
}

export function nominatimStateFromAddress(a) {
  const iso = a?.["ISO3166-2-lvl4"];
  if (iso?.startsWith("US-")) return iso.slice(3);
  const name = a?.state || "";
  if (/^florida$/i.test(name)) return "FL";
  if (name.length === 2) return name.toUpperCase();
  return "";
}

export function isFloridaNominatimItem(item) {
  const a = item?.address || {};
  const state = nominatimStateFromAddress(a);
  if (state === "FL") return true;
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  return isInFlorida(lat, lng);
}

export function floridaSearchParams(base = {}) {
  const params = new URLSearchParams({
    format: "json",
    countrycodes: "us",
    addressdetails: "1",
    ...base,
  });
  params.set("viewbox", FL_VIEWBOX);
  return params;
}
