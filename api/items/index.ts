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
  stockTracked?: boolean;
  serialnumber?: string;
  barcode?: string;
  supplier_name?: string;
  unitprice?: number;
}

interface HaloRawItem extends Record<string, unknown> {
  id: number;
  name: string;
}

function normalizeItem(raw: HaloRawItem): HaloItem {
  const stockTracked = !(Boolean(raw.dont_track_stock) || Boolean(raw.isrecurringitem));
  return {
    id: Number(raw.id),
    name: String(raw.name ?? ""),
    description: typeof raw.description === "string" ? raw.description : undefined,
    count: Number(raw.count ?? raw.quantity_in_stock ?? 0),
    serialized: Boolean(raw.serialized ?? raw.serialise_only_one),
    stockTracked,
    serialnumber: typeof raw.serialnumber === "string" ? raw.serialnumber : undefined,
    barcode: typeof raw.barcode === "string" ? raw.barcode : undefined,
    supplier_name: typeof raw.supplier_name === "string" ? raw.supplier_name : undefined,
    unitprice: typeof raw.unitprice === "number" ? raw.unitprice : undefined,
  };
}

app.http("items", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "items",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const idParam = req.query.get("id");
      if (idParam) {
        const itemId = Number(idParam);
        if (!Number.isFinite(itemId) || itemId <= 0) {
          return { status: 400, jsonBody: { error: "id must be a positive number" } };
        }

        const item = await haloGet<HaloRawItem>(`/Item/${itemId}`);
        const normalized = normalizeItem(item);
        return {
          status: 200,
          jsonBody: { items: normalized ? [normalized] : [], total: normalized ? 1 : 0 },
        };
      }

      const search = req.query.get("search") ?? "";
      const page = req.query.get("page") ?? "1";
      const pagesize = req.query.get("pagesize") ?? "25";

      const params: Record<string, string> = {
        pageinate: "true",
        page_no: page,
        page_size: pagesize,
      };
      if (search) params.search = search;

      const data = await haloGet<{ items: HaloRawItem[]; record_count: number }>("/Item", params);
      const normalizedItems = (data.items ?? []).map(normalizeItem);

      return {
        status: 200,
        jsonBody: { items: normalizedItems, total: data.record_count ?? 0 },
      };
    } catch (err) {
      ctx.error("items error:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
