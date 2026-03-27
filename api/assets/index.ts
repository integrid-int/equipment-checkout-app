/**
 * GET /api/assets?search=<barcode|name>&page=1&pagesize=25
 * Returns list of assets from Halo PSA.
 * Optionally filters by inventory_number (barcode) or asset name.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { haloGet } from "../shared/haloClient";

interface HaloAsset {
  id: number;
  inventory_number: string;
  assettype_name: string;
  client_name: string;
  site_name: string;
  status_name: string;
  fields: Array<{ name: string; value: string }>;
  [key: string]: unknown;
}

interface HaloAssetsResponse {
  assets: HaloAsset[];
  record_count: number;
}

app.http("assets", {
  methods: ["GET"],
  authLevel: "anonymous", // SWA handles auth at the edge
  route: "assets",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const search = req.query.get("search") ?? "";
      const page = req.query.get("page") ?? "1";
      const pagesize = req.query.get("pagesize") ?? "25";

      const params: Record<string, string> = {
        pageinate: "true",
        page_no: page,
        pagesize,
        // Include custom fields in response
        includeassetfields: "true",
      };

      // Search by barcode (inventory_number) or free-text
      if (search) {
        params.search = search;
      }

      const data = await haloGet<HaloAssetsResponse>("/Asset", params);

      return {
        status: 200,
        jsonBody: {
          assets: data.assets ?? [],
          total: data.record_count ?? 0,
        },
      };
    } catch (err) {
      ctx.error("assets function error:", err);
      return {
        status: 500,
        jsonBody: { error: (err as Error).message },
      };
    }
  },
});
