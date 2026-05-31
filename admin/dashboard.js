import { api, requireAdmin, fmtDate, esc, setStatus, formatAddress, adminPageUrl, getServerOrigin, clearAuthToken } from "../js/api-client.js";
import { loadLeaflet, createMap, drawRoute, drawCustomers, refreshMap } from "../js/admin-maps.js";
import { attachAddressAutocomplete, pickedCoordsPayload, clearPickedCoords } from "../js/address-autocomplete.js";
import { t, days as i18nDays, daysShort as i18nDaysShort, dayName, adminLocale, initLangToggle, onLangChange } from "../js/admin-i18n.js";
import { createWorkdayUI, workdayExportUrl, initWorkdayExportDates } from "../js/workday-ui.js";

const admin = await requireAdmin();
if (!admin) throw new Error("redirect");

document.getElementById("adminEmail").textContent = admin.email;
if (admin.isSuper) {
  document.querySelector('[data-view="team"]')?.removeAttribute("hidden");
  document.getElementById("msgLogOwnerWrap")?.removeAttribute("hidden");
  document.getElementById("msgLogClearAll")?.removeAttribute("hidden");
  document.getElementById("exportUserWrap")?.removeAttribute("hidden");
  const superLead = document.querySelector("#view-messages .msg-log .section__lead");
  if (superLead) {
    superLead.dataset.i18n = "msgLogLeadSuper";
    superLead.textContent = t("msgLogLeadSuper");
  }
} else {
  document.getElementById("addFormLeadMember")?.removeAttribute("hidden");
}

initLangToggle();
let currentView = "calendar";

function poolsLabel(n) {
  return `${n} ${n === 1 ? t("pool") : t("pools")}`;
}

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
  getBusinessName: () => admin.businessName || "MSG Pool Services",
  getExportUrl: () => {
    initWorkdayExportDates(fmtDate);
    const to = document.getElementById("exportToDate")?.value || "";
    const from = document.getElementById("exportFromDate")?.value?.trim() || "";
    const sel = document.getElementById("exportUserSelect");
    const uid = admin.isSuper && sel?.value ? sel.value : "";
    return workdayExportUrl({
      userId: uid || undefined,
      from: from || undefined,
      to: to || undefined,
    });
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

const initWorkday = () => workdayUI.init();
const renderWorkday = () => workdayUI.render();

async function initWorkLog() {
  initWorkdayExportDates(fmtDate);
  if (admin.isSuper) await ensureMsgLogTeamOptions();
}

function refreshCurrentView() {
  if (currentView === "customers") loadCustomerList();
  else if (currentView === "messages") initMessages();
  else if (currentView === "workday") renderWorkday();
  else if (currentView === "worklog") initWorkLog();
  else if (currentView === "map") loadCustomerMap();
  else if (currentView === "team") loadTeamUsers();
  else if (currentView === "route" && routeDateInput.value) loadRoute(routeDateInput.value);
}

function ownerBadge(c) {
  if (!admin.isSuper) return "";
  const label = c.ownerName || c.ownerEmail || t("ownerUnknown");
  return `<span class="tag tag--owner">${t("ownerBadge")}: ${esc(label)}</span>`;
}

let teamUsersCache = [];
let teamOwnerOptionsLoaded = false;

onLangChange(() => {
  loadStats();
  renderCalendar();
  refreshCurrentView();
});

let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth() + 1;
let calendarCounts = {};
let selectedDate = null;

let routeMap = null;
let routeLayer = null;
let customerMap = null;
let customerLayer = null;

const views = {
  calendar: document.getElementById("view-calendar"),
  route: document.getElementById("view-route"),
  map: document.getElementById("view-map"),
  customers: document.getElementById("view-customers"),
  messages: document.getElementById("view-messages"),
  workday: document.getElementById("view-workday"),
  worklog: document.getElementById("view-worklog"),
  team: document.getElementById("view-team"),
  add: document.getElementById("view-add"),
};

const customerForm = document.getElementById("customerForm");
const formStatus = document.getElementById("formStatus");
const dayModal = document.getElementById("dayModal");

const routeDateInput = document.getElementById("routeDate");
routeDateInput.value = fmtDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* still clear local session below */
  }
  clearAuthToken();
  window.location.href = adminPageUrl("/admin/login.html");
});

document.querySelectorAll(".admin-nav__btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

function showView(name) {
  document.querySelectorAll(".admin-nav__btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.view === name);
  });
  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
}

function switchView(name) {
  currentView = name;
  showView(name);

  if (name === "customers") loadCustomerList();
  if (name === "messages") initMessages();
  if (name === "workday") initWorkday();
  if (name === "worklog") initWorkLog();
  if (name === "add") resetForm();
  if (name === "route") {
    loadRouteStartForm().then(() => ensureRouteMap());
  }
  if (name === "map") {
    ensureCustomerMap().then(() => loadCustomerMap());
  }
  if (name === "team") loadTeamUsers();
}

document.getElementById("prevMonth")?.addEventListener("click", () => {
  viewMonth -= 1;
  if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; }
  renderCalendar();
});

document.getElementById("nextMonth")?.addEventListener("click", () => {
  viewMonth += 1;
  if (viewMonth > 12) { viewMonth = 1; viewYear += 1; }
  renderCalendar();
});

document.getElementById("todayBtn")?.addEventListener("click", () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth() + 1;
  renderCalendar();
});

document.getElementById("closeDayModal")?.addEventListener("click", () => dayModal.close());
dayModal?.addEventListener("click", (e) => {
  if (e.target === dayModal) dayModal.close();
});

document.getElementById("cancelForm")?.addEventListener("click", () => {
  switchView("calendar");
});

document.getElementById("suggestDayBtn")?.addEventListener("click", suggestBestDay);

async function suggestBestDay() {
  const resultEl = document.getElementById("suggestDayResult");
  const street = customerForm.street.value.trim();
  const city = customerForm.city.value.trim();
  const zip = customerForm.zip.value.trim();
  const picked = pickedCoordsPayload(customerForm);

  if (!picked.lat && (!street || !city || !zip)) {
    setStatus(resultEl, t("dayEnterAddr"), "error");
    return;
  }

  setStatus(resultEl, t("findingDay"));
  try {
    const data = await api("/api/admin/suggest-day", {
      method: "POST",
      body: JSON.stringify({ ...picked, street, city, state: "FL", zip }),
    });
    resultEl.classList.remove("form-status--error");
    resultEl.innerHTML = `
      <strong>${t("suggested")}: ${dayName(data.suggestedDay)}.</strong> ${esc(data.reason)}
      <button type="button" class="btn btn--small" id="useSuggestedDay">${t("use")} ${dayName(data.suggestedDay)}</button>
    `;
    document.getElementById("useSuggestedDay")?.addEventListener("click", () => {
      customerForm.serviceDayOfWeek.value = String(data.suggestedDay);
      setStatus(resultEl, `${t("daySet")} ${dayName(data.suggestedDay)}.`, "success");
    });
  } catch (err) {
    setStatus(resultEl, err.message, "error");
  }
}

document.getElementById("loadRouteBtn")?.addEventListener("click", () => loadRoute(routeDateInput.value));
document.getElementById("refreshMapBtn")?.addEventListener("click", () => loadCustomerMap());
document.getElementById("relocateAllBtn")?.addEventListener("click", () => {
  if (!confirm(t("relocateConfirm"))) return;
  loadCustomerMap(true);
});

document.getElementById("routeStartForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("routeStartStatus");
  const form = e.target;
  try {
    setStatus(statusEl, t("saving"));
    await api("/api/admin/settings/route-start", {
      method: "PUT",
      body: JSON.stringify({
        street: form.street.value.trim(),
        city: form.city.value.trim(),
        state: "FL",
        zip: form.zip.value.trim(),
        ...pickedCoordsPayload(form),
      }),
    });
    clearPickedCoords(form);
    setStatus(statusEl, t("startAddrSaved"), "success");
    if (routeDateInput.value) loadRoute(routeDateInput.value);
  } catch (err) {
    setStatus(statusEl, err.message, "error");
  }
});

customerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("customerId").value;
  const body = {
    name: customerForm.name.value.trim(),
    phone: customerForm.phone.value.trim(),
    email: customerForm.email.value.trim(),
    street: customerForm.street.value.trim(),
    city: customerForm.city.value.trim(),
    state: "FL",
    zip: customerForm.zip.value.trim(),
    serviceDayOfWeek: Number(customerForm.serviceDayOfWeek.value),
    poolType: customerForm.poolType.value,
    monthlyRate: customerForm.monthlyRate.value ? Number(customerForm.monthlyRate.value) : null,
    notes: customerForm.notes.value.trim(),
    ...pickedCoordsPayload(customerForm),
  };

  if (id) body.active = customerForm.active.checked;
  if (admin.isSuper) {
    const ownerId = Number(document.getElementById("customerOwner").value);
    if (!ownerId) {
      setStatus(formStatus, t("selectRouteOperator"), "error");
      return;
    }
    body.assignToUserId = ownerId;
  }

  try {
    setStatus(formStatus, t("saving"));
    if (id) {
      await api(`/api/admin/customers/${id}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/api/admin/customers", { method: "POST", body: JSON.stringify(body) });
    }
    setStatus(formStatus, t("saved"), "success");
    clearPickedCoords(customerForm);
    resetForm();
    await Promise.all([renderCalendar(), loadStats(), loadCustomerList()]);
    setTimeout(() => switchView("calendar"), 800);
  } catch (err) {
    setStatus(formStatus, err.message, "error");
  }
});

async function ensureRouteMap() {
  await loadLeaflet();
  if (!routeMap) {
    routeMap = createMap(document.getElementById("routeMap"));
    routeLayer = L.layerGroup().addTo(routeMap);
  }
  await refreshMap(routeMap);
}

async function ensureCustomerMap() {
  await loadLeaflet();
  if (!customerMap) {
    customerMap = createMap(document.getElementById("customerMap"));
    customerLayer = L.layerGroup().addTo(customerMap);
  }
  await refreshMap(customerMap);
}

async function loadRouteStartForm() {
  const { routeStart } = await api("/api/admin/settings/route-start");
  const form = document.getElementById("routeStartForm");
  if (!form || !routeStart) return;
  form.street.value = routeStart.street || "";
  form.city.value = routeStart.city || "";
  form.state.value = routeStart.state || "FL";
  form.zip.value = routeStart.zip || "";
}

async function ensureTeamOwnerSelect() {
  const row = document.getElementById("ownerRow");
  const sel = document.getElementById("customerOwner");
  if (!admin.isSuper || !row || !sel) return;
  row.hidden = false;
  if (!teamOwnerOptionsLoaded) {
    const { users } = await api("/api/admin/users");
    teamUsersCache = users;
    teamOwnerOptionsLoaded = true;
  }
  const keep = sel.value;
  sel.innerHTML = teamUsersCache
    .filter((u) => u.active)
    .map((u) => {
      const label = u.name || u.email;
      const biz = u.businessName ? ` · ${u.businessName}` : "";
      return `<option value="${u.id}">${esc(`${label}${biz}`)}</option>`;
    })
    .join("");
  if (keep && sel.querySelector(`option[value="${keep}"]`)) sel.value = keep;
}

async function resetForm() {
  customerForm.reset();
  document.getElementById("customerId").value = "";
  document.getElementById("formTitle").textContent = t("addTitle");
  document.getElementById("activeRow").hidden = true;
  document.getElementById("state").value = "FL";
  setStatus(formStatus, "");
  const ownerRow = document.getElementById("ownerRow");
  const ownerSel = document.getElementById("customerOwner");
  if (admin.isSuper && ownerRow) {
    await ensureTeamOwnerSelect();
    ownerSel.required = true;
    document.getElementById("customerOwner").value = String(admin.id);
  } else if (ownerRow) {
    ownerRow.hidden = true;
    if (ownerSel) ownerSel.required = false;
  }
}

async function editCustomer(c) {
  switchView("add");
  document.getElementById("formTitle").textContent = t("editTitle");
  document.getElementById("customerId").value = c.id;
  customerForm.name.value = c.name;
  customerForm.phone.value = c.phone || "";
  customerForm.email.value = c.email || "";
  customerForm.street.value = c.street || "";
  customerForm.city.value = c.city || "";
  customerForm.state.value = "FL";
  customerForm.zip.value = c.zip || "";
  customerForm.serviceDayOfWeek.value = c.serviceDayOfWeek;
  customerForm.poolType.value = c.poolType || "pool";
  customerForm.monthlyRate.value = c.monthlyRate ?? "";
  customerForm.notes.value = c.notes || "";
  customerForm.active.checked = c.active;
  document.getElementById("activeRow").hidden = false;
  if (admin.isSuper) {
    await ensureTeamOwnerSelect();
    document.getElementById("customerOwner").required = true;
    document.getElementById("customerOwner").value = String(c.ownerId ?? admin.id);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function renderCalendar() {
  const title = document.getElementById("calendarTitle");
  const grid = document.getElementById("calendarGrid");
  const monthName = new Date(viewYear, viewMonth - 1, 1).toLocaleString(adminLocale(), { month: "long", year: "numeric" });
  title.textContent = monthName;

  const { counts } = await api(`/api/admin/calendar?year=${viewYear}&month=${viewMonth}`);
  calendarCounts = counts;

  const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const today = fmtDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

  let html = i18nDaysShort().map((d) => `<div class="calendar-grid__head">${d}</div>`).join("");

  for (let i = 0; i < firstDow; i++) {
    html += `<div class="calendar-cell calendar-cell--empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = fmtDate(viewYear, viewMonth, day);
    const count = counts[dateStr] || 0;
    const isToday = dateStr === today;
    html += `
      <button type="button" class="calendar-cell${isToday ? " calendar-cell--today" : ""}" data-date="${dateStr}">
        <span class="calendar-cell__num">${day}</span>
        ${count ? `<span class="calendar-cell__badge">${poolsLabel(count)}</span>` : ""}
      </button>
    `;
  }

  grid.innerHTML = html;
  grid.querySelectorAll("[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => openDayModal(btn.dataset.date));
  });
}

async function openDayModal(dateStr) {
  selectedDate = dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  document.getElementById("dayModalTitle").textContent =
    `${dayName(d.getDay())}, ${d.toLocaleDateString(adminLocale(), { month: "long", day: "numeric", year: "numeric" })}`;

  const body = document.getElementById("dayModalBody");
  body.innerHTML = `<p class="muted">${t("loading")}</p>`;
  dayModal.showModal();

  const { customers } = await api(`/api/admin/day?date=${dateStr}`);
  const extraHtml = await renderAddExtraForm(dateStr);

  const routeBtn = `
    <button type="button" class="btn btn--small day-modal__route" data-route-date="${dateStr}">
      ${t("viewRoute")}
    </button>
  `;

  if (!customers.length) {
    body.innerHTML = `
      <p class="muted">${t("noPoolsThisDay")}</p>
      <p class="fineprint">${t("assignHint")}</p>
      <h3>${t("addOneTime")}</h3>
      ${extraHtml}
    `;
    bindExtraForm(dateStr);
    return;
  }

  body.innerHTML = `
    <div class="day-modal__toolbar">
      <p class="muted">${poolsLabel(customers.length)} ${t("onRoute")}</p>
      <button type="button" class="btn btn--ghost btn--small" data-msg-date="${dateStr}">${t("textCustomers")}</button>
      ${routeBtn}
    </div>
    <div class="day-list">
      ${customers.map((c) => renderDayCustomer(c, dateStr)).join("")}
    </div>
    <hr class="hr" />
    <h3>${t("addOneTime")}</h3>
    ${extraHtml}
  `;
  bindDayActions(dateStr);
  bindExtraForm(dateStr);

  body.querySelector("[data-route-date]")?.addEventListener("click", async () => {
    dayModal.close();
    routeDateInput.value = dateStr;
    document.querySelector('[data-view="route"]').click();
  });

  body.querySelector("[data-msg-date]")?.addEventListener("click", () => {
    dayModal.close();
    openMessagesForDate(dateStr);
  });
}

function renderDayCustomer(c, dateStr) {
  const skipped = c.overrides?.some((o) => o.type === "skip");
  const extra = c.overrides?.some((o) => o.type === "extra");
  return `
    <article class="day-customer" data-id="${c.id}">
      <div class="day-customer__head">
        <strong>${esc(c.name)}</strong>
        ${ownerBadge(c)}
        ${extra ? `<span class="tag tag--extra">${t("extraVisit")}</span>` : ""}
        ${skipped ? `<span class="tag tag--skip">${t("skipped")}</span>` : ""}
      </div>
      <p class="muted">${esc(formatAddress(c))}</p>
      ${c.phone ? `<p>📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></p>` : ""}
      ${c.notes ? `<p class="day-customer__notes"><strong>${t("notes")}</strong> ${esc(c.notes)}</p>` : ""}
      <div class="day-customer__actions">
        <button type="button" class="btn btn--ghost btn--small" data-edit="${c.id}">${t("edit")}</button>
        <button type="button" class="btn btn--ghost btn--small" data-skip="${c.id}">${t("skipThisDay")}</button>
        ${extra ? `<button type="button" class="btn btn--ghost btn--small" data-unextra="${c.id}">${t("removeExtra")}</button>` : ""}
      </div>
    </article>
  `;
}

async function renderAddExtraForm(dateStr) {
  const { customers } = await api("/api/admin/customers");
  if (!customers.length) {
    return `<p class="muted">${t("addCustomersFirst")}</p>`;
  }
  return `
    <form class="extra-form" data-date="${dateStr}">
      <div class="form-row">
        <label>${t("customer")}</label>
        <select name="customerId" required>
          <option value="">${t("selectCustomer")}</option>
          ${customers.map((c) => `<option value="${c.id}">${esc(c.name)} -${dayName(c.serviceDayOfWeek)}</option>`).join("")}
        </select>
      </div>
      <button type="submit" class="btn btn--small">${t("scheduleExtra")}</button>
    </form>
  `;
}

function bindDayActions(dateStr) {
  document.getElementById("dayModalBody").querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { customer } = await api(`/api/admin/customers/${btn.dataset.edit}`);
      dayModal.close();
      editCustomer(customer);
    });
  });

  document.getElementById("dayModalBody").querySelectorAll("[data-skip]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/admin/overrides", {
        method: "POST",
        body: JSON.stringify({ customerId: Number(btn.dataset.skip), date: dateStr, type: "skip" }),
      });
      openDayModal(dateStr);
      renderCalendar();
    });
  });

  document.getElementById("dayModalBody").querySelectorAll("[data-unextra]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/admin/overrides", {
        method: "DELETE",
        body: JSON.stringify({ customerId: Number(btn.dataset.unextra), date: dateStr, type: "extra" }),
      });
      openDayModal(dateStr);
      renderCalendar();
    });
  });
}

function bindExtraForm(dateStr) {
  document.getElementById("dayModalBody").querySelector(".extra-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const customerId = Number(e.target.customerId.value);
    await api("/api/admin/overrides", {
      method: "POST",
      body: JSON.stringify({ customerId, date: dateStr, type: "extra" }),
    });
    openDayModal(dateStr);
    renderCalendar();
  });
}

async function loadRoute(dateStr) {
  if (!dateStr) return;

  const meta = document.getElementById("routeMeta");
  const list = document.getElementById("routeStopList");
  const warnings = document.getElementById("routeWarnings");

  meta.innerHTML = `<p class="muted">${t("buildingRoute")}</p>`;
  list.innerHTML = "";
  warnings.hidden = true;

  showView("route");
  await loadRouteStartForm();
  await ensureRouteMap();

  try {
    const route = await api(`/api/admin/route?date=${dateStr}`, { timeoutMs: 120000 });
    const d = new Date(`${dateStr}T12:00:00`);
    const localDay = dayName(d.getDay());
    const scheduledCount = route.scheduledCount ?? route.stops?.length ?? 0;

    if (!scheduledCount) {
      meta.innerHTML = `<p class="muted"><strong>${localDay}</strong> -${t("noPoolsDate")}</p>`;
      drawRoute(routeMap, routeLayer, { depot: route.depot, stops: [], geometry: null });
      await refreshMap(routeMap);
      return;
    }

    const stats = [];
    if (route.distanceMiles != null) stats.push(`${route.distanceMiles} mi`);
    if (route.durationMinutes != null) stats.push(`~${route.durationMinutes} ${t("minDrive")}`);

    const startLabel = route.depot?.label ? esc(route.depot.label) : t("yourSavedStart");
    const mappedTxt = route.stops?.length
      ? ` · ${route.stops.length} ${route.stops.length === 1 ? t("mappedStop") : t("mappedStops")}`
      : "";

    meta.innerHTML = `
      <h2 class="route-panel__title">${localDay}, ${d.toLocaleDateString(adminLocale(), { month: "long", day: "numeric", year: "numeric" })}</h2>
      <p class="route-panel__stats">${poolsLabel(scheduledCount)} ${t("scheduled")}${mappedTxt}${stats.length ? ` · ${stats.join(" · ")}` : ""}</p>
      <p class="fineprint">${t("optimizedFrom")} ${startLabel}.</p>
    `;

    if (route.stops?.length) {
      list.innerHTML = route.stops.map((stop) => `
        <li class="route-stop">
          <span class="route-stop__num">${stop.order}</span>
          <div>
            <strong>${esc(stop.name)}</strong>
            <p class="muted">${esc(formatAddress(stop))}</p>
            ${stop.phone ? `<p class="fineprint">${esc(stop.phone)}</p>` : ""}
            ${stop.notes ? `<p class="route-stop__notes">${esc(stop.notes)}</p>` : ""}
          </div>
        </li>
      `).join("");
    } else {
      list.innerHTML = `<li class="muted">${t("poolsScheduledNone")}</li>`;
    }

    if (route.unmapped?.length) {
      warnings.hidden = false;
      warnings.innerHTML = `
        <p><strong>${poolsLabel(route.unmapped.length)} ${t("notOnMap")}</strong></p>
        <ul>${route.unmapped.map((c) => `<li>${esc(c.name)} -${esc(formatAddress(c))}</li>`).join("")}</ul>
        <p class="fineprint">${t("rebuildHint")}</p>
      `;
    }

    drawRoute(routeMap, routeLayer, route);
    await refreshMap(routeMap);
  } catch (err) {
    meta.innerHTML = `<p class="form-status--error">${esc(err.message)}</p>`;
  }
}

async function loadCustomerMap(force = false) {
  await ensureCustomerMap();
  const metaEl = document.querySelector("#view-map .section__lead");
  metaEl.textContent = force ? t("relocatingLocations") : t("loadingLocations");

  try {
    const { customers, geocoded, attempted } = await api(`/api/admin/map/geocode${force ? "?force=1" : ""}`, {
      method: "POST",
      timeoutMs: 120000,
    });
    const mapped = customers.filter((c) => c.lat != null && c.lng != null);
    const unmapped = customers.length - mapped.length;

    if (attempted > 0) {
      metaEl.textContent = unmapped
        ? `${t("mappedShort")} ${geocoded} ${t("ofWord")} ${attempted}. ${mapped.length} ${t("onMapLc")} ${unmapped} ${t("stillNeedAddr")}`
        : `${t("mapAll")} ${customers.length} ${t("activeMapped")}`;
    } else {
      metaEl.textContent = unmapped
        ? `${mapped.length} ${t("ofWord")} ${customers.length} ${t("activeOnMap")} ${unmapped} ${t("needCompleteAddr")}`
        : `${t("mapAll")} ${customers.length} ${t("activeOnMap")}`;
    }

    drawCustomers(customerMap, customerLayer, customers);
    await refreshMap(customerMap);
  } catch (err) {
    metaEl.textContent = err.message;
  }
}

async function loadCustomerList() {
  const { customers } = await api("/api/admin/customers?all=1");
  const el = document.getElementById("customerList");

  if (!customers.length) {
    el.innerHTML = `<p class="muted">${t("noCustomers")}</p>`;
    return;
  }

  el.innerHTML = customers.map((c) => `
    <article class="customer-row${c.active ? "" : " customer-row--inactive"}">
      <div>
        <strong>${esc(c.name)}</strong>
        <span class="tag">${dayName(c.serviceDayOfWeek)}</span>
        ${ownerBadge(c)}
        ${c.active ? "" : `<span class="tag tag--skip">${t("inactive")}</span>`}
        ${c.lat != null ? `<span class="tag tag--mapped">${t("onMap")}</span>` : `<span class="tag tag--warn">${t("notMapped")}</span>`}
        <p class="muted">${esc(formatAddress(c))}</p>
        ${c.phone ? `<p>${esc(c.phone)}</p>` : ""}
        ${c.notes ? `<p class="customer-row__notes">${esc(c.notes)}</p>` : ""}
      </div>
      <div class="customer-row__actions">
        <button type="button" class="btn btn--ghost btn--small" data-edit-list="${c.id}">${t("edit")}</button>
        ${c.active ? `<button type="button" class="btn btn--ghost btn--small" data-deactivate="${c.id}">${t("deactivate")}</button>` : ""}
        <button type="button" class="btn btn--ghost btn--small btn--danger" data-delete="${c.id}">${t("removePermanently")}</button>
      </div>
    </article>
  `).join("");

  el.querySelectorAll("[data-edit-list]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { customer } = await api(`/api/admin/customers/${btn.dataset.editList}`);
      editCustomer(customer);
    });
  });

  el.querySelectorAll("[data-deactivate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("deactivateConfirm"))) return;
      await api(`/api/admin/customers/${btn.dataset.deactivate}/deactivate`, { method: "PATCH" });
      loadCustomerList();
      renderCalendar();
      loadStats();
    });
  });

  el.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("deleteConfirm"))) return;
      await api(`/api/admin/customers/${btn.dataset.delete}`, { method: "DELETE" });
      loadCustomerList();
      renderCalendar();
      loadStats();
    });
  });
}

async function loadStats() {
  const { totalActive, routeLoad } = await api("/api/admin/stats");
  document.getElementById("statTotal").textContent = totalActive;
  document.getElementById("statByDay").innerHTML = routeLoad
    .filter((r) => r.count > 0)
    .map((r) => `<li><strong>${dayName(r.day ?? r.dayOfWeek)}</strong> -${poolsLabel(r.count)}</li>`)
    .join("") || `<li class='muted'>${t("noRoutes")}</li>`;
}

// ---- Team (super user) ----
function renderTeamUser(u) {
  const roleTag = u.isSuper
    ? `<span class="tag tag--super">${t("teamSuper")}</span>`
    : `<span class="tag">${t("teamUser")}</span>`;
  const statusTag = u.active
    ? `<span class="tag tag--mapped">${t("teamActive")}</span>`
    : `<span class="tag tag--skip">${t("teamRestricted")}</span>`;
  const memberActions = u.isSuper ? "" : `
      ${u.active
        ? `<button type="button" class="btn btn--ghost btn--small" data-restrict-user="${u.id}">${t("teamRestrict")}</button>`
        : `<button type="button" class="btn btn--ghost btn--small" data-restore-user="${u.id}">${t("teamRestore")}</button>`}
      <button type="button" class="btn btn--ghost btn--small" data-reset-pwd="${u.id}">${t("teamResetPwd")}</button>
      <button type="button" class="btn btn--ghost btn--small btn--danger" data-delete-user="${u.id}">${t("teamDelete")}</button>`;
  return `
    <article class="team-user-row card${u.active ? "" : " team-user-row--restricted"}">
      <div>
        <strong>${esc(u.name || u.email)}</strong>
        ${roleTag}
        ${statusTag}
        <p class="muted">${esc(u.email)}</p>
        <p class="fineprint">${u.businessName ? esc(u.businessName) : `<span class="muted">${t("teamNoBusiness")}</span>`}</p>
        <p class="fineprint">${u.activeCustomers ?? 0} ${t("teamPools")}</p>
      </div>
      <div class="team-user-row__actions">
        <button type="button" class="btn btn--ghost btn--small" data-edit-user="${u.id}">${t("teamEditAccount")}</button>
        ${memberActions}
      </div>
    </article>
  `;
}

async function loadTeamUsers() {
  if (!admin.isSuper) return;
  const el = document.getElementById("teamUserList");
  if (!el) return;
  el.innerHTML = `<p class="muted">${t("loading")}</p>`;
  try {
    const { users } = await api("/api/admin/users");
    teamUsersCache = users;
    el.innerHTML = users.length
      ? users.map(renderTeamUser).join("")
      : `<p class="muted">${t("teamNoUsers")}</p>`;

    el.querySelectorAll("[data-edit-user]").forEach((btn) => {
      btn.addEventListener("click", () => openTeamEditModal(Number(btn.dataset.editUser)));
    });

    el.querySelectorAll("[data-restrict-user]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("teamRestrictConfirm"))) return;
        await api(`/api/admin/users/${btn.dataset.restrictUser}`, {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        });
        teamOwnerOptionsLoaded = false;
        loadTeamUsers();
      });
    });

    el.querySelectorAll("[data-restore-user]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api(`/api/admin/users/${btn.dataset.restoreUser}`, {
          method: "PATCH",
          body: JSON.stringify({ active: true }),
        });
        teamOwnerOptionsLoaded = false;
        loadTeamUsers();
      });
    });

    el.querySelectorAll("[data-reset-pwd]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const password = prompt(t("teamPwdPrompt"));
        if (!password) return;
        if (password.length < 8) {
          alert(t("teamPwdShort"));
          return;
        }
        await api(`/api/admin/users/${btn.dataset.resetPwd}`, {
          method: "PATCH",
          body: JSON.stringify({ password }),
        });
        alert(t("teamUpdated"));
      });
    });

    el.querySelectorAll("[data-delete-user]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("teamDeleteConfirm"))) return;
        await api(`/api/admin/users/${btn.dataset.deleteUser}`, { method: "DELETE" });
        teamOwnerOptionsLoaded = false;
        loadTeamUsers();
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="form-status--error">${esc(err.message)}</p>`;
  }
}

document.getElementById("teamAddForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("teamAddStatus");
  const form = e.target;
  try {
    setStatus(statusEl, t("saving"));
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value,
        businessName: form.businessName.value.trim(),
      }),
    });
    form.reset();
    teamOwnerOptionsLoaded = false;
    setStatus(statusEl, t("teamCreated"), "success");
    loadTeamUsers();
  } catch (err) {
    setStatus(statusEl, err.message, "error");
  }
});

const teamEditModal = document.getElementById("teamEditModal");
const teamEditForm = document.getElementById("teamEditForm");
const teamEditStatus = document.getElementById("teamEditStatus");

function openTeamEditModal(userId) {
  const u = teamUsersCache.find((x) => x.id === userId);
  if (!u || !teamEditForm || !teamEditModal) return;
  teamEditForm.userId.value = String(u.id);
  teamEditForm.name.value = u.name || "";
  teamEditForm.email.value = u.email || "";
  teamEditForm.businessName.value = u.businessName || "";
  teamEditForm.password.value = "";
  setStatus(teamEditStatus, "");
  teamEditModal.showModal();
}

document.getElementById("closeTeamEditModal")?.addEventListener("click", () => teamEditModal?.close());
document.getElementById("cancelTeamEdit")?.addEventListener("click", () => teamEditModal?.close());
teamEditModal?.addEventListener("click", (e) => {
  if (e.target === teamEditModal) teamEditModal.close();
});

teamEditForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = Number(teamEditForm.userId.value);
  const password = teamEditForm.password.value;
  if (password && password.length < 8) {
    setStatus(teamEditStatus, t("teamPwdShort"), "error");
    return;
  }
  try {
    setStatus(teamEditStatus, t("saving"));
    const body = {
      name: teamEditForm.name.value.trim(),
      email: teamEditForm.email.value.trim(),
      businessName: teamEditForm.businessName.value.trim(),
    };
    if (password) body.password = password;
    await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (id === admin.id) {
      admin.name = body.name;
      admin.email = body.email;
      admin.businessName = body.businessName;
      document.getElementById("adminEmail").textContent = body.email;
    }
    teamOwnerOptionsLoaded = false;
    teamEditModal.close();
    loadTeamUsers();
  } catch (err) {
    setStatus(teamEditStatus, err.message, "error");
  }
});

// ---- Messaging ----
let msgLang = "en";
let msgCustomers = [];
let msgCustomersLoaded = false;
let msgLogActiveDate = null;
const MSG_LOG_PER_DAY = 10;

function messageLogDate(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function formatLogTabDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString(adminLocale(), { weekday: "short", month: "short", day: "numeric" });
}

async function ensureMsgLogTeamOptions() {
  if (!admin.isSuper) return;
  try {
    if (!teamUsersCache.length) {
      const { users } = await api("/api/admin/users");
      teamUsersCache = users || [];
    }
    const ownerSel = document.getElementById("msgLogOwnerFilter");
    const exportSel = document.getElementById("exportUserSelect");
    const keepOwner = ownerSel?.value || "";
    const keepExport = exportSel?.value || "";
    const memberOpts = teamUsersCache
      .map((u) => `<option value="${u.id}">${esc(u.name || u.email)}</option>`)
      .join("");
    if (ownerSel) {
      ownerSel.innerHTML = `<option value="">${t("msgLogOwnerAll")}</option>${memberOpts}`;
      ownerSel.value = keepOwner;
    }
    if (exportSel) {
      exportSel.innerHTML = memberOpts;
      exportSel.value = keepExport || String(admin.userId);
    }
  } catch {
    /* filters stay empty until refresh */
  }
}

async function initMessages() {
  const dateInput = document.getElementById("msgDate");
  if (dateInput && !dateInput.value) {
    const now = new Date();
    dateInput.value = fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
  await ensureMsgLogTeamOptions();
  loadMessageLog();
  try {
    if (!msgCustomersLoaded) {
      const { customers } = await api("/api/admin/customers");
      msgCustomers = customers;
      msgCustomersLoaded = true;
    }
    const select = document.getElementById("msgCustomer");
    const keep = select.value;
    select.innerHTML =
      `<option value="">${t("selectCustomer")}</option>` +
      msgCustomers
        .map((c) => `<option value="${c.id}">${esc(c.name)}${c.phone ? "" : ` (${t("noPhone").toLowerCase()})`}</option>`)
        .join("");
    select.value = keep;
  } catch (err) {
    setStatus(document.getElementById("msgStatus"), err.message, "error");
  }
}

function updateScore(score) {
  const el = document.getElementById("msgScore");
  if (!el) return;
  if (score == null) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `${t("accuracy")} ${score}%`;
  el.classList.remove("msg-score--high", "msg-score--mid", "msg-score--low");
  el.classList.add(score >= 90 ? "msg-score--high" : score >= 75 ? "msg-score--mid" : "msg-score--low");
}

function renderMsgRecipient(c, message) {
  const phone = (c.phone || "").replace(/[^\d+]/g, "");
  const smsHref = phone ? `sms:${phone}?&body=${encodeURIComponent(message)}` : null;
  return `
    <article class="msg-recipient">
      <div>
        <strong>${esc(c.name)}</strong>
        <p class="muted">${phone ? esc(c.phone) : t("noPhone")}</p>
      </div>
      ${smsHref
        ? `<a class="btn btn--small" data-sms data-log-id="${c.id ?? ""}" data-log-name="${esc(c.name)}" data-log-phone="${esc(c.phone || "")}" href="${smsHref}">${t("text")}</a>`
        : `<span class="tag tag--warn">${t("addPhone")}</span>`}
    </article>
  `;
}

async function logMessage(entry) {
  try {
    await api("/api/admin/messages/log", { method: "POST", body: JSON.stringify(entry) });
    loadMessageLog();
  } catch {
    /* logging is best-effort; never block texting */
  }
}

function renderLogItem(m) {
  const when = new Date(m.created_at).toLocaleString(adminLocale(), { dateStyle: "medium", timeStyle: "short" });
  const lang = m.language === "es" ? t("spanish") : t("english");
  const ownerTag = admin.isSuper && m.owner_name
    ? `<span class="tag tag--owner">${esc(m.owner_name || m.owner_email || t("ownerUnknown"))}</span>`
    : "";
  return `
    <article class="msg-log__item">
      <div class="msg-log__meta">
        <strong>${esc(m.customer_name || "(no name)")}</strong>
        ${m.phone ? `<span class="muted">${esc(m.phone)}</span>` : ""}
        ${ownerTag}
        <span class="tag">${lang}</span>
        <span class="muted msg-log__time">${esc(when)}</span>
        <button type="button" class="msg-log__del" data-del-msg="${m.id}" aria-label="Delete this message" title="Delete">✕</button>
      </div>
      <p class="msg-log__sent">${esc(m.sent_text)}</p>
      ${m.original_text && m.original_text !== m.sent_text
        ? `<p class="msg-log__orig muted">${t("youWrote")} ${esc(m.original_text)}</p>`
        : ""}
    </article>
  `;
}

function groupMessagesByDate(messages) {
  const byDate = new Map();
  for (const m of messages) {
    const key = messageLogDate(m.created_at);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(m);
  }
  return byDate;
}

function renderMessageLogTabs(dates, activeDate) {
  const tabsEl = document.getElementById("msgLogTabs");
  if (!tabsEl) return;
  if (!dates.length) {
    tabsEl.hidden = true;
    tabsEl.innerHTML = "";
    return;
  }
  tabsEl.hidden = false;
  tabsEl.innerHTML = dates
    .map(({ date, count }) => {
      const active = date === activeDate ? " is-active" : "";
      const shown = Math.min(count, MSG_LOG_PER_DAY);
      const countLabel = count > MSG_LOG_PER_DAY ? `${shown}/${count}` : String(count);
      return `<button type="button" class="msg-log__tab${active}" role="tab" data-msg-date="${date}" aria-selected="${date === activeDate}">${esc(formatLogTabDate(date))}<span class="msg-log__tab-count">(${countLabel})</span></button>`;
    })
    .join("");
  tabsEl.querySelectorAll("[data-msg-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      msgLogActiveDate = btn.dataset.msgDate;
      const filter = document.getElementById("msgLogDateFilter");
      if (filter) filter.value = msgLogActiveDate;
      loadMessageLog();
    });
  });
}

async function loadMessageLog() {
  const list = document.getElementById("msgLogList");
  if (!list) return;
  const dateFilterEl = document.getElementById("msgLogDateFilter");
  const ownerFilterEl = document.getElementById("msgLogOwnerFilter");
  const jumpDate = dateFilterEl?.value || "";
  try {
    let url = "/api/admin/messages";
    if (admin.isSuper && ownerFilterEl?.value) {
      url += `?ownerId=${encodeURIComponent(ownerFilterEl.value)}`;
    }
    const { messages } = await api(url);
    const byDate = groupMessagesByDate(messages);
    const dates = [...byDate.entries()]
      .map(([date, items]) => ({ date, count: items.length }))
      .sort((a, b) => b.date.localeCompare(a.date));

    if (jumpDate && byDate.has(jumpDate)) {
      msgLogActiveDate = jumpDate;
    } else if (!msgLogActiveDate || !byDate.has(msgLogActiveDate)) {
      msgLogActiveDate = dates[0]?.date || null;
    }

    renderMessageLogTabs(dates, msgLogActiveDate);

    if (!msgLogActiveDate || !byDate.has(msgLogActiveDate)) {
      list.innerHTML = `<p class="muted">${t("noMessages")}</p>`;
      if (dateFilterEl && jumpDate && !byDate.has(jumpDate)) {
        list.innerHTML = `<p class="muted">${t("noMessages")}</p><p class="muted msg-log__hint">${esc(jumpDate)}</p>`;
      }
      return;
    }

    if (dateFilterEl) dateFilterEl.value = msgLogActiveDate;

    const dayMessages = byDate.get(msgLogActiveDate);
    const totalOnDay = dayMessages.length;
    const visible = dayMessages.slice(0, MSG_LOG_PER_DAY);
    const extra = totalOnDay - visible.length;

    list.innerHTML = `
      <p class="muted msg-log__hint">${t("msgLogPerDayHint")}${extra > 0 ? ` (${extra} ${t("msgLogMoreOnDay")})` : ""}</p>
      ${visible.map(renderLogItem).join("")}
    `;

    list.querySelectorAll("[data-del-msg]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("deleteMsgConfirm"))) return;
        try {
          await api(`/api/admin/messages/${btn.dataset.delMsg}`, { method: "DELETE" });
          loadMessageLog();
        } catch (err) {
          setStatus(document.getElementById("msgStatus"), err.message, "error");
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="form-status--error">${esc(err.message)}</p>`;
  }
}

async function composeMessage() {
  const statusEl = document.getElementById("msgStatus");
  const preview = document.getElementById("msgPreview");
  const previewText = document.getElementById("msgPreviewText");
  const recipientsEl = document.getElementById("msgRecipients");
  const text = document.getElementById("msgInput").value.trim();

  recipientsEl.innerHTML = "";
  preview.hidden = true;
  setStatus(statusEl, "");
  updateScore(null);

  if (!text) {
    setStatus(statusEl, t("writeFirst"), "error");
    return;
  }

  const mode = document.querySelector('input[name="msgMode"]:checked')?.value || "individual";
  let recipients = [];
  try {
    if (mode === "individual") {
      const id = Number(document.getElementById("msgCustomer").value);
      if (!id) { setStatus(statusEl, t("selectACustomer"), "error"); return; }
      const c = msgCustomers.find((x) => x.id === id);
      if (c) recipients = [c];
    } else {
      const date = document.getElementById("msgDate").value;
      if (!date) { setStatus(statusEl, t("pickADate"), "error"); return; }
      const { customers } = await api(`/api/admin/day?date=${date}`);
      recipients = customers;
    }
  } catch (err) {
    setStatus(statusEl, err.message, "error");
    return;
  }

  if (!recipients.length) {
    setStatus(statusEl, t("noCustomersSel"), "error");
    return;
  }

  let outgoing = text;
  setStatus(statusEl, t("polishing"));
  try {
    const { translated, score } = await api("/api/admin/translate", {
      method: "POST",
      body: JSON.stringify({ text, source: "es", target: msgLang }),
    });
    outgoing = translated || text;
    updateScore(score);
  } catch (err) {
    setStatus(statusEl, err.message, "error");
    return;
  }
  setStatus(statusEl, "");

  previewText.textContent = outgoing;
  preview.hidden = false;

  const withPhone = recipients.filter((c) => (c.phone || "").trim());
  recipientsEl.innerHTML = `
    <h3>${t("recipients")} (${recipients.length})</h3>
    <div class="msg-recipient-list">
      ${recipients.map((c) => renderMsgRecipient(c, outgoing)).join("")}
    </div>
    <p class="fineprint">${t("tapTextHint")}${
      withPhone.length < recipients.length ? t("skippedNoPhone") : "."
    }</p>
  `;

  recipientsEl.querySelectorAll("a[data-sms]").forEach((a) => {
    a.addEventListener("click", () => {
      logMessage({
        customerId: a.dataset.logId ? Number(a.dataset.logId) : null,
        customerName: a.dataset.logName || "",
        phone: a.dataset.logPhone || "",
        originalText: text,
        sentText: outgoing,
        language: msgLang,
      });
    });
  });
}

async function openMessagesForDate(dateStr) {
  switchView("messages");
  await initMessages();
  const dayRadio = document.querySelector('input[name="msgMode"][value="day"]');
  if (dayRadio) dayRadio.checked = true;
  document.getElementById("msgIndividualRow").hidden = true;
  document.getElementById("msgDayRow").hidden = false;
  document.getElementById("msgDate").value = dateStr;
  document.getElementById("msgInput").focus();
}

document.querySelectorAll("#view-messages .msg-lang [data-lang]").forEach((btn) => {
  btn.addEventListener("click", () => {
    msgLang = btn.dataset.lang;
    document.querySelectorAll("#view-messages .msg-lang [data-lang]").forEach((b) => {
      const active = b.dataset.lang === msgLang;
      b.classList.toggle("is-active", active);
      b.classList.toggle("btn--ghost", !active);
    });
  });
});

document.querySelectorAll('input[name="msgMode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const mode = document.querySelector('input[name="msgMode"]:checked')?.value;
    document.getElementById("msgIndividualRow").hidden = mode !== "individual";
    document.getElementById("msgDayRow").hidden = mode !== "day";
    document.getElementById("msgRecipients").innerHTML = "";
    document.getElementById("msgPreview").hidden = true;
  });
});

document.getElementById("msgTranslateBtn")?.addEventListener("click", composeMessage);
document.getElementById("msgLogRefresh")?.addEventListener("click", loadMessageLog);
document.getElementById("msgLogDateFilter")?.addEventListener("change", () => {
  msgLogActiveDate = document.getElementById("msgLogDateFilter")?.value || null;
  loadMessageLog();
});
document.getElementById("msgLogOwnerFilter")?.addEventListener("change", () => {
  msgLogActiveDate = null;
  loadMessageLog();
});
document.getElementById("msgLogClearAll")?.addEventListener("click", async () => {
  if (!admin.isSuper) return;
  if (!confirm(t("msgLogClearConfirm"))) return;
  try {
    const ownerId = document.getElementById("msgLogOwnerFilter")?.value || "";
    const url = ownerId
      ? `/api/admin/messages/clear?ownerId=${encodeURIComponent(ownerId)}`
      : "/api/admin/messages/clear";
    await api(url, { method: "DELETE" });
    msgLogActiveDate = null;
    loadMessageLog();
  } catch (err) {
    setStatus(document.getElementById("msgStatus"), err.message, "error");
  }
});

await Promise.all([renderCalendar(), loadStats()]);

attachAddressAutocomplete({
  street: document.getElementById("street"),
  city: document.getElementById("city"),
  state: document.getElementById("state"),
  zip: document.getElementById("zip"),
});

attachAddressAutocomplete({
  street: document.getElementById("startStreet"),
  city: document.getElementById("startCity"),
  state: document.getElementById("startState"),
  zip: document.getElementById("startZip"),
});
