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

      // If the search is a ticket number, fetch directly by ID
      const ticketId = parseInt(search, 10);
      if (!isNaN(ticketId) && String(ticketId) === search) {
        try {
          const ticket = await haloGet<HaloTicket>(`/Tickets/${ticketId}`);
          ctx.log(`Ticket ${ticketId} found by direct ID lookup`);
          return {
            status: 200,
            jsonBody: { tickets: [ticket], total: 1 },
          };
        } catch (err) {
          ctx.warn(`Ticket ${ticketId} not found by ID: ${(err as Error).message}. Falling back to text search.`);
        }
      }

      // Text search — match Halo skill doc pattern: GET /api/Tickets?search=...&open_only=true
      const params: Record<string, string> = {
        open_only: "true",
      };
      if (search) params.search = search;

      ctx.log(`Searching tickets with params: ${JSON.stringify(params)}`);
      const data = await haloGet<{ tickets: HaloTicket[]; record_count: number }>("/Tickets", params);
      ctx.log(`Halo returned ${data.record_count ?? 0} tickets`);

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
