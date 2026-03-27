/**
 * GET /api/checkins
 * Returns all assets currently checked out (status = In Use).
 * Used for the "Currently Out" dashboard view.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet } from "../shared/haloClient";

app.http("checkins", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "checkins",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const inUseStatusId = parseInt(process.env.HALO_STATUS_IN_USE ?? "2", 10);

      const data = await haloGet<{ assets: unknown[] }>("/Asset", {
        status_id: inUseStatusId.toString(),
        includeassetfields: "true",
        pageinate: "true",
        pagesize: "100",
      });

      return {
        status: 200,
        jsonBody: { assets: data.assets ?? [] },
      };
    } catch (err) {
      ctx.error("checkins function error:", err);
      return { status: 500, jsonBody: { error: (err as Error).message } };
    }
  },
});
