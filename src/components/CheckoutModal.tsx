/**
 * CheckoutModal — shown when a user wants to check out an asset.
 * Pre-fills the "Checked out to" field from the signed-in user,
 * but allows editing (e.g. checking out on behalf of a colleague).
 */

import { useState } from "react";
import type { HaloAsset } from "../types/halo";
import { useAuth } from "../hooks/useAuth";

interface Props {
  asset: HaloAsset;
  onConfirm: (checkedOutTo: string, notes: string) => Promise<void>;
  onClose: () => void;
}

export default function CheckoutModal({ asset, onConfirm, onClose }: Props) {
  const { displayName, email } = useAuth();
  const [checkedOutTo, setCheckedOutTo] = useState(displayName);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!checkedOutTo.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm(checkedOutTo.trim(), notes.trim());
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-xl p-6 pb-safe-bottom">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-900">Check Out</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
          >
            ✕
          </button>
        </div>

        {/* Asset summary */}
        <div className="bg-blue-50 rounded-xl p-3 mb-5">
          <p className="font-semibold text-blue-900">{asset.assettype_name}</p>
          {asset.inventory_number && (
            <p className="text-sm text-blue-700 font-mono">{asset.inventory_number}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="checkout-to">
              Checking out to <span className="text-red-500">*</span>
            </label>
            <input
              id="checkout-to"
              type="text"
              value={checkedOutTo}
              onChange={(e) => setCheckedOutTo(e.target.value)}
              className="input"
              placeholder="Name of person taking the equipment"
              required
              autoFocus
            />
            {displayName && (
              <button
                type="button"
                className="mt-1 text-xs text-brand-600 underline"
                onClick={() => setCheckedOutTo(displayName)}
              >
                Use my name ({displayName})
              </button>
            )}
          </div>

          <div>
            <label className="label" htmlFor="checkout-notes">
              Notes <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="checkout-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input resize-none"
              rows={3}
              placeholder="Purpose, job number, return date…"
            />
          </div>

          {submitError && (
            <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !checkedOutTo.trim()}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? "Checking out…" : "Confirm Check Out"}
          </button>
        </form>
      </div>
    </div>
  );
}
