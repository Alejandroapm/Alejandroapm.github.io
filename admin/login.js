import { api, setStatus, getServerOrigin, adminPageUrl, isStaticDevServer, isApiAvailable } from "../js/api-client.js";
import { t, initLangToggle } from "../js/admin-i18n.js";

initLangToggle();

const REMEMBER_EMAIL_KEY = "msg_admin_saved_email";
const REMEMBER_DEVICE_KEY = "msg_admin_remember_device";

const form = document.getElementById("loginForm");
const statusEl = document.getElementById("formStatus");
const serverNotice = document.getElementById("serverNotice");
const submitBtn = form?.querySelector('button[type="submit"]');

if (isStaticDevServer()) {
  window.location.replace(adminPageUrl("/admin/login.html"));
}

function showServerNotice(html, warn = false) {
  if (!serverNotice) return;
  serverNotice.innerHTML = html;
  serverNotice.classList.toggle("admin-server-notice--warn", warn);
}

if (serverNotice) {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    showServerNotice(
      `Local admin: keep the server running with <code>cd server && npm start</code>, then use <a href="${getServerOrigin()}/admin/">${getServerOrigin()}/admin/</a>.`
    );
  }
}

const savedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY);
if (savedEmail && form?.email) {
  form.email.value = savedEmail;
}
if (localStorage.getItem(REMEMBER_DEVICE_KEY) === "1") {
  const rememberEl = document.getElementById("rememberDevice");
  if (rememberEl) rememberEl.checked = true;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  const password = form.password.value;
  const rememberDevice = !!document.getElementById("rememberDevice")?.checked;

  try {
    setStatus(statusEl, t("signingIn"));
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberDevice }),
    });

    form.password.value = "";

    if (rememberDevice) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, email);
      localStorage.setItem(REMEMBER_DEVICE_KEY, "1");
    } else {
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
      localStorage.removeItem(REMEMBER_DEVICE_KEY);
    }

    window.location.href = adminPageUrl("/admin/index.html");
  } catch (err) {
    form.password.value = "";
    setStatus(statusEl, err.message, "error");
  }
});

(async function initLoginPage() {
  const apiUp = await isApiAvailable();

  if (!apiUp) {
    showServerNotice(
      "<strong>Admin login is not available here.</strong> GitHub Pages and Live Server are static only. For free hosting with admin, deploy via <strong>Cloudflare Pages</strong> (see README). Locally, run <code>cd server && npm start</code> or <code>npm run dev:cf</code>.",
      true
    );
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  try {
    const { admin } = await api("/api/auth/me");
    if (admin) window.location.replace(adminPageUrl("/admin/index.html"));
  } catch (err) {
    if (err.message?.includes("Please sign in") || err.message?.includes("Session expired")) {
      return;
    }
    setStatus(statusEl, err.message, "error");
  }
})();
