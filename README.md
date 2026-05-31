# MSG Pool Services Website

Marketing site + **admin-only** business dashboard for **MSG Pool Services**.

## Public site

Open via the Node server (recommended) or `npx serve .` for static preview only.

## Admin dashboard

Owner-only login at **/admin/login.html** with:

- **Interactive calendar** -click any day to see all pools scheduled that day
- **Add / edit customers** -name, phone, email, address, weekly service day, pool type, monthly rate
- **Private notes** per customer (gate codes, pets, chemicals, etc.)
- **Route overview** -pools per day of week
- **Skip a day** or **add extra visit** for one-off schedule changes

### Setup

```bash
cd server
npm install
copy .env.example .env
```

Edit `server/.env`:

```
ADMIN_EMAIL=your@email.com
ADMIN_PASSWORD=your-secure-password
JWT_SECRET=long-random-string
BASE_URL=http://localhost:3000
```

```bash
npm start
```

Open **http://localhost:3000** → click **Log In** (top bar) or go to **/admin/login.html**.

> Admin features require the server. Change the default password in `.env` before going live.

## Project structure

```
mayelin/
├── index.html          # Public marketing site
├── admin/
│   ├── login.html      # Admin log in
│   ├── index.html      # Calendar + customer management
│   └── dashboard.js
├── js/app.js           # Public site (i18n, quote form, sliders)
└── server/             # API + SQLite database
```

## Quote form

Public quote form uses [Web3Forms](https://web3forms.com) (no server required for quotes).
