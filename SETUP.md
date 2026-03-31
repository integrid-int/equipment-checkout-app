# Deployment Kit App — Setup Guide

iPad/iPhone-compatible PWA for deployment kit management via Halo PSA.
Technicians pull inventory against jobs, receivers receive against POs, admins manage roles.

---

## Recommended: Automated PowerShell Setup

`setup.ps1` handles everything except the two Halo PSA manual steps below.
**Total time: ~10 minutes.**

### Before you run the script

Complete these two steps in Halo PSA — they cannot be automated:

#### 1. Create a Halo PSA API Client

1. Log into `integrid.halopsa.com` as an admin
2. Go to **Admin → Integrations → API**
3. Click **New Application** and set:
   - **Name:** `Deployment Kit App`
   - **Authentication Method:** Client Credentials
   - **Scope:** `all`
4. Save — copy the **Client ID** and **Client Secret**

#### 2. Add Custom Fields to Item Type

Go to **Admin → Items → Item Types** → select your item type → **Custom Fields → Add Field**:

| Field Name       | Type      | Display Name    |
|------------------|-----------|-----------------|
| `CheckoutTo`     | Text      | Checked Out To  |
| `CheckoutBy`     | Text      | Checked Out By  |
| `CheckoutDate`   | Date/Time | Checkout Date   |
| `CheckoutNotes`  | Text      | Checkout Notes  |

Also note your Item **status IDs** from **Admin → Items → Statuses** (hover each status — the ID appears in the URL).

---

### Run the script

Open **PowerShell 7+** as your normal user (not Administrator) in the repo folder:

```powershell
.\setup.ps1
```

Or with custom resource names:

```powershell
.\setup.ps1 -ResourceGroup "my-rg" -Location "westus2" -SiteName "my-kit-app"
```

The script will:

| # | What it does | How |
|---|-------------|-----|
| 1 | Install missing PowerShell modules | `Install-Module` from PSGallery |
| 2 | Install GitHub CLI if missing | `winget install GitHub.cli` |
| 3 | Sign in to Azure | `Connect-AzAccount` |
| 4 | Connect to Microsoft Graph | `Connect-MgGraph` |
| 5 | Create Entra app registration | `New-MgApplication` |
| 6 | Generate client secret (24 mo) | `Add-MgApplicationPassword` |
| 7 | Create Azure resource group | `New-AzResourceGroup` |
| 8 | Deploy ARM template | `New-AzResourceGroupDeployment` |
| 9 | Patch Entra redirect URI | `Update-MgApplication` |
| 10 | Retrieve SWA deployment token | `Get-AzStaticWebAppSecret` |
| 11 | Set GitHub Actions secrets | `gh secret set` |
| 12 | Trigger first CI/CD deployment | `gh workflow run` |
| 13 | Save output summary | `setup-output.txt` |

#### What the script prompts for

- Halo Client ID and Client Secret (from step 1 above)
- Entra app role assignments to configure (`admin`, `technician`, `receiver`)
- GitHub PAT with `repo` scope — create at:
  `github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)`
- Resource group / region / SWA name — press **Enter** to accept defaults

#### Script prerequisites

The script installs what it can automatically. If auto-install fails, install manually:

- **PowerShell 7+** — [aka.ms/powershell](https://aka.ms/powershell)
- **Azure CLI** (optional) — [docs.microsoft.com/cli/azure/install-azure-cli](https://docs.microsoft.com/cli/azure/install-azure-cli)
- **GitHub CLI** — [cli.github.com](https://cli.github.com)

---

### After the script finishes

1. **Wait ~3 minutes** for the GitHub Actions build to complete
   Monitor at: `https://github.com/integrid-int/equipment-checkout-app/actions`

2. **Open the app URL** printed in the summary (also saved to `setup-output.txt`)
   Sign in with your Entra / Microsoft 365 account

3. **Assign roles in Entra** (app registration / enterprise app):

| Role value | Who gets it | Access |
|------------|-------------|--------|
| **admin** | App admins | Everything + admin pages |
| **technician** | Field techs | Job, Pull Kit, Return, Stock |
| **receiver** | Warehouse / receiving staff | Receive POs, Stock |

Create these app roles on your Entra app registration, then assign users/groups in the Enterprise Application for this app.

4. **iOS kiosk setup** (iPad / iPhone):
   - Open **Safari** (not Chrome) and navigate to the app URL
   - Sign in with Entra credentials
   - Tap **Share → Add to Home Screen**
   - Name it **"Kit Checkout"** → tap **Add**
   - The app launches fullscreen with no browser chrome

---

## Alternative: One-Click Deploy to Azure (portal)

If you prefer the Azure portal wizard over PowerShell:

[![Deploy to Azure](https://aka.ms/deploytoazure)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fintegrid-int%2Fequipment-checkout-app%2Fmain%2Fazuredeploy.json)

The portal collects all parameters and provisions the infrastructure. Afterward complete these steps:

1. Copy the `entraRedirectUri` from the deployment **Outputs** tab
2. Add it to your Entra app registration under **Authentication → Redirect URIs**
3. Add GitHub Actions secrets — go to `github.com/integrid-int/equipment-checkout-app/settings/secrets/actions`:

   | Secret name | Value |
   |-------------|-------|
   | `AZURE_STATIC_WEB_APPS_API_TOKEN` | Run: `az staticwebapp secrets list --name <siteName> --resource-group <rg> --query properties.apiKey -o tsv` |
   | `ENTRA_TENANT_ID` | Your Azure AD Directory (tenant) ID |

4. Push to `main` or trigger the workflow manually in GitHub Actions

---

## Local Development

```bash
# Install dependencies
npm install
cd api && npm install && cd ..

# Configure credentials
cp .env.example .env.local
# Edit .env.local — fill in HALO_CLIENT_ID and HALO_CLIENT_SECRET

# Start app + API together (SWA CLI provides mock auth locally)
swa start http://localhost:5173 --api-location api --run "npm run dev"
```

Open [http://localhost:4280](http://localhost:4280). No real Entra login is required for local dev — SWA CLI injects a mock user via `/.auth/me`.

**Local dev prerequisites:**
- Node 18+
- Azure Static Web Apps CLI: `npm i -g @azure/static-web-apps-cli`
- Azure Functions Core Tools v4: `npm i -g azure-functions-core-tools@4`

---

## App Structure

```
src/
  pages/
    FindJobPage.tsx     ← Find Halo ticket by scan or search
    PullKitPage.tsx     ← Scan items into a pull list against a job
    ReturnPage.tsx      ← Scan items back to stock
    ReceivePage.tsx     ← Receive items against a PO
    StockPage.tsx       ← Browse current stock levels
    AdminPage.tsx       ← Role setup guidance (managed in Entra)
  components/
    BarcodeScanner.tsx  ← Camera scanner (@zxing/browser, iOS Safari compatible)
    NavBar.tsx          ← Header + role-filtered bottom tabs
    RoleGuard.tsx       ← Protects routes by role
  context/
    ActiveJobContext.tsx ← Active ticket + pull list (persists in sessionStorage)
    RoleContext.tsx      ← Current user role from /api/me

api/
  tickets/            ← GET  /api/tickets
  items/              ← GET  /api/items
  pull/               ← POST /api/pull
  return/             ← POST /api/return
  purchase-orders/    ← GET  /api/purchase-orders
  receive/            ← POST /api/receive
  me/                 ← GET  /api/me (user + role claim)
  shared/
    haloClient.ts     ← Halo PSA OAuth2 token + fetch helpers
    auth.ts           ← Entra claim parsing + role authorization

azuredeploy.json      ← ARM template (SWA + Storage Account)
setup.ps1             ← Automated end-to-end setup script
deploy.sh             ← Lightweight deploy-only script (Mac/Linux)
deploy.ps1            ← Lightweight deploy-only script (Windows)
```

---

## Roles Reference

| Role | Tabs | Can do |
|------|------|--------|
| **Admin** | All tabs | Full access + admin pages |
| **Technician** | Job, Pull Kit, Return, Stock | Pull deployment kits, return unused items |
| **Receiver** | Receive, Stock | Receive POs into stock, view inventory |

- Users with no recognized app role claim see a **"pending access"** screen after sign-in
- Assign app roles in Entra; role changes take effect after token refresh (sign out/in)
