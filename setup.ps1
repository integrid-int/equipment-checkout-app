#Requires -Version 7.0
<#
.SYNOPSIS
    Full automated setup for the Deployment Kit App.

.DESCRIPTION
    Automates everything except the two manual Halo PSA steps:
      1. Creating the Halo API client  (Admin → Integrations → API)
      2. Adding custom fields to Items (Admin → Items → Custom Fields)

    What this script does automatically:
      - Installs required PowerShell modules and GitHub CLI if missing
      - Creates the Entra app registration with correct settings
      - Generates a client secret
      - Creates the Azure resource group
      - Deploys the ARM template (SWA + Storage Account)
      - Retrieves the deployed SWA URL
      - Patches the Entra app with the correct redirect URI
      - Retrieves the SWA deployment token
      - Sets all required GitHub Actions secrets
      - Triggers the first CI/CD deployment
      - Prints a completion summary

.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -ResourceGroup "my-rg" -Location "westus2" -SiteName "my-kit-app"

.NOTES
    Prerequisites (script will attempt to install missing items):
      - PowerShell 7+
      - Azure CLI  OR  Az PowerShell module
      - Microsoft.Graph PowerShell module
      - GitHub CLI (gh)
#>

[CmdletBinding()]
param(
    [string]$ResourceGroup = "integrid-deployment-kit-rg",
    [string]$Location      = "eastus2",
    [string]$SiteName      = "integrid-deployment-kit",
    [string]$RepoUrl       = "https://github.com/integrid-int/equipment-checkout-app",
    [string]$Branch        = "main"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Step($n, $msg)  { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)        { Write-Host "    ✓ $msg" -ForegroundColor Green }
function Write-Info($msg)      { Write-Host "    · $msg" -ForegroundColor Gray }
function Write-Warn($msg)      { Write-Host "    ⚠ $msg" -ForegroundColor Yellow }
function Fail($msg)            { Write-Host "`n✗ $msg" -ForegroundColor Red; exit 1 }

function Read-SecureInput($prompt) {
    $ss = Read-Host $prompt -AsSecureString
    [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss))
}

function Assert-Command($name, $installHint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Warn "$name not found. $installHint"
        return $false
    }
    return $true
}

# ── Banner ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║   Deployment Kit App — Automated Setup           ║" -ForegroundColor Blue
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""
Write-Host "  Before running this script you must have already:"
Write-Host "  1. Created a Halo PSA API client (Admin → Integrations → API)"
Write-Host "  2. Added custom fields to your Item type in Halo"
Write-Host "     (checkout_to, checkout_by, checkout_date, checkout_notes)"
Write-Host ""
$confirm = Read-Host "Have you completed both Halo steps? (y/n)"
if ($confirm -ne "y") { Fail "Complete the Halo PSA manual steps first, then re-run." }

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────

Write-Step 1 "Checking prerequisites"

# PowerShell modules
foreach ($module in @("Az.Accounts", "Az.Resources", "Az.Websites", "Microsoft.Graph")) {
    if (-not (Get-Module -ListAvailable -Name $module)) {
        Write-Info "Installing $module..."
        Install-Module $module -Scope CurrentUser -Force -AllowClobber -Repository PSGallery
        Write-Ok "Installed $module"
    } else {
        Write-Ok "$module present"
    }
}

# GitHub CLI
if (-not (Assert-Command "gh" "")) {
    Write-Info "Installing GitHub CLI via winget..."
    try {
        winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("PATH", "User")
        Write-Ok "GitHub CLI installed"
    } catch {
        Fail "Could not install gh CLI automatically. Install from https://cli.github.com and re-run."
    }
}

# Verify gh is authenticated
$ghStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "GitHub CLI not authenticated. Launching gh auth login..."
    gh auth login
}
Write-Ok "GitHub CLI authenticated"

# ── Step 2: Collect inputs ────────────────────────────────────────────────────

Write-Step 2 "Collecting credentials"
Write-Host ""

Write-Host "  Halo PSA" -ForegroundColor White
$HaloClientId     = Read-Host "    Client ID"
$HaloClientSecret = Read-SecureInput "    Client Secret"
if (-not $HaloClientId -or -not $HaloClientSecret) { Fail "Halo credentials are required" }

Write-Host ""
Write-Host "  Admin bootstrap" -ForegroundColor White
$AdminEmails = Read-Host "    Admin email(s) — comma separated (your email first)"
if (-not $AdminEmails) { Fail "At least one admin email is required" }

Write-Host ""
Write-Host "  Deployment settings (press Enter to accept defaults)" -ForegroundColor White
$rgInput   = Read-Host "    Resource group  [$ResourceGroup]"
$locInput  = Read-Host "    Azure region    [$Location]"
$nameInput = Read-Host "    SWA name        [$SiteName]"
if ($rgInput)   { $ResourceGroup = $rgInput }
if ($locInput)  { $Location = $locInput }
if ($nameInput) { $SiteName = $nameInput }

Write-Ok "Inputs collected"

# ── Step 3: Azure login ───────────────────────────────────────────────────────

Write-Step 3 "Signing in to Azure"

Import-Module Az.Accounts -ErrorAction Stop

$ctx = Get-AzContext -ErrorAction SilentlyContinue
if (-not $ctx) {
    Connect-AzAccount
    $ctx = Get-AzContext
}
Write-Ok "Signed in as: $($ctx.Account.Id)"
Write-Ok "Subscription: $($ctx.Subscription.Name) ($($ctx.Subscription.Id))"

$TenantId = $ctx.Tenant.Id

# ── Step 4: Microsoft Graph login ────────────────────────────────────────────

Write-Step 4 "Connecting to Microsoft Graph"

Import-Module Microsoft.Graph.Applications -ErrorAction Stop
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

Connect-MgGraph -TenantId $TenantId -Scopes "Application.ReadWrite.All" -NoWelcome
Write-Ok "Connected to Microsoft Graph (tenant: $TenantId)"

# ── Step 5: Entra app registration ───────────────────────────────────────────

Write-Step 5 "Creating Entra app registration"

$appName = "Deployment Kit App"

# Check if app already exists
$existing = Get-MgApplication -Filter "displayName eq '$appName'" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Warn "App '$appName' already exists — reusing it"
    $app = $existing
} else {
    $app = New-MgApplication -DisplayName $appName `
        -SignInAudience "AzureADMyOrg" `
        -Web @{
            ImplicitGrantSettings = @{
                EnableIdTokenIssuance = $true
            }
        }
    Write-Ok "Created app: $appName ($($app.AppId))"
}

$EntraClientId = $app.AppId

# Add client secret (expires 24 months)
Write-Info "Generating client secret (24 month expiry)..."
$secretParams = @{
    ApplicationId       = $app.Id
    PasswordCredential  = @{
        DisplayName = "deployment-kit-$(Get-Date -Format 'yyyy-MM')"
        EndDateTime = (Get-Date).AddMonths(24)
    }
}
$secret = Add-MgApplicationPassword @secretParams
$EntraClientSecret = $secret.SecretText
Write-Ok "Client secret created (expires $((Get-Date).AddMonths(24).ToString('yyyy-MM-dd')))"

# ── Step 6: Resource group ────────────────────────────────────────────────────

Write-Step 6 "Creating resource group: $ResourceGroup"

Import-Module Az.Resources -ErrorAction Stop

$rg = Get-AzResourceGroup -Name $ResourceGroup -ErrorAction SilentlyContinue
if ($rg) {
    Write-Warn "Resource group already exists — reusing"
} else {
    New-AzResourceGroup -Name $ResourceGroup -Location $Location | Out-Null
    Write-Ok "Created: $ResourceGroup ($Location)"
}

# ── Step 7: ARM deployment ────────────────────────────────────────────────────

Write-Step 7 "Deploying ARM template (this takes ~2 minutes)"

# Get GitHub PAT for ARM template repo wiring
Write-Info "A GitHub PAT (repo scope) is needed to wire up GitHub Actions."
Write-Info "Go to: github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)"
$GithubPat = Read-SecureInput "    GitHub PAT (repo scope)"
if (-not $GithubPat) { Fail "GitHub PAT is required" }

$templateFile = Join-Path $PSScriptRoot "azuredeploy.json"
if (-not (Test-Path $templateFile)) { Fail "azuredeploy.json not found in $PSScriptRoot" }

$deployParams = @{
    siteName          = $SiteName
    location          = $Location
    repositoryUrl     = $RepoUrl
    repositoryBranch  = $Branch
    repositoryToken   = $GithubPat
    entraTenantId     = $TenantId
    entraClientId     = $EntraClientId
    entraClientSecret = $EntraClientSecret
    haloClientId      = $HaloClientId
    haloClientSecret  = $HaloClientSecret
    adminEmails       = $AdminEmails
}

$deployment = New-AzResourceGroupDeployment `
    -ResourceGroupName $ResourceGroup `
    -TemplateFile $templateFile `
    -TemplateParameterObject $deployParams `
    -Name "deployment-kit-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

if ($deployment.ProvisioningState -ne "Succeeded") {
    Fail "ARM deployment failed: $($deployment.ProvisioningState)"
}

$SwaUrl         = $deployment.Outputs["swaUrl"].Value
$RedirectUri    = $deployment.Outputs["entraRedirectUri"].Value
$SwaHostname    = $deployment.Outputs["swaDefaultHostname"].Value 2>$null
if (-not $SwaHostname) { $SwaHostname = $SwaUrl -replace "https://","" }

Write-Ok "Deployed successfully"
Write-Ok "App URL: $SwaUrl"

# ── Step 8: Patch Entra redirect URI ─────────────────────────────────────────

Write-Step 8 "Adding redirect URI to Entra app"

$redirectUris = @($RedirectUri)

# Preserve any existing redirect URIs
$currentApp = Get-MgApplication -ApplicationId $app.Id
$existingUris = $currentApp.Web.RedirectUris ?? @()
$mergedUris = ($existingUris + $redirectUris | Select-Object -Unique)

Update-MgApplication -ApplicationId $app.Id -Web @{
    RedirectUris = $mergedUris
    ImplicitGrantSettings = @{ EnableIdTokenIssuance = $true }
}

Write-Ok "Redirect URI added: $RedirectUri"

# ── Step 9: GitHub Actions secrets ───────────────────────────────────────────

Write-Step 9 "Setting GitHub Actions secrets"

# Get SWA deployment token
Import-Module Az.Websites -ErrorAction Stop

$swaToken = (Get-AzStaticWebAppSecret -ResourceGroupName $ResourceGroup -Name $SiteName).Property.ApiKey
if (-not $swaToken) { Fail "Could not retrieve SWA deployment token" }

$repoSlug = $RepoUrl -replace "https://github.com/", ""

gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body $swaToken   --repo $repoSlug
gh secret set ENTRA_TENANT_ID                  --body $TenantId   --repo $repoSlug

Write-Ok "AZURE_STATIC_WEB_APPS_API_TOKEN set"
Write-Ok "ENTRA_TENANT_ID set"

# ── Step 10: Trigger first deployment ────────────────────────────────────────

Write-Step 10 "Triggering first GitHub Actions deployment"

gh workflow run "azure-static-web-apps.yml" --repo $repoSlug --ref $Branch
Write-Ok "Workflow triggered — build will complete in ~3 minutes"
Write-Info "Watch progress at: https://github.com/$repoSlug/actions"

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   Setup Complete!                                            ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  App URL:          $SwaUrl" -ForegroundColor Cyan
Write-Host "  Entra Client ID:  $EntraClientId" -ForegroundColor Cyan
Write-Host "  Resource group:   $ResourceGroup" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ─── Still manual ──────────────────────────────────────────"
Write-Host ""
Write-Host "  1. Wait ~3 minutes for the GitHub Actions build to finish."
Write-Host "     Monitor: https://github.com/$repoSlug/actions"
Write-Host ""
Write-Host "  2. Open $SwaUrl in Safari on your iPad/iPhone."
Write-Host "     Sign in with your Entra account."
Write-Host ""
Write-Host "  3. Tap Share → Add to Home Screen to install as a kiosk app."
Write-Host ""
Write-Host "  4. Open the Admin tab and assign roles to your team."
Write-Host "     Your account ($($AdminEmails.Split(',')[0].Trim())) already has Admin."
Write-Host ""

# Save outputs to file for reference
$outputFile = Join-Path $PSScriptRoot "setup-output.txt"
@"
Deployment Kit App — Setup Output
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

App URL:           $SwaUrl
Entra Client ID:   $EntraClientId
Tenant ID:         $TenantId
Resource Group:    $ResourceGroup
SWA Name:          $SiteName
Admin Emails:      $AdminEmails

GitHub repo:       https://github.com/$repoSlug
Actions:           https://github.com/$repoSlug/actions

NOTE: Client secret is NOT saved here for security reasons.
Store it in your password manager.
"@ | Set-Content $outputFile

Write-Host "  Output saved to: setup-output.txt" -ForegroundColor Gray
Write-Host ""
