# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Equipment Checkout App — an iPad/iPhone-compatible PWA for deployment kit management via Halo PSA. Two-tier architecture: React SPA frontend + Azure Functions (Node.js) API backend.

### Node version

Use **Node 20** (not 22). Azure Functions Core Tools v4 is incompatible with Node 22, and SWA CLI 2.0.1 also rejects Node 22. Switch via `nvm use 20`.

### SWA CLI version

Use **SWA CLI 2.0.1** (`@azure/static-web-apps-cli@2.0.1`). Versions 2.0.2+ have a [known bug](https://github.com/Azure/static-web-apps-cli/issues/947) that breaks AAD mock auth locally — the emulator returns `ENTRA_CLIENT_ID not found in env for 'aad' provider` instead of serving the mock login form.

### Running the dev environment

Standard commands are in `README.md` under "Local Development". Key caveats:

1. **Unset Entra env vars for SWA CLI**: When Entra secrets are injected as environment variables (as they are in Cloud Agent VMs), the SWA CLI tries real OAuth instead of mock auth. Start SWA with:
   ```bash
   env -u ENTRA_CLIENT_ID -u ENTRA_CLIENT_SECRET -u ENTRA_TENANT_ID -u ENTRA_ISSUER_URL \
     swa start http://localhost:5173 --api-location api --run "npm run dev"
   ```

2. **`api/local.settings.json` required**: Azure Functions Core Tools needs this file to know the runtime. If missing, `func start` prompts interactively (which hangs in non-TTY). The update script creates it from environment variables. Template:
   ```json
   {
     "IsEncrypted": false,
     "Values": {
       "AzureWebJobsStorage": "",
       "FUNCTIONS_WORKER_RUNTIME": "node",
       "HALO_CLIENT_ID": "<from env>",
       "HALO_CLIENT_SECRET": "<from env>",
       "ADMIN_EMAILS": "<from env>",
       "AZURE_STORAGE_CONNECTION_STRING": "<from env>",
       "ENTRA_CLIENT_ID": "<from env>",
       "ENTRA_CLIENT_SECRET": "<from env>",
       "ENTRA_TENANT_ID": "<from env>"
     }
   }
   ```

3. **Mock auth login**: After SWA CLI starts on port 4280, navigate to `http://localhost:4280`. You'll be redirected to the mock auth form. Fill in:
   - Username: use an email from `ADMIN_EMAILS` for admin access
   - Claims: `[{"typ":"preferred_username","val":"<email>"},{"typ":"name","val":"<name>"}]`

4. **`admin-roles` route conflict**: The `admin-roles` Azure Function shows an error about conflicting with built-in routes. This is a known issue with Azure Functions Core Tools and does not affect the other 7 API endpoints.

### Required secrets

All of these must be available as environment variables or in `api/local.settings.json`:
- `HALO_CLIENT_ID`, `HALO_CLIENT_SECRET` — Halo PSA API credentials (required for all API endpoints)
- `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID` — Microsoft Entra ID (needed in `local.settings.json` for API, but must be **unset** from the SWA CLI process)
- `ADMIN_EMAILS` — bootstrap admin email(s)
- `AZURE_STORAGE_CONNECTION_STRING` — Azure Table Storage (optional; roles fall back to `ADMIN_EMAILS`)

### Build and lint

- Frontend: `npm run build` (runs `tsc && vite build`)
- API: `cd api && npm run build` (runs `tsc`)
- No separate lint command is configured; TypeScript strict mode serves as the lint check via `tsc`.

### Ports

| Service | Port |
|---------|------|
| SWA emulator (entry point) | 4280 |
| Vite dev server | 5173 |
| Azure Functions API | 7071 |
