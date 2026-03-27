/**
 * GET /api/purchase-orders?search=<query>
 * GET /api/purchase-orders?id=<id>       — fetch a single PO with line items
 *
 * Returns open/partial POs from Halo PSA purchasing module.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet } from "../shared/haloClient";

interface HaloPOLine {
  id: number;
  item_id: number;
  item_name: string;
  quantity: number;
  quantityreceived: number;
  unitprice: number;
  serialized: boolean;
  serialnumber?: string;
}

interface HaloPO {
  id: number;
  ponumber: string;
  supplier_name: string;
  status: string;
  dateraised: string;
  lines?: HaloPOLine[];
}

app.http("purchase-orders", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "purchase-orders",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = req.query.get("id");
      const search = req.query.get("search") ?? "";

      // Fetch single PO with lines
      if (id) {
        const po = await haloGet<HaloPO>(`/PurchaseOrder/${id}`, {
          includepo_lines: "true",
        });
        return { status: 200, jsonBody: { po } };
      }

      // Search POs (open and partial only)
      const params: Record<string, string> = {
        pageinate: "true",
        pagesize: "20",
        open_only: "true",
      };
      if (search) params.search = search;

      const data = await haloGet<{ purchaseorders: HaloPO[]; record_count: number }>(
        "/PurchaseOrder",
        params
      );

      return {
        status: 200,
        jsonBody: { purchaseOrders: data.purchaseorders ?? [], total: data.record_count ?? 0 },
      };
    } catch (err) {
      ctx.error("purchase-orders error:", err);
      return { status: 500, jsonBody: { error: (err as Error).message } };
    }
  },
});
