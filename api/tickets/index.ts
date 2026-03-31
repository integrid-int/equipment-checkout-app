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

      // Search with includedetails to discover if ticket items are returned
      const params: Record<string, string> = {
        includedetails: "true",
      };
      if (search) params.search = search;

      ctx.log(`Searching tickets with params: ${JSON.stringify(params)}`);

      const rawData = await haloGet<Record<string, unknown>>("/Tickets", params);

      const ticketsArray = (rawData.tickets ?? []) as Record<string, unknown>[];
      const total = (rawData.record_count ?? 0) as number;

      // Discovery: log ALL keys on the first ticket to find item-related fields
      if (ticketsArray.length > 0) {
        const firstTicket = ticketsArray[0];
        const allKeys = Object.keys(firstTicket);
        ctx.log(`Ticket keys (${allKeys.length} total): [${allKeys.join(", ")}]`);

        // Look for item/line-related fields
        const itemKeys = allKeys.filter(k =>
          k.includes("item") || k.includes("line") || k.includes("charge") ||
          k.includes("product") || k.includes("quote") || k.includes("bill")
        );
        ctx.log(`Item-related keys: [${itemKeys.join(", ")}]`);

        // Log values of item-related fields
        for (const key of itemKeys) {
          const val = firstTicket[key];
          ctx.log(`  ${key} = ${JSON.stringify(val)?.substring(0, 200)}`);
        }
      }

      const tickets = ticketsArray as unknown as HaloTicket[];

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
