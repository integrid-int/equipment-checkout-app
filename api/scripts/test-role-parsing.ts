/**
 * Local regression tests for Entra / SWA client principal role parsing.
 * Run: cd api && npm run build && node dist/scripts/test-role-parsing.js
 */

import {
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
