/**
 * POST /api/pull
 * Check out a list of items against a Halo ticket.
 *
 * Body: {
 *   ticketId: number,
 *   pulledByEmail: string,
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

interface PullEntry {
  itemId: number;
  itemName: string;
  quantity: number;
  serialNumber?: string;
}

interface PullBody {
  ticketId: number;
  pulledByEmail: string;
  entries: PullEntry[];
}

app.http("pull", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "pull",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as PullBody;

      if (!body.ticketId || !body.entries?.length) {
        return { status: 400, jsonBody: { error: "ticketId and entries are required" } };
      }

      const errors: string[] = [];

      // Process each entry: decrement stock + validate qty
      for (const entry of body.entries) {
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
        } catch (err) {
          errors.push(`Failed to update stock for "${entry.itemName}": ${(err as Error).message}`);
        }
      }

      if (errors.length === body.entries.length) {
        return { status: 422, jsonBody: { error: "All items failed", details: errors } };
      }

      // Build audit note for the ticket
      const successEntries = body.entries.filter(
        (e) => !errors.some((err) => err.includes(`"${e.itemName}"`))
      );

      const lines = successEntries.map((e) =>
        e.serialNumber
          ? `  • ${e.itemName} — Serial: ${e.serialNumber}`
          : `  • ${e.itemName} × ${e.quantity}`
      );

      const note = [
        `Kit pulled by ${body.pulledByEmail}`,
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
      return { status: 500, jsonBody: { error: (err as Error).message } };
    }
  },
});
