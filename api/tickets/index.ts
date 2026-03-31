/**
 * GET /api/tickets?search=<query>
 * Search Halo tickets by ID, summary, or client name.
 * If search is a number, fetches the ticket directly by ID.
 * Otherwise performs a text search.
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
      const search = (req.query.get("search") ?? "").trim();

      // For numeric searches, skip the direct /Tickets/{id} lookup (returns 401
      // with client credentials) and just use the list endpoint with search param.
      // The search param matches ticket IDs in the list response.

      // Text search — try with minimal params first to debug
      const params: Record<string, string> = {};
      if (search) params.search = search;
      // Note: open_only removed temporarily for debugging

      ctx.log(`Searching tickets with params: ${JSON.stringify(params)}`);

      // Use raw fetch via haloGet but log the full response shape
      const rawData = await haloGet<Record<string, unknown>>("/Tickets", params);
      const keys = Object.keys(rawData);
      ctx.log(`Halo /Tickets response keys: [${keys.join(", ")}]`);
      ctx.log(`Halo /Tickets raw response (first 500 chars): ${JSON.stringify(rawData).substring(0, 500)}`);

      const tickets = (rawData.tickets ?? []) as HaloTicket[];
      const total = (rawData.record_count ?? 0) as number;

      ctx.log(`Parsed ${tickets.length} tickets, record_count=${total}`);

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
