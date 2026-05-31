import { api, setStatus, getServerOrigin, adminPageUrl, isStaticDevServer } from "../js/api-client.js";

const REMEMBER_EMAIL_KEY = "msg_admin_saved_email";
const REMEMBER_DEVICE_KEY = "msg_admin_remember_device";

const form = document.getElementById("loginForm");
const statusEl = document.getElementById("formStatus");
const serverNotice = document.getElementById("serverNotice");

if (isStaticDevServer()) {
  window.location.replace(adminPageUrl("/admin/login.html"));
}

if (serverNotice) {
  if (isStaticDevServer() || window.location.hostname === "localhost") {
    serverNotice.innerHTML = `Admin panel runs at <a href="${getServerOrigin()}/admin/">${getServerOrigin()}/admin/</a>. Keep the server running with <code>cd server && npm start</code>.`;
  } else {
    serverNotice.textContent = "Admin login requires the Node.js server deployed with this website.";
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
    setStatus(statusEl, "Signing in…");
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

(async function checkExistingSession() {
  try {
    await api("/api/health");
    const { admin } = await api("/api/auth/me");
    if (admin) window.location.replace(adminPageUrl("/admin/index.html"));
  } catch (err) {
    if (statusEl && !statusEl.textContent) {
      setStatus(statusEl, err.message, "error");
    }
  }
})();
