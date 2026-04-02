# Equipment Checkout App

iPad/iPhone-compatible Progressive Web App for checking equipment in and out of a equipment room. Integrates with [Halo PSA](https://integrid.halopsa.com) for asset tracking and uses Microsoft Entra ID for authentication.

---

## Features

- **Barcode scanning** — tap to open the camera and scan any 1D/2D barcode
- **Instant asset lookup** — finds the item in Halo PSA and shows its current status
- **Check out / Check in** — updates asset status and logs an audit trail in Halo
- **Inventory browser** — searchable list of all assets with inline checkout
- **Currently out dashboard** — see everything that's checked out at a glance
- **Entra SSO** — sign in with your Microsoft work account
- **iOS kiosk mode** — add to home screen on iPad/iPhone for a fullscreen app experience

---

## One-Click Deploy

[![Deploy to Azure](https://aka.ms/deploytoazure)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fintegrid-int%2Fequipment-checkout-app%2Fmain%2Fazuredeploy.json)

The Azure portal wizard will prompt for all required values and provision everything automatically.

---

## Quick Start (CLI)

**Mac/Linux:**
```bash
./deploy.sh
```

**Windows:**
```powershell
.\deploy.ps1
```

Both scripts interactively collect credentials, create the Azure resource group, deploy the ARM template, and set GitHub Actions secrets automatically.

---

## Architecture

```
Browser / iPad              Azure SWA Edge           Azure Functions (Node)
─────────────────           ──────────────           ──────────────────────
React PWA          ──────▶  Entra Auth Gate  ──────▶  /api/assets
@zxing barcode              /.auth/me                 /api/checkout
Tailwind UI                 Route rules               /api/checkin
                                                      /api/checkins
                                                           │
                                                           ▼
                                                      Halo PSA API
                                                  integrid.halopsa.com
```

- **Frontend** — React + TypeScript + Vite, served as a static site
- **Auth** — Azure SWA built-in Entra ID (AAD) — no tokens in the browser
- **API** — Azure Functions proxy keeps Halo PSA credentials server-side
- **Halo PSA** — OAuth2 client credentials, updates asset custom fields + creates audit actions

---

## Prerequisites

Before deploying you will need:

| What | Where to get it |
|------|----------------|
| Halo PSA API client (client credentials) | Halo Admin → Integrations → API |
| Halo custom fields on assets | Halo Admin → Assets → Custom Fields — see [SETUP.md](SETUP.md) |
| Entra app registration | portal.azure.com → Azure AD → App registrations |
| GitHub PAT (repo scope) | github.com → Settings → Developer settings → Tokens |
| Azure subscription | portal.azure.com |

Full step-by-step instructions in [SETUP.md](SETUP.md).

---

## Local Development

```bash
# Install dependencies
npm install
cd api && npm install && cd ..

# Configure credentials
cp .env.example .env.local
# edit .env.local with your Halo client ID/secret

# Start (SWA CLI handles auth + API proxy)
swa start http://localhost:5173 --api-location api --run "npm run dev"
```

Open [http://localhost:4280](http://localhost:4280).

---

## Cursor Subagent: Halo Swagger API Development

This repo includes a project-scoped Cursor subagent at `.cursor/agents/halo-swagger-api-dev.md`.

Use it when implementing or changing API routes under `api/` that integrate with Halo PSA Swagger:

- Explicit invoke: `/halo-swagger-api-dev implement GET /api/<route> using Halo Swagger`
- Natural language: `Use the halo-swagger-api-dev subagent to add/update this Halo API route`

The subagent is tuned for:
- Swagger-accurate endpoint integration (`https://usehalo.com/swagger/`)
- Server-side OAuth safety via existing `api/shared/haloClient.ts`
- Stable frontend-facing contracts and aligned updates to `src/types/halo.ts`

---

## Project Structure

```
├── src/
│   ├── pages/
│   │   ├── ScanPage.tsx          # Barcode scan → lookup → checkout/checkin
│   │   ├── InventoryPage.tsx     # Searchable asset list
│   │   └── CheckedOutPage.tsx    # All currently checked-out items
│   ├── components/
│   │   ├── BarcodeScanner.tsx    # Camera scanner (@zxing/browser)
│   │   ├── AssetCard.tsx         # Asset display + action buttons
│   │   ├── CheckoutModal.tsx     # Checkout form
│   │   ├── CheckinModal.tsx      # Checkin form
│   │   └── NavBar.tsx            # Header + bottom tab bar
│   └── hooks/
│       ├── useAuth.ts            # SWA /.auth/me user
│       └── useAssets.ts          # Halo asset fetch + state
├── api/
│   ├── assets/                   # GET  /api/assets?search=...
│   ├── checkout/                 # POST /api/checkout
│   ├── checkin/                  # POST /api/checkin
│   ├── checkins/                 # GET  /api/checkins
│   └── shared/haloClient.ts      # OAuth2 token + fetch helpers
├── azuredeploy.json              # ARM template
├── staticwebapp.config.json      # SWA routes + Entra auth config
├── deploy.sh                     # One-command deploy (Mac/Linux)
└── deploy.ps1                    # One-command deploy (Windows)
```
