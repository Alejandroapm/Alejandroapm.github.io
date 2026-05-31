import { api, requireAdmin, DAYS, DAYS_SHORT, fmtDate, esc, setStatus, formatAddress, adminPageUrl } from "../js/api-client.js";
import { loadLeaflet, createMap, drawRoute, drawCustomers, refreshMap } from "../js/admin-maps.js";
import { attachAddressAutocomplete, pickedCoordsPayload, clearPickedCoords } from "../js/address-autocomplete.js";

const admin = await requireAdmin();
if (!admin) throw new Error("redirect");

document.getElementById("adminEmail").textContent = admin.email;

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
  add: document.getElementById("view-add"),
};

const customerForm = document.getElementById("customerForm");
const formStatus = document.getElementById("formStatus");
const dayModal = document.getElementById("dayModal");

const routeDateInput = document.getElementById("routeDate");
routeDateInput.value = fmtDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
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
  showView(name);

  if (name === "customers") loadCustomerList();
  if (name === "messages") initMessages();
  if (name === "add") resetForm();
  if (name === "route") {
    loadRouteStartForm().then(() => ensureRouteMap());
  }
  if (name === "map") {
    ensureCustomerMap().then(() => loadCustomerMap());
  }
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

document.getElementById("loadRouteBtn")?.addEventListener("click", () => loadRoute(routeDateInput.value));
document.getElementById("refreshMapBtn")?.addEventListener("click", () => loadCustomerMap());

document.getElementById("routeStartForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("routeStartStatus");
  const form = e.target;
  try {
    setStatus(statusEl, "Saving…");
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
    setStatus(statusEl, "Start address saved.", "success");
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

  try {
    setStatus(formStatus, "Saving…");
    if (id) {
      await api(`/api/admin/customers/${id}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/api/admin/customers", { method: "POST", body: JSON.stringify(body) });
    }
    setStatus(formStatus, "Saved!", "success");
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

function resetForm() {
  customerForm.reset();
  document.getElementById("customerId").value = "";
  document.getElementById("formTitle").textContent = "Add customer";
  document.getElementById("activeRow").hidden = true;
  document.getElementById("state").value = "FL";
  setStatus(formStatus, "");
}

function editCustomer(c) {
  switchView("add");
  document.getElementById("formTitle").textContent = "Edit customer";
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
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function renderCalendar() {
  const title = document.getElementById("calendarTitle");
  const grid = document.getElementById("calendarGrid");
  const monthName = new Date(viewYear, viewMonth - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  title.textContent = monthName;

  const { counts } = await api(`/api/admin/calendar?year=${viewYear}&month=${viewMonth}`);
  calendarCounts = counts;

  const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const today = fmtDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

  let html = DAYS_SHORT.map((d) => `<div class="calendar-grid__head">${d}</div>`).join("");

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
        ${count ? `<span class="calendar-cell__badge">${count} pool${count === 1 ? "" : "s"}</span>` : ""}
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
    `${DAYS[d.getDay()]}, ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const body = document.getElementById("dayModalBody");
  body.innerHTML = `<p class="muted">Loading…</p>`;
  dayModal.showModal();

  const { customers } = await api(`/api/admin/day?date=${dateStr}`);
  const extraHtml = await renderAddExtraForm(dateStr);

  const routeBtn = `
    <button type="button" class="btn btn--small day-modal__route" data-route-date="${dateStr}">
      View optimized route
    </button>
  `;

  if (!customers.length) {
    body.innerHTML = `
      <p class="muted">No pools scheduled this day.</p>
      <p class="fineprint">Assign customers a weekly service day, or add a one-time extra visit below.</p>
      <h3>Add one-time visit</h3>
      ${extraHtml}
    `;
    bindExtraForm(dateStr);
    return;
  }

  body.innerHTML = `
    <div class="day-modal__toolbar">
      <p class="muted">${customers.length} pool${customers.length === 1 ? "" : "s"} on route</p>
      <button type="button" class="btn btn--ghost btn--small" data-msg-date="${dateStr}">Text customers</button>
      ${routeBtn}
    </div>
    <div class="day-list">
      ${customers.map((c) => renderDayCustomer(c, dateStr)).join("")}
    </div>
    <hr class="hr" />
    <h3>Add one-time visit</h3>
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
        ${extra ? '<span class="tag tag--extra">Extra visit</span>' : ""}
        ${skipped ? '<span class="tag tag--skip">Skipped</span>' : ""}
      </div>
      <p class="muted">${esc(formatAddress(c))}</p>
      ${c.phone ? `<p>📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></p>` : ""}
      ${c.notes ? `<p class="day-customer__notes"><strong>Notes:</strong> ${esc(c.notes)}</p>` : ""}
      <div class="day-customer__actions">
        <button type="button" class="btn btn--ghost btn--small" data-edit="${c.id}">Edit</button>
        <button type="button" class="btn btn--ghost btn--small" data-skip="${c.id}">Skip this day</button>
        ${extra ? `<button type="button" class="btn btn--ghost btn--small" data-unextra="${c.id}">Remove extra</button>` : ""}
      </div>
    </article>
  `;
}

async function renderAddExtraForm(dateStr) {
  const { customers } = await api("/api/admin/customers");
  if (!customers.length) {
    return `<p class="muted">Add customers first to schedule extra visits.</p>`;
  }
  return `
    <form class="extra-form" data-date="${dateStr}">
      <div class="form-row">
        <label>Customer</label>
        <select name="customerId" required>
          <option value="">Select customer…</option>
          ${customers.map((c) => `<option value="${c.id}">${esc(c.name)} -${DAYS[c.serviceDayOfWeek]}</option>`).join("")}
        </select>
      </div>
      <button type="submit" class="btn btn--small">Schedule extra visit</button>
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

  meta.innerHTML = `<p class="muted">Building optimized route…</p>`;
  list.innerHTML = "";
  warnings.hidden = true;

  showView("route");
  await loadRouteStartForm();
  await ensureRouteMap();

  try {
    const route = await api(`/api/admin/route?date=${dateStr}`);
    const d = new Date(`${dateStr}T12:00:00`);
    const scheduledCount = route.scheduledCount ?? route.stops?.length ?? 0;

    if (!scheduledCount) {
      meta.innerHTML = `<p class="muted"><strong>${route.dayName}</strong> -No pools scheduled for this date.</p>`;
      drawRoute(routeMap, routeLayer, { depot: route.depot, stops: [], geometry: null });
      await refreshMap(routeMap);
      return;
    }

    const stats = [];
    if (route.distanceMiles != null) stats.push(`${route.distanceMiles} mi`);
    if (route.durationMinutes != null) stats.push(`~${route.durationMinutes} min drive`);

    const startLabel = route.depot?.label ? esc(route.depot.label) : "your saved start address";

    meta.innerHTML = `
      <h2 class="route-panel__title">${route.dayName}, ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</h2>
      <p class="route-panel__stats">${scheduledCount} pool${scheduledCount === 1 ? "" : "s"} scheduled${route.stops?.length ? ` · ${route.stops.length} mapped stop${route.stops.length === 1 ? "" : "s"}` : ""}${stats.length ? ` · ${stats.join(" · ")}` : ""}</p>
      <p class="fineprint">Optimized driving order from ${startLabel}.</p>
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
      list.innerHTML = `<li class="muted">Pools are scheduled but none could be placed on the map yet.</li>`;
    }

    if (route.unmapped?.length) {
      warnings.hidden = false;
      warnings.innerHTML = `
        <p><strong>${route.unmapped.length} pool${route.unmapped.length === 1 ? "" : "s"} not on map:</strong></p>
        <ul>${route.unmapped.map((c) => `<li>${esc(c.name)} -${esc(formatAddress(c))}</li>`).join("")}</ul>
        <p class="fineprint">Edit each customer, pick their address from the Florida search results, save, then rebuild the route.</p>
      `;
    }

    drawRoute(routeMap, routeLayer, route);
    await refreshMap(routeMap);
  } catch (err) {
    meta.innerHTML = `<p class="form-status--error">${esc(err.message)}</p>`;
  }
}

async function loadCustomerMap() {
  await ensureCustomerMap();
  const metaEl = document.querySelector("#view-map .section__lead");
  metaEl.textContent = "Loading customer locations…";

  try {
    const { customers, geocoded, attempted } = await api("/api/admin/map/geocode", { method: "POST" });
    const mapped = customers.filter((c) => c.lat != null && c.lng != null);
    const unmapped = customers.length - mapped.length;

    if (attempted > 0) {
      metaEl.textContent = unmapped
        ? `Mapped ${geocoded} of ${attempted} pending address${attempted === 1 ? "" : "es"}. ${mapped.length} on map; ${unmapped} still need a verified address.`
        : `All ${customers.length} active customers mapped.`;
    } else {
      metaEl.textContent = unmapped
        ? `${mapped.length} of ${customers.length} active customers on map. ${unmapped} need a complete address.`
        : `All ${customers.length} active customers on map.`;
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
    el.innerHTML = `<p class="muted">No customers yet. Use “Add customer” to get started.</p>`;
    return;
  }

  el.innerHTML = customers.map((c) => `
    <article class="customer-row${c.active ? "" : " customer-row--inactive"}">
      <div>
        <strong>${esc(c.name)}</strong>
        <span class="tag">${DAYS[c.serviceDayOfWeek]}</span>
        ${c.active ? "" : '<span class="tag tag--skip">Inactive</span>'}
        ${c.lat != null ? '<span class="tag tag--mapped">On map</span>' : '<span class="tag tag--warn">Not mapped</span>'}
        <p class="muted">${esc(formatAddress(c))}</p>
        ${c.phone ? `<p>${esc(c.phone)}</p>` : ""}
        ${c.notes ? `<p class="customer-row__notes">${esc(c.notes)}</p>` : ""}
      </div>
      <div class="customer-row__actions">
        <button type="button" class="btn btn--ghost btn--small" data-edit-list="${c.id}">Edit</button>
        ${c.active ? `<button type="button" class="btn btn--ghost btn--small" data-deactivate="${c.id}">Deactivate</button>` : ""}
        <button type="button" class="btn btn--ghost btn--small btn--danger" data-delete="${c.id}">Remove permanently</button>
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
      if (!confirm("Deactivate this customer? They will be removed from the calendar but kept in your records.")) return;
      await api(`/api/admin/customers/${btn.dataset.deactivate}/deactivate`, { method: "PATCH" });
      loadCustomerList();
      renderCalendar();
      loadStats();
    });
  });

  el.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Permanently remove this customer? This cannot be undone and deletes all visit overrides.")) return;
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
    .map((r) => `<li><strong>${r.dayName}</strong> -${r.count} pool${r.count === 1 ? "" : "s"}</li>`)
    .join("") || "<li class='muted'>No routes yet</li>";
}

// ---- Messaging ----
let msgLang = "en";
let msgCustomers = [];
let msgCustomersLoaded = false;

async function initMessages() {
  const dateInput = document.getElementById("msgDate");
  if (dateInput && !dateInput.value) {
    const now = new Date();
    dateInput.value = fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
  loadMessageLog();
  if (msgCustomersLoaded) return;
  try {
    const { customers } = await api("/api/admin/customers");
    msgCustomers = customers;
    const select = document.getElementById("msgCustomer");
    select.innerHTML =
      `<option value="">Select customer…</option>` +
      customers
        .map((c) => `<option value="${c.id}">${esc(c.name)}${c.phone ? "" : " (no phone)"}</option>`)
        .join("");
    msgCustomersLoaded = true;
  } catch (err) {
    setStatus(document.getElementById("msgStatus"), err.message, "error");
  }
}

function renderMsgRecipient(c, message) {
  const phone = (c.phone || "").replace(/[^\d+]/g, "");
  const smsHref = phone ? `sms:${phone}?&body=${encodeURIComponent(message)}` : null;
  return `
    <article class="msg-recipient">
      <div>
        <strong>${esc(c.name)}</strong>
        <p class="muted">${phone ? esc(c.phone) : "No phone on file"}</p>
      </div>
      ${smsHref
        ? `<a class="btn btn--small" data-sms data-log-id="${c.id ?? ""}" data-log-name="${esc(c.name)}" data-log-phone="${esc(c.phone || "")}" href="${smsHref}">Text</a>`
        : `<span class="tag tag--warn">Add a phone</span>`}
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
  const when = new Date(m.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const lang = m.language === "es" ? "Spanish" : "English";
  return `
    <article class="msg-log__item">
      <div class="msg-log__meta">
        <strong>${esc(m.customer_name || "(no name)")}</strong>
        ${m.phone ? `<span class="muted">${esc(m.phone)}</span>` : ""}
        <span class="tag">${lang}</span>
        <span class="muted msg-log__time">${esc(when)}</span>
      </div>
      <p class="msg-log__sent">${esc(m.sent_text)}</p>
      ${m.original_text && m.original_text !== m.sent_text
        ? `<p class="msg-log__orig muted">You wrote: ${esc(m.original_text)}</p>`
        : ""}
    </article>
  `;
}

async function loadMessageLog() {
  const list = document.getElementById("msgLogList");
  if (!list) return;
  try {
    const { messages } = await api("/api/admin/messages");
    list.innerHTML = messages.length
      ? messages.map(renderLogItem).join("")
      : `<p class="muted">No messages logged yet.</p>`;
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

  if (!text) {
    setStatus(statusEl, "Write a message first.", "error");
    return;
  }

  const mode = document.querySelector('input[name="msgMode"]:checked')?.value || "individual";
  let recipients = [];
  try {
    if (mode === "individual") {
      const id = Number(document.getElementById("msgCustomer").value);
      if (!id) { setStatus(statusEl, "Select a customer.", "error"); return; }
      const c = msgCustomers.find((x) => x.id === id);
      if (c) recipients = [c];
    } else {
      const date = document.getElementById("msgDate").value;
      if (!date) { setStatus(statusEl, "Pick a date.", "error"); return; }
      const { customers } = await api(`/api/admin/day?date=${date}`);
      recipients = customers;
    }
  } catch (err) {
    setStatus(statusEl, err.message, "error");
    return;
  }

  if (!recipients.length) {
    setStatus(statusEl, "No customers found for that selection.", "error");
    return;
  }

  let outgoing = text;
  setStatus(statusEl, "Polishing message…");
  try {
    const { translated } = await api("/api/admin/translate", {
      method: "POST",
      body: JSON.stringify({ text, source: "es", target: msgLang }),
    });
    outgoing = translated || text;
  } catch (err) {
    setStatus(statusEl, err.message, "error");
    return;
  }
  setStatus(statusEl, "");

  previewText.textContent = outgoing;
  preview.hidden = false;

  const withPhone = recipients.filter((c) => (c.phone || "").trim());
  recipientsEl.innerHTML = `
    <h3>Recipients (${recipients.length})</h3>
    <div class="msg-recipient-list">
      ${recipients.map((c) => renderMsgRecipient(c, outgoing)).join("")}
    </div>
    <p class="fineprint">Tap “Text” to open your phone’s Messages app with the message ready to send${
      withPhone.length < recipients.length ? ". Customers without a phone number are skipped." : "."
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
