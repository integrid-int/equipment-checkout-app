/**
 * GET /api/me
 * Returns the current user's email and their assigned app role.
 * The SWA edge injects x-ms-client-principal from the Entra token.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getUserRole } from "../shared/roleStore";
import { appendFileSync } from "fs";

app.http("me", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "me",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      // SWA injects the client principal as a base64 header
      const principalHeader = req.headers.get("x-ms-client-principal");
      // #region agent log
      try { appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "B", location: "api/me/index.ts:20", message: "me handler entry", data: { hasPrincipalHeader: Boolean(principalHeader) }, timestamp: Date.now() }) + "\n"); } catch {}
      // #endregion
      if (!principalHeader) {
        return { status: 401, jsonBody: { error: "Not authenticated" } };
      }

      const principal = JSON.parse(
        Buffer.from(principalHeader, "base64").toString("utf8")
      ) as {
        userDetails: string;
        claims?: Array<{ typ: string; val: string }>;
      };

      const email =
        principal.claims?.find((c) => c.typ === "preferred_username")?.val ??
        principal.claims?.find((c) => c.typ === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")?.val ??
        principal.userDetails;

      const displayName =
        principal.claims?.find((c) => c.typ === "name")?.val ??
        principal.userDetails;
      // #region agent log
      try { appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "B", location: "api/me/index.ts:40", message: "me derived identity", data: { hasEmail: Boolean(email), hasDisplayName: Boolean(displayName) }, timestamp: Date.now() }) + "\n"); } catch {}
      // #endregion

      if (!email) {
        return { status: 400, jsonBody: { error: "Could not determine user email from token" } };
      }

      const role = await getUserRole(email);
      // #region agent log
      try { appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "B", location: "api/me/index.ts:47", message: "me handler success", data: { role: role ?? null }, timestamp: Date.now() }) + "\n"); } catch {}
      // #endregion

      return {
        status: 200,
        jsonBody: { email, displayName, role },
      };
    } catch (err) {
      // #region agent log
      try { appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "D", location: "api/me/index.ts:54", message: "me handler error", data: { error: err instanceof Error ? err.message : String(err) }, timestamp: Date.now() }) + "\n"); } catch {}
      // #endregion
      ctx.error("me error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
