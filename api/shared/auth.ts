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

/** Shape of the decoded SWA client principal (fields vary by runtime/version). */
export interface ClientPrincipal {
  userDetails: string;
  userRoles?: string[];
  claims?: Array<{ typ: string; val: unknown }>;
}

const VALID_ROLES: AppRole[] = ["admin", "technician", "receiver"];
const ROLE_ALIASES: Record<string, AppRole> = {
  admin: "admin",
  admins: "admin",
  technician: "technician",
  technicians: "technician",
  tech: "technician",
  techs: "technician",
  receiver: "receiver",
  receivers: "receiver",
};

function normalizeClaimType(typ: string): string {
  return typ.trim().toLowerCase();
}

/** Values may be string, array (AAD sometimes emits multiple role claims), or rare JSON scalars. */
export function extractRoleStringsFromClaimValue(val: unknown): string[] {
  if (val === null || val === undefined) return [];
  if (typeof val === "string") return val ? [val] : [];
  if (typeof val === "number" || typeof val === "boolean") return [String(val)];
  if (Array.isArray(val)) {
    const out: string[] = [];
    for (const item of val) out.push(...extractRoleStringsFromClaimValue(item));
    return out;
  }
  return [];
}

function claimTypeIsRoleClaim(typ: string): boolean {
  const t = normalizeClaimType(typ);
  if (t === "roles" || t === "role") return true;
  if (
    t === "http://schemas.microsoft.com/ws/2008/06/identity/claims/role" ||
    t === "https://schemas.microsoft.com/ws/2008/06/identity/claims/role"
  ) {
    return true;
  }
  // Some gateways normalize URI scheme or casing; keep a narrow suffix match.
  if (t.endsWith("/ws/2008/06/identity/claims/role")) return true;
  return false;
}

/** Decode SWA `x-ms-client-principal` header; returns null if missing or invalid. */
export function decodeClientPrincipal(req: HttpRequest): ClientPrincipal | null {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as ClientPrincipal;
  } catch {
    return null;
  }
}

/** Safe diagnostics: claim type names only (no values). */
export interface RoleClaimDiagnostics {
  /** Distinct claim `typ` strings present (capped). */
  claimTypes: string[];
  /** Which `typ` values were treated as role sources. */
  roleLikeClaimTypes: string[];
  /** How many raw role strings were considered (after flattening arrays). */
  roleCandidateCount: number;
  /** If no app role matched but at least one candidate was seen. */
  hadUnrecognizedRoleCandidates: boolean;
  /** Where the resolved role came from, if any. */
  resolutionSource: "userRoles" | "claims" | null;
}

function uniqueSorted(values: string[], cap: number): string[] {
  const u = [...new Set(values)].sort();
  return u.slice(0, cap);
}

/**
 * Resolve app role from a decoded client principal (used by HTTP handlers and tests).
 */
export function resolveAppRoleFromPrincipal(p: ClientPrincipal | null): {
  role: AppRole | null;
  diagnostics: RoleClaimDiagnostics;
} {
  const emptyDiag: RoleClaimDiagnostics = {
    claimTypes: [],
    roleLikeClaimTypes: [],
    roleCandidateCount: 0,
    hadUnrecognizedRoleCandidates: false,
    resolutionSource: null,
  };

  if (!p) {
    return { role: null, diagnostics: emptyDiag };
  }

  const allTypes = (p.claims ?? []).map((c) => c.typ);
  const claimTypes = uniqueSorted(allTypes, 50);

  const roleLikeClaimTypes = uniqueSorted(
    (p.claims ?? []).filter((c) => claimTypeIsRoleClaim(c.typ)).map((c) => c.typ),
    20
  );

  const rawFromUserRoles = (p.userRoles ?? []).filter(
    (r) => r && r !== "authenticated" && r !== "anonymous"
  );

  const rawFromClaims: string[] = [];
  for (const c of p.claims ?? []) {
    if (!claimTypeIsRoleClaim(c.typ)) continue;
    rawFromClaims.push(...extractRoleStringsFromClaimValue(c.val));
  }

  const candidates = [...rawFromUserRoles, ...rawFromClaims];
  const roleCandidateCount = candidates.length;

  const tryResolve = (source: "userRoles" | "claims"): AppRole | null => {
    const list = source === "userRoles" ? rawFromUserRoles : rawFromClaims;
    for (const rawRole of list) {
      if (typeof rawRole !== "string") continue;
      const exact = normalizeRole(rawRole);
      if (exact) return exact;
      const suffix = rawRole.split(/[./:\\|]/).pop();
      const fromSuffix = normalizeRole(suffix);
      if (fromSuffix) return fromSuffix;
    }
    return null;
  };

  let resolutionSource: "userRoles" | "claims" | null = null;
  let role = tryResolve("userRoles");
  if (role) resolutionSource = "userRoles";
  else {
    role = tryResolve("claims");
    if (role) resolutionSource = "claims";
  }

  const hadUnrecognizedRoleCandidates = role === null && roleCandidateCount > 0;

  return {
    role,
    diagnostics: {
      claimTypes,
      roleLikeClaimTypes,
      roleCandidateCount,
      hadUnrecognizedRoleCandidates,
      resolutionSource,
    },
  };
}

function normalizeRole(value: string | undefined): AppRole | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  if (VALID_ROLES.includes(lower as AppRole)) return lower as AppRole;

  const alias = ROLE_ALIASES[lower];
  if (alias) return alias;

  return null;
}

/** Extract email from the SWA client principal header. */
export function getCallerEmail(req: HttpRequest): string | null {
  const p = decodeClientPrincipal(req);
  if (!p) return null;
  return getCallerEmailFromPrincipal(p);
}

function claimTypeIsPreferredUsername(typ: string): boolean {
  return normalizeClaimType(typ) === "preferred_username";
}

function claimTypeIsEmail(typ: string): boolean {
  const t = normalizeClaimType(typ);
  return (
    t === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" ||
    t === "https://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" ||
    t === "email" ||
    t.endsWith("/identity/claims/emailaddress")
  );
}

export function getCallerEmailFromPrincipal(p: ClientPrincipal): string | null {
  for (const c of p.claims ?? []) {
    if (!claimTypeIsPreferredUsername(c.typ)) continue;
    const v = extractRoleStringsFromClaimValue(c.val)[0];
    if (v) return v;
  }
  for (const c of p.claims ?? []) {
    if (!claimTypeIsEmail(c.typ)) continue;
    const v = extractRoleStringsFromClaimValue(c.val)[0];
    if (v) return v;
  }
  return p.userDetails ?? null;
}

/** Resolve app role from Entra app role claims in client principal. */
export function getCallerRole(req: HttpRequest): AppRole | null {
  const p = decodeClientPrincipal(req);
  return resolveAppRoleFromPrincipal(p).role;
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
