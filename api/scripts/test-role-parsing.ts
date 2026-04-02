/**
 * Local regression tests for Entra / SWA client principal role parsing.
 * Run: cd api && npm run build && node dist/scripts/test-role-parsing.js
 */

import {
  resolveAppRole,
  resolveAppRoleWithFallback,
  decodeClientPrincipal,
  resolveAppRoleFromPrincipal,
  type ClientPrincipal,
} from "../shared/auth";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const cases: Array<{ name: string; p: ClientPrincipal; expectRole: "admin" | "technician" | "receiver" | null }> = [
  {
    name: "standard roles claim",
    p: {
      userDetails: "u@x.com",
      claims: [{ typ: "roles", val: "admin" }],
    },
    expectRole: "admin",
  },
  {
    name: "Role claim type capital R (case-insensitive typ)",
    p: {
      userDetails: "u@x.com",
      claims: [{ typ: "Role", val: "receiver" }],
    },
    expectRole: "receiver",
  },
  {
    name: "https scheme Microsoft role URI",
    p: {
      userDetails: "u@x.com",
      claims: [
        {
          typ: "https://schemas.microsoft.com/ws/2008/06/identity/claims/role",
          val: "technician",
        },
      ],
    },
    expectRole: "technician",
  },
  {
    name: "http scheme with uppercase HTTP in URI",
    p: {
      userDetails: "u@x.com",
      claims: [
        {
          typ: "HTTP://schemas.microsoft.com/ws/2008/06/identity/claims/role",
          val: "admin",
        },
      ],
    },
    expectRole: "admin",
  },
  {
    name: "roles val as array (multi-value)",
    p: {
      userDetails: "u@x.com",
      claims: [{ typ: "roles", val: ["foo", "DeploymentKits.Technician"] }],
    },
    expectRole: "technician",
  },
  {
    name: "alternate claim key names (type/value)",
    p: {
      userDetails: "u@x.com",
      claims: [{ typ: "roles", val: "admin" }],
    },
    expectRole: "admin",
  },
  {
    name: "userRoles with dotted suffix",
    p: {
      userDetails: "u@x.com",
      userRoles: ["authenticated", "MyApp.receivers"],
    },
    expectRole: "receiver",
  },
  {
    name: "suffix split by backslash",
    p: {
      userDetails: "u@x.com",
      claims: [{ typ: "roles", val: "App\\admins" }],
    },
    expectRole: "admin",
  },
  {
    name: "no role claim",
    p: { userDetails: "u@x.com", claims: [{ typ: "sub", val: "x" }] },
    expectRole: null,
  },
];

let passed = 0;
for (const c of cases) {
  const { role, diagnostics } = resolveAppRoleFromPrincipal(c.p);
  assert(role === c.expectRole, `${c.name}: expected role ${c.expectRole}, got ${role}`);
  if (c.expectRole === null && diagnostics.roleCandidateCount === 0) {
    assert(!diagnostics.hadUnrecognizedRoleCandidates, `${c.name}: diag should not flag unrecognized`);
  }
  passed++;
}

// Validate coercion from raw claim shape (type/value)
const rawTypeValue = {
  userDetails: "u@x.com",
  claims: [{ type: "roles", value: "admin" }],
};
const b64 = Buffer.from(JSON.stringify(rawTypeValue)).toString("base64");
const req = {
  headers: { get: (name: string) => (name === "x-ms-client-principal" ? b64 : null) },
} as unknown as import("@azure/functions").HttpRequest;
const decoded = decodeClientPrincipal(req);
assert(decoded?.claims?.[0]?.typ === "roles", "decode should normalize claim type from `type`");
assert(decoded?.claims?.[0]?.val === "admin", "decode should normalize claim value from `value`");
assert(resolveAppRoleFromPrincipal(decoded).role === "admin", "decoded raw type/value claim should resolve admin");
passed++;

// Unrecognized candidates flag
const unrec: ClientPrincipal = {
  userDetails: "u@x.com",
  claims: [{ typ: "roles", val: "UnknownRole.Value" }],
};
const d = resolveAppRoleFromPrincipal(unrec);
assert(d.role === null, "unrecognized role value");
assert(d.diagnostics.hadUnrecognizedRoleCandidates, "should set hadUnrecognizedRoleCandidates");
assert(d.diagnostics.roleCandidateCount === 1, "candidate count");
passed++;

// Fallback: x-ms-client-principal has no role claims but forwarded AAD ID token does.
const mkUnsignedJwt = (payload: Record<string, unknown>) => {
  const enc = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc(payload)}.`;
};

const principalWithoutRoles = {
  userDetails: "u@x.com",
  userRoles: ["authenticated", "anonymous"],
  claims: [{ typ: "name", val: "User Example" }],
};
const reqWithIdTokenFallback = {
  headers: {
    get: (name: string) => {
      if (name === "x-ms-client-principal") {
        return Buffer.from(JSON.stringify(principalWithoutRoles)).toString("base64");
      }
      if (name === "x-ms-token-aad-id-token") {
        return mkUnsignedJwt({
          roles: ["admin"],
          aud: "test-audience",
        });
      }
      return null;
    },
  },
} as unknown as import("@azure/functions").HttpRequest;

const fallbackResolved = resolveAppRole(reqWithIdTokenFallback);
assert(fallbackResolved.role === "admin", "id token fallback should resolve admin role");
assert(fallbackResolved.diagnostics.resolutionSource === "idToken", "resolution source should be idToken");
assert(
  fallbackResolved.diagnostics.idTokenRoleCandidateCount > 0,
  "id token fallback should contribute candidates"
);
passed++;

// Fallback: principal + id token miss roles, but /.auth/me has them.
const reqWithAuthMeFallback = {
  headers: {
    get: (name: string) => {
      if (name === "x-ms-client-principal") {
        return Buffer.from(JSON.stringify(principalWithoutRoles)).toString("base64");
      }
      if (name === "host") return "example.test";
      if (name === "x-forwarded-proto") return "https";
      if (name === "cookie") return "StaticWebAppsAuthCookie=test";
      return null;
    },
  },
} as unknown as import("@azure/functions").HttpRequest;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (!url.endsWith("/.auth/me")) throw new Error(`Unexpected fetch URL: ${url}`);
  return new Response(
    JSON.stringify({
      clientPrincipal: {
        userDetails: "u@x.com",
        userRoles: ["authenticated"],
        claims: [{ typ: "roles", val: "admin" }],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}) as typeof fetch;

async function runAsyncChecks() {
  try {
    const authMeResolved = await resolveAppRoleWithFallback(reqWithAuthMeFallback);
    assert(authMeResolved.role === "admin", "authMe fallback should resolve admin role");
    assert(authMeResolved.diagnostics.resolutionSource === "authMe", "resolution source should be authMe");
    assert(
      authMeResolved.diagnostics.authMeRoleCandidateCount > 0,
      "authMe fallback should contribute candidates"
    );
    passed++;
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`OK: ${passed} role-parsing checks passed`);
}

runAsyncChecks().catch((err) => {
  console.error(err);
  process.exit(1);
});
