/**
 * Shared WorkDay UI — used by the admin dashboard and the standalone WorkDay iPhone app.
 * Both clients talk to the same /api/admin/workday/* endpoints, so changes sync automatically.
 */
import { authFetch } from "./api-client.js";

export function createWorkdayUI(deps) {
  const {
    api,
    getServerOrigin,
    setStatus,
    esc,
    fmtDate,
    t,
    dayName,
    adminLocale,
    poolsLabel,
    getBusinessName = () => "MSG Pool Services",
    els,
  } = deps;

  const { body, jobModal, navModal, exportLogBtn, closeJobModal, closeNavModal } = els;

  let workday = null;
  let workdayBusy = false;
  let jobLang = "en";
  let jobState = { stopId: null, messagePhotos: [], messageText: "", completionPhotos: [] };

  function completionText(lang, customerFirstName) {
    const sender = getBusinessName();
    if (lang === "es") {
      return `Hola${customerFirstName ? ` ${customerFirstName}` : ""}, el servicio de su piscina ya quedó completo por hoy. Todo se ve muy bien. ¡Gracias! — ${sender}`;
    }
    return `Hi${customerFirstName ? ` ${customerFirstName}` : ""}, your pool service is complete for today. Everything looks great. Thank you! — ${sender}`;
  }

  async function logMessage(entry) {
    try {
      await api("/api/admin/messages/log", { method: "POST", body: JSON.stringify(entry) });
    } catch {
      /* logging is best-effort */
    }
  }

  function getPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
      );
    });
  }

  function fmtTime(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleTimeString(adminLocale(), { hour: "numeric", minute: "2-digit" });
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "";
  }

  function activeStopIndex() {
    if (!workday?.stops) return -1;
    return workday.stops.findIndex((s) => s.status !== "completed" && s.status !== "skipped");
  }

  function findStop(id) {
    return (workday?.stops || []).find((s) => s.id === id);
  }

  function canNavigate(stop) {
    return !!(stop && (stop.address || (stop.lat != null && stop.lng != null)));
  }

  function wdDayLabel() {
    if (!workday?.date) return esc(workday?.dayName || "");
    return dayName(new Date(`${workday.date}T12:00:00`).getDay());
  }

  async function refreshFromServer() {
    try {
      const { workday: wd } = await api("/api/admin/workday/active");
      workday = wd;
      renderWorkday();
    } catch (err) {
      if (body) body.innerHTML = `<p class="form-status--error">${esc(err.message)}</p>`;
    }
  }

  async function initWorkday() {
    if (!body) return;
    body.innerHTML = `<p class="muted">${t("loading")}</p>`;
    await refreshFromServer();
  }

  function renderWorkday() {
    if (!body) return;
    if (!workday) return renderStartScreen();
    if (workday.status === "ended") return renderSummaryScreen();
    renderActiveDay();
  }

  async function renderStartScreen() {
    const today = fmtDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
    body.innerHTML = `
      <div class="workday-start card">
        <h2>${t("startTitle")}</h2>
        <p class="muted">${t("startBlurb")}</p>
        <div class="form-row">
          <label for="workdayDate">${t("date")}</label>
          <div class="date-input-wrap">
            <input type="date" id="workdayDate" value="${today}" />
          </div>
        </div>
        <p class="workday-start__count muted" id="workdayCount">${t("checkingSchedule")}</p>
        <button type="button" class="btn btn--block" id="startDayBtn">${t("startDay")}</button>
        <p class="fineprint" id="workdayStartStatus" aria-live="polite"></p>
      </div>
    `;
    const dateInput = document.getElementById("workdayDate");
    const updateCount = async () => {
      const countEl = document.getElementById("workdayCount");
      try {
        const { customers } = await api(`/api/admin/day?date=${dateInput.value}`);
        countEl.textContent = customers.length
          ? `${poolsLabel(customers.length)} ${t("poolsScheduledForDate")}`
          : t("noPoolsForDate");
      } catch {
        countEl.textContent = "";
      }
    };
    dateInput.addEventListener("change", updateCount);
    updateCount();
    document.getElementById("startDayBtn").addEventListener("click", () => startDay(dateInput.value));
  }

  async function startDay(date) {
    if (workdayBusy) return;
    const statusEl = document.getElementById("workdayStartStatus");
    const btn = document.getElementById("startDayBtn");
    workdayBusy = true;
    btn.disabled = true;
    setStatus(statusEl, t("buildingDay"));
    const coords = await getPosition();
    try {
      const { workday: wd } = await api("/api/admin/workday/start", {
        method: "POST",
        body: JSON.stringify({ date, ...(coords || {}) }),
        timeoutMs: 60000,
      });
      workday = wd;
      renderWorkday();
    } catch (err) {
      setStatus(statusEl, err.message, "error");
      btn.disabled = false;
    } finally {
      workdayBusy = false;
    }
  }

  function renderActiveDay() {
    const stops = workday.stops || [];
    const total = stops.length;
    const done = stops.filter((s) => s.status === "completed").length;
    const activeIdx = activeStopIndex();

    if (!total) {
      body.innerHTML = `
        <div class="workday-bar card">
          <div><strong>${wdDayLabel()}</strong><p class="muted">${t("noStopsRoute")}</p></div>
          <button type="button" class="btn btn--ghost btn--small" id="endDayBtn">${t("endDay")}</button>
        </div>`;
      document.getElementById("endDayBtn").addEventListener("click", endDay);
      return;
    }

    body.innerHTML = `
      <div class="workday-bar card">
        <div>
          <strong>${wdDayLabel()}</strong>
          <p class="muted">${done} ${t("of")} ${total} ${t("done")} · ${t("started")} ${esc(fmtTime(workday.startedAt))}</p>
        </div>
        <button type="button" class="btn btn--ghost btn--small" id="endDayBtn">${t("endDay")}</button>
      </div>
      <div class="workday-progress"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>
      <div class="workday-stops">
        ${stops.map((s, i) => renderStopCard(s, i, activeIdx)).join("")}
      </div>
    `;

    document.getElementById("endDayBtn").addEventListener("click", endDay);
    bindStopActions(body);
  }

  function renderStopCard(stop, idx, activeIdx) {
    const isActive = idx === activeIdx;
    const isLocked = activeIdx !== -1 && idx > activeIdx;
    const stateClass = stop.status === "completed"
      ? "is-done"
      : stop.status === "skipped"
        ? "is-skipped"
        : isActive
          ? "is-active"
          : isLocked
            ? "is-locked"
            : "";

    const badge = stop.status === "completed"
      ? `<span class="tag tag--mapped">${t("done")} ${esc(fmtTime(stop.completedAt))}</span>`
      : stop.status === "skipped"
        ? `<span class="tag tag--skip">${t("skipped")}</span>`
        : stop.status === "in_progress"
          ? `<span class="tag tag--extra">${t("inProgress")}</span>`
          : isActive
            ? `<span class="tag tag--extra">${t("nextStop")}</span>`
            : "";

    let actions = "";
    if (isActive) {
      actions = `
        <div class="workday-stop__actions">
          ${canNavigate(stop) ? `<button type="button" class="btn btn--small" data-nav="${stop.id}">${t("navigate")}</button>` : `<span class="tag tag--warn">${t("noAddress")}</span>`}
          ${stop.status === "in_progress"
            ? `<button type="button" class="btn btn--small" data-job="${stop.id}">${t("openJob")}</button>`
            : `<button type="button" class="btn btn--small" data-startjob="${stop.id}">${t("startJob")}</button>`}
          <button type="button" class="btn btn--ghost btn--small" data-job="${stop.id}">${t("completeJob")}</button>
          <button type="button" class="btn btn--ghost btn--small" data-skip="${stop.id}">${t("skip")}</button>
        </div>`;
    }

    return `
      <article class="workday-stop ${stateClass}" data-stop="${stop.id}">
        <div class="workday-stop__seq">${stop.status === "completed" ? "✓" : stop.seq}</div>
        <div class="workday-stop__main">
          <div class="workday-stop__head">
            <strong>${esc(stop.name)}</strong>
            ${badge}
          </div>
          <p class="muted">${esc(stop.address)}</p>
          ${stop.phone ? `<p class="fineprint"><a href="tel:${esc(stop.phone)}">${esc(stop.phone)}</a></p>` : ""}
          ${stop.customerNotes ? `<p class="workday-stop__note"><strong>${t("customerNote")}</strong> ${esc(stop.customerNotes)}</p>` : ""}
          ${actions}
        </div>
      </article>
    `;
  }

  function bindStopActions(scope) {
    scope.querySelectorAll("[data-nav]").forEach((b) =>
      b.addEventListener("click", () => openNavChooser(findStop(Number(b.dataset.nav))))
    );
    scope.querySelectorAll("[data-startjob]").forEach((b) =>
      b.addEventListener("click", () => doStartJob(Number(b.dataset.startjob)))
    );
    scope.querySelectorAll("[data-job]").forEach((b) =>
      b.addEventListener("click", () => openJobPanel(findStop(Number(b.dataset.job))))
    );
    scope.querySelectorAll("[data-skip]").forEach((b) =>
      b.addEventListener("click", () => skipCurrentStop(Number(b.dataset.skip)))
    );
  }

  function openNavChooser(stop) {
    if (!canNavigate(stop) || !navModal) return;
    const titleEl = document.getElementById("navModalTitle");
    if (titleEl) titleEl.textContent = `${t("navigateTo")} ${stop.name}`;
    const dest = stop.address ? encodeURIComponent(stop.address) : `${stop.lat},${stop.lng}`;
    const apps = [
      { name: t("googleMaps"), href: `https://www.google.com/maps/dir/?api=1&destination=${dest}` },
      { name: t("appleMaps"), href: `https://maps.apple.com/?daddr=${dest}` },
      { name: t("waze"), href: `https://waze.com/ul?q=${dest}&navigate=yes` },
      { name: t("otherMaps"), href: `geo:0,0?q=${dest}` },
    ];
    const modalBody = document.getElementById("navModalBody");
    modalBody.innerHTML = apps
      .map((a) => `<a class="btn btn--block sheet__option" target="_blank" rel="noopener" href="${a.href}">${a.name}</a>`)
      .join("");

    modalBody.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", async () => {
        navModal.close();
        const coords = await getPosition();
        try {
          await api(`/api/admin/workday/${workday.id}/navigate`, {
            method: "POST",
            body: JSON.stringify({ stopId: stop.id, ...(coords || {}) }),
          });
        } catch { /* best-effort */ }
      });
    });
    navModal.showModal();
  }

  async function doStartJob(stopId) {
    const coords = await getPosition();
    try {
      const { workday: wd } = await api(`/api/admin/workday/stop/${stopId}/start`, {
        method: "POST",
        body: JSON.stringify(coords || {}),
      });
      workday = wd;
      renderWorkday();
      openJobPanel(findStop(stopId));
    } catch (err) {
      alert(err.message);
    }
  }

  async function skipCurrentStop(stopId) {
    if (!confirm(t("skipStopConfirm"))) return;
    const coords = await getPosition();
    try {
      const { workday: wd } = await api(`/api/admin/workday/stop/${stopId}/skip`, {
        method: "POST",
        body: JSON.stringify(coords || {}),
      });
      workday = wd;
      renderWorkday();
    } catch (err) {
      alert(err.message);
    }
  }

  function openJobPanel(stop) {
    if (!stop || !jobModal) return;
    jobState = { stopId: stop.id, messagePhotos: [], messageText: "", completionPhotos: [] };
    const titleEl = document.getElementById("jobModalTitle");
    if (titleEl) titleEl.textContent = stop.name;

    const langBtns = () => `
      <div class="msg-lang">
        <button type="button" class="btn btn--small ${jobLang === "en" ? "is-active" : "btn--ghost"}" data-job-lang="en">${t("english")}</button>
        <button type="button" class="btn btn--small ${jobLang === "es" ? "is-active" : "btn--ghost"}" data-job-lang="es">${t("spanish")}</button>
      </div>`;

    document.getElementById("jobModalBody").innerHTML = `
      <p class="muted job-modal__addr">${esc(stop.address)}</p>
      ${canNavigate(stop) ? `<button type="button" class="btn btn--ghost btn--small" id="jobNavBtn">${t("navigateHere")}</button>` : ""}
      ${stop.customerNotes ? `<div class="job-callout"><strong>${t("customerNote")}</strong> ${esc(stop.customerNotes)}</div>` : ""}

      <div class="form-row">
        <label for="jobNotes">${t("yourPrivateNotes")}</label>
        <textarea id="jobNotes" rows="3" placeholder="${esc(t("notesPh"))}">${esc(stop.notes || "")}</textarea>
        <p class="fineprint" id="jobNotesStatus" aria-live="polite"></p>
      </div>

      <hr class="hr" />

      <div class="job-section">
        <h3>${t("message")} ${esc(firstName(stop.name)) || t("customer").toLowerCase()}</h3>
        <p class="fineprint">${t("msgJobBlurb")}</p>
        <textarea id="jobMsgInput" rows="3" placeholder="${esc(t("msgJobPh"))}"></textarea>
        <label class="fineprint">${t("receiveIn")}</label>
        ${langBtns()}
        <div class="job-photos">
          <label class="btn btn--ghost btn--small job-photo-add">
            ${t("addPhoto")}
            <input type="file" accept="image/*" capture="environment" multiple hidden id="jobMsgPhotos" />
          </label>
          <div class="job-photo-thumbs" id="jobMsgThumbs"></div>
        </div>
        <button type="button" class="btn btn--small" id="jobMsgPreviewBtn">${t("previewPrepare")}</button>
        <div class="msg-preview" id="jobMsgPreview" hidden>
          <label>${t("customerWillReceive")}</label>
          <p class="msg-preview__text" id="jobMsgPreviewText"></p>
        </div>
        <button type="button" class="btn btn--block" id="jobMsgShareBtn" hidden>${t("shareToCustomer")}</button>
        <p class="fineprint" id="jobMsgStatus" aria-live="polite"></p>
      </div>

      <hr class="hr" />

      <div class="job-section job-section--complete">
        <h3>${t("completeJobH")}</h3>
        <p class="fineprint">${t("completeBlurb")}</p>
        <textarea id="jobDoneMsg" rows="3">${esc(completionText(jobLang, firstName(stop.name)))}</textarea>
        ${langBtns()}
        <div class="job-photos">
          <label class="btn btn--ghost btn--small job-photo-add">
            ${t("addPoolPhoto")}
            <input type="file" accept="image/*" capture="environment" multiple hidden id="jobDonePhotos" />
          </label>
          <div class="job-photo-thumbs" id="jobDoneThumbs"></div>
        </div>
        <button type="button" class="btn btn--ghost btn--block" id="jobDoneShareBtn">${t("shareCompletion")}</button>
        <button type="button" class="btn btn--block" id="jobCompleteBtn">${t("markComplete")}</button>
        <p class="fineprint" id="jobDoneStatus" aria-live="polite"></p>
      </div>
    `;

    bindJobPanel(stop);
    jobModal.showModal();
  }

  function renderThumbs(container, files, onRemove) {
    container.innerHTML = files
      .map((f, i) => `<div class="job-thumb"><img src="${URL.createObjectURL(f)}" alt="" /><button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`)
      .join("");
    container.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", () => onRemove(Number(b.dataset.rm)))
    );
  }

  function bindJobPanel(stop) {
    document.getElementById("jobNavBtn")?.addEventListener("click", () => openNavChooser(stop));

    const notesEl = document.getElementById("jobNotes");
    let notesTimer = null;
    notesEl.addEventListener("input", () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(async () => {
        try {
          await api(`/api/admin/workday/stop/${stop.id}/notes`, {
            method: "POST",
            body: JSON.stringify({ notes: notesEl.value }),
          });
          const local = findStop(stop.id);
          if (local) local.notes = notesEl.value;
          setStatus(document.getElementById("jobNotesStatus"), t("savedShort"), "success");
        } catch {
          setStatus(document.getElementById("jobNotesStatus"), t("notesSaveErr"), "error");
        }
      }, 700);
    });

    document.querySelectorAll("#jobModalBody [data-job-lang]").forEach((b) =>
      b.addEventListener("click", () => {
        jobLang = b.dataset.jobLang;
        document.querySelectorAll("#jobModalBody [data-job-lang]").forEach((x) => {
          const active = x.dataset.jobLang === jobLang;
          x.classList.toggle("is-active", active);
          x.classList.toggle("btn--ghost", !active);
        });
        document.getElementById("jobDoneMsg").value = completionText(jobLang, firstName(stop.name));
        document.getElementById("jobMsgPreview").hidden = true;
        document.getElementById("jobMsgShareBtn").hidden = true;
      })
    );

    const msgThumbs = document.getElementById("jobMsgThumbs");
    const rerenderMsgThumbs = () =>
      renderThumbs(msgThumbs, jobState.messagePhotos, (i) => {
        jobState.messagePhotos.splice(i, 1);
        rerenderMsgThumbs();
      });
    document.getElementById("jobMsgPhotos").addEventListener("change", (e) => {
      jobState.messagePhotos.push(...Array.from(e.target.files || []));
      rerenderMsgThumbs();
      e.target.value = "";
    });

    const doneThumbs = document.getElementById("jobDoneThumbs");
    const rerenderDoneThumbs = () =>
      renderThumbs(doneThumbs, jobState.completionPhotos, (i) => {
        jobState.completionPhotos.splice(i, 1);
        rerenderDoneThumbs();
      });
    document.getElementById("jobDonePhotos").addEventListener("change", (e) => {
      jobState.completionPhotos.push(...Array.from(e.target.files || []));
      rerenderDoneThumbs();
      e.target.value = "";
    });

    document.getElementById("jobMsgPreviewBtn").addEventListener("click", async () => {
      const statusEl = document.getElementById("jobMsgStatus");
      const text = document.getElementById("jobMsgInput").value.trim();
      if (!text) { setStatus(statusEl, t("writeFirst"), "error"); return; }
      setStatus(statusEl, t("polishing"));
      try {
        const { translated } = await api("/api/admin/translate", {
          method: "POST",
          body: JSON.stringify({ text, source: "es", target: jobLang }),
        });
        jobState.messageText = translated || text;
        document.getElementById("jobMsgPreviewText").textContent = jobState.messageText;
        document.getElementById("jobMsgPreview").hidden = false;
        document.getElementById("jobMsgShareBtn").hidden = false;
        setStatus(statusEl, "");
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });

    document.getElementById("jobMsgShareBtn").addEventListener("click", async () => {
      const statusEl = document.getElementById("jobMsgStatus");
      const text = jobState.messageText || document.getElementById("jobMsgInput").value.trim();
      if (!text) return;
      const res = await shareToCustomer({ phone: stop.phone, text, files: jobState.messagePhotos });
      reportShare(statusEl, res, jobState.messagePhotos.length);
      if (res.shared) {
        logMessage({
          customerId: stop.customerId || null,
          customerName: stop.name,
          phone: stop.phone || "",
          originalText: document.getElementById("jobMsgInput").value.trim(),
          sentText: text,
          language: jobLang,
        });
      }
    });

    document.getElementById("jobDoneShareBtn").addEventListener("click", async () => {
      const statusEl = document.getElementById("jobDoneStatus");
      const text = document.getElementById("jobDoneMsg").value.trim();
      const res = await shareToCustomer({ phone: stop.phone, text, files: jobState.completionPhotos });
      reportShare(statusEl, res, jobState.completionPhotos.length);
      if (res.shared) {
        logMessage({
          customerId: stop.customerId || null,
          customerName: stop.name,
          phone: stop.phone || "",
          originalText: "(completion message)",
          sentText: text,
          language: jobLang,
        });
      }
    });

    document.getElementById("jobCompleteBtn").addEventListener("click", () => doComplete(stop.id, notesEl.value));
  }

  function reportShare(statusEl, res, photoCount) {
    if (res.cancelled) { setStatus(statusEl, t("shareCancelled"), ""); return; }
    if (!res.shared) { setStatus(statusEl, t("shareNeedPhone"), "error"); return; }
    if (res.viaSms) {
      setStatus(statusEl, t("smsOpened"), "success");
    } else if (photoCount && res.withFiles) {
      setStatus(statusEl, t("photoReady"), "success");
    } else if (photoCount && !res.withFiles) {
      setStatus(statusEl, t("photoNoAttach"), "");
    } else {
      setStatus(statusEl, t("openedApp"), "success");
    }
  }

  async function shareToCustomer({ phone, text, files = [] }) {
    const cleanPhone = (phone || "").replace(/[^\d+]/g, "");
    const canFiles = files.length > 0 && navigator.canShare && navigator.canShare({ files });

    if (navigator.share && (canFiles || !cleanPhone)) {
      try {
        await navigator.share(canFiles ? { text, files } : { text });
        return { shared: true, withFiles: !!canFiles };
      } catch (err) {
        if (err && err.name === "AbortError") return { shared: false, cancelled: true };
      }
    }

    if (cleanPhone) {
      window.location.href = `sms:${cleanPhone}?&body=${encodeURIComponent(text)}`;
      return { shared: true, withFiles: false, viaSms: true };
    }

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return { shared: true, withFiles: false };
      } catch (err) {
        if (err && err.name === "AbortError") return { shared: false, cancelled: true };
      }
    }
    return { shared: false };
  }

  async function doComplete(stopId, notes) {
    const coords = await getPosition();
    try {
      const { workday: wd } = await api(`/api/admin/workday/stop/${stopId}/complete`, {
        method: "POST",
        body: JSON.stringify({ notes: notes || "", ...(coords || {}) }),
      });
      workday = wd;
      jobModal.close();
      renderWorkday();
    } catch (err) {
      setStatus(document.getElementById("jobDoneStatus"), err.message, "error");
    }
  }

  async function endDay() {
    if (!workday || !confirm(t("endDayConfirm"))) return;
    const coords = await getPosition();
    try {
      const { workday: wd } = await api(`/api/admin/workday/${workday.id}/end`, {
        method: "POST",
        body: JSON.stringify(coords || {}),
      });
      workday = wd;
      renderWorkday();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderSummaryScreen() {
    const stops = workday.stops || [];
    const done = stops.filter((s) => s.status === "completed").length;
    const skipped = stops.filter((s) => s.status === "skipped").length;
    const mins = workday.startedAt && workday.endedAt ? Math.round((workday.endedAt - workday.startedAt) / 60000) : null;
    const hrs = mins != null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "—";
    body.innerHTML = `
      <div class="workday-summary card">
        <h2>${t("dayComplete")}</h2>
        <div class="workday-summary__grid">
          <div><span class="workday-summary__num">${done}</span><span class="muted">${t("jobsDone")}</span></div>
          <div><span class="workday-summary__num">${skipped}</span><span class="muted">${t("skipped").toLowerCase()}</span></div>
          <div><span class="workday-summary__num">${workday.totalMiles ?? 0}</span><span class="muted">${t("miles")}</span></div>
          <div><span class="workday-summary__num">${hrs}</span><span class="muted">${t("onTheRoad")}</span></div>
        </div>
        <button type="button" class="btn btn--block" id="exportLogBtn2">${t("downloadCsv")}</button>
        <button type="button" class="btn btn--ghost btn--block" id="newDayBtn">${t("startNewDay")}</button>
      </div>
    `;
    document.getElementById("exportLogBtn2").addEventListener("click", downloadWorkLog);
    document.getElementById("newDayBtn").addEventListener("click", () => { workday = null; renderWorkday(); });
  }

  async function downloadWorkLog() {
    try {
      const res = await authFetch("/api/admin/workday/export.csv");
      if (!res.ok) throw new Error("Could not download work log.");
      const disp = res.headers.get("Content-Disposition") || "";
      const match = disp.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `workday-log-${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  }

  function bindModals() {
    exportLogBtn?.addEventListener("click", downloadWorkLog);
    closeJobModal?.addEventListener("click", () => jobModal?.close());
    closeNavModal?.addEventListener("click", () => navModal?.close());
    jobModal?.addEventListener("click", (e) => { if (e.target === jobModal) jobModal.close(); });
    navModal?.addEventListener("click", (e) => { if (e.target === navModal) navModal.close(); });
  }

  function bindSync() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && workday?.status === "active") {
        refreshFromServer();
      }
    });
  }

  bindModals();
  bindSync();

  return {
    init: initWorkday,
    render: renderWorkday,
    refresh: refreshFromServer,
    downloadWorkLog,
  };
}
