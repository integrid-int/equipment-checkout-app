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
          const itemData = await haloGet<{ id: number; count: number; name: string }>(
            `/Item/${entry.itemId}`
          );

          const newCount = (itemData.count ?? 0) - entry.quantity;
          if (newCount < 0) {
            errors.push(`Insufficient stock for "${entry.itemName}" (available: ${itemData.count})`);
            continue;
          }

          // Update stock count
          await haloPost("/Item", [{ id: entry.itemId, count: newCount }]);
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

      await haloPost("/Actions", [
        {
          ticket_id: body.ticketId,
          note,
          outcome: "Kit Pulled",
          who_type: 2,
          hiddenfromclient: false,
        },
      ]);

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
