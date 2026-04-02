#Requires -Version 7.0
<#
.SYNOPSIS
    Full automated setup for the Deployment Kit App.

.DESCRIPTION
    Only one manual prerequisite: create the Halo PSA API client.
    Everything else — including Halo custom fields — is automated.

    What this script does:
      - Installs required PowerShell modules and GitHub CLI if missing
      - Gets a Halo PSA token and creates/verifies the 4 custom fields on Items
      - Creates the Entra app registration and client secret
      - Creates the Azure resource group
      - Deploys the ARM template (SWA + Storage Account)
      - Patches the Entra app with the correct redirect URI
      - Retrieves the SWA deployment token
      - Sets all required GitHub Actions secrets
      - Triggers the first CI/CD deployment
      - Saves a summary to setup-output.txt

.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -ResourceGroup "my-rg" -Location "westus2" -SiteName "my-kit-app"

.NOTES
    Prerequisites (script installs missing items automatically):
      - PowerShell 7+
      - Az PowerShell module
      - Microsoft.Graph PowerShell module
      - GitHub CLI (gh)

    One manual step before running:
      Create a Halo PSA API client at Admin → Integrations → API
      Authentication method: Client Credentials, Scope: all
#>

[CmdletBinding()]
param(
    [string]$HaloBaseUrl   = "https://integrid.halopsa.com",
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

# ── Halo PSA API helpers ──────────────────────────────────────────────────────

function Get-HaloToken($clientId, $clientSecret) {
    $body = "grant_type=client_credentials" +
            "&client_id=$([Uri]::EscapeDataString($clientId))" +
            "&client_secret=$([Uri]::EscapeDataString($clientSecret))" +
            "&scope=all"
    $resp = Invoke-RestMethod `
        -Uri "$HaloBaseUrl/auth/token" `
        -Method POST `
        -Body $body `
        -ContentType "application/x-www-form-urlencoded"
    return $resp.access_token
}

function Invoke-HaloGet($token, $path, $query = @{}) {
    $uri = "$HaloBaseUrl/api$path"
    if ($query.Count -gt 0) {
        $qs = ($query.GetEnumerator() | ForEach-Object { "$($_.Key)=$([Uri]::EscapeDataString($_.Value))" }) -join "&"
        $uri = "$uri?$qs"
    }
    return Invoke-RestMethod -Uri $uri -Method GET `
        -Headers @{ Authorization = "Bearer $token" }
}

function Invoke-HaloPost($token, $path, $body) {
    return Invoke-RestMethod -Uri "$HaloBaseUrl/api$path" -Method POST `
        -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
        -Body ($body | ConvertTo-Json -Depth 10)
}

# ── Banner ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║   Deployment Kit App — Automated Setup           ║" -ForegroundColor Blue
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""
Write-Host "  One manual step required before running:"
Write-Host "  · Create a Halo PSA API client"
Write-Host "    Admin → Integrations → API → New Application"
Write-Host "    Authentication: Client Credentials   Scope: all"
Write-Host ""
$confirm = Read-Host "Have you created the Halo API client? (y/n)"
if ($confirm -ne "y") { Fail "Create the Halo API client first, then re-run." }

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────

Write-Step 1 "Checking prerequisites"

foreach ($module in @("Az.Accounts", "Az.Resources", "Az.Websites", "Microsoft.Graph")) {
    if (-not (Get-Module -ListAvailable -Name $module)) {
        Write-Info "Installing $module..."
        Install-Module $module -Scope CurrentUser -Force -AllowClobber -Repository PSGallery
        Write-Ok "Installed $module"
    } else {
        Write-Ok "$module present"
    }
}

if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) {
    Write-Info "Installing GitHub CLI via winget..."
    try {
        winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("PATH", "User")
        Write-Ok "GitHub CLI installed"
    } catch {
        Fail "Could not install gh CLI. Install from https://cli.github.com and re-run."
    }
}

gh auth status 2>&1 | Out-Null
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
Write-Host "  Deployment settings (press Enter to accept defaults)" -ForegroundColor White
$rgInput   = Read-Host "    Resource group  [$ResourceGroup]"
$locInput  = Read-Host "    Azure region    [$Location]"
$nameInput = Read-Host "    SWA name        [$SiteName]"
if ($rgInput)   { $ResourceGroup = $rgInput }
if ($locInput)  { $Location = $locInput }
if ($nameInput) { $SiteName = $nameInput }

Write-Ok "Inputs collected"

# ── Step 3: Halo PSA custom fields ───────────────────────────────────────────

Write-Step 3 "Creating Halo PSA custom fields on Items"

# Field type IDs in Halo PSA: 1=Text, 2=Numeric, 3=Date, 4=Checkbox, 5=Dropdown
$requiredFields = @(
    @{ name = "CheckoutTo";    label = "Checked Out To"; type = 1 }
    @{ name = "CheckoutBy";    label = "Checked Out By"; type = 1 }
    @{ name = "CheckoutDate";  label = "Checkout Date";  type = 3 }
    @{ name = "CheckoutNotes"; label = "Checkout Notes"; type = 1 }
)

try {
    Write-Info "Authenticating with Halo PSA..."
    $haloToken = Get-HaloToken $HaloClientId $HaloClientSecret
    Write-Ok "Halo token acquired"

    # Fetch existing custom fields for the Items object type
    Write-Info "Fetching existing Item custom fields..."
    $existing = Invoke-HaloGet $haloToken "/CustomField" @{ objecttype = "items" }
    $existingNames = @($existing.customfields | Select-Object -ExpandProperty name)

    foreach ($field in $requiredFields) {
        if ($existingNames -contains $field.name) {
            Write-Ok "Already exists: $($field.name)"
            continue
        }

        Write-Info "Creating $($field.name)..."
        Invoke-HaloPost $haloToken "/CustomField" @{
            name       = $field.name
            label      = $field.label
            type       = $field.type
            objecttype = "items"
            searchable = $true
        } | Out-Null

        Write-Ok "Created: $($field.name) ($($field.label))"
    }
} catch {
    # Non-fatal — surface the error and let the user decide
    Write-Warn "Could not create custom fields automatically: $($_.Exception.Message)"
    Write-Warn "You may need to create them manually in Halo:"
    Write-Warn "  Admin → Items → Item Types → Custom Fields"
    Write-Warn "  Fields: CheckoutTo, CheckoutBy, CheckoutDate, CheckoutNotes"
    $cont = Read-Host "    Continue with the rest of setup anyway? (y/n)"
    if ($cont -ne "y") { exit 1 }
}

# ── Step 4: Azure login ───────────────────────────────────────────────────────

Write-Step 4 "Signing in to Azure"

Import-Module Az.Accounts -ErrorAction Stop

$ctx = Get-AzContext -ErrorAction SilentlyContinue
if (-not $ctx) {
    Connect-AzAccount
    $ctx = Get-AzContext
}
Write-Ok "Signed in as: $($ctx.Account.Id)"
Write-Ok "Subscription: $($ctx.Subscription.Name) ($($ctx.Subscription.Id))"

$TenantId = $ctx.Tenant.Id

# ── Step 5: Microsoft Graph login ────────────────────────────────────────────

Write-Step 5 "Connecting to Microsoft Graph"

Import-Module Microsoft.Graph.Applications -ErrorAction Stop
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

Connect-MgGraph -TenantId $TenantId -Scopes "Application.ReadWrite.All" -NoWelcome
Write-Ok "Connected to Microsoft Graph (tenant: $TenantId)"

# ── Step 6: Entra app registration ───────────────────────────────────────────

Write-Step 6 "Creating Entra app registration"

$appName = "Deployment Kit App"

# App roles for the application (values must match VALID_ROLES in api/shared/auth.ts)
$appRoleDefs = @(
    @{
        Id                  = [System.Guid]::NewGuid().ToString()
        DisplayName         = "Admin"
        Description         = "Admins — full access including admin pages"
        Value               = "admin"
        AllowedMemberTypes  = @("User")
        IsEnabled           = $true
    },
    @{
        Id                  = [System.Guid]::NewGuid().ToString()
        DisplayName         = "Technician"
        Description         = "Technicians — pull kits, returns, view stock"
        Value               = "technician"
        AllowedMemberTypes  = @("User")
        IsEnabled           = $true
    },
    @{
        Id                  = [System.Guid]::NewGuid().ToString()
        DisplayName         = "Receiver"
        Description         = "Receivers — receive POs, view stock"
        Value               = "receiver"
        AllowedMemberTypes  = @("User")
        IsEnabled           = $true
    }
)

# Emit the roles claim in the ID token so SWA includes it in x-ms-client-principal
$optionalClaims = @{
    IdToken     = @(@{ Name = "roles"; Essential = $false })
    AccessToken = @(@{ Name = "roles"; Essential = $false })
    Saml2Token  = @()
}

$existingApp = Get-MgApplication -Filter "displayName eq '$appName'" -ErrorAction SilentlyContinue
if ($existingApp) {
    Write-Warn "App '$appName' already exists — reusing it"
    $app = $existingApp

    # Merge in any missing app roles (do not disable or replace existing ones)
    $existingRoleValues = $app.AppRoles | Select-Object -ExpandProperty Value
    $rolesToAdd = $appRoleDefs | Where-Object { $_.Value -notin $existingRoleValues }
    if ($rolesToAdd.Count -gt 0) {
        $mergedRoles = @($app.AppRoles) + @($rolesToAdd)
        Update-MgApplication -ApplicationId $app.Id -AppRoles $mergedRoles -OptionalClaims $optionalClaims
        Write-Ok "Added missing app roles: $($rolesToAdd.Value -join ', ')"
    } else {
        # Still patch optional claims in case they were missing
        Update-MgApplication -ApplicationId $app.Id -OptionalClaims $optionalClaims
        Write-Ok "App roles already present; patched optional claims"
    }
} else {
    $app = New-MgApplication -DisplayName $appName `
        -SignInAudience "AzureADMyOrg" `
        -Web @{ ImplicitGrantSettings = @{ EnableIdTokenIssuance = $true } } `
        -AppRoles $appRoleDefs `
        -OptionalClaims $optionalClaims
    Write-Ok "Created app: $appName ($($app.AppId))"
}

$EntraClientId = $app.AppId

Write-Info "Generating client secret (24 month expiry)..."
$secret = Add-MgApplicationPassword -ApplicationId $app.Id -PasswordCredential @{
    DisplayName = "deployment-kit-$(Get-Date -Format 'yyyy-MM')"
    EndDateTime = (Get-Date).AddMonths(24)
}
$EntraClientSecret = $secret.SecretText
Write-Ok "Client secret created (expires $((Get-Date).AddMonths(24).ToString('yyyy-MM-dd')))"

# ── Step 7: Resource group ────────────────────────────────────────────────────

Write-Step 7 "Creating resource group: $ResourceGroup"

Import-Module Az.Resources -ErrorAction Stop

$rg = Get-AzResourceGroup -Name $ResourceGroup -ErrorAction SilentlyContinue
if ($rg) {
    Write-Warn "Resource group already exists — reusing"
} else {
    New-AzResourceGroup -Name $ResourceGroup -Location $Location | Out-Null
    Write-Ok "Created: $ResourceGroup ($Location)"
}

# ── Step 8: ARM deployment ────────────────────────────────────────────────────

Write-Step 8 "Deploying ARM template (this takes ~2 minutes)"

$templateFile = Join-Path $PSScriptRoot "azuredeploy.json"
if (-not (Test-Path $templateFile)) { Fail "azuredeploy.json not found in $PSScriptRoot" }

$deployment = New-AzResourceGroupDeployment `
    -ResourceGroupName $ResourceGroup `
    -TemplateFile $templateFile `
    -TemplateParameterObject @{
        siteName          = $SiteName
        location          = $Location
        entraTenantId     = $TenantId
        entraClientId     = $EntraClientId
        entraClientSecret = $EntraClientSecret
        haloClientId      = $HaloClientId
        haloClientSecret  = $HaloClientSecret
    } `
    -Name "deployment-kit-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

if ($deployment.ProvisioningState -ne "Succeeded") {
    Fail "ARM deployment failed: $($deployment.ProvisioningState)"
}

$SwaUrl      = $deployment.Outputs["swaUrl"].Value
$RedirectUri = $deployment.Outputs["entraRedirectUri"].Value

Write-Ok "Deployed successfully"
Write-Ok "App URL: $SwaUrl"

# ── Step 9: Patch Entra redirect URI ─────────────────────────────────────────

Write-Step 9 "Adding redirect URI to Entra app"

$currentApp   = Get-MgApplication -ApplicationId $app.Id
$existingUris = $currentApp.Web.RedirectUris ?? @()
$mergedUris   = ($existingUris + @($RedirectUri) | Select-Object -Unique)

Update-MgApplication -ApplicationId $app.Id -Web @{
    RedirectUris          = $mergedUris
    ImplicitGrantSettings = @{ EnableIdTokenIssuance = $true }
}
Write-Ok "Redirect URI added: $RedirectUri"

# ── Step 10: GitHub Actions secrets ──────────────────────────────────────────

Write-Step 10 "Setting GitHub Actions secrets"

$swaToken = az staticwebapp secrets list `
    --name $SiteName `
    --resource-group $ResourceGroup `
    --query "properties.apiKey" -o tsv
if (-not $swaToken) { Fail "Could not retrieve SWA deployment token" }

$repoSlug = $RepoUrl -replace "https://github.com/", ""

gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body $swaToken  --repo $repoSlug
gh secret set ENTRA_TENANT_ID                  --body $TenantId  --repo $repoSlug

Write-Ok "AZURE_STATIC_WEB_APPS_API_TOKEN set"
Write-Ok "ENTRA_TENANT_ID set"

# ── Step 11: Trigger first deployment ────────────────────────────────────────

Write-Step 11 "Triggering first GitHub Actions deployment"

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
Write-Host "  ─── Remaining manual steps ────────────────────────────────"
Write-Host ""
Write-Host "  1. Wait ~3 minutes for the GitHub Actions build to finish."
Write-Host "     Monitor: https://github.com/$repoSlug/actions"
Write-Host ""
Write-Host "  2. Open $SwaUrl in Safari on your iPad/iPhone."
Write-Host "     Sign in with your Entra account."
Write-Host ""
Write-Host "  3. Tap Share → Add to Home Screen to install as a kiosk app."
Write-Host ""
Write-Host "  4. In Entra, assign users/groups to app roles: admin, technician, receiver."
Write-Host "     Users must sign out/in (or refresh token) after role assignment."
Write-Host ""

$outputFile = Join-Path $PSScriptRoot "setup-output.txt"
@"
Deployment Kit App — Setup Output
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

App URL:           $SwaUrl
Entra Client ID:   $EntraClientId
Tenant ID:         $TenantId
Resource Group:    $ResourceGroup
SWA Name:          $SiteName

GitHub repo:       https://github.com/$repoSlug
Actions:           https://github.com/$repoSlug/actions

NOTE: Client secret is NOT saved here for security.
Store it in your password manager.
"@ | Set-Content $outputFile

Write-Host "  Output saved to: setup-output.txt" -ForegroundColor Gray
Write-Host ""
