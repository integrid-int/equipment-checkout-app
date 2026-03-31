#!/usr/bin/env bash
# deploy.sh — One-command deploy of Equipment Checkout to Azure
# Usage: ./deploy.sh
# Prerequisites: az CLI, gh CLI (optional for GitHub secrets)

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

header() { echo -e "\n${BOLD}${GREEN}▶ $1${NC}"; }
warn()   { echo -e "${YELLOW}⚠ $1${NC}"; }
die()    { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────────
header "Checking prerequisites"
command -v az  >/dev/null 2>&1 || die "Azure CLI not found. Install: https://docs.microsoft.com/cli/azure/install-azure-cli"
command -v jq  >/dev/null 2>&1 || die "jq not found. Install: brew install jq"
az account show >/dev/null 2>&1 || { warn "Not logged in. Running az login..."; az login; }

# ── Gather inputs ────────────────────────────────────────────────────────────
header "Configuration"

read -rp "  Resource group name  [equipment-checkout-rg]: " RG
RG="${RG:-equipment-checkout-rg}"

read -rp "  Azure region         [eastus2]:                " LOCATION
LOCATION="${LOCATION:-eastus2}"

read -rp "  SWA resource name    [equipment-checkout]:     " SITE_NAME
SITE_NAME="${SITE_NAME:-equipment-checkout}"

read -rp "  GitHub repo URL      (e.g. https://github.com/org/repo): " REPO_URL
[[ -z "$REPO_URL" ]] && die "Repository URL is required"

echo ""
echo -e "${BOLD}Entra / Azure AD${NC}"
read -rp "  Tenant ID:           " TENANT_ID
[[ -z "$TENANT_ID" ]] && die "Tenant ID is required"

read -rp "  App Client ID:       " ENTRA_CLIENT_ID
[[ -z "$ENTRA_CLIENT_ID" ]] && die "Entra Client ID is required"

read -rsp "  App Client Secret:   " ENTRA_CLIENT_SECRET; echo
[[ -z "$ENTRA_CLIENT_SECRET" ]] && die "Entra Client Secret is required"

echo ""
echo -e "${BOLD}Halo PSA${NC}"
read -rp "  Halo Client ID:      " HALO_CLIENT_ID
[[ -z "$HALO_CLIENT_ID" ]] && die "Halo Client ID is required"

read -rsp "  Halo Client Secret:  " HALO_CLIENT_SECRET; echo
[[ -z "$HALO_CLIENT_SECRET" ]] && die "Halo Client Secret is required"

read -rp "  Status ID Available  [1]: " HALO_STATUS_AVAILABLE
HALO_STATUS_AVAILABLE="${HALO_STATUS_AVAILABLE:-1}"

read -rp "  Status ID In Use     [2]: " HALO_STATUS_IN_USE
HALO_STATUS_IN_USE="${HALO_STATUS_IN_USE:-2}"

echo ""
# ── Resource Group ────────────────────────────────────────────────────────────
header "Creating resource group: $RG"
az group create \
  --name "$RG" \
  --location "$LOCATION" \
  --output none
echo "  Done."

# ── ARM Deployment ────────────────────────────────────────────────────────────
header "Deploying ARM template"
DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$RG" \
  --template-file azuredeploy.json \
  --parameters \
      siteName="$SITE_NAME" \
      location="$LOCATION" \
      entraTenantId="$TENANT_ID" \
      entraClientId="$ENTRA_CLIENT_ID" \
      entraClientSecret="$ENTRA_CLIENT_SECRET" \
      haloClientId="$HALO_CLIENT_ID" \
      haloClientSecret="$HALO_CLIENT_SECRET" \
  --output json)

SWA_URL=$(echo "$DEPLOY_OUTPUT" | jq -r '.properties.outputs.swaUrl.value')
REDIRECT_URI=$(echo "$DEPLOY_OUTPUT" | jq -r '.properties.outputs.entraRedirectUri.value')

# ── GitHub Secrets ────────────────────────────────────────────────────────────
if command -v gh >/dev/null 2>&1; then
  header "Setting GitHub Actions secrets"
  # Get the SWA deployment token
  SWA_TOKEN=$(az staticwebapp secrets list \
    --name "$SITE_NAME" \
    --resource-group "$RG" \
    --query "properties.apiKey" -o tsv)

  # Detect repo owner/name from URL
  REPO_SLUG=$(echo "$REPO_URL" | sed 's|https://github.com/||')

  gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body "$SWA_TOKEN" --repo "$REPO_SLUG"
  gh secret set ENTRA_TENANT_ID                  --body "$TENANT_ID"             --repo "$REPO_SLUG"
  echo "  Secrets set on $REPO_SLUG"
else
  warn "gh CLI not found — set the following GitHub secrets manually:"
  echo ""
  SWA_TOKEN=$(az staticwebapp secrets list \
    --name "$SITE_NAME" \
    --resource-group "$RG" \
    --query "properties.apiKey" -o tsv)
  echo "  AZURE_STATIC_WEB_APPS_API_TOKEN = $SWA_TOKEN"
  echo "  ENTRA_TENANT_ID                 = $TENANT_ID"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
header "Deployment complete!"
echo ""
echo -e "  ${BOLD}App URL:${NC}          $SWA_URL"
echo -e "  ${BOLD}Entra redirect:${NC}   $REDIRECT_URI"
echo ""
echo -e "${YELLOW}Next step:${NC} Add this Redirect URI to your Entra app registration:"
echo -e "  portal.azure.com → Azure AD → App registrations → your app → Authentication"
echo -e "  Add redirect URI: ${BOLD}$REDIRECT_URI${NC}"
echo ""
echo -e "${YELLOW}Then push to 'main' to trigger the first deployment.${NC}"
