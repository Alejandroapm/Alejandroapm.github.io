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

  const syncImgWidth = () => {
    beforeImg.style.width = `${frame.offsetWidth}px`;
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

  syncImgWidth();
  window.addEventListener("resize", syncImgWidth);
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
    topArea: "Kissimmee • St. Cloud • Orlando Area",
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
    heroLead: "Professional weekly pool and hot tub cleaning. Clear pricing, reliable scheduling, and crystal-clear water — cleaning only, no repairs.",
    heroB1: "Skimming, brushing, vacuuming & chemistry",
    heroB2: "Filter and basket cleaning each visit",
    heroB3: "Service notes after every visit",
    heroB4: "No long-term contracts — cancel anytime",
    startingAt: "Starting at",
    startingNote: "/visit · final price depends on pool size & condition",
    heroCta1: "Get Your Quote",
    heroCta2: "Call Now",
    stat1Val: "Weekly",
    stat1Label: "Reliable routes",
    stat2Val: "$90+",
    stat2Label: "Transparent pricing",
    stat3Val: "Local",
    stat3Label: "Kissimmee area pros",
    stat4Val: "EN / ES",
    stat4Label: "Bilingual service",

    plansTitle: "Two ways to keep your pool beautiful",
    plansSubtitle: "Pick the plan that fits your pool. Both focus on cleaning and water quality — not repairs.",
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
    serviceSubtitle: "One service standard for every customer — consistent cleaning you can count on.",
    weeklyChecklistTitle: "Weekly Service Checklist",
    svc1: "Pool cleaning (skim + brush walls/steps)",
    svc2: "Vacuum as needed",
    svc3: "Chemical testing & balancing",
    svc4: "Filter cleaning (as scheduled/needed)",
    svc5: "Empty skimmer & pump baskets",
    svc6: "Service report after each visit",
    svc7: "Weekly scheduling (same service day when possible)",
    serviceFineprint: "“Starting at $90” applies to typical weekly maintenance pools. Green-to-clean or first-time deep cleans are quoted separately.",

    baTitle: "See the difference",
    baSubtitle: "Drag the divider left or right to compare real pool results from our service area.",
    before: "Before",
    after: "After",
    gallery1: "Weekly maintenance",
    gallery2: "Hot tub care",

    whyTitle: "Why homeowners choose MSG",
    whySubtitle: "You own a pool to relax — not to chase technicians or guess if the water is safe.",
    why1Title: "Set and forget",
    why1Text: "Weekly routes and predictable scheduling. You know service is happening — no wondering if someone will show up.",
    why2Title: "A team that knows your pool",
    why2Text: "Every pool behaves differently. Over time we learn your equipment, chemistry, and patterns — familiarity builds.",
    why3Title: "Visible service",
    why3Text: "Notes after every visit. You can see exactly what was done and how the water tested.",
    why4Title: "Flexible by design",
    why4Text: "No long-term contracts. Pause, skip, or cancel with a quick message — no awkward calls.",

    howTitle: "Booked in three simple steps",
    how1Title: "Request a quote",
    how1Text: "Send your ZIP, pool type, and condition. We reply quickly with a clear price — no guessing.",
    how2Title: "Pick your start day",
    how2Text: "We add you to a weekly route in Kissimmee, St. Cloud, Poinciana, or nearby Orlando areas.",
    how3Title: "Relax — we’ve got it",
    how3Text: "Your pool gets serviced on schedule. You receive notes so you always know the water is handled.",

    promiseTitle: "Our service promise",
    promise1Title: "We make it right",
    promise1Text: "If something isn’t right after a visit, tell us within a few days — we’ll return to fix it.",
    promise2Title: "Clear communication",
    promise2Text: "Call or text anytime. Bilingual support in English and Spanish.",
    promise3Title: "No contracts",
    promise3Text: "Stay because the water stays clear — not because you’re locked in.",

    reviewsTitle: "What customers say",
    review1: "“Consistent weekly service and the water finally stays clear. Great communication after every visit.”",
    review2: "“They brought our cloudy pool back fast and set us on a weekly plan. Professional and on time.”",
    review3: "“Hot tub and pool both handled weekly. Fair price and no repair upsells — exactly what we needed.”",
    reviewLoc1: "Kissimmee, FL",
    reviewLoc2: "St. Cloud, FL",
    reviewLoc3: "Poinciana, FL",

    areaTitle: "Service area",
    areaSubtitle: "Kissimmee and nearby communities. Send your ZIP code to confirm coverage.",
    areaListTitle: "Typical areas",
    areaCta: "Check my ZIP",
    hoursTitle: "Hours",
    hours1Label: "Mon–Sat:",
    hours1: "8am–6pm",
    hours2Label: "Sunday:",
    hours2: "Closed",
    hoursNote: "Weekly routes vary. We confirm your service day after signup.",

    faqTitle: "Pool cleaning questions, answered",
    faqQ1: "Do I need to be home during service?",
    faqA1: "No. We need access to the backyard and pool equipment. Please secure pets before we arrive.",
    faqQ2: "Do you bring chemicals?",
    faqA2: "We can use your chemicals or include them in your quote — tell us your preference when you request a price.",
    faqQ3: "Is this weekly service only?",
    faqA3: "Yes. Weekly service keeps Florida pools stable and helps prevent algae. One-time deep cleans are available before weekly service starts.",
    faqQ4: "How long does each visit take?",
    faqA4: "Most weekly visits take 30 minutes to 2 hours depending on pool size, debris, and enclosure. Deep cleans may take longer.",
    faqQ5: "Do you service above-ground pools and hot tubs?",
    faqA5: "Yes. We service in-ground pools, above-ground pools, and hot tubs. Mention your setup in the quote form.",
    faqQ6: "What should I do before you arrive?",
    faqA6: "Clear the pool area, make sure the pump and filter are running, and keep pets away from the backyard during service.",

    quoteTitle: "Get your quote",
    quoteSubtitle: "Send the basics and we’ll reply quickly with pricing for your pool.",
    formName: "Name",
    formPhone: "Phone",
    formEmail: "Email (optional)",
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

    contactTitle: "Contact",
    contactPhone: "Phone:",
    contactEmail: "Email:",
    quoteTipsTitle: "Fast quote tips",
    tip1: "ZIP code + city",
    tip2: "Screen enclosure? (yes/no)",
    tip3: "Current condition (green, cloudy, clear)",
    tip4: "Anything special (pets, trees, hot tub)",

    footerTag: "Weekly pool & hot tub cleaning · Kissimmee area",
    stickyCall: "Call",
    stickyQuote: "Get a Quote"
  },

  es: {
    topBadge: "Limpieza Semanal",
    topArea: "Kissimmee • St. Cloud • Área de Orlando",
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
    heroLead: "Limpieza semanal profesional de piscina y jacuzzi. Precios claros, horarios confiables y agua cristalina — solo limpieza, sin reparaciones.",
    heroB1: "Recoger basura, cepillar, aspirar y químicos",
    heroB2: "Limpieza de filtro y canastas en cada visita",
    heroB3: "Notas de servicio después de cada visita",
    heroB4: "Sin contratos largos — cancela cuando quieras",
    startingAt: "Desde",
    startingNote: "/visita · el precio final depende del tamaño y condición",
    heroCta1: "Pedir Cotización",
    heroCta2: "Llamar Ahora",
    stat1Val: "Semanal",
    stat1Label: "Rutas confiables",
    stat2Val: "$90+",
    stat2Label: "Precios claros",
    stat3Val: "Local",
    stat3Label: "Área Kissimmee",
    stat4Val: "EN / ES",
    stat4Label: "Servicio bilingüe",

    plansTitle: "Dos formas de mantener tu piscina hermosa",
    plansSubtitle: "Elige el plan que se adapte a tu piscina. Ambos se enfocan en limpieza y calidad del agua — no reparaciones.",
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
    serviceSubtitle: "Un solo estándar para todos — limpieza consistente en la que puedes confiar.",
    weeklyChecklistTitle: "Lista de Servicio Semanal",
    svc1: "Limpieza (recoger basura + cepillar paredes/escalones)",
    svc2: "Aspirado según sea necesario",
    svc3: "Pruebas y balance de químicos",
    svc4: "Limpieza del filtro (según programación/necesidad)",
    svc5: "Vaciar canastas del skimmer y la bomba",
    svc6: "Reporte después de cada visita",
    svc7: "Programación semanal (mismo día cuando sea posible)",
    serviceFineprint: "“Desde $90” aplica a mantenimiento semanal típico. Limpiezas profundas o piscina verde se cotizan aparte.",

    baTitle: "Mira la diferencia",
    baSubtitle: "Arrastra el divisor a la izquierda o derecha para comparar resultados reales.",
    before: "Antes",
    after: "Después",
    gallery1: "Mantenimiento semanal",
    gallery2: "Cuidado de jacuzzi",

    whyTitle: "Por qué eligen MSG",
    whySubtitle: "Tienes piscina para relajarte — no para perseguir técnicos ni adivinar si el agua está bien.",
    why1Title: "Configura y olvida",
    why1Text: "Rutas semanales y horarios predecibles. Sabes que el servicio va a pasar.",
    why2Title: "Un equipo que conoce tu piscina",
    why2Text: "Cada piscina es diferente. Con el tiempo aprendemos tu equipo, químicos y patrones.",
    why3Title: "Servicio visible",
    why3Text: "Notas después de cada visita. Ves exactamente qué se hizo y cómo quedó el agua.",
    why4Title: "Flexible",
    why4Text: "Sin contratos largos. Pausa, salta o cancela con un mensaje rápido.",

    howTitle: "Reserva en tres pasos",
    how1Title: "Pide cotización",
    how1Text: "Envía tu ZIP, tipo de piscina y condición. Respondemos rápido con un precio claro.",
    how2Title: "Elige tu día",
    how2Text: "Te agregamos a una ruta semanal en Kissimmee, St. Cloud, Poinciana u Orlando cercano.",
    how3Title: "Relájate",
    how3Text: "Tu piscina se atiende en horario. Recibes notas para saber que el agua está controlada.",

    promiseTitle: "Nuestra promesa",
    promise1Title: "Lo arreglamos",
    promise1Text: "Si algo no está bien después de una visita, avísanos en pocos días — volvemos a corregirlo.",
    promise2Title: "Comunicación clara",
    promise2Text: "Llama o escribe cuando quieras. Soporte bilingüe en inglés y español.",
    promise3Title: "Sin contratos",
    promise3Text: "Quédate porque el agua se mantiene clara — no porque estés amarrado.",

    reviewsTitle: "Lo que dicen los clientes",
    review1: "“Servicio semanal consistente y el agua por fin se mantiene clara. Buena comunicación después de cada visita.”",
    review2: "“Recuperaron nuestra piscina turbia rápido y nos pusieron en plan semanal. Profesionales y puntuales.”",
    review3: "“Jacuzzi y piscina cada semana. Precio justo y sin venta de reparaciones — justo lo que necesitábamos.”",
    reviewLoc1: "Kissimmee, FL",
    reviewLoc2: "St. Cloud, FL",
    reviewLoc3: "Poinciana, FL",

    areaTitle: "Área de servicio",
    areaSubtitle: "Kissimmee y comunidades cercanas. Envía tu ZIP para confirmar cobertura.",
    areaListTitle: "Áreas típicas",
    areaCta: "Verificar mi ZIP",
    hoursTitle: "Horario",
    hours1Label: "Lun–Sáb:",
    hours1: "8am–6pm",
    hours2Label: "Domingo:",
    hours2: "Cerrado",
    hoursNote: "Las rutas semanales varían. Confirmamos tu día al registrarte.",

    faqTitle: "Preguntas sobre limpieza de piscinas",
    faqQ1: "¿Tengo que estar en casa durante el servicio?",
    faqA1: "No. Necesitamos acceso al patio y al equipo. Por favor asegura las mascotas antes de llegar.",
    faqQ2: "¿Ustedes traen químicos?",
    faqA2: "Podemos usar tus químicos o incluirlos en la cotización — indícanos tu preferencia al pedir precio.",
    faqQ3: "¿Solo ofrecen servicio semanal?",
    faqA3: "Sí. El servicio semanal mantiene las piscinas estables en Florida. Limpiezas profundas están disponibles antes de empezar el plan semanal.",
    faqQ4: "¿Cuánto dura cada visita?",
    faqA4: "La mayoría de visitas semanales toman de 30 minutos a 2 horas según tamaño, basura y screen. Limpiezas profundas pueden tardar más.",
    faqQ5: "¿Atienden piscinas sobre el suelo y jacuzzis?",
    faqA5: "Sí. Atendemos piscinas enterradas, sobre el suelo y jacuzzis. Menciónalo en el formulario.",
    faqQ6: "¿Qué debo hacer antes de que lleguen?",
    faqA6: "Despeja el área, asegúrate de que bomba y filtro estén funcionando, y mantén mascotas lejos del patio.",

    quoteTitle: "Pide tu cotización",
    quoteSubtitle: "Envía lo básico y respondemos rápido con el precio para tu piscina.",
    formName: "Nombre",
    formPhone: "Teléfono",
    formEmail: "Email (opcional)",
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

    contactTitle: "Contacto",
    contactPhone: "Teléfono:",
    contactEmail: "Email:",
    quoteTipsTitle: "Para cotizar rápido",
    tip1: "ZIP + ciudad",
    tip2: "¿Tiene screen? (sí/no)",
    tip3: "Condición actual (verde, turbia, clara)",
    tip4: "Algo especial (mascotas, árboles, jacuzzi)",

    footerTag: "Limpieza semanal de piscina y jacuzzi · Área Kissimmee",
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

// Quote form
const form = document.getElementById("quoteForm");
const statusEl = document.getElementById("formStatus");

if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());

    const required = ["name", "phone", "zip", "poolType"];
    const missing = required.filter((k) => !String(data[k] || "").trim());

    if (missing.length) {
      if (statusEl) {
        statusEl.textContent = currentLang === "es"
          ? "Por favor llena nombre, teléfono, ZIP y tipo."
          : "Please fill out name, phone, ZIP, and pool type.";
      }
      return;
    }

    const mailSubject = encodeURIComponent("MSG Pool Services — Quote Request");
    const mailBody = encodeURIComponent(
      `Name: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email || "—"}\nZIP: ${data.zip}\nPool Type: ${data.poolType}\nPlan: ${data.plan || "weekly"}\nNotes:\n${data.message || "—"}`
    );

    if (statusEl) {
      statusEl.textContent = currentLang === "es"
        ? "¡Gracias! Abriendo tu correo para enviar la solicitud…"
        : "Thanks! Opening your email app to send the request…";
    }

    window.location.href = `mailto:msgpoolservices2026@gmail.com?subject=${mailSubject}&body=${mailBody}`;
    form.reset();
  });
}
