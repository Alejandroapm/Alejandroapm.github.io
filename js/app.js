const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Mobile nav
const navToggle = document.getElementById("navToggle");
const navMenu = document.getElementById("navMenu");

if (navToggle && navMenu) {
  navToggle.addEventListener("click", () => {
    const open = navMenu.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(open));
  });

  navMenu.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      navMenu.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

// Before/after compare slider (range + draggable divider)
document.querySelectorAll("[data-compare]").forEach((root) => {
  const slider = root.querySelector(".compare__slider");
  const frame = root.querySelector(".compare__frame");
  const before = root.querySelector(".compare__before");
  const beforeImg = root.querySelector(".compare__before .compare__img");
  const handle = root.querySelector(".compare__handle");
  if (!slider || !frame || !before || !beforeImg || !handle) return;

  let dragging = false;

  const afterImg = root.querySelector(".compare__img--after");

  const syncImgSize = () => {
    const w = frame.offsetWidth;
    const h = frame.offsetHeight;
    beforeImg.style.width = `${w}px`;
    beforeImg.style.height = `${h}px`;
  };

  const update = (pct) => {
    const clamped = Math.min(100, Math.max(0, pct));
    before.style.width = `${clamped}%`;
    handle.style.left = `${clamped}%`;
    slider.value = String(clamped);
  };

  const pctFromClientX = (clientX) => {
    const rect = frame.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    update(pctFromClientX(e.clientX));
  };

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("is-dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const startDrag = (e) => {
    dragging = true;
    root.classList.add("is-dragging");
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture(e.pointerId);
    update(pctFromClientX(e.clientX));
    e.preventDefault();
  };

  syncImgSize();
  window.addEventListener("resize", syncImgSize);
  beforeImg.addEventListener("load", syncImgSize);
  afterImg?.addEventListener("load", syncImgSize);
  if (beforeImg.complete) syncImgSize();
  if (afterImg?.complete) syncImgSize();

  slider.addEventListener("input", () => update(Number(slider.value)));

  handle.addEventListener("pointerdown", startDrag);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);

  update(Number(slider.value));
});

// --------------------
// Language toggle (EN/ES)
// --------------------
const dict = {
  en: {
    topBadge: "Weekly Cleaning",
    topArea: "Ocoee • Kissimmee • St. Cloud • Central FL",
    topQuote: "Get a Quote",
    tagline: "Swimming Pool and Hot Tub Cleaning Service",
    menu: "Menu",
    navPlans: "Plans",
    navService: "Service",
    navBeforeAfter: "Before & After",
    navWhy: "Why Us",
    navFaq: "FAQ",
    navQuote: "Get a Quote",

    heroEyebrow: "Fully Managed Pool Care",
    heroTitle1: "Dive in.",
    heroTitle2: "We handle the rest.",
    heroLead: "Professional weekly pool and hot tub cleaning. Clear pricing, reliable scheduling, and crystal-clear water.",
    heroB1: "Skimming, brushing, vacuuming & chemistry",
    heroB2: "Filter and basket cleaning each visit",
    heroB3: "Service notes after every visit",
    heroB4: "No contracts — pay per visit, cancel anytime",
    startingAt: "Starting at",
    startingNote: "/visit · final price depends on pool size & condition",
    heroCta1: "Get Your Quote",
    heroCta2: "Call Now",
    stat1Val: "Weekly",
    stat1Label: "Reliable routes",
    stat2Val: "$100+",
    stat2Label: "Transparent pricing",
    stat3Val: "No contract",
    stat3Label: "Pay per visit only",
    stat4Val: "EN / ES",
    stat4Label: "Bilingual service",

    plansTitle: "Two ways to keep your pool beautiful",
    plansSubtitle: "Pick the plan that fits your pool. Both focus on cleaning and water quality.",
    plan1Badge: "Most Common",
    plan1Title: "Weekly Pool Cleaning",
    plan1Desc: "Regular maintenance to keep your pool sparkling all season. Same-day route when possible.",
    plan1a: "Skimming, brushing & vacuuming",
    plan1b: "Water chemistry testing & balancing",
    plan1c: "Filter & basket cleaning",
    plan1d: "Visit notes after each service",
    planFrom: "From",
    planPerVisit: "/visit",
    planCta: "Get a Quote",
    plan2Badge: "Green or Cloudy?",
    plan2Title: "Deep Clean + Weekly Service",
    plan2Desc: "Start with a thorough deep clean, then move to weekly maintenance to keep water clear.",
    plan2a: "Everything in Weekly Cleaning",
    plan2b: "Shock, algaecide & heavy debris removal",
    plan2c: "Tile line & waterline scrubbing",
    plan2d: "Multi-visit recovery when needed",
    plan2Price: "Custom quote",
    plan2Note: "based on pool condition",

    serviceTitle: "What’s included every week",
    serviceSubtitle: "One service standard for every customer - consistent cleaning you can count on.",
    weeklyChecklistTitle: "Weekly Service Checklist",
    svc1: "Pool cleaning (skim + brush walls/steps)",
    svc2: "Vacuuming every visit",
    svc3: "Chemical testing & balancing",
    svc4: "Filter cleaning (as scheduled/needed)",
    svc5: "Empty skimmer & pump baskets",
    svc6: "Service report after each visit",
    svc7: "Weekly scheduling (same service day when possible)",
    serviceFineprint: "“Starting at $100” applies to typical weekly maintenance pools. Green-to-clean or first-time deep cleans are quoted separately. No contracts — pay per visit.",
    noContractBanner: "No contracts. Weekly service with no long-term commitment — cancel or pause anytime.",

    baTitle: "See the difference",
    baSubtitle: "Drag the divider left or right to compare real pool results from our service area.",
    before: "Before",
    after: "After",
    compareLoc1: "Kissimmee, FL",
    compareLoc2: "St. Cloud, FL",
    compareLoc3: "Poinciana, FL",

    whyTitle: "Why homeowners choose MSG",
    whySubtitle: "You own a pool to relax - not to chase technicians or guess if the water is safe.",
    why1Title: "Set and forget",
    why1Text: "Weekly routes and predictable scheduling. You know service is happening - no wondering if someone will show up.",
    why2Title: "A team that knows your pool",
    why2Text: "Every pool behaves differently. Over time we learn your equipment, chemistry, and patterns - familiarity builds.",
    why3Title: "Visible service",
    why3Text: "Notes after every visit. You can see exactly what was done and how the water tested.",
    why4Title: "Flexible by design",
    why4Text: "No contracts ever. Pause, skip, or cancel with a quick message — no penalties and no lock-in.",

    howTitle: "Booked in three simple steps",
    how1Title: "Request a quote",
    how1Text: "Send your ZIP, pool type, and condition. We reply quickly with a clear price - no guessing.",
    how2Title: "Pick your start day",
    how2Text: "We add you to a weekly route in Ocoee, Davenport, Poinciana, Narcoossee, Altamonte Springs, Kissimmee, or St. Cloud.",
    how3Title: "Relax - we’ve got it",
    how3Text: "Your pool gets serviced on schedule. You receive notes so you always know the water is handled.",

    promiseTitle: "Our service promise",
    promise1Title: "Consistent weekly care",
    promise1Text: "The full checklist on every visit — skimming, brushing, vacuuming, chemistry, and filter care you can count on.",
    promise2Title: "Clear communication",
    promise2Text: "Call or text anytime. Bilingual support in English and Spanish.",
    promise3Title: "No contracts",
    promise3Text: "No long-term agreement. Pay per visit and stop anytime — no cancellation fees.",

    reviewsTitle: "What customers say",
    review1: "“Our weekly service keeps the pool ready every weekend. Always on schedule and great communication.”",
    review2: "“Crystal clear water after the deep clean. They explained everything and stayed in touch.”",
    review3: "“Fair pricing and dependable visits. Vacuuming and chemistry are on point every time.”",
    reviewAuthor1: "Robert H.",
    reviewAuthor2: "Susan M.",
    reviewAuthor3: "David K.",
    reviewLoc1: "Ocoee, FL",
    reviewLoc2: "Altamonte Springs, FL",
    reviewLoc3: "Davenport, FL",

    areaTitle: "Service area",
    areaSubtitle: "Serving Ocoee, Davenport, Poinciana, Narcoossee, Altamonte Springs, Kissimmee, and St. Cloud. Send your ZIP to confirm coverage.",
    areaListTitle: "Typical areas",
    areaCta: "Check my ZIP",
    hoursTitle: "Hours",
    hours1Label: "Mon-Sat:",
    hours1: "8am-6pm",
    hours2Label: "Sunday:",
    hours2: "Closed",
    hoursNote: "Weekly routes vary. We confirm your service day after signup.",

    faqTitle: "Pool cleaning questions, answered",
    faqQ1: "Do I need to be home during service?",
    faqA1: "No. We need access to the backyard and pool equipment. Please secure pets before we arrive.",
    faqQ2: "Do you bring chemicals?",
    faqA2: "We can use your chemicals or include them in your quote - tell us your preference when you request a price.",
    faqQ3: "Is this weekly service only?",
    faqA3: "Yes. Weekly service keeps Florida pools stable and helps prevent algae. One-time deep cleans are available before weekly service starts.",
    faqQ4: "Do you service above-ground pools and hot tubs?",
    faqA4: "Yes. We service in-ground pools, above-ground pools, and hot tubs. Mention your setup in the quote form.",
    faqQ5: "What should I do before you arrive?",
    faqA5: "Keep the water at the proper level — we take care of the rest.",
    faqQ6: "Do you do pool repairs or remodeling?",
    faqA6: "No, but we work with partners who can quote and help with your pool.",
    faqQ7: "Can you remove rust or calcium stains from the pool surface?",
    faqA7: "Yes. It requires a specific estimate depending on the damage.",

    quoteTitle: "Get your quote",
    quoteSubtitle: "Send the basics and we’ll reply quickly with pricing for your pool.",
    formName: "Name",
    formPhone: "Phone",
    formEmail: "Email",
    errRequired: "Please fill out name, email, phone, ZIP code, and pool type.",
    errEmail: "Enter a valid email address (example: you@email.com).",
    errPhone: "Enter a valid US phone number with 10 digits (example: (786) 555-1234).",
    errZip: "Enter a valid 5-digit ZIP code.",
    formZip: "ZIP Code",
    formPoolType: "Pool Type",
    formSelect: "Select…",
    formPool: "Swimming Pool",
    formHotTub: "Hot Tub",
    formBoth: "Both",
    formPlan: "Interested in",
    formPlanWeekly: "Weekly Cleaning",
    formPlanDeep: "Deep Clean + Weekly",
    formNotes: "Notes (screen enclosure, pets, trees, water condition)",
    formSubmit: "Submit Quote Request",
    formSending: "Sending…",
    formSuccess: "Thanks! Your quote request was sent. We’ll contact you soon.",
    formError: "Something went wrong. Please try again or call (786) 767-3747.",

    contactTitle: "Contact",
    contactPhone: "Phone:",
    contactEmail: "Email:",
    quoteTipsTitle: "Fast quote tips",
    tip1: "ZIP code + city",
    tip2: "Screen enclosure? (yes/no)",
    tip3: "Current condition (green, cloudy, clear)",
    tip4: "Anything special (pets, trees, hot tub)",

    footerTag: "Weekly pool & hot tub cleaning · Central Florida · No contracts",
    stickyCall: "Call",
    stickyQuote: "Get a Quote"
  },

  es: {
    topBadge: "Limpieza Semanal",
    topArea: "Ocoee • Kissimmee • St. Cloud • FL Central",
    topQuote: "Pedir Cotización",
    tagline: "Servicio de Limpieza de Piscinas y Jacuzzi",
    menu: "Menú",
    navPlans: "Planes",
    navService: "Servicio",
    navBeforeAfter: "Antes y Después",
    navWhy: "Por Qué",
    navFaq: "Preguntas",
    navQuote: "Pedir Cotización",

    heroEyebrow: "Cuidado Completo de Piscina",
    heroTitle1: "Sumérgete.",
    heroTitle2: "Nosotros nos encargamos.",
    heroLead: "Limpieza semanal profesional de piscina y jacuzzi. Precios claros, horarios confiables y agua cristalina.",
    heroB1: "Recoger basura, cepillar, aspirar y químicos",
    heroB2: "Limpieza de filtro y canastas en cada visita",
    heroB3: "Notas de servicio después de cada visita",
    heroB4: "Sin contratos — paga por visita, cancela cuando quieras",
    startingAt: "Desde",
    startingNote: "/visita · el precio final depende del tamaño y condición",
    heroCta1: "Pedir Cotización",
    heroCta2: "Llamar Ahora",
    stat1Val: "Semanal",
    stat1Label: "Rutas confiables",
    stat2Val: "$100+",
    stat2Label: "Precios claros",
    stat3Val: "Sin contrato",
    stat3Label: "Solo paga por visita",
    stat4Val: "EN / ES",
    stat4Label: "Servicio bilingüe",

    plansTitle: "Dos formas de mantener tu piscina hermosa",
    plansSubtitle: "Elige el plan que se adapte a tu piscina. Ambos se enfocan en limpieza y calidad del agua.",
    plan1Badge: "Más Común",
    plan1Title: "Limpieza Semanal",
    plan1Desc: "Mantenimiento regular para mantener tu piscina brillante toda la temporada.",
    plan1a: "Recoger basura, cepillar y aspirar",
    plan1b: "Pruebas y balance de químicos",
    plan1c: "Limpieza de filtro y canastas",
    plan1d: "Notas después de cada visita",
    planFrom: "Desde",
    planPerVisit: "/visita",
    planCta: "Pedir Cotización",
    plan2Badge: "¿Verde o Turbia?",
    plan2Title: "Limpieza Profunda + Semanal",
    plan2Desc: "Empieza con una limpieza profunda y luego pasa a mantenimiento semanal.",
    plan2a: "Todo lo de Limpieza Semanal",
    plan2b: "Shock, alguicida y remoción de basura",
    plan2c: "Limpieza de línea de agua y azulejos",
    plan2d: "Recuperación en varias visitas si hace falta",
    plan2Price: "Cotización personalizada",
    plan2Note: "según condición de la piscina",

    serviceTitle: "Qué incluye cada semana",
    serviceSubtitle: "Un solo estándar para todos - limpieza consistente en la que puedes confiar.",
    weeklyChecklistTitle: "Lista de Servicio Semanal",
    svc1: "Limpieza (recoger basura + cepillar paredes/escalones)",
    svc2: "Aspirado en cada visita",
    svc3: "Pruebas y balance de químicos",
    svc4: "Limpieza del filtro (según programación/necesidad)",
    svc5: "Vaciar canastas del skimmer y la bomba",
    svc6: "Reporte después de cada visita",
    svc7: "Programación semanal (mismo día cuando sea posible)",
    serviceFineprint: "“Desde $100” aplica a mantenimiento semanal típico. Limpiezas profundas o piscina verde se cotizan aparte. Sin contratos — paga por visita.",
    noContractBanner: "Sin contratos. Servicio semanal sin compromiso a largo plazo — cancela o pausa cuando quieras.",

    baTitle: "Mira la diferencia",
    baSubtitle: "Arrastra el divisor a la izquierda o derecha para comparar resultados reales.",
    before: "Antes",
    after: "Después",
    compareLoc1: "Kissimmee, FL",
    compareLoc2: "St. Cloud, FL",
    compareLoc3: "Poinciana, FL",

    whyTitle: "Por qué eligen MSG",
    whySubtitle: "Tienes piscina para relajarte - no para perseguir técnicos ni adivinar si el agua está bien.",
    why1Title: "Configura y olvida",
    why1Text: "Rutas semanales y horarios predecibles. Sabes que el servicio va a pasar.",
    why2Title: "Un equipo que conoce tu piscina",
    why2Text: "Cada piscina es diferente. Con el tiempo aprendemos tu equipo, químicos y patrones.",
    why3Title: "Servicio visible",
    why3Text: "Notas después de cada visita. Ves exactamente qué se hizo y cómo quedó el agua.",
    why4Title: "Flexible",
    why4Text: "Sin contratos. Pausa, salta o cancela con un mensaje — sin penalidades ni amarrarte.",

    howTitle: "Reserva en tres pasos",
    how1Title: "Pide cotización",
    how1Text: "Envía tu ZIP, tipo de piscina y condición. Respondemos rápido con un precio claro.",
    how2Title: "Elige tu día",
    how2Text: "Te agregamos a una ruta semanal en Ocoee, Davenport, Poinciana, Narcoossee, Altamonte Springs, Kissimmee o St. Cloud.",
    how3Title: "Relájate",
    how3Text: "Tu piscina se atiende en horario. Recibes notas para saber que el agua está controlada.",

    promiseTitle: "Nuestra promesa",
    promise1Title: "Cuidado semanal consistente",
    promise1Text: "La lista completa en cada visita — recoger basura, cepillar, aspirar, químicos y filtro en los que puedes confiar.",
    promise2Title: "Comunicación clara",
    promise2Text: "Llama o escribe cuando quieras. Soporte bilingüe en inglés y español.",
    promise3Title: "Sin contratos",
    promise3Text: "Sin acuerdo a largo plazo. Paga por visita y cancela cuando quieras — sin cargos por cancelación.",

    reviewsTitle: "Lo que dicen los clientes",
    review1: "“El servicio semanal mantiene la piscina lista para la familia. Siempre puntuales y muy buena comunicación.”",
    review2: "“Recuperaron nuestra piscina verde en pocos días. Profesionales y nos explicaron cada paso.”",
    review3: "“Precio justo y visitas confiables. El aspirado y los químicos siempre quedan perfectos.”",
    reviewAuthor1: "Carmen Villalobos",
    reviewAuthor2: "Miguel Rodríguez",
    reviewAuthor3: "Patricia Soto",
    reviewLoc1: "Kissimmee, FL",
    reviewLoc2: "St. Cloud, FL",
    reviewLoc3: "Poinciana, FL",

    areaTitle: "Área de servicio",
    areaSubtitle: "Servimos Ocoee, Davenport, Poinciana, Narcoossee, Altamonte Springs, Kissimmee y St. Cloud. Envía tu ZIP para confirmar.",
    areaListTitle: "Áreas típicas",
    areaCta: "Verificar mi ZIP",
    hoursTitle: "Horario",
    hours1Label: "Lun-Sáb:",
    hours1: "8am-6pm",
    hours2Label: "Domingo:",
    hours2: "Cerrado",
    hoursNote: "Las rutas semanales varían. Confirmamos tu día al registrarte.",

    faqTitle: "Preguntas sobre limpieza de piscinas",
    faqQ1: "¿Tengo que estar en casa durante el servicio?",
    faqA1: "No. Necesitamos acceso al patio y al equipo. Por favor asegura las mascotas antes de llegar.",
    faqQ2: "¿Ustedes traen químicos?",
    faqA2: "Podemos usar tus químicos o incluirlos en la cotización - indícanos tu preferencia al pedir precio.",
    faqQ3: "¿Solo ofrecen servicio semanal?",
    faqA3: "Sí. El servicio semanal mantiene las piscinas estables en Florida. Limpiezas profundas están disponibles antes de empezar el plan semanal.",
    faqQ4: "¿Atienden piscinas sobre el suelo y jacuzzis?",
    faqA4: "Sí. Atendemos piscinas enterradas, sobre el suelo y jacuzzis. Menciónalo en el formulario.",
    faqQ5: "¿Qué debo hacer antes de que lleguen?",
    faqA5: "Tener el agua en el nivel correcto; nosotros nos encargamos del resto.",
    faqQ6: "¿Se hacen reparaciones o remodelaciones de piscinas?",
    faqA6: "No, pero trabajamos con partners que pueden cotizar y ayudar con su piscina.",
    faqQ7: "¿Pueden quitar las manchas de óxido o de calcio de la superficie de las piscinas?",
    faqA7: "Sí. Requiere un estimado específico dependiendo del daño.",

    quoteTitle: "Pide tu cotización",
    quoteSubtitle: "Envía lo básico y respondemos rápido con el precio para tu piscina.",
    formName: "Nombre",
    formPhone: "Teléfono",
    formEmail: "Email",
    errRequired: "Por favor llena nombre, email, teléfono, código postal y tipo de piscina.",
    errEmail: "Ingresa un email válido (ejemplo: tu@email.com).",
    errPhone: "Ingresa un teléfono válido de EE.UU. con 10 dígitos (ejemplo: (786) 555-1234).",
    errZip: "Ingresa un código postal válido de 5 dígitos.",
    formZip: "Código Postal",
    formPoolType: "Tipo",
    formSelect: "Selecciona…",
    formPool: "Piscina",
    formHotTub: "Jacuzzi",
    formBoth: "Ambos",
    formPlan: "Interesado en",
    formPlanWeekly: "Limpieza Semanal",
    formPlanDeep: "Limpieza Profunda + Semanal",
    formNotes: "Notas (screen, mascotas, árboles, condición del agua)",
    formSubmit: "Enviar Solicitud",
    formSending: "Enviando…",
    formSuccess: "¡Gracias! Tu solicitud fue enviada. Te contactaremos pronto.",
    formError: "Algo salió mal. Intenta de nuevo o llama al (786) 767-3747.",

    contactTitle: "Contacto",
    contactPhone: "Teléfono:",
    contactEmail: "Email:",
    quoteTipsTitle: "Para cotizar rápido",
    tip1: "ZIP + ciudad",
    tip2: "¿Tiene screen? (sí/no)",
    tip3: "Condición actual (verde, turbia, clara)",
    tip4: "Algo especial (mascotas, árboles, jacuzzi)",

    footerTag: "Limpieza semanal de piscina y jacuzzi · Florida Central · Sin contratos",
    stickyCall: "Llamar",
    stickyQuote: "Cotización"
  }
};

let currentLang = "en";

function setLanguage(lang) {
  currentLang = lang;
  const map = dict[lang];
  if (!map) return;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (map[key]) el.textContent = map[key];
  });

  document.getElementById("langEN")?.classList.toggle("is-active", lang === "en");
  document.getElementById("langES")?.classList.toggle("is-active", lang === "es");
  document.documentElement.lang = lang;
  localStorage.setItem("msg_lang", lang);
}

document.getElementById("langEN")?.addEventListener("click", () => setLanguage("en"));
document.getElementById("langES")?.addEventListener("click", () => setLanguage("es"));

const savedLang = localStorage.getItem("msg_lang");
if (savedLang && dict[savedLang]) setLanguage(savedLang);

// Quote form → Web3Forms (Vanilla JS AJAX)
const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

const form = document.getElementById("quoteForm");
const statusEl = document.getElementById("formStatus");
const submitBtn = document.getElementById("formSubmitBtn");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const emailErrorEl = document.getElementById("emailError");
const phoneErrorEl = document.getElementById("phoneError");

function formMsg(key, fallback) {
  return dict[currentLang]?.[key] || dict.en[key] || fallback;
}

function setFormStatus(message, type = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.remove("form-status--success", "form-status--error");
  if (type) statusEl.classList.add(`form-status--${type}`);
}

function phoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function isValidPhone(value) {
  const digits = phoneDigits(value);
  return digits.length === 10;
}

function isValidEmail(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

function isValidZip(value) {
  return ZIP_RE.test(String(value || "").trim());
}

function setFieldError(input, errorEl, message) {
  if (!input || !errorEl) return;
  if (message) {
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    errorEl.textContent = message;
  } else {
    input.classList.remove("is-invalid");
    input.setAttribute("aria-invalid", "false");
    errorEl.textContent = "";
  }
}

function clearFieldErrors() {
  setFieldError(emailInput, emailErrorEl, "");
  setFieldError(phoneInput, phoneErrorEl, "");
}

function validateQuoteForm(data) {
  clearFieldErrors();
  let valid = true;
  let firstMessage = "";

  const required = ["name", "email", "phone", "zip", "poolType"];
  const missing = required.filter((k) => !String(data[k] || "").trim());

  if (missing.length) {
    firstMessage = formMsg("errRequired", "Please fill out all required fields.");
    valid = false;
  }

  if (data.email?.trim() && !isValidEmail(data.email)) {
    setFieldError(emailInput, emailErrorEl, formMsg("errEmail", "Enter a valid email address."));
    if (!firstMessage) firstMessage = formMsg("errEmail", "Enter a valid email address.");
    valid = false;
  } else if (!data.email?.trim()) {
    setFieldError(emailInput, emailErrorEl, formMsg("errEmail", "Email is required."));
    if (!firstMessage) firstMessage = formMsg("errRequired", "Please fill out all required fields.");
    valid = false;
  }

  if (data.phone?.trim() && !isValidPhone(data.phone)) {
    setFieldError(phoneInput, phoneErrorEl, formMsg("errPhone", "Enter a valid US phone number."));
    if (!firstMessage) firstMessage = formMsg("errPhone", "Enter a valid US phone number.");
    valid = false;
  } else if (!data.phone?.trim()) {
    setFieldError(phoneInput, phoneErrorEl, formMsg("errPhone", "Phone is required."));
    if (!firstMessage) firstMessage = formMsg("errRequired", "Please fill out all required fields.");
    valid = false;
  }

  if (data.zip?.trim() && !isValidZip(data.zip)) {
    if (!firstMessage) firstMessage = formMsg("errZip", "Enter a valid 5-digit ZIP code.");
    valid = false;
  }

  return { valid, message: firstMessage };
}

if (emailInput && emailErrorEl) {
  emailInput.addEventListener("blur", () => {
    const val = emailInput.value.trim();
    if (!val) {
      setFieldError(emailInput, emailErrorEl, "");
      return;
    }
    setFieldError(
      emailInput,
      emailErrorEl,
      isValidEmail(val) ? "" : formMsg("errEmail", "Enter a valid email address.")
    );
  });
}

if (phoneInput && phoneErrorEl) {
  phoneInput.addEventListener("blur", () => {
    const val = phoneInput.value.trim();
    if (!val) {
      setFieldError(phoneInput, phoneErrorEl, "");
      return;
    }
    setFieldError(
      phoneInput,
      phoneErrorEl,
      isValidPhone(val) ? "" : formMsg("errPhone", "Enter a valid US phone number.")
    );
  });
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const { valid, message } = validateQuoteForm(data);

    if (!valid) {
      setFormStatus(message, "error");
      const firstInvalid = form.querySelector(".is-invalid") || form.querySelector("[required]:invalid");
      firstInvalid?.focus();
      return;
    }

    const formData = new FormData(form);
    formData.set("phone", phoneDigits(data.phone));

    if (submitBtn) submitBtn.disabled = true;
    setFormStatus(formMsg("formSending", "Sending…"));

    try {
      const response = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        body: formData,
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok && result.success) {
        setFormStatus(formMsg("formSuccess", "Thanks! Your quote request was sent."), "success");
        clearFieldErrors();
        form.reset();
      } else {
        console.error("Web3Forms error:", result);
        setFormStatus(formMsg("formError", "Something went wrong. Please try again."), "error");
      }
    } catch (err) {
      console.error("Form submit failed:", err);
      setFormStatus(formMsg("formError", "Something went wrong. Please try again."), "error");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
