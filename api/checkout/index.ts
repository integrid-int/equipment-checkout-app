/**
 * POST /api/checkout
 * Body: { assetId: number, checkedOutTo: string, notes?: string }
 *
 * Updates the asset in Halo PSA with:
 *  - A custom field "Checked Out To" (field name: checkout_to)
 *  - A custom field "Checkout Date"  (field name: checkout_date)
 *  - A custom field "Checkout Notes" (field name: checkout_notes)
 *  - Asset status set to "In Use" (status_id configurable via env)
 *
 * Also creates a Halo Action (note) on the asset for audit trail.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloPost } from "../shared/haloClient";

app.http("checkout", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "checkout",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as {
        assetId: number;
        checkedOutTo: string;
        checkedOutByEmail: string;
        notes?: string;
      };

      if (!body.assetId || !body.checkedOutTo) {
        return { status: 400, jsonBody: { error: "assetId and checkedOutTo are required" } };
      }

      const inUseStatusId = parseInt(process.env.HALO_STATUS_IN_USE ?? "2", 10);
      const now = new Date().toISOString();

      // Update asset custom fields + status
      await haloPost("/Asset", [
        {
          id: body.assetId,
          status_id: inUseStatusId,
          fields: [
            { name: "checkout_to",    value: body.checkedOutTo },
            { name: "checkout_date",  value: now },
            { name: "checkout_notes", value: body.notes ?? "" },
            { name: "checkout_by",    value: body.checkedOutByEmail },
          ],
        },
      ]);

      // Create an audit action/note on the asset
      await haloPost("/Actions", [
        {
          asset_id: body.assetId,
          note: `Checked out to ${body.checkedOutTo} by ${body.checkedOutByEmail}. ${body.notes ?? ""}`.trim(),
          outcome: "Checked Out",
          who_type: 2, // Agent
          hiddenfromclient: false,
        },
      ]);

      return { status: 200, jsonBody: { success: true, checkedOutAt: now } };
    } catch (err) {
      ctx.error("checkout function error:", err);
      return { status: 500, jsonBody: { error: (err as Error).message } };
    }
  },
});
