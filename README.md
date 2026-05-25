# MSG Pool Services Website

A single-page marketing site for **MSG Pool Services** — weekly pool and hot tub cleaning in the Kissimmee / Orlando area.

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
└── assets/         # logo.png, pool photos
```

## Customize

- **Photos:** Replace files in `assets/` (hero uses `pool3.jpeg`; compare slider uses `pool2.jpeg` / `pool4.jpeg`).
- **Pricing:** Update `$90` in `index.html` and copy in `js/app.js`.
- **Contact:** Phone and email are in `index.html` and the quote form mailto link.
- **Before/after:** For a true before/after pair, add two photos from the same angle and update paths in the compare section.

## Features

- Home Gnome–inspired layout: hero, plans, service checklist, drag compare, why us, how it works, promise, reviews, FAQ, quote form
- English / Spanish toggle (saved in browser)
- Mobile nav + sticky Call / Quote bar
- Quote form opens the user's email client with pre-filled details
