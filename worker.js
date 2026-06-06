import app from "./functions/_lib/app.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://api.web3forms.com",
    "script-src 'self' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: blob: https://unpkg.com https://*.tile.openstreetmap.org",
    "connect-src 'self' https://api.web3forms.com",
    "font-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
  ].join("; "),
};

function withSecurityHeaders(response, requestUrl) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  if (requestUrl.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let response;
    if (url.pathname.startsWith("/api/")) {
      response = await app.fetch(request, env, ctx);
    } else {
      response = await env.ASSETS.fetch(request);
    }
    return withSecurityHeaders(response, url);
  },
};
