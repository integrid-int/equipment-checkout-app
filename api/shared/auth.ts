/**
 * Shared auth helpers for Azure Functions endpoints.
 * Reads the SWA-injected x-ms-client-principal header to identify the caller
 * and checks their role against the role store.
 */

import { HttpRequest } from "@azure/functions";
import { getUserRole, AppRole } from "./roleStore";

interface CallerInfo {
  email: string;
  role: AppRole;
}

/** Extract email from the SWA client principal header. */
export function getCallerEmail(req: HttpRequest): string | null {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      userDetails: string;
      claims?: Array<{ typ: string; val: string }>;
    };
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
  } catch {
    return null;
  }
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
  const role = await getUserRole(email);
  if (!role || !allowedRoles.includes(role)) return null;
  return { email, role };
}
