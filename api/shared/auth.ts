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

interface RawClientPrincipal {
  userDetails?: unknown;
  userRoles?: unknown;
  claims?: unknown;
}

interface RawPrincipalClaim {
  typ?: unknown;
  val?: unknown;
  type?: unknown;
  value?: unknown;
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

function coerceClaims(rawClaims: unknown): Array<{ typ: string; val: unknown }> {
  if (!Array.isArray(rawClaims)) return [];

  const claims: Array<{ typ: string; val: unknown }> = [];
  for (const raw of rawClaims) {
    if (!raw || typeof raw !== "object") continue;
    const claim = raw as RawPrincipalClaim;
    const typSource = typeof claim.typ === "string" ? claim.typ : claim.type;
    if (typeof typSource !== "string" || !typSource.trim()) continue;

    const valSource = claim.val !== undefined ? claim.val : claim.value;
    claims.push({ typ: typSource, val: valSource });
  }

  return claims;
}

function coerceUserRoles(rawUserRoles: unknown): string[] {
  if (!Array.isArray(rawUserRoles)) return [];
  return rawUserRoles.filter((r): r is string => typeof r === "string");
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
    t === "https://schemas.microsoft.com/ws/2008/06/identity/claims/role" ||
    t === "http://schemas.microsoft.com/ws/2008/06/identity/claims/roles" ||
    t === "https://schemas.microsoft.com/ws/2008/06/identity/claims/roles"
  ) {
    return true;
  }
  // Some gateways normalize URI scheme/casing or use plural claim names.
  if (
    t.endsWith("/ws/2008/06/identity/claims/role") ||
    t.endsWith("/ws/2008/06/identity/claims/roles") ||
    t.endsWith("/identity/claims/role") ||
    t.endsWith("/identity/claims/roles")
  ) {
    return true;
  }
  return false;
}

/** Decode SWA `x-ms-client-principal` header; returns null if missing or invalid. */
export function decodeClientPrincipal(req: HttpRequest): ClientPrincipal | null {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(header, "base64").toString("utf8")
    ) as RawClientPrincipal;

    return {
      userDetails: typeof parsed.userDetails === "string" ? parsed.userDetails : "",
      userRoles: coerceUserRoles(parsed.userRoles),
      claims: coerceClaims(parsed.claims),
    };
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
  resolutionSource: "userRoles" | "claims" | "idToken" | "authMe" | null;
  /** How many role-like candidates came from AAD ID token fallback parsing. */
  idTokenRoleCandidateCount: number;
  /** How many role-like candidates came from /.auth/me fallback parsing. */
  authMeRoleCandidateCount: number;
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
    idTokenRoleCandidateCount: 0,
    authMeRoleCandidateCount: 0,
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
      idTokenRoleCandidateCount: 0,
      authMeRoleCandidateCount: 0,
    },
  };
}

function decodeJwtPartBase64Url(part: string): string | null {
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4;
    const padded = padding === 0 ? normalized : `${normalized}${"=".repeat(4 - padding)}`;
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function decodeIdTokenPayload(req: HttpRequest): Record<string, unknown> | null {
  const token = req.headers.get("x-ms-token-aad-id-token");
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payloadJson = decodeJwtPartBase64Url(parts[1]);
  if (!payloadJson) return null;

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    return payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function resolveRoleFromCandidates(candidates: string[]): AppRole | null {
  for (const rawRole of candidates) {
    if (typeof rawRole !== "string") continue;
    const exact = normalizeRole(rawRole);
    if (exact) return exact;
    const suffix = rawRole.split(/[./:\\|]/).pop();
    const fromSuffix = normalizeRole(suffix);
    if (fromSuffix) return fromSuffix;
  }
  return null;
}

function extractIdTokenRoleCandidates(req: HttpRequest): string[] {
  const payload = decodeIdTokenPayload(req);
  if (!payload) return [];

  const out: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!claimTypeIsRoleClaim(key)) continue;
    out.push(...extractRoleStringsFromClaimValue(value));
  }
  return out;
}

/**
 * Resolve role from principal claims, with fallback to SWA forwarded AAD ID token.
 */
export function resolveAppRole(req: HttpRequest): {
  role: AppRole | null;
  diagnostics: RoleClaimDiagnostics;
} {
  const principalResult = resolveAppRoleFromPrincipal(decodeClientPrincipal(req));
  if (principalResult.role) return principalResult;

  const idTokenCandidates = extractIdTokenRoleCandidates(req);
  if (idTokenCandidates.length === 0) return principalResult;

  const roleFromIdToken = resolveRoleFromCandidates(idTokenCandidates);
  return {
    role: roleFromIdToken,
    diagnostics: {
      ...principalResult.diagnostics,
      roleCandidateCount:
        principalResult.diagnostics.roleCandidateCount + idTokenCandidates.length,
      hadUnrecognizedRoleCandidates:
        roleFromIdToken === null &&
        (principalResult.diagnostics.hadUnrecognizedRoleCandidates ||
          idTokenCandidates.length > 0),
      resolutionSource: roleFromIdToken ? "idToken" : null,
      idTokenRoleCandidateCount: idTokenCandidates.length,
      authMeRoleCandidateCount: 0,
    },
  };
}

function firstForwardedValue(v: string | null): string | null {
  if (!v) return null;
  const first = v.split(",")[0]?.trim();
  return first || null;
}

function buildAuthMeUrl(req: HttpRequest): string | null {
  const host =
    firstForwardedValue(req.headers.get("x-forwarded-host")) ??
    firstForwardedValue(req.headers.get("host"));
  if (!host) return null;
  const proto = firstForwardedValue(req.headers.get("x-forwarded-proto")) ?? "https";
  return `${proto}://${host}/.auth/me`;
}

interface SwaMeResponse {
  clientPrincipal?: {
    userDetails?: unknown;
    userRoles?: unknown;
    claims?: unknown;
  } | null;
}

async function fetchAuthMePrincipal(req: HttpRequest): Promise<ClientPrincipal | null> {
  const url = buildAuthMeUrl(req);
  if (!url) return null;

  const cookie = req.headers.get("cookie");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const data = (await resp.json()) as SwaMeResponse;
    const cp = data?.clientPrincipal;
    if (!cp || typeof cp !== "object") return null;
    return {
      userDetails: typeof cp.userDetails === "string" ? cp.userDetails : "",
      userRoles: coerceUserRoles(cp.userRoles),
      claims: coerceClaims(cp.claims),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve role with all server-side fallbacks:
 * 1) x-ms-client-principal
 * 2) x-ms-token-aad-id-token
 * 3) /.auth/me using caller cookies
 */
export async function resolveAppRoleWithFallback(req: HttpRequest): Promise<{
  role: AppRole | null;
  diagnostics: RoleClaimDiagnostics;
}> {
  const fromPrincipalOrIdToken = resolveAppRole(req);
  if (fromPrincipalOrIdToken.role) return fromPrincipalOrIdToken;

  const authMePrincipal = await fetchAuthMePrincipal(req);
  const authMeResolved = resolveAppRoleFromPrincipal(authMePrincipal);
  const authMeCandidates = authMeResolved.diagnostics.roleCandidateCount;
  const role = authMeResolved.role;

  return {
    role,
    diagnostics: {
      ...fromPrincipalOrIdToken.diagnostics,
      roleCandidateCount:
        fromPrincipalOrIdToken.diagnostics.roleCandidateCount + authMeCandidates,
      hadUnrecognizedRoleCandidates:
        role === null &&
        (fromPrincipalOrIdToken.diagnostics.hadUnrecognizedRoleCandidates ||
          authMeResolved.diagnostics.hadUnrecognizedRoleCandidates),
      resolutionSource: role ? "authMe" : fromPrincipalOrIdToken.diagnostics.resolutionSource,
      authMeRoleCandidateCount: authMeCandidates,
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
  return resolveAppRole(req).role;
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
  const role = (await resolveAppRoleWithFallback(req)).role;
  if (!role || !allowedRoles.includes(role)) return null;
  return { email, role };
}
