# Equipment Checkout — Setup Guide

iPad/iPhone-compatible PWA for equipment room checkout via Halo PSA.

---

## One-Click Deploy to Azure

> Push this repo to GitHub first, then click the button below.

[![Deploy to Azure](https://aka.ms/deploytoazure)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fintegrid-int%2Fequipment-checkout-app%2Fmain%2Fazuredeploy.json)

The portal wizard will prompt for all required values (Halo credentials, Entra IDs, GitHub PAT) and provision everything in one shot.

---

## Or: One-Command CLI Deploy

**Mac/Linux:**
```bash
./deploy.sh
```

**Windows (PowerShell):**
```powershell
.\deploy.ps1
```

Both scripts interactively prompt for credentials, create the resource group, deploy the ARM template, and automatically set the required GitHub Actions secrets.

---

## Prerequisites (for CLI deploy)

- Node 18+
- Azure CLI (`az login`)
- `jq` — `brew install jq` (Mac) or download from https://jqlang.github.io/jq/
- GitHub CLI (`gh`) — optional, for auto-setting Actions secrets
- Azure Static Web Apps CLI: `npm i -g @azure/static-web-apps-cli` (local dev only)
- Azure Functions Core Tools v4: `npm i -g azure-functions-core-tools@4` (local dev only)

---

## 1. Halo PSA — Create API Client

1. In Halo: **Admin → Integrations → API**
2. Create a new application with **Client Credentials** grant
3. Grant scope: `all` (or at minimum `read:assets write:assets write:actions`)
4. Copy **Client ID** and **Client Secret** → add to `.env.local` and Azure SWA app settings

### Custom Fields on Assets

Add these custom fields to your Asset type in Halo (**Admin → Assets → Custom Fields**):

| Field Name        | Type   | Display Name     |
|-------------------|--------|------------------|
| `checkout_to`     | Text   | Checked Out To   |
| `checkout_by`     | Text   | Checked Out By   |
| `checkout_date`   | Date   | Checkout Date    |
| `checkout_notes`  | Text   | Checkout Notes   |

### Asset Status IDs

Find your "Available" and "In Use" status IDs in **Admin → Assets → Statuses**.
Update `HALO_STATUS_AVAILABLE` and `HALO_STATUS_IN_USE` in your env vars.

---

## 2. Azure Entra — Register App

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory → App registrations → New**
2. Name: `Equipment Checkout`
3. Redirect URI: `https://<your-swa>.azurestaticapps.net/.auth/login/aad/callback`
4. Add a **Client Secret** under *Certificates & secrets*
5. Copy **Application (client) ID**, **Directory (tenant) ID**, and secret
6. Update `staticwebapp.config.json`: replace `YOUR_TENANT_ID`

---

## 3. Local Development

```bash
# Install dependencies
npm install
cd api && npm install && cd ..

# Create env file
cp .env.example .env.local
# Fill in HALO_CLIENT_ID, HALO_CLIENT_SECRET

# Start Vite + Functions together
swa start http://localhost:5173 --api-location api --run "npm run dev"
```

SWA CLI proxies `/.auth/me` with a fake user locally (no real Entra needed for dev).

---

## 4. Deploy to Azure

### Option A — One-Click (portal)
Click the Deploy to Azure button at the top of this file. The Azure portal wizard collects all parameters and deploys via the ARM template.

After deployment, the portal outputs:
- **App URL** — your SWA hostname
- **Entra Redirect URI** — add this to your Entra app registration

Then add two GitHub Actions secrets to your repo (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | From: `az staticwebapp secrets list --name <siteName> --resource-group <rg> --query properties.apiKey -o tsv` |
| `ENTRA_TENANT_ID` | Your Azure AD tenant ID |

Push to `main` to trigger the first CI/CD deployment.

---

### Option B — CLI scripts

```bash
# Mac/Linux
./deploy.sh

# Windows PowerShell
.\deploy.ps1
```

These scripts handle everything including setting GitHub secrets automatically (requires `gh` CLI).

---

### Option C — Manual ARM deployment

```bash
az group create --name equipment-checkout-rg --location eastus2

az deployment group create \
  --resource-group equipment-checkout-rg \
  --template-file azuredeploy.json \
  --parameters \
      siteName="equipment-checkout" \
      repositoryUrl="https://github.com/YOUR_ORG/equipment-checkout-app" \
      repositoryToken="YOUR_GITHUB_PAT" \
      entraTenantId="YOUR_TENANT_ID" \
      entraClientId="YOUR_ENTRA_CLIENT_ID" \
      entraClientSecret="YOUR_ENTRA_SECRET" \
      haloClientId="YOUR_HALO_CLIENT_ID" \
      haloClientSecret="YOUR_HALO_SECRET"
```

---

## 5. iOS Kiosk Setup

1. Open Safari on the iPad/iPhone and navigate to your SWA URL
2. Sign in with Entra credentials
3. Tap the **Share** button → **Add to Home Screen**
4. Name it "Checkout" → **Add**

The app will launch fullscreen with no browser chrome, acting as a dedicated kiosk.

---

## App Structure

```
src/
  pages/
    ScanPage.tsx       ← Scan barcode → look up → checkout/checkin
    InventoryPage.tsx  ← Browse all assets, search, checkout/checkin
    CheckedOutPage.tsx ← All currently checked-out items
  components/
    BarcodeScanner.tsx ← Camera scanner (@zxing/browser)
    AssetCard.tsx      ← Asset display + action buttons
    CheckoutModal.tsx  ← Checkout form
    CheckinModal.tsx   ← Checkin form
    NavBar.tsx         ← Top header + bottom tab bar
api/
  assets/    ← GET /api/assets?search=...
  checkout/  ← POST /api/checkout
  checkin/   ← POST /api/checkin
  checkins/  ← GET /api/checkins (all currently out)
  shared/
    haloClient.ts ← OAuth2 token + fetch helpers
```
