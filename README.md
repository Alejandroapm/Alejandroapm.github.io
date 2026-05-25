# MSG Pool Services Website

A single-page marketing site for **MSG Pool Services** - weekly pool and hot tub cleaning in the Kissimmee / Orlando area.

## Run locally

Open `index.html` in your browser, or use a simple local server:

```bash
npx serve .
```

## Project structure

```
mayelin/
├── index.html      # Main page
├── css/styles.css  # Styles
├── js/app.js       # Nav, i18n (EN/ES), compare slider, quote form
└── assets/         # Header_image.png, Slider_*_*.png, logo
```

## Customize

- **Photos:** `Header_image.png` (hero background), `Slider_1_1.png` / `Slider_1_2.png` (before/after; pairs 2 and 3 for additional sliders).
- **Pricing:** Update `$100` in `index.html` and copy in `js/app.js`.
- **Contact:** Phone and email are in `index.html` and the Web3Forms quote form.

## Features

- Home Gnome-inspired layout: hero, plans, service checklist, drag compare, why us, how it works, promise, reviews, FAQ, quote form
- English / Spanish toggle (saved in browser)
- Mobile nav + sticky Call / Quote bar
- Quote form submits to [Web3Forms](https://web3forms.com) via AJAX (email and phone validated; HTML `action` fallback)
