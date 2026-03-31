/**
 * Shared auth helpers for Azure Functions endpoints.
 * Reads the SWA-injected x-ms-client-principal header to identify the caller
 * and checks their role from Entra app-role claims.
 */

import { HttpRequest } from "@azure/functions";

export type AppRole = "admin" | "technician" | "receiver";

interface CallerInfo {
  email: string;
  role: AppRole;
}

interface ClientPrincipal {
  userDetails: string;
  userRoles?: string[];
  claims?: Array<{ typ: string; val: string }>;
}

const VALID_ROLES: AppRole[] = ["admin", "technician", "receiver"];

function decodePrincipal(req: HttpRequest): ClientPrincipal | null {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as ClientPrincipal;
  } catch {
    return null;
  }
}

/** Extract email from the SWA client principal header. */
export function getCallerEmail(req: HttpRequest): string | null {
  const p = decodePrincipal(req);
  if (!p) return null;
  return (
    p.claims?.find((c) => c.typ === "preferred_username")?.val ??
    p.claims?.find(
      (c) =>
        c.typ ===
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
    )?.val ??
    p.userDetails ??
    null
  );
}

function normalizeRole(value: string | undefined): AppRole | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  return VALID_ROLES.includes(lower as AppRole) ? (lower as AppRole) : null;
}

/** Resolve app role from Entra app role claims in client principal. */
export function getCallerRole(req: HttpRequest): AppRole | null {
  const p = decodePrincipal(req);
  if (!p) return null;

  const rawRolesFromUserRoles = (p.userRoles ?? []).filter(
    (r) => r && r !== "authenticated" && r !== "anonymous"
  );

  const rawRolesFromClaims = (p.claims ?? [])
    .filter(
      (c) =>
        c.typ === "roles" ||
        c.typ === "role" ||
        c.typ === "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
    )
    .map((c) => c.val);

  for (const rawRole of [...rawRolesFromUserRoles, ...rawRolesFromClaims]) {
    const exact = normalizeRole(rawRole);
    if (exact) return exact;

    // Support app-role values like "DeploymentKits.Admin"
    const suffix = rawRole.split(".").pop();
    const fromSuffix = normalizeRole(suffix);
    if (fromSuffix) return fromSuffix;
  }

  return null;
}

/**
 * Verify the caller has one of the allowed roles.
 * Returns caller info on success, or null if unauthorized.
 */
export async function requireRole(
  req: HttpRequest,
  allowedRoles: AppRole[]
): Promise<CallerInfo | null> {
  const email = getCallerEmail(req);
  if (!email) return null;
  const role = getCallerRole(req);
  if (!role || !allowedRoles.includes(role)) return null;
  return { email, role };
}
