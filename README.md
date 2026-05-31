# MSG Pool Services Website



Marketing site + **admin-only** business dashboard for **MSG Pool Services**.



## Hosting (free with Cloudflare)

| Where | What works |
|-------|------------|
| **Cloudflare Pages** (production — free) | Public site + **admin login** + calendar |
| **GitHub Pages** (testing only) | Public marketing site — **admin login will not work** |
| **Local `cd server && npm start`** | Everything (simple development) |
| **Local `npm run dev:cf`** | Same stack as Cloudflare (needs root `npm install`) |

**You do not need Render or any paid host.** Admin login runs on Cloudflare’s free tier (Pages + D1 database + Functions).

### Deploy to Cloudflare Pages (free)

1. Push this repo to GitHub (you can keep GitHub Pages for the public site preview if you want).
2. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Select the repo. Build settings (also set in `wrangler.toml`):
   - **Build command:** `npm install` (required — installs `hono`, `jose`, `bcryptjs` for admin API)
   - **Build output directory:** `/` (project root)
   - Commit **`package.json`** and **`package-lock.json`** at the repo root.
4. Create a **D1 database**: Workers & Pages → **D1** → **Create** → name it `msg-pool-db`.
5. Copy the **database ID** into `wrangler.toml` (`database_id = "..."`).
6. In your Pages project → **Settings** → **Functions** → confirm the **D1 binding** `DB` is linked to `msg-pool-db`.
7. **Settings** → **Environment variables** (Production):
   - `ADMIN_EMAIL` — your login email
   - `ADMIN_PASSWORD` — your login password
   - `JWT_SECRET` — long random string (e.g. 32+ characters)
8. Deploy. Open **https://your-project.pages.dev/admin/login.html** (or your custom domain).

Tables are created automatically on the first API request — you do not need a separate migration step unless you prefer running `npm run db:migrate:remote` once.

> **Important:** Use **Cloudflare Pages** for the live site with admin. GitHub Pages cannot run the login API.



## Local development



### Option A — Node server (simplest)



```bash

cd server

npm install

copy .env.example .env

# Edit .env: ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET

npm start

```



Open **http://localhost:3000** → **Log In** or **/admin/login.html**



### Option B — Cloudflare locally

```bash
npm install
copy .dev.vars.example .dev.vars
# Edit .dev.vars: ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET
npm run dev:cf
```

Open **http://localhost:8788/admin/login.html**



## Admin features



- Interactive calendar with daily pool counts  

- Add / edit customers (Florida addresses, route map)  

- Route planner with optimized stops  

- Skip days / extra visits  

- **WorkDay** route execution (admin tab + installable iPhone PWA at `/workday-app/`)



## WorkDay iPhone app

Field techs can install **WorkDay** on iPhone from the admin topbar (**Install WorkDay**). It uses the same admin login and the same cloud database as the website — changes sync automatically.

Shared WorkDay code lives in `js/workday-ui.js`. See `AGENTS.md` for dual-client development rules.



## Public quote form



Uses [Web3Forms](https://web3forms.com) — works on any static host, no server required.



## Project structure



```

mayelin/

├── index.html              # Public marketing site

├── admin/                  # Admin dashboard (HTML + JS)
├── workday-app/            # WorkDay iPhone PWA (shared js/workday-ui.js)
├── js/workday-ui.js        # Shared WorkDay logic (admin + app)

├── functions/              # Cloudflare API (free tier)

├── schema.sql              # D1 database schema

├── wrangler.toml           # Cloudflare config

├── package.json            # Cloudflare dev dependencies

└── server/                 # Local Node server (optional dev)

```

