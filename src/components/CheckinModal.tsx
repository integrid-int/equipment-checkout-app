import { useState } from "react";
import type { HaloAsset } from "../types/halo";

interface Props {
  asset: HaloAsset;
  onConfirm: (notes: string) => Promise<void>;
  onClose: () => void;
}

function getField(asset: HaloAsset, name: string) {
  return asset.fields?.find((f) => f.name === name)?.value ?? "";
}

export default function CheckinModal({ asset, onConfirm, onClose }: Props) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const checkedOutTo = getField(asset, "checkout_to");
  const checkoutDate = getField(asset, "checkout_date");
  const dateStr = checkoutDate
    ? new Date(checkoutDate).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm(notes.trim());
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-xl p-6 pb-safe-bottom">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-900">Check In</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
          >
            ✕
          </button>
        </div>

        {/* Asset summary */}
        <div className="bg-amber-50 rounded-xl p-3 mb-5">
          <p className="font-semibold text-amber-900">{asset.assettype_name}</p>
          {asset.inventory_number && (
            <p className="text-sm text-amber-700 font-mono">{asset.inventory_number}</p>
          )}
          {checkedOutTo && (
            <p className="text-sm text-amber-800 mt-1">
              Checked out to <strong>{checkedOutTo}</strong>
              {dateStr && <> since {dateStr}</>}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="checkin-notes">
              Notes <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="checkin-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input resize-none"
              rows={3}
              placeholder="Condition, damage, missing parts…"
              autoFocus
            />
          </div>

          {submitError && (
            <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-secondary disabled:opacity-50"
          >
            {submitting ? "Checking in…" : "Confirm Check In"}
          </button>
        </form>
      </div>
    </div>
  );
}
