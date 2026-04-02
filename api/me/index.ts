/**
 * GET /api/me
 * Returns the current user's email and their assigned app role.
 * The SWA edge injects x-ms-client-principal from the Entra token.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  decodeClientPrincipal,
  extractRoleStringsFromClaimValue,
  getCallerEmailFromPrincipal,
  resolveAppRoleWithFallback,
} from "../shared/auth";

app.http("me", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "me",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const principalHeader = req.headers.get("x-ms-client-principal");
      if (!principalHeader) {
        return { status: 401, jsonBody: { error: "Not authenticated" } };
      }

      const principal = decodeClientPrincipal(req);
      if (!principal) {
        return { status: 400, jsonBody: { error: "Invalid client principal header" } };
      }

      const email = getCallerEmailFromPrincipal(principal);
      const nameClaim = principal.claims?.find(
        (c) => c.typ?.trim().toLowerCase() === "name"
      );
      const displayNameStr =
        (nameClaim ? extractRoleStringsFromClaimValue(nameClaim.val)[0] : undefined) ??
        principal.userDetails;

      if (!email) {
        return { status: 400, jsonBody: { error: "Could not determine user email from token" } };
      }

      const { role, diagnostics } = await resolveAppRoleWithFallback(req);

      const allowVerbose =
        process.env.ALLOW_ME_ROLE_DIAGNOSTICS === "true" ||
        process.env.ALLOW_ME_ROLE_DIAGNOSTICS === "1";
      const wantVerbose = allowVerbose && req.query.get("verbose") === "1";

      const roleDiagnostics = {
        roleCandidateCount: diagnostics.roleCandidateCount,
        hadUnrecognizedRoleCandidates: diagnostics.hadUnrecognizedRoleCandidates,
        resolutionSource: diagnostics.resolutionSource,
        roleLikeClaimTypeCount: diagnostics.roleLikeClaimTypes.length,
        idTokenRoleCandidateCount: diagnostics.idTokenRoleCandidateCount,
        authMeRoleCandidateCount: diagnostics.authMeRoleCandidateCount,
        ...(wantVerbose
          ? {
              claimTypes: diagnostics.claimTypes,
              roleLikeClaimTypes: diagnostics.roleLikeClaimTypes,
            }
          : {}),
      };

      return {
        status: 200,
        jsonBody: {
          email,
          displayName: displayNameStr,
          role,
          roleDiagnostics,
        },
      };
    } catch (err) {
      ctx.error("me error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
