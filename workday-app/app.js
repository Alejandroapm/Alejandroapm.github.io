import { api, setStatus, fmtDate, esc, getServerOrigin, isApiAvailable, setAuthToken, clearAuthToken, saveApiOrigin } from "../js/api-client.js";
import { t, dayName, adminLocale, onLangChange, setAdminLang, getAdminLang, applyStaticI18n } from "../js/admin-i18n.js";
import { createWorkdayUI, workdayExportUrl, initWorkdayExportDates } from "../js/workday-ui.js";

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
const panelWorkday = document.getElementById("appPanelWorkday");
const panelWorklog = document.getElementById("appPanelWorklog");

let appView = "workday";

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
    if (!appScreen.hidden && appView === "workday") workdayUI.render();
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
  getExportUrl: () => {
    initWorkdayExportDates(fmtDate);
    const to = document.getElementById("exportToDate")?.value || "";
    const from = document.getElementById("exportFromDate")?.value?.trim() || "";
    return workdayExportUrl({ from: from || undefined, to: to || undefined });
  },
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

function switchAppView(name) {
  appView = name;
  document.querySelectorAll(".workday-app__tab").forEach((btn) => {
    const active = btn.dataset.appView === name;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  });
  if (panelWorkday) panelWorkday.hidden = name !== "workday";
  if (panelWorklog) panelWorklog.hidden = name !== "worklog";
  if (name === "workday") workdayUI.render();
  if (name === "worklog") initWorkdayExportDates(fmtDate);
}

document.querySelectorAll(".workday-app__tab").forEach((btn) => {
  btn.addEventListener("click", () => switchAppView(btn.dataset.appView));
});

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
  switchAppView("workday");
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
    saveApiOrigin(getServerOrigin());
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
      t("apiUnavailableHint"),
      "error"
    );
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
