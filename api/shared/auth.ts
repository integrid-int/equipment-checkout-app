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
const ROLE_NOISE = new Set(["authenticated", "anonymous"]);

function normalizeClaimType(typ: string): string {
  return typ.trim().toLowerCase();
}

function isNoiseRoleCandidate(value: string): boolean {
  return ROLE_NOISE.has(value.trim().toLowerCase());
}

function filterRoleCandidates(candidates: string[]): string[] {
  return candidates
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !isNoiseRoleCandidate(c));
}

function coerceClaims(rawClaims: unknown): Array<{ typ: string; val: unknown }> {
  const claims: Array<{ typ: string; val: unknown }> = [];
  if (Array.isArray(rawClaims)) {
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

  // Some runtimes expose claims as an object map: { claimType: value }.
  if (rawClaims && typeof rawClaims === "object") {
    for (const [key, value] of Object.entries(rawClaims as Record<string, unknown>)) {
      if (!key || !key.trim()) continue;
      claims.push({ typ: key, val: value });
    }
    return claims;
  }

  // Rare shape: claims serialized as JSON string.
  if (typeof rawClaims === "string") {
    try {
      return coerceClaims(JSON.parse(rawClaims));
    } catch {
      return [];
    }
  }

  return claims;
}

function coerceUserRoles(rawUserRoles: unknown): string[] {
  if (typeof rawUserRoles === "string") {
    return rawUserRoles
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
  }
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
  resolutionSource:
    | "userRoles"
    | "claims"
    | "rawPrincipal"
    | "idToken"
    | "accessToken"
    | "authToken"
    | "authMe"
    | null;
  /** How many role-like candidates came from AAD ID token fallback parsing. */
  idTokenRoleCandidateCount: number;
  /** How many role-like candidates came from AAD access token fallback parsing. */
  accessTokenRoleCandidateCount: number;
  /** How many role-like candidates came from x-ms-auth-token/authentication headers. */
  authTokenRoleCandidateCount: number;
  /** How many role-like candidates came from raw x-ms-client-principal parsing. */
  rawPrincipalRoleCandidateCount: number;
  /** How many role-like candidates came from /.auth/me fallback parsing. */
  authMeRoleCandidateCount: number;
  /** Whether /.auth/me fallback call was attempted. */
  authMeAttempted: boolean;
  /** Outcome of /.auth/me fallback call. */
  authMeFetchStatus: "not_attempted" | "ok" | "non_ok" | "error" | "no_url";
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
    accessTokenRoleCandidateCount: 0,
    authTokenRoleCandidateCount: 0,
    rawPrincipalRoleCandidateCount: 0,
    authMeRoleCandidateCount: 0,
    authMeAttempted: false,
    authMeFetchStatus: "not_attempted",
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

  const rawFromUserRoles = filterRoleCandidates(p.userRoles ?? []);

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
      accessTokenRoleCandidateCount: 0,
      authTokenRoleCandidateCount: 0,
      rawPrincipalRoleCandidateCount: 0,
      authMeRoleCandidateCount: 0,
      authMeAttempted: false,
      authMeFetchStatus: "not_attempted",
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

function decodeClientPrincipalRaw(req: HttpRequest): unknown | null {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function extractRawRoleCandidatesFromUnknown(
  node: unknown,
  keyHint: string | null = null,
  depth = 0
): string[] {
  if (depth > 8 || node === null || node === undefined) return [];

  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    if (!keyHint) return [];
    const k = keyHint.trim().toLowerCase();
    if (!k) return [];
    if (claimTypeIsRoleClaim(k) || k.includes("role")) return [String(node)];
    return [];
  }

  if (Array.isArray(node)) {
    const out: string[] = [];
    for (const child of node) {
      out.push(...extractRawRoleCandidatesFromUnknown(child, keyHint, depth + 1));
    }
    return out;
  }

  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: string[] = [];

    // Handle claim-like objects even when names differ from typ/val.
    const maybeClaim = obj as RawPrincipalClaim;
    const typSource = typeof maybeClaim.typ === "string" ? maybeClaim.typ : maybeClaim.type;
    const valSource = maybeClaim.val !== undefined ? maybeClaim.val : maybeClaim.value;
    if (typeof typSource === "string" && claimTypeIsRoleClaim(typSource)) {
      out.push(...extractRoleStringsFromClaimValue(valSource));
    }

    for (const [k, v] of Object.entries(obj)) {
      out.push(...extractRawRoleCandidatesFromUnknown(v, k, depth + 1));
    }
    return out;
  }

  return [];
}

function extractRawPrincipalRoleCandidates(req: HttpRequest): string[] {
  const raw = decodeClientPrincipalRaw(req);
  if (!raw) return [];
  return filterRoleCandidates(extractRawRoleCandidatesFromUnknown(raw));
}

function decodeTokenPayload(
  req: HttpRequest,
  headerName:
    | "x-ms-token-aad-id-token"
    | "x-ms-token-aad-access-token"
    | "x-ms-auth-token"
    | "authentication"
): Record<string, unknown> | null {
  const raw = req.headers.get(headerName);
  if (!raw) return null;

  const token = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : raw.trim();

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
  for (const rawRole of filterRoleCandidates(candidates)) {
    if (typeof rawRole !== "string") continue;
    const exact = normalizeRole(rawRole);
    if (exact) return exact;
    const suffix = rawRole.split(/[./:\\|]/).pop();
    const fromSuffix = normalizeRole(suffix);
    if (fromSuffix) return fromSuffix;
  }
  return null;
}

function extractTokenRoleCandidates(
  req: HttpRequest,
  headerName:
    | "x-ms-token-aad-id-token"
    | "x-ms-token-aad-access-token"
    | "x-ms-auth-token"
    | "authentication"
): string[] {
  const payload = decodeTokenPayload(req, headerName);
  if (!payload) return [];
  return filterRoleCandidates(extractRawRoleCandidatesFromUnknown(payload));
}

/**
 * Resolve role from principal claims, with fallback to SWA forwarded AAD tokens.
 */
export function resolveAppRole(req: HttpRequest): {
  role: AppRole | null;
  diagnostics: RoleClaimDiagnostics;
} {
  const principalResult = resolveAppRoleFromPrincipal(decodeClientPrincipal(req));
  if (principalResult.role) return principalResult;

  const rawPrincipalCandidates = extractRawPrincipalRoleCandidates(req);
  const roleFromRawPrincipal = resolveRoleFromCandidates(rawPrincipalCandidates);
  if (roleFromRawPrincipal) {
    return {
      role: roleFromRawPrincipal,
      diagnostics: {
        ...principalResult.diagnostics,
        roleCandidateCount:
          principalResult.diagnostics.roleCandidateCount + rawPrincipalCandidates.length,
        hadUnrecognizedRoleCandidates:
          principalResult.diagnostics.hadUnrecognizedRoleCandidates ||
          (rawPrincipalCandidates.length > 0 && roleFromRawPrincipal === null),
        resolutionSource: "rawPrincipal",
        rawPrincipalRoleCandidateCount: rawPrincipalCandidates.length,
      },
    };
  }

  const baseRoleCandidateCount =
    principalResult.diagnostics.roleCandidateCount + rawPrincipalCandidates.length;
  const hadUnrecognizedBeforeTokens =
    principalResult.diagnostics.hadUnrecognizedRoleCandidates ||
    rawPrincipalCandidates.length > 0;

  const idTokenCandidates = extractTokenRoleCandidates(req, "x-ms-token-aad-id-token");
  const roleFromIdToken = resolveRoleFromCandidates(idTokenCandidates);
  if (roleFromIdToken) {
    return {
      role: roleFromIdToken,
      diagnostics: {
        ...principalResult.diagnostics,
        roleCandidateCount:
          baseRoleCandidateCount + idTokenCandidates.length,
        hadUnrecognizedRoleCandidates:
          hadUnrecognizedBeforeTokens ||
          (idTokenCandidates.length > 0 && roleFromIdToken === null),
        resolutionSource: "idToken",
        idTokenRoleCandidateCount: idTokenCandidates.length,
        rawPrincipalRoleCandidateCount: rawPrincipalCandidates.length,
      },
    };
  }

  const accessTokenCandidates = extractTokenRoleCandidates(
    req,
    "x-ms-token-aad-access-token"
  );
  const roleFromAccessToken = resolveRoleFromCandidates(accessTokenCandidates);
  if (roleFromAccessToken || accessTokenCandidates.length > 0 || idTokenCandidates.length > 0) {
    const totalCandidates =
      baseRoleCandidateCount +
      idTokenCandidates.length +
      accessTokenCandidates.length;
    return {
      role: roleFromAccessToken,
      diagnostics: {
        ...principalResult.diagnostics,
        roleCandidateCount: totalCandidates,
        hadUnrecognizedRoleCandidates:
          roleFromAccessToken === null && totalCandidates > 0,
        resolutionSource: roleFromAccessToken ? "accessToken" : null,
        idTokenRoleCandidateCount: idTokenCandidates.length,
        accessTokenRoleCandidateCount: accessTokenCandidates.length,
        authTokenRoleCandidateCount: 0,
        rawPrincipalRoleCandidateCount: rawPrincipalCandidates.length,
      },
    };
  }

  const authTokenCandidates = [
    ...extractTokenRoleCandidates(req, "x-ms-auth-token"),
    ...extractTokenRoleCandidates(req, "authentication"),
  ];
  const roleFromAuthToken = resolveRoleFromCandidates(authTokenCandidates);
  if (roleFromAuthToken || authTokenCandidates.length > 0) {
    const totalCandidates =
      baseRoleCandidateCount + authTokenCandidates.length;
    return {
      role: roleFromAuthToken,
      diagnostics: {
        ...principalResult.diagnostics,
        roleCandidateCount: totalCandidates,
        hadUnrecognizedRoleCandidates:
          roleFromAuthToken === null && totalCandidates > 0,
        resolutionSource: roleFromAuthToken ? "authToken" : null,
        authTokenRoleCandidateCount: authTokenCandidates.length,
        rawPrincipalRoleCandidateCount: rawPrincipalCandidates.length,
      },
    };
  }

  return {
    role: null,
    diagnostics: {
      ...principalResult.diagnostics,
      roleCandidateCount: baseRoleCandidateCount,
      hadUnrecognizedRoleCandidates: hadUnrecognizedBeforeTokens,
      accessTokenRoleCandidateCount: 0,
      authTokenRoleCandidateCount: 0,
      rawPrincipalRoleCandidateCount: rawPrincipalCandidates.length,
    },
  };
}

function firstForwardedValue(v: string | null): string | null {
  if (!v) return null;
  const first = v.split(",")[0]?.trim();
  return first || null;
}

function originFromUrlLikeValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function buildAuthMeUrl(req: HttpRequest): string | null {
  const originalUrlOrigin = originFromUrlLikeValue(req.headers.get("x-ms-original-url"));
  if (originalUrlOrigin) return `${originalUrlOrigin}/.auth/me`;

  const originHeader = originFromUrlLikeValue(req.headers.get("origin"));
  if (originHeader) return `${originHeader}/.auth/me`;

  const refererOrigin = originFromUrlLikeValue(req.headers.get("referer"));
  if (refererOrigin) return `${refererOrigin}/.auth/me`;

  const hostFromHeaders =
    firstForwardedValue(req.headers.get("x-forwarded-host")) ??
    firstForwardedValue(req.headers.get("host"));
  if (hostFromHeaders) {
    const proto = firstForwardedValue(req.headers.get("x-forwarded-proto")) ?? "https";
    return `${proto}://${hostFromHeaders}/.auth/me`;
  }

  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}/.auth/me`;
  } catch {
    return null;
  }
}

interface SwaMeResponse {
  clientPrincipal?: {
    userDetails?: unknown;
    userRoles?: unknown;
    claims?: unknown;
  } | null;
}

interface AuthMeFetchResult {
  principal: ClientPrincipal | null;
  attempted: boolean;
  status: "not_attempted" | "ok" | "non_ok" | "error" | "no_url";
}

async function fetchAuthMePrincipal(req: HttpRequest): Promise<AuthMeFetchResult> {
  const url = buildAuthMeUrl(req);
  if (!url) {
    return { principal: null, attempted: false, status: "no_url" };
  }

  const cookie = req.headers.get("cookie");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) return { principal: null, attempted: true, status: "non_ok" };
    const data = (await resp.json()) as SwaMeResponse;
    const cp = data?.clientPrincipal;
    if (!cp || typeof cp !== "object") {
      return { principal: null, attempted: true, status: "ok" };
    }
    return {
      attempted: true,
      status: "ok",
      principal: {
        userDetails: typeof cp.userDetails === "string" ? cp.userDetails : "",
        userRoles: coerceUserRoles(cp.userRoles),
        claims: coerceClaims(cp.claims),
      },
    };
  } catch {
    return { principal: null, attempted: true, status: "error" };
  }
}

/**
 * Resolve role with all server-side fallbacks:
 * 1) x-ms-client-principal
 * 2) x-ms-token-aad-id-token
 * 3) x-ms-token-aad-access-token
 * 4) /.auth/me using caller cookies
 */
export async function resolveAppRoleWithFallback(req: HttpRequest): Promise<{
  role: AppRole | null;
  diagnostics: RoleClaimDiagnostics;
}> {
  const fromPrincipalOrTokens = resolveAppRole(req);
  if (fromPrincipalOrTokens.role) return fromPrincipalOrTokens;

  const authMeFetch = await fetchAuthMePrincipal(req);
  const authMeResolved = resolveAppRoleFromPrincipal(authMeFetch.principal);
  const authMeCandidates = authMeResolved.diagnostics.roleCandidateCount;
  const role = authMeResolved.role;
  const totalCandidates =
    fromPrincipalOrTokens.diagnostics.roleCandidateCount + authMeCandidates;

  return {
    role,
    diagnostics: {
      ...fromPrincipalOrTokens.diagnostics,
      roleCandidateCount: totalCandidates,
      hadUnrecognizedRoleCandidates:
        role === null && (totalCandidates > 0),
      resolutionSource: role ? "authMe" : fromPrincipalOrTokens.diagnostics.resolutionSource,
      authMeRoleCandidateCount: authMeCandidates,
      authMeAttempted: authMeFetch.attempted,
      authMeFetchStatus: authMeFetch.status,
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
