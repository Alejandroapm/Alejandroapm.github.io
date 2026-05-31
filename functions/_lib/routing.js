/** Nearest-neighbor route from depot through all stops */
export function optimizeStopOrder(stops, depot) {
  if (!stops.length) return [];
  if (stops.length === 1) return [{ ...stops[0], order: 1 }];

  const remaining = stops.map((s) => ({ ...s }));
  const ordered = [];
  let current = depot;

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    current = { lat: next.lat, lng: next.lng };
  }

  return ordered.map((s, i) => ({ ...s, order: i + 1 }));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchDrivingRoute(points) {
  if (points.length < 2) return { geometry: null, distanceM: 0, durationS: 0 };

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { geometry: null, distanceM: 0, durationS: 0 };

  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.[0]) {
    return { geometry: null, distanceM: 0, durationS: 0 };
  }

  const route = data.routes[0];
  return {
    geometry: route.geometry,
    distanceM: route.distance,
    durationS: route.duration,
  };
}

export const DEFAULT_DEPOT = {
  lat: 28.2916,
  lng: -81.4076,
  label: "Route start (Kissimmee area)",
};
