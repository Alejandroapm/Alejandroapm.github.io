/** Ports used by Live Server and other static dev servers (not the Node API). */
const STATIC_DEV_PORTS = new Set(["5500", "5501", "5502", "8080", "8888", "5173"]);
const API_TIMEOUT_MS = 12000;

function readMetaApiOrigin() {
  const meta = document.querySelector('meta[name="msg-api-origin"]');
  return meta?.content?.trim().replace(/\/$/, "") || null;
}

function isLocalDevHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Origin where the Node.js API is served. */
export function getServerOrigin() {
  const meta = readMetaApiOrigin();
  if (meta) return meta;

  const { protocol, hostname, port, origin } = window.location;

  if (isLocalDevHost(hostname)) {
    if (port === "3000") return origin;
    if (!port || STATIC_DEV_PORTS.has(port)) {
      return `${protocol}//${hostname}:3000`;
    }
  }

  return origin;
}

const API = getServerOrigin();

/** Full URL for an admin page — use when redirecting between login and dashboard. */
export function adminPageUrl(path = "/admin/login.html") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (window.location.origin === getServerOrigin()) return normalized;
  return `${getServerOrigin()}${normalized}`;
}

/** Full URL for the WorkDay iPhone app (PWA). */
export function workdayAppUrl(path = "/workday-app/") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (window.location.origin === getServerOrigin()) return normalized;
  return `${getServerOrigin()}${normalized}`;
}

/** True when viewing static files locally (Live Server) instead of the Node app. */
export function isStaticDevServer() {
  if (!isLocalDevHost(window.location.hostname)) return false;
  return window.location.origin !== getServerOrigin();
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        "Admin server is not responding. If you use Cloudflare Pages, check that D1 and environment variables are configured (see README)."
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function apiMissingMessage() {
  if (isLocalDevHost(window.location.hostname)) {
    return `Start the server locally: cd server && npm start, then open ${getServerOrigin()}/admin/ — or use Cloudflare: npm run dev:cf`;
  }
  if (/github\.io$/i.test(window.location.hostname)) {
    return "GitHub Pages is static-only and cannot run admin login. Connect this repo to Cloudflare Pages (free) — see README.";
  }
  return "Admin API not found. If you use Cloudflare Pages, bind the D1 database and set ADMIN_EMAIL, ADMIN_PASSWORD, and JWT_SECRET in the dashboard.";
}

export async function isApiAvailable() {
  try {
    const res = await fetchWithTimeout(`${API}/api/health`, { credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetchWithTimeout(`${API}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (err) {
    if (err.message?.includes("not responding")) throw err;
    throw new Error(
      isStaticDevServer()
        ? `Cannot reach the admin server at ${getServerOrigin()}. Run cd server && npm start, then open ${getServerOrigin()}/admin/`
        : apiMissingMessage()
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(data.error || "Please sign in.");
    }
    if (res.status === 404 || res.status === 405) {
      throw new Error(apiMissingMessage());
    }
    throw new Error(data.error || `Error ${res.status}`);
  }

  return data;
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtDate(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatAddress(c) {
  if (c.fullAddress) return c.fullAddress;
  if (c.street && c.city && c.state && c.zip) {
    return `${c.street}, ${c.city}, ${c.state} ${c.zip}`;
  }
  return c.address || "";
}

export function setStatus(el, msg, type = "") {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("form-status--success", "form-status--error");
  if (type) el.classList.add(`form-status--${type}`);
}

export async function requireAdmin() {
  try {
    const { admin } = await api("/api/auth/me");
    return admin;
  } catch {
    window.location.href = adminPageUrl("/admin/login.html");
    return null;
  }
}
