/**
 * POST /api/checkin
 * Body: { assetId: number, notes?: string }
 *
 * Clears checkout custom fields and resets asset status to "Available".
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloPost } from "../shared/haloClient";

app.http("checkin", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "checkin",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as {
        assetId: number;
        returnedByEmail: string;
        notes?: string;
      };

      if (!body.assetId) {
        return { status: 400, jsonBody: { error: "assetId is required" } };
      }

      const availableStatusId = parseInt(process.env.HALO_STATUS_AVAILABLE ?? "1", 10);
      const now = new Date().toISOString();

      // Clear checkout fields + restore status
      await haloPost("/Asset", [
        {
          id: body.assetId,
          status_id: availableStatusId,
          fields: [
            { name: "checkout_to",    value: "" },
            { name: "checkout_date",  value: "" },
            { name: "checkout_notes", value: "" },
            { name: "checkout_by",    value: "" },
          ],
        },
      ]);

      // Audit note
      await haloPost("/Actions", [
        {
          asset_id: body.assetId,
          note: `Checked in by ${body.returnedByEmail}. ${body.notes ?? ""}`.trim(),
          outcome: "Checked In",
          who_type: 2,
          hiddenfromclient: false,
        },
      ]);

      return { status: 200, jsonBody: { success: true, checkedInAt: now } };
    } catch (err) {
      ctx.error("checkin function error:", err);
      return { status: 500, jsonBody: { error: (err as Error).message } };
    }
  },
});
