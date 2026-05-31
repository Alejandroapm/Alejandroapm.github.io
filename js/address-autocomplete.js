import { api, esc } from "./api-client.js";

function readPickedCoords(form) {
  if (!form?.dataset.geoLat || !form?.dataset.geoLng) return null;
  const lat = Number(form.dataset.geoLat);
  const lng = Number(form.dataset.geoLng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

export function clearPickedCoords(form) {
  if (!form) return;
  delete form.dataset.geoLat;
  delete form.dataset.geoLng;
}

export function pickedCoordsPayload(form) {
  const c = readPickedCoords(form);
  return c ? { lat: c.lat, lng: c.lng } : {};
}

/**
 * Florida-only address autocomplete. Fills street, city, state (FL), zip, and map coordinates.
 */
export function attachAddressAutocomplete(fields, options = {}) {
  const { street, city, state, zip } = fields;
  if (!street || !city || !state || !zip) return;

  const form = street.closest("form");
  const apiPath = options.apiPath || "/api/admin/address/suggest";
  const row = street.closest(".form-row") || street.parentElement;
  row.classList.add("address-autocomplete-wrap");

  const hint = document.createElement("p");
  hint.className = "fineprint address-autocomplete-hint";
  hint.textContent = "Search Florida addresses -city, state, and ZIP auto-fill when you pick a result.";
  row.appendChild(hint);

  const list = document.createElement("ul");
  list.className = "address-suggestions";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  row.appendChild(list);

  let timer = null;
  let activeIndex = -1;
  let suggestions = [];

  street.setAttribute("aria-autocomplete", "list");
  street.setAttribute("aria-controls", list.id || (list.id = `addr-list-${Math.random().toString(36).slice(2, 8)}`));

  state.value = "FL";
  state.readOnly = true;

  function hideList() {
    list.hidden = true;
    activeIndex = -1;
    suggestions = [];
    list.innerHTML = "";
  }

  function apply(item) {
    street.value = item.street || street.value;
    city.value = item.city || city.value;
    state.value = "FL";
    zip.value = item.zip || zip.value;
    if (form && item.lat != null && item.lng != null) {
      form.dataset.geoLat = String(item.lat);
      form.dataset.geoLng = String(item.lng);
    }
    hideList();
    street.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderItems(items) {
    suggestions = items;
    if (!items.length) {
      hideList();
      return;
    }

    list.innerHTML = items.map((item, i) => `
      <li role="option" data-index="${i}" class="address-suggestions__item${i === activeIndex ? " is-active" : ""}">
        <strong>${esc(item.street || item.label.split(",")[0])}</strong>
        <span>${esc([item.city, "FL", item.zip].filter(Boolean).join(", "))}</span>
      </li>
    `).join("");
    list.hidden = false;

    list.querySelectorAll("[data-index]").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        apply(suggestions[Number(el.dataset.index)]);
      });
    });
  }

  async function search() {
    const q = street.value.trim();
    if (q.length < 3) {
      hideList();
      return;
    }

    try {
      const data = await api(`${apiPath}?q=${encodeURIComponent(q)}`);
      renderItems(data.suggestions || []);
    } catch {
      hideList();
    }
  }

  street.addEventListener("input", () => {
    clearPickedCoords(form);
    clearTimeout(timer);
    timer = setTimeout(search, 320);
  });

  street.addEventListener("keydown", (e) => {
    if (list.hidden || !suggestions.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, suggestions.length - 1);
      renderItems(suggestions);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderItems(suggestions);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      apply(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      hideList();
    }
  });

  document.addEventListener("click", (e) => {
    if (!row.contains(e.target)) hideList();
  });
}
