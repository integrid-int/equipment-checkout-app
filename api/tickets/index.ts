/**
 * GET /api/tickets?search=<query>
 * Search Halo tickets by ID, summary, or client name.
 * If search is a number, fetches the ticket directly by ID.
 * Otherwise performs a text search.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet } from "../shared/haloClient";
import { appendFileSync } from "fs";

interface HaloTicket {
  id: number;
  summary: string;
  client_name: string;
  site_name: string;
  agent_name: string;
  status_name: string;
  dateoccurred: string;
  attachedItems?: TicketAttachedItem[];
  [key: string]: unknown;
}

interface TicketAttachedItem {
  itemId: number;
  itemName: string;
  quantity: number;
}

function normalizeAttachedItems(rawItems: unknown): TicketAttachedItem[] {
  if (!Array.isArray(rawItems)) return [];

  const merged = new Map<number, TicketAttachedItem>();
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") continue;

    const item = rawItem as Record<string, unknown>;
    const itemId = Number(item.item_id);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;

    const rawQty = Number(item.quantity ?? item.order_qty ?? 0);
    const quantity = Math.max(0, Math.trunc(rawQty));
    if (quantity <= 0) continue;

    const itemName =
      typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : `Item #${itemId}`;

    const existing = merged.get(itemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      merged.set(itemId, { itemId, itemName, quantity });
    }
  }

  return Array.from(merged.values());
}

app.http("tickets", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "tickets",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const search = (req.query.get("search") ?? "").trim();
      // #region agent log
      try { appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "A", location: "api/tickets/index.ts:68", message: "tickets handler entry", data: { search }, timestamp: Date.now() }) + "\n"); } catch {}
      // #endregion

      // For numeric searches, skip the direct /Tickets/{id} lookup (returns 401
      // with client credentials) and just use the list endpoint with search param.
      // The search param matches ticket IDs in the list response.

      // Search with includedetails to discover if ticket items are returned
      const params: Record<string, string> = {
        includedetails: "true",
      };
      if (search) params.search = search;

      const rawData = await haloGet<Record<string, unknown>>("/Tickets", params);
      const ticketsArray = Array.isArray(rawData.tickets)
        ? (rawData.tickets as Record<string, unknown>[])
        : [];
      const total = (rawData.record_count ?? 0) as number;
      const attachedByTicketId = new Map<number, TicketAttachedItem[]>();
      const isNumericSearch = /^\d+$/.test(search);

      if (isNumericSearch) {
        const searchId = Number(search);
        const idsToEnrich = ticketsArray
          .map((t) => Number(t.id))
          .filter((id) => Number.isFinite(id) && id === searchId);
        // #region agent log
        try { appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "A", location: "api/tickets/index.ts:93", message: "numeric enrichment candidates", data: { searchId, idsToEnrichCount: idsToEnrich.length }, timestamp: Date.now() }) + "\n"); } catch {}
        // #endregion

        for (const id of idsToEnrich) {
          try {
            const detailed = await haloGet<Record<string, unknown>>(`/Tickets/${id}`, {
              includedetails: "true",
              includelinkeddata: "true",
            });
            attachedByTicketId.set(id, normalizeAttachedItems(detailed.items_issued));
          } catch (detailErr) {
            ctx.warn(`Could not enrich attached items for ticket ${id}:`, detailErr);
            attachedByTicketId.set(id, []);
          }
        }
      }

      const tickets = ticketsArray.map((ticket) => {
        const id = Number(ticket.id);
        return {
          ...ticket,
          attachedItems: attachedByTicketId.get(id) ?? [],
        };
      }) as HaloTicket[];
      // #region agent log
      try { appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "A", location: "api/tickets/index.ts:118", message: "tickets handler success", data: { search, ticketCount: tickets.length, enrichedCount: attachedByTicketId.size, isNumericSearch }, timestamp: Date.now() }) + "\n"); } catch {}
      // #endregion

      return {
        status: 200,
        jsonBody: { tickets, total },
      };
    } catch (err) {
      // #region agent log
      try { appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "D", location: "api/tickets/index.ts:127", message: "tickets handler error", data: { error: err instanceof Error ? err.message : String(err) }, timestamp: Date.now() }) + "\n"); } catch {}
      // #endregion
      ctx.error("tickets error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
