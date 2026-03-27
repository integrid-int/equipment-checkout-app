/**
 * POST /api/return
 * Return unused items from a deployment back to stock.
 *
 * Body: {
 *   ticketId?: number,          // optional — logs note on ticket if provided
 *   returnedByEmail: string,
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

interface ReturnEntry {
  itemId: number;
  itemName: string;
  quantity: number;
  serialNumber?: string;
}

interface ReturnBody {
  ticketId?: number;
  returnedByEmail: string;
  entries: ReturnEntry[];
}

app.http("return", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "return",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as ReturnBody;

      if (!body.entries?.length) {
        return { status: 400, jsonBody: { error: "entries are required" } };
      }

      const errors: string[] = [];

      for (const entry of body.entries) {
        try {
          const itemData = await haloGet<{ id: number; count: number }>(
            `/Item/${entry.itemId}`
          );
          const newCount = (itemData.count ?? 0) + entry.quantity;
          await haloPost("/Item", [{ id: entry.itemId, count: newCount }]);
        } catch (err) {
          errors.push(`Failed to return "${entry.itemName}": ${(err as Error).message}`);
        }
      }

      // Log audit note on ticket if provided
      if (body.ticketId) {
        const successEntries = body.entries.filter(
          (e) => !errors.some((err) => err.includes(`"${e.itemName}"`))
        );

        if (successEntries.length > 0) {
          const lines = successEntries.map((e) =>
            e.serialNumber
              ? `  • ${e.itemName} — Serial: ${e.serialNumber}`
              : `  • ${e.itemName} × ${e.quantity}`
          );

          const note = [
            `Items returned to stock by ${body.returnedByEmail}`,
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
      }

      return {
        status: 200,
        jsonBody: {
          success: true,
          returned: body.entries.length - errors.length,
          errors: errors.length ? errors : undefined,
        },
      };
    } catch (err) {
      ctx.error("return error:", err);
      return { status: 500, jsonBody: { error: (err as Error).message } };
    }
  },
});
