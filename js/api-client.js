/** Ports used by Live Server and other static dev servers (not the Node API). */
const STATIC_DEV_PORTS = new Set(["5500", "5501", "5502", "8080", "8888", "5173"]);

function readMetaApiOrigin() {
  const meta = document.querySelector('meta[name="msg-api-origin"]');
  return meta?.content?.trim().replace(/\/$/, "") || null;
}

/** Origin where the Node.js API is served (usually http://localhost:3000). */
export function getServerOrigin() {
  const meta = readMetaApiOrigin();
  if (meta) return meta;

  const { protocol, hostname, port, origin } = window.location;

  if (port === "3000") return origin;

  if (!port || STATIC_DEV_PORTS.has(port)) {
    return `${protocol}//${hostname}:3000`;
  }

  return origin;
}

const API = getServerOrigin();

/** Full URL for an admin page -use when redirecting between login and dashboard. */
export function adminPageUrl(path = "/admin/login.html") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (window.location.origin === getServerOrigin()) return normalized;
  return `${getServerOrigin()}${normalized}`;
}

export function isStaticDevServer() {
  return window.location.origin !== getServerOrigin();
}

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      isStaticDevServer()
        ? `Cannot reach the admin server at ${getServerOrigin()}. Open a terminal, run cd server && npm start, then open ${getServerOrigin()}/admin/`
        : "Cannot reach the admin server. Run cd server && npm start in the project folder."
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 405) {
      throw new Error(
        `Admin login needs the Node server, not Live Server. Run cd server && npm start, then open ${getServerOrigin()}/admin/`
      );
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
