/**
 * GET /api/items?search=<name|barcode|serial>
 * Look up stock items by name, barcode, or serial number.
 * Returns current stock count.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet } from "../shared/haloClient";

interface HaloItem {
  id: number;
  name: string;
  description?: string;
  count: number;
  serialized: boolean;
  serialnumber?: string;
  barcode?: string;
  supplier_name?: string;
  unitprice?: number;
}

app.http("items", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "items",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const search = req.query.get("search") ?? "";
      const page = req.query.get("page") ?? "1";
      const pagesize = req.query.get("pagesize") ?? "25";

      const params: Record<string, string> = {
        pageinate: "true",
        page_no: page,
        pagesize,
      };
      if (search) params.search = search;

      const data = await haloGet<{ items: HaloItem[]; record_count: number }>("/Item", params);

      return {
        status: 200,
        jsonBody: { items: data.items ?? [], total: data.record_count ?? 0 },
      };
    } catch (err) {
      ctx.error("items error:", err);
      return { status: 500, jsonBody: { error: (err as Error).message } };
    }
  },
});
