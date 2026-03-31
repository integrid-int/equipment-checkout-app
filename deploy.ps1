# deploy.ps1 — One-command deploy of Equipment Checkout to Azure (Windows / PowerShell)
# Usage: .\deploy.ps1
# Prerequisites: Azure CLI, optionally GitHub CLI (gh)

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Header($msg) { Write-Host "`n▶ $msg" -ForegroundColor Green -NoNewline; Write-Host "" }
function Write-Warn($msg)   { Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Fail($msg)   { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

# ── Prerequisites ─────────────────────────────────────────────────────────────
Write-Header "Checking prerequisites"
if (-not (Get-Command az -ErrorAction SilentlyContinue))  { Write-Fail "Azure CLI not found. Install from https://aka.ms/installazurecliwindows" }
if (-not (Get-Command jq -ErrorAction SilentlyContinue))  { Write-Warn "jq not found — output parsing will use az --query instead" }

try { az account show | Out-Null }
catch { Write-Warn "Not logged in. Running az login..."; az login }

# ── Gather inputs ──────────────────────────────────────────────────────────────
Write-Header "Configuration"

$RG           = Read-Host "  Resource group name  [equipment-checkout-rg]"
if (-not $RG) { $RG = "equipment-checkout-rg" }

$Location     = Read-Host "  Azure region         [eastus2]"
if (-not $Location) { $Location = "eastus2" }

$SiteName     = Read-Host "  SWA resource name    [equipment-checkout]"
if (-not $SiteName) { $SiteName = "equipment-checkout" }

$RepoUrl      = Read-Host "  GitHub repo URL      (e.g. https://github.com/org/repo)"
if (-not $RepoUrl) { Write-Fail "Repository URL is required" }

Write-Host "`nEntra / Azure AD" -ForegroundColor White
$TenantId          = Read-Host "  Tenant ID"
if (-not $TenantId) { Write-Fail "Tenant ID is required" }

$EntraClientId     = Read-Host "  App Client ID"
if (-not $EntraClientId) { Write-Fail "Entra Client ID is required" }

$EntraClientSecret = Read-Host "  App Client Secret" -AsSecureString
$EntraClientSecretPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($EntraClientSecret))

Write-Host "`nHalo PSA" -ForegroundColor White
$HaloClientId     = Read-Host "  Halo Client ID"
if (-not $HaloClientId) { Write-Fail "Halo Client ID is required" }

$HaloClientSecret = Read-Host "  Halo Client Secret" -AsSecureString
$HaloClientSecretPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($HaloClientSecret))

# ── Resource Group ─────────────────────────────────────────────────────────────
Write-Header "Creating resource group: $RG"
az group create --name $RG --location $Location --output none
Write-Host "  Done."

# ── ARM Deployment ─────────────────────────────────────────────────────────────
Write-Header "Deploying ARM template"
$DeployOutput = az deployment group create `
  --resource-group $RG `
  --template-file azuredeploy.json `
  --parameters `
      siteName=$SiteName `
      location=$Location `
      entraTenantId=$TenantId `
      entraClientId=$EntraClientId `
      entraClientSecret=$EntraClientSecretPlain `
      haloClientId=$HaloClientId `
      haloClientSecret=$HaloClientSecretPlain `
  --output json | ConvertFrom-Json

$SwaUrl      = $DeployOutput.properties.outputs.swaUrl.value
$RedirectUri = $DeployOutput.properties.outputs.entraRedirectUri.value

# ── GitHub Secrets ─────────────────────────────────────────────────────────────
$SwaToken = az staticwebapp secrets list `
  --name $SiteName `
  --resource-group $RG `
  --query "properties.apiKey" -o tsv

if (Get-Command gh -ErrorAction SilentlyContinue) {
  Write-Header "Setting GitHub Actions secrets"
  $RepoSlug = $RepoUrl -replace "https://github.com/", ""
  gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body $SwaToken --repo $RepoSlug
  gh secret set ENTRA_TENANT_ID                  --body $TenantId --repo $RepoSlug
  Write-Host "  Secrets set on $RepoSlug"
} else {
  Write-Warn "gh CLI not found — set these GitHub secrets manually:"
  Write-Host ""
  Write-Host "  AZURE_STATIC_WEB_APPS_API_TOKEN = $SwaToken"
  Write-Host "  ENTRA_TENANT_ID                 = $TenantId"
}

# ── Summary ────────────────────────────────────────────────────────────────────
Write-Header "Deployment complete!"
Write-Host ""
Write-Host "  App URL:          $SwaUrl"        -ForegroundColor Cyan
Write-Host "  Entra redirect:   $RedirectUri"   -ForegroundColor Cyan
Write-Host ""
Write-Warn "Next step: Add this Redirect URI to your Entra app registration:"
Write-Host "  portal.azure.com → Azure AD → App registrations → your app → Authentication"
Write-Host "  Add redirect URI: $RedirectUri" -ForegroundColor Yellow
Write-Host ""
Write-Warn "Then push to 'main' to trigger the first deployment."
