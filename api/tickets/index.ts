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

      const data = await haloGet<{ tickets: HaloTicket[]; record_count: number }>("/Tickets", params);

      return {
        status: 200,
        jsonBody: { tickets: data.tickets ?? [], total: data.record_count ?? 0 },
      };
    } catch (err) {
      ctx.error("tickets error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
