import type { HaloAsset } from "../types/halo";

interface Props {
  asset: HaloAsset;
  onCheckout?: (asset: HaloAsset) => void;
  onCheckin?: (asset: HaloAsset) => void;
}

function getField(asset: HaloAsset, name: string): string {
  return asset.fields?.find((f) => f.name === name)?.value ?? "";
}

export default function AssetCard({ asset, onCheckout, onCheckin }: Props) {
  const isOut = asset.status_name?.toLowerCase().includes("use") ||
                asset.status_name?.toLowerCase().includes("out");
  const checkedOutTo = getField(asset, "checkout_to");
  const checkoutDate = getField(asset, "checkout_date");

  const dateStr = checkoutDate
    ? new Date(checkoutDate).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div
          className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${
            isOut ? "bg-amber-400" : "bg-green-400"
          }`}
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{asset.assettype_name}</p>
          {asset.inventory_number && (
            <p className="text-sm text-gray-500 font-mono">{asset.inventory_number}</p>
          )}
        </div>
        <span
          className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
            isOut
              ? "bg-amber-100 text-amber-700"
              : "bg-green-100 text-green-700"
          }`}
        >
          {isOut ? "Out" : "Available"}
        </span>
      </div>

      {/* Site / client */}
      {(asset.client_name || asset.site_name) && (
        <p className="text-sm text-gray-500 truncate">
          {[asset.client_name, asset.site_name].filter(Boolean).join(" · ")}
        </p>
      )}

      {/* Checkout info */}
      {isOut && checkedOutTo && (
        <div className="bg-amber-50 rounded-xl px-3 py-2 text-sm">
          <p className="text-amber-900">
            <span className="font-medium">Out to: </span>{checkedOutTo}
          </p>
          {dateStr && <p className="text-amber-700 text-xs mt-0.5">Since {dateStr}</p>}
        </div>
      )}

      {/* Action button */}
      <div className="flex gap-2">
        {!isOut && onCheckout && (
          <button
            onClick={() => onCheckout(asset)}
            className="btn-primary flex-1"
          >
            Check Out
          </button>
        )}
        {isOut && onCheckin && (
          <button
            onClick={() => onCheckin(asset)}
            className="btn-secondary flex-1"
          >
            Check In
          </button>
        )}
      </div>
    </div>
  );
}
