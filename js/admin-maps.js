const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const DEFAULT_CENTER = [28.2916, -81.4076];

let leafletReady = null;

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletReady) return leafletReady;

  leafletReady = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Could not load map library."));
    document.head.appendChild(script);
  });

  return leafletReady;
}

function resolveContainer(container) {
  if (typeof container === "string") {
    const el = document.getElementById(container);
    if (!el) throw new Error(`Map container #${container} not found.`);
    return el;
  }
  return container;
}

export async function waitForVisible(el) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (!el.offsetParent && el.hidden) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function createMap(container, center = DEFAULT_CENTER, zoom = 10) {
  const el = resolveContainer(container);
  const map = L.map(el, { scrollWheelZoom: true }).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
  return map;
}

export async function refreshMap(map) {
  if (!map) return;
  await waitForVisible(map.getContainer());
  map.invalidateSize(true);
}

export function numberedIcon(n) {
  return L.divIcon({
    className: "route-marker-wrap",
    html: `<span class="route-marker"><span class="route-marker__num">${n}</span></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export function depotIcon() {
  return L.divIcon({
    className: "route-marker-wrap",
    html: `<span class="route-marker route-marker--depot"><span class="route-marker__num">S</span></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export function customerIcon() {
  return L.divIcon({
    className: "map-pin-wrap",
    html: `<span class="map-pin"><span class="map-pin__dot"></span></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export function drawRoute(map, layerGroup, routeData) {
  layerGroup.clearLayers();
  if (!routeData) return;

  const bounds = [];
  const depot = routeData.depot;

  if (depot?.lat != null && depot?.lng != null) {
    L.marker([depot.lat, depot.lng], { icon: depotIcon() })
      .bindPopup(`<strong>Start</strong><br>${depot.label || "Route start"}`)
      .addTo(layerGroup);
    bounds.push([depot.lat, depot.lng]);
  }

  const stops = (routeData.stops || []).filter((s) => s.lat != null && s.lng != null);

  stops.forEach((stop) => {
    L.marker([stop.lat, stop.lng], { icon: numberedIcon(stop.order) })
      .bindPopup(`<strong>${stop.order}. ${stop.name}</strong><br>${stop.fullAddress || ""}`)
      .addTo(layerGroup);
    bounds.push([stop.lat, stop.lng]);
  });

  const linePoints = [];
  if (depot?.lat != null) linePoints.push([depot.lat, depot.lng]);
  stops.forEach((s) => linePoints.push([s.lat, s.lng]));

  if (routeData.geometry?.coordinates?.length) {
    const latLngs = routeData.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    L.polyline(latLngs, { color: "#0b5fff", weight: 5, opacity: 0.9 }).addTo(layerGroup);
    latLngs.forEach((ll) => bounds.push(ll));
  } else if (linePoints.length >= 2) {
    L.polyline(linePoints, {
      color: "#0b5fff",
      weight: 4,
      opacity: 0.75,
      dashArray: "8 10",
    }).addTo(layerGroup);
  }

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  } else if (depot?.lat != null) {
    map.setView([depot.lat, depot.lng], 12);
  }
}

export function drawCustomers(map, layerGroup, customers) {
  layerGroup.clearLayers();
  const bounds = [];
  const mapped = customers.filter((c) => c.lat != null && c.lng != null);

  mapped.forEach((c) => {
    L.marker([c.lat, c.lng], { icon: customerIcon() })
      .bindPopup(`<strong>${c.name}</strong><br>${c.fullAddress || ""}`)
      .addTo(layerGroup);
    bounds.push([c.lat, c.lng]);
  });

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  } else {
    map.setView(DEFAULT_CENTER, 10);
  }

  return mapped.length;
}

export function drawDayStops(map, layerGroup, customers, depot = null) {
  layerGroup.clearLayers();
  const bounds = [];

  if (depot?.lat != null && depot?.lng != null) {
    L.marker([depot.lat, depot.lng], { icon: depotIcon() })
      .bindPopup(`<strong>Start</strong><br>${depot.label || ""}`)
      .addTo(layerGroup);
    bounds.push([depot.lat, depot.lng]);
  }

  customers.forEach((c, i) => {
    if (c.lat == null || c.lng == null) return;
    L.marker([c.lat, c.lng], { icon: numberedIcon(i + 1) })
      .bindPopup(`<strong>${c.name}</strong><br>${c.fullAddress || ""}`)
      .addTo(layerGroup);
    bounds.push([c.lat, c.lng]);
  });

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }
}
