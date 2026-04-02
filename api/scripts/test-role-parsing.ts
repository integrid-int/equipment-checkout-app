/**
 * Local regression tests for Entra / SWA client principal role parsing.
 * Run: cd api && npm run build && node dist/scripts/test-role-parsing.js
 */

import {
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

console.log(`OK: ${passed} role-parsing checks passed`);
