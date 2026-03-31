/**
 * GET /api/tickets?search=<query>
 * Search open/active Halo tickets by ID, summary, or client name.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet } from "../shared/haloClient";

interface HaloTicket {
  id: number;
  summary: string;
  client_name: string;
  site_name: string;
  agent_name: string;
  status_name: string;
  dateoccurred: string;
}

app.http("tickets", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "tickets",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const search = req.query.get("search") ?? "";

      const params: Record<string, string> = {
        pageinate: "true",
        pagesize: "20",
        open_only: "true",
      };
      if (search) params.search = search;

      const data = await haloGet<Record<string, unknown>>("/Tickets", params);

      ctx.log("Halo /Tickets response keys:", Object.keys(data));
      ctx.log("Halo /Tickets record_count:", data.record_count);

      // Halo returns tickets under "tickets" key
      const tickets = (data.tickets ?? []) as HaloTicket[];
      const total = (data.record_count ?? 0) as number;

      return {
        status: 200,
        jsonBody: { tickets, total },
      };
    } catch (err) {
      ctx.error("tickets error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
