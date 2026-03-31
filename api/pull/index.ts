/**
 * POST /api/pull
 * Check out a list of items against a Halo ticket.
 *
 * Body: {
 *   ticketId: number,
 *   entries: Array<{
 *     itemId: number,
 *     itemName: string,
 *     quantity: number,
 *     serialNumber?: string
 *   }>
 * }
 *
 * For each entry:
 *   1. Decrements the Item stock count in Halo
 *   2. Posts an Action/note to the ticket with pull details for audit
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet, haloPost } from "../shared/haloClient";
import { requireRole } from "../shared/auth";

interface PullEntry {
  itemId: number;
  itemName: string;
  quantity: number;
  serialNumber?: string;
}

interface PullBody {
  ticketId: number;
  entries: PullEntry[];
}

interface TicketIssuedLine {
  item_id: number;
  quantity: number;
  name: string;
}

interface HaloStockItem {
  id: number;
  name?: string;
  count?: number;
  quantity_in_stock?: number;
  isrecurringitem?: boolean;
  dont_track_stock?: boolean;
}

function normalizeIssuedLines(raw: unknown): TicketIssuedLine[] {
  if (!Array.isArray(raw)) return [];

  const merged = new Map<number, TicketIssuedLine>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const line = row as Record<string, unknown>;

    const itemId = Number(line.item_id);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;

    const quantity = Math.max(0, Math.trunc(Number(line.quantity ?? line.order_qty ?? 0)));
    if (quantity <= 0) continue;

    const name =
      typeof line.name === "string" && line.name.trim()
        ? line.name.trim()
        : `Item #${itemId}`;

    const existing = merged.get(itemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      merged.set(itemId, {
        item_id: itemId,
        quantity,
        name,
      });
    }
  }

  return Array.from(merged.values());
}

app.http("pull", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "pull",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const caller = await requireRole(req, ["admin", "technician"]);
      if (!caller) {
        return { status: 403, jsonBody: { error: "Technician or admin role required" } };
      }

      const body = (await req.json()) as PullBody;

      if (!body.ticketId || !body.entries?.length) {
        return { status: 400, jsonBody: { error: "ticketId and entries are required" } };
      }

      const errors: string[] = [];
      const successIndices: number[] = [];

      // Process each entry: decrement stock + validate qty
      for (let i = 0; i < body.entries.length; i++) {
        const entry = body.entries[i];

        if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) {
          errors.push(`Invalid quantity for "${entry.itemName}"`);
          continue;
        }

        try {
          // Fetch current stock
          const itemData = await haloGet<HaloStockItem>(
            `/Item/${entry.itemId}`
          );

          const stockTracked = !(itemData.dont_track_stock || itemData.isrecurringitem);
          if (stockTracked) {
            const available = Number(itemData.count ?? itemData.quantity_in_stock ?? 0);
            const newCount = available - entry.quantity;
            if (newCount < 0) {
              errors.push(`Insufficient stock for "${entry.itemName}" (available: ${available})`);
              continue;
            }

            // Some Halo tenants expose count, others expose quantity_in_stock.
            await haloPost("/Item", [
              {
                id: entry.itemId,
                count: newCount,
                quantity_in_stock: newCount,
              },
            ]);
          }
          successIndices.push(i);
        } catch (err) {
          ctx.error(`Stock update failed for item ${entry.itemId}:`, err);
          errors.push(`Failed to update stock for "${entry.itemName}"`);
        }
      }

      if (successIndices.length === 0) {
        return { status: 422, jsonBody: { error: "All items failed", details: errors } };
      }

      // Build audit note for the ticket
      const successEntries = successIndices.map((i) => body.entries[i]);

      // Attach successful pulled items to the ticket's issued-items list so
      // additional ad-hoc scanned items are reflected on the Halo ticket.
      try {
        const ticket = await haloGet<Record<string, unknown>>(`/Tickets/${body.ticketId}`, {
          includedetails: "true",
          includelinkeddata: "true",
        });
        const mergedIssuedLines = new Map<number, TicketIssuedLine>();
        for (const existing of normalizeIssuedLines(ticket.items_issued)) {
          mergedIssuedLines.set(existing.item_id, { ...existing });
        }

        for (const entry of successEntries) {
          const existing = mergedIssuedLines.get(entry.itemId);
          if (existing) {
            existing.quantity += entry.quantity;
          } else {
            mergedIssuedLines.set(entry.itemId, {
              item_id: entry.itemId,
              quantity: entry.quantity,
              name: entry.itemName,
            });
          }
        }

        await haloPost("/Tickets", [
          {
            id: body.ticketId,
            items_issued: Array.from(mergedIssuedLines.values()),
          },
        ]);
      } catch (ticketErr) {
        ctx.error(`Failed to update ticket ${body.ticketId} items_issued:`, ticketErr);
        errors.push("Ticket item list update failed (pull completed, but ticket attachments were not updated)");
      }

      const lines = successEntries.map((e) =>
        e.serialNumber
          ? `  • ${e.itemName} — Serial: ${e.serialNumber}`
          : `  • ${e.itemName} × ${e.quantity}`
      );

      const note = [
        `Kit pulled by ${caller.email}`,
        "",
        ...lines,
        "",
        `Total items: ${successEntries.reduce((s, e) => s + e.quantity, 0)}`,
      ].join("\n");

      try {
        await haloPost("/Actions", [
          {
            ticket_id: body.ticketId,
            note,
            outcome: "Kit Pulled",
            who_type: 2,
            hiddenfromclient: false,
          },
        ]);
      } catch (actionErr) {
        ctx.error(`Failed to write pull action for ticket ${body.ticketId}:`, actionErr);
        errors.push("Pull note update failed (stock/ticket items were updated)");
      }

      return {
        status: 200,
        jsonBody: {
          success: true,
          pulled: successEntries.length,
          errors: errors.length ? errors : undefined,
        },
      };
    } catch (err) {
      ctx.error("pull error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
