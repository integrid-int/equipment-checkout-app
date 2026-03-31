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
  attachedItems?: TicketAttachedItem[];
  [key: string]: unknown;
}

interface TicketAttachedItem {
  itemId: number;
  itemName: string;
  quantity: number;
}

function asTicketId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
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
          .map((t) => asTicketId(t.id))
          .filter((id): id is number => id !== null && id === searchId);

        for (const id of idsToEnrich) {
          const baseTicket = ticketsArray.find((t) => asTicketId(t.id) === id);
          let attachedItems = normalizeAttachedItems(baseTicket?.items_issued);

          if (attachedItems.length === 0) {
            try {
              const detailed = await haloGet<Record<string, unknown>>(`/Tickets/${id}`, {
                includedetails: "true",
                includelinkeddata: "true",
              });
              attachedItems = normalizeAttachedItems(detailed.items_issued);
            } catch (detailErr) {
              // Some tenants return 401/403 for /Tickets/{id} with app creds.
              ctx.warn(`Primary ticket detail fetch failed for ticket ${id}:`, detailErr);
            }
          }

          if (attachedItems.length === 0) {
            try {
              const fallback = await haloGet<Record<string, unknown>>("/Tickets", {
                search: String(id),
                includedetails: "true",
                includelinkeddata: "true",
              });
              const fallbackTickets = Array.isArray(fallback.tickets)
                ? (fallback.tickets as Record<string, unknown>[])
                : [];
              const exact = fallbackTickets.find((t) => asTicketId(t.id) === id);
              attachedItems = normalizeAttachedItems(exact?.items_issued);
            } catch (fallbackErr) {
              ctx.warn(`Fallback ticket list fetch failed for ticket ${id}:`, fallbackErr);
            }
          }

          attachedByTicketId.set(id, attachedItems);
        }
      }

      const tickets = ticketsArray.map((ticket) => {
        const id = Number(ticket.id);
        return {
          ...ticket,
          attachedItems: attachedByTicketId.get(id) ?? [],
        };
      }) as HaloTicket[];

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
