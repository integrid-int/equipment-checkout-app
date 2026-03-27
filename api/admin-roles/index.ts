/**
 * GET  /api/admin-roles         — list all role assignments
 * POST /api/admin-roles         — assign or update a user's role
 * DELETE /api/admin-roles?email — remove a user's role assignment
 *
 * All endpoints require the caller to have the "admin" role.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getUserRole, listRoles, setRole, deleteRole, AppRole } from "../shared/roleStore";

async function getCallerEmail(req: HttpRequest): Promise<string | null> {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      userDetails: string;
      claims?: Array<{ typ: string; val: string }>;
    };
    return (
      p.claims?.find((c) => c.typ === "preferred_username")?.val ??
      p.claims?.find((c) => c.typ === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")?.val ??
      p.userDetails
    );
  } catch {
    return null;
  }
}

async function requireAdmin(req: HttpRequest): Promise<string | null> {
  const email = await getCallerEmail(req);
  if (!email) return null;
  const role = await getUserRole(email);
  return role === "admin" ? email : null;
}

app.http("admin-roles", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "anonymous",
  route: "admin-roles",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const callerEmail = await requireAdmin(req);
      if (!callerEmail) {
        return { status: 403, jsonBody: { error: "Admin role required" } };
      }

      if (req.method === "GET") {
        const roles = await listRoles();
        return { status: 200, jsonBody: { roles } };
      }

      if (req.method === "POST") {
        const body = (await req.json()) as { email: string; role: AppRole };
        if (!body.email || !body.role) {
          return { status: 400, jsonBody: { error: "email and role are required" } };
        }
        const validRoles: AppRole[] = ["admin", "technician", "receiver"];
        if (!validRoles.includes(body.role)) {
          return { status: 400, jsonBody: { error: `role must be one of: ${validRoles.join(", ")}` } };
        }
        // Prevent removing own admin role
        if (body.email.toLowerCase() === callerEmail.toLowerCase() && body.role !== "admin") {
          return { status: 400, jsonBody: { error: "Cannot remove your own admin role" } };
        }
        await setRole(body.email, body.role);
        return { status: 200, jsonBody: { success: true } };
      }

      if (req.method === "DELETE") {
        const email = req.query.get("email");
        if (!email) return { status: 400, jsonBody: { error: "email query param required" } };
        if (email.toLowerCase() === callerEmail.toLowerCase()) {
          return { status: 400, jsonBody: { error: "Cannot delete your own role assignment" } };
        }
        await deleteRole(email);
        return { status: 200, jsonBody: { success: true } };
      }

      return { status: 405, jsonBody: { error: "Method not allowed" } };
    } catch (err) {
      ctx.error("admin-roles error:", err);
      return { status: 500, jsonBody: { error: (err as Error).message } };
    }
  },
});
