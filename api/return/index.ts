/**
 * POST /api/return
 * Return unused items from a deployment back to stock.
 *
 * Body: {
 *   ticketId?: number,          // optional — logs note on ticket if provided
 *   entries: Array<{
 *     itemId: number,
 *     itemName: string,
 *     quantity: number,
 *     serialNumber?: string
 *   }>
 * }
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet, haloPost } from "../shared/haloClient";
import { requireRole } from "../shared/auth";

interface ReturnEntry {
  itemId: number;
  itemName: string;
  quantity: number;
  serialNumber?: string;
}

interface ReturnBody {
  ticketId?: number;
  entries: ReturnEntry[];
}

interface HaloReturnItem {
  id: number;
  count?: number;
  quantity_in_stock?: number;
  serialized?: boolean;
  serialise_only_one?: boolean;
}

app.http("return", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "return",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const caller = await requireRole(req, ["admin", "technician"]);
      if (!caller) {
        return { status: 403, jsonBody: { error: "Technician or admin role required" } };
      }

      const body = (await req.json()) as ReturnBody;

      if (!body.entries?.length) {
        return { status: 400, jsonBody: { error: "entries are required" } };
      }

      const errors: string[] = [];
      const successIndices: number[] = [];

      for (let i = 0; i < body.entries.length; i++) {
        const entry = body.entries[i];

        if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) {
          errors.push(`Invalid quantity for "${entry.itemName}"`);
          continue;
        }

        try {
          const itemData = await haloGet<HaloReturnItem>(
            `/Item/${entry.itemId}`
          );
          const serialized = Boolean(itemData.serialized ?? itemData.serialise_only_one);
          const serial = entry.serialNumber?.trim();
          if (serialized) {
            if (!serial) {
              errors.push(`Serialized return item "${entry.itemName}" requires a scanned serial number`);
              continue;
            }
            if (entry.quantity !== 1) {
              errors.push(`Serialized return item "${entry.itemName}" must be submitted as one unit per serial`);
              continue;
            }
          }

          const currentCount = Number(itemData.count ?? itemData.quantity_in_stock ?? 0);
          const newCount = currentCount + entry.quantity;
          await haloPost("/Item", [{ id: entry.itemId, count: newCount }]);
          successIndices.push(i);
        } catch (err) {
          ctx.error(`Return failed for item ${entry.itemId}:`, err);
          errors.push(`Failed to return "${entry.itemName}"`);
        }
      }

      // Log audit note on ticket if provided
      if (body.ticketId && successIndices.length > 0) {
        const successEntries = successIndices.map((i) => body.entries[i]);

        const lines = successEntries.map((e) =>
          e.serialNumber
            ? `  • ${e.itemName} — Serial: ${e.serialNumber}`
            : `  • ${e.itemName} × ${e.quantity}`
        );

        const note = [
          `Items returned to stock by ${caller.email}`,
          "",
          ...lines,
        ].join("\n");

        await haloPost("/Actions", [
          {
            ticket_id: body.ticketId,
            note,
            outcome: "Items Returned",
            who_type: 2,
            hiddenfromclient: false,
          },
        ]);
      }

      return {
        status: 200,
        jsonBody: {
          success: true,
          returned: successIndices.length,
          errors: errors.length ? errors : undefined,
        },
      };
    } catch (err) {
      ctx.error("return error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
