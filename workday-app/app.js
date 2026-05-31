import { api, setStatus, fmtDate, esc, getServerOrigin, isApiAvailable, setAuthToken, clearAuthToken } from "../js/api-client.js";
import { t, dayName, adminLocale, onLangChange, setAdminLang, getAdminLang, applyStaticI18n } from "../js/admin-i18n.js";
import { createWorkdayUI } from "../js/workday-ui.js";

const REMEMBER_EMAIL_KEY = "msg_admin_saved_email";
const REMEMBER_DEVICE_KEY = "msg_admin_remember_device";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
}

const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const loginForm = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const loginSubmitBtn = loginForm?.querySelector('button[type="submit"]');

function initWorkdayAppLang() {
  const sync = (lang) => {
    document.querySelectorAll("#langEN, #langENApp").forEach((b) => b?.classList.toggle("is-active", lang === "en"));
    document.querySelectorAll("#langES, #langESApp").forEach((b) => b?.classList.toggle("is-active", lang === "es"));
    document.documentElement.lang = lang;
  };
  document.querySelectorAll("#langEN, #langENApp").forEach((b) => b?.addEventListener("click", () => setAdminLang("en")));
  document.querySelectorAll("#langES, #langESApp").forEach((b) => b?.addEventListener("click", () => setAdminLang("es")));
  onLangChange((lang) => {
    sync(lang);
    if (!appScreen.hidden) workdayUI.render();
  });
  applyStaticI18n();
  sync(getAdminLang());
}

function poolsLabel(n) {
  return `${n} ${n === 1 ? t("pool") : t("pools")}`;
}

const profile = { businessName: "MSG Pool Services" };

const workdayUI = createWorkdayUI({
  api,
  getServerOrigin,
  setStatus,
  esc,
  fmtDate,
  t,
  dayName,
  adminLocale,
  poolsLabel,
  getBusinessName: () => profile.businessName,
  els: {
    body: document.getElementById("workdayBody"),
    jobModal: document.getElementById("jobModal"),
    navModal: document.getElementById("navModal"),
    exportLogBtn: document.getElementById("exportLogBtn"),
    closeJobModal: document.getElementById("closeJobModal"),
    closeNavModal: document.getElementById("closeNavModal"),
  },
});

initWorkdayAppLang();

const savedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY);
if (savedEmail && loginForm?.email) loginForm.email.value = savedEmail;
if (localStorage.getItem(REMEMBER_DEVICE_KEY) === "1") {
  document.getElementById("rememberDevice").checked = true;
}

function showLogin() {
  loginScreen.hidden = false;
  appScreen.hidden = true;
}

function showApp(admin) {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  profile.businessName = admin.businessName || "MSG Pool Services";
  document.getElementById("appUserEmail").textContent = admin.email;
  workdayUI.init();
}

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = loginForm.email.value.trim();
  const password = loginForm.password.value;
  const rememberDevice = !!document.getElementById("rememberDevice")?.checked;

  try {
    setStatus(loginStatus, t("signingIn"));
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberDevice }),
    });
    if (data.token) setAuthToken(data.token, rememberDevice || true);
    loginForm.password.value = "";

    if (rememberDevice) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, email);
      localStorage.setItem(REMEMBER_DEVICE_KEY, "1");
    } else {
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
      localStorage.removeItem(REMEMBER_DEVICE_KEY);
    }

    showApp(data.admin || { email });
  } catch (err) {
    loginForm.password.value = "";
    setStatus(loginStatus, err.message, "error");
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* still clear local session below */
  }
  clearAuthToken();
  showLogin();
});

(async function boot() {
  const apiUp = await isApiAvailable();
  if (!apiUp) {
    setStatus(
      loginStatus,
      "Admin login is not available here. Open WorkDay from your Cloudflare admin site (not GitHub Pages). See Install WorkDay in the admin dashboard.",
      "error"
    );
    if (loginSubmitBtn) loginSubmitBtn.disabled = true;
    return;
  }

  try {
    const { admin } = await api("/api/auth/me");
    if (admin) showApp(admin);
    else showLogin();
  } catch {
    clearAuthToken();
    showLogin();
  }
})();
