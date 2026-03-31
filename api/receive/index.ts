/**
 * POST /api/receive
 * Receive items from a PO into stock.
 *
 * Body: {
 *   poId: number,
 *   lines: Array<{
 *     poLineId: number,
 *     itemId: number,
 *     itemName: string,
 *     quantityReceived: number,
 *     serialNumbers?: string[]   // for serialized items, one per unit
 *   }>
 * }
 *
 * For each line:
 *   1. Increments Item stock count in Halo
 *   2. Updates PO line quantityreceived
 *   3. Creates an Action note on the PO for audit trail
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet, haloPost } from "../shared/haloClient";
import { requireRole } from "../shared/auth";

interface ReceiveLine {
  poLineId: number;
  itemId: number;
  itemName: string;
  quantityReceived: number;
  serialNumbers?: string[];
}

interface ReceiveBody {
  poId: number;
  lines: ReceiveLine[];
}

app.http("receive", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "receive",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const caller = await requireRole(req, ["admin", "receiver"]);
      if (!caller) {
        return { status: 403, jsonBody: { error: "Receiver or admin role required" } };
      }

      const body = (await req.json()) as ReceiveBody;

      if (!body.poId || !body.lines?.length) {
        return { status: 400, jsonBody: { error: "poId and lines are required" } };
      }

      const errors: string[] = [];
      const received: ReceiveLine[] = [];

      for (const line of body.lines) {
        if (!Number.isInteger(line.quantityReceived) || line.quantityReceived <= 0) {
          errors.push(`Invalid quantity for "${line.itemName}"`);
          continue;
        }

        try {
          // Get current stock count
          const item = await haloGet<{ id: number; count: number }>(
            `/Item/${line.itemId}`
          );

          // Increment stock
          const newCount = (item.count ?? 0) + line.quantityReceived;
          await haloPost("/Item", [{ id: line.itemId, count: newCount }]);

          // Update PO line received quantity
          await haloPost("/PurchaseOrder", [
            {
              id: body.poId,
              lines: [
                {
                  id: line.poLineId,
                  quantityreceived: line.quantityReceived,
                },
              ],
            },
          ]);

          received.push(line);
        } catch (err) {
          ctx.error(`Receive failed for item ${line.itemId}:`, err);
          errors.push(`Failed to receive "${line.itemName}"`);
        }
      }

      if (received.length === 0 && errors.length > 0) {
        return { status: 422, jsonBody: { error: "All lines failed", details: errors } };
      }

      // Build audit note
      const noteLines = received.map((l) => {
        const serials = l.serialNumbers?.length
          ? ` — SN: ${l.serialNumbers.join(", ")}`
          : "";
        return `  • ${l.itemName} × ${l.quantityReceived}${serials}`;
      });

      const note = [
        `Received by ${caller.email}`,
        `PO #${body.poId}`,
        "",
        ...noteLines,
      ].join("\n");

      await haloPost("/Actions", [
        {
          purchaseorder_id: body.poId,
          note,
          outcome: "Items Received",
          who_type: 2,
          hiddenfromclient: false,
        },
      ]);

      return {
        status: 200,
        jsonBody: {
          success: true,
          receivedCount: received.length,
          errors: errors.length ? errors : undefined,
        },
      };
    } catch (err) {
      ctx.error("receive error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
