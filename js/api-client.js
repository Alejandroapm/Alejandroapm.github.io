/** Ports used by Live Server and other static dev servers (not the Node API). */
const STATIC_DEV_PORTS = new Set(["5500", "5501", "5502", "8080", "8888", "5173"]);
const API_TIMEOUT_MS = 12000;
const AUTH_TOKEN_KEY = "msg_admin_auth_token";

/** Persist API origin after a successful login on the live host (helps WorkDay PWA). */
export function saveApiOrigin(origin) {
  const o = String(origin || "").trim().replace(/\/$/, "");
  if (!o || !/^https?:\/\//i.test(o)) return;
  try {
    localStorage.setItem("msg_api_origin", o);
  } catch {
    /* private mode */
  }
}

function readStoredApiOrigin() {
  try {
    const o = localStorage.getItem("msg_api_origin")?.trim().replace(/\/$/, "");
    return o && /^https?:\/\//i.test(o) ? o : null;
  } catch {
    return null;
  }
}

function readMetaApiOrigin() {
  const meta = document.querySelector('meta[name="msg-api-origin"]');
  const content = meta?.content?.trim().replace(/\/$/, "") || "";
  if (!content || /your-domain|your-cloudflare|example\.com/i.test(content)) return null;
  return content;
}

function isLocalDevHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Origin where the Node.js / Cloudflare API is served. */
export function getServerOrigin() {
  const meta = readMetaApiOrigin();
  if (meta) return meta;

  const stored = readStoredApiOrigin();
  if (stored) return stored;

  const { protocol, hostname, port, origin } = window.location;

  if (isLocalDevHost(hostname)) {
    if (port === "3000" || port === "8788") return origin;
    if (!port || STATIC_DEV_PORTS.has(port)) {
      return `${protocol}//${hostname}:3000`;
    }
  }

  if (/\.github\.io$/i.test(hostname) && stored) return stored;

  return origin;
}

function apiBase() {
  return getServerOrigin();
}

/** Persist JWT for clients where HttpOnly cookies are unreliable (e.g. iPhone PWA). */
export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || null;
}

export function setAuthToken(token, remember = false) {
  clearAuthToken();
  if (!token) return;
  if (remember) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else sessionStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

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

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const { timeoutMessage, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        timeoutMessage ||
          "This is taking too long. If starting a work day, geocode customers on the Map tab first, then try again."
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
  const origins = [...new Set([apiBase(), readStoredApiOrigin()].filter(Boolean))];
  for (const origin of origins) {
    try {
      const res = await fetchWithTimeout(`${origin}/api/health`, {
        credentials: "include",
        headers: authHeaders(),
      }, API_TIMEOUT_MS);
      if (res.ok) {
        saveApiOrigin(origin);
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

export async function api(path, options = {}) {
  const { timeoutMs, timeoutMessage, ...fetchOptions } = options;
  let res;
  try {
    res = await fetchWithTimeout(`${apiBase()}${path}`, {
      credentials: "include",
      ...fetchOptions,
      headers: authHeaders({
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      }),
      timeoutMessage,
    }, timeoutMs ?? API_TIMEOUT_MS);
  } catch (err) {
    if (err.message?.includes("taking too long") || err.message?.includes("not responding")) throw err;
    throw new Error(
      isStaticDevServer()
        ? `Cannot reach the admin server at ${getServerOrigin()}. Run cd server && npm start, then open ${getServerOrigin()}/admin/`
        : apiMissingMessage()
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      clearAuthToken();
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
    clearAuthToken();
    window.location.href = adminPageUrl("/admin/login.html");
    return null;
  }
}

/** Authenticated fetch for downloads and other non-JSON responses. */
export async function authFetch(path, options = {}) {
  const { timeoutMs, timeoutMessage, ...fetchOptions } = options;
  return fetchWithTimeout(`${apiBase()}${path}`, {
    credentials: "include",
    ...fetchOptions,
    headers: authHeaders(fetchOptions.headers || {}),
    timeoutMessage,
  }, timeoutMs ?? API_TIMEOUT_MS);
}
