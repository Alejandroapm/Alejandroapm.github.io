# Development guide

## WorkDay: website + iPhone app (shared code)

WorkDay exists in **two clients** that must stay in sync:

| Client | Path | Purpose |
|--------|------|---------|
| Admin dashboard | `admin/dashboard.js` + `admin/index.html` | Full admin site; WorkDay is one tab |
| WorkDay iPhone app | `workday-app/` | Standalone PWA for field use |

Both use the **same shared module** and **same API**:

- **Shared UI logic:** `js/workday-ui.js` — all route execution, navigation, job panel, messaging, photos, CSV export
- **Shared translations:** `js/admin-i18n.js` — EN/ES strings for WorkDay and install flow
- **Shared backend:** Cloudflare Worker `/api/admin/workday/*` + D1 database

### When you change WorkDay features

1. Edit **`js/workday-ui.js`** (not duplicate logic in admin or app).
2. Add or update strings in **`js/admin-i18n.js`** if user-visible text changes.
3. If new DOM elements are required, update **both**:
   - `admin/index.html` (WorkDay view + modals)
   - `workday-app/index.html` (app shell + modals)
4. If new static assets are added, update **`workday-app/sw.js`** cache list.
5. Test in the admin WorkDay tab **and** `/workday-app/` on a phone.

Data sync between website and app is automatic: both clients read/write the same D1 tables via the API. The app also refreshes active work days when you return to the app (visibility change).

### Installing the iPhone app

Users tap **Install WorkDay** in the admin topbar → `workday-app/install.html` → follow Safari “Add to Home Screen” steps. There is no App Store build; this is a Progressive Web App (PWA).
