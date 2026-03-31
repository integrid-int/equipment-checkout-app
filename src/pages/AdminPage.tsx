/**
 * AdminPage — manage user role assignments.
 * Only accessible to users with the "admin" role.
 */

import { useEffect, useState } from "react";
import type { AppRole } from "../context/RoleContext";

interface RoleEntry {
  email: string;
  role: AppRole;
}

const ROLE_LABELS: Record<string, { label: string; color: string; description: string }> = {
  admin:      { label: "Admin",      color: "bg-brand-100 text-brand-700", description: "Full access + role management" },
  technician: { label: "Technician", color: "bg-accent-300/20 text-accent-700",     description: "Pull kits, returns, view stock" },
  receiver:   { label: "Receiver",   color: "bg-emerald-100 text-emerald-700", description: "Receive POs, view stock" },
};

export default function AdminPage() {
  const [users, setUsers] = useState<RoleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add user form
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("technician");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-roles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { roles: RoleEntry[] };
      setUsers(data.roles.sort((a, b) => a.email.localeCompare(b.email)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);

  async function handleAddOrUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newRole) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim().toLowerCase(), role: newRole }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      showToast(`Role set for ${newEmail}`);
      setNewEmail("");
      setNewRole("technician");
      fetchUsers();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeRole(email: string, role: AppRole) {
    try {
      const res = await fetch("/api/admin-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, role } : u)));
      showToast(`Updated ${email} → ${role}`);
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`);
    }
  }

  async function handleRemove(email: string) {
    if (!confirm(`Remove role for ${email}?`)) return;
    try {
      const res = await fetch(`/api/admin-roles?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      showToast(`Removed ${email}`);
      fetchUsers();
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <div className="px-4 pt-4 pb-24 flex flex-col gap-5">

      {/* Role legend */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Roles</p>
        {Object.entries(ROLE_LABELS).map(([key, { label, color, description }]) => (
          <div key={key} className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${color} w-24 text-center`}>{label}</span>
            <span className="text-sm text-gray-500">{description}</span>
          </div>
        ))}
      </div>

      <hr className="border-gray-100" />

      {/* Add / update user form */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-3">Add or Update User</p>
        <form onSubmit={handleAddOrUpdate} className="flex flex-col gap-3">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="input"
            placeholder="user@integrid.com"
            required
          />
          <div className="flex gap-2">
            {(["technician", "receiver", "admin"] as AppRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setNewRole(r)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                  newRole === r
                    ? `${ROLE_LABELS[r!]?.color} border-transparent`
                    : "border-gray-200 text-gray-400"
                }`}
              >
                {ROLE_LABELS[r!]?.label}
              </button>
            ))}
          </div>
          {saveError && <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2">{saveError}</p>}
          <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? "Saving…" : "Assign Role"}
          </button>
        </form>
      </div>

      <hr className="border-gray-100" />

      {/* User list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-700">Current Users ({users.length})</p>
          <button onClick={fetchUsers} className="text-xs text-brand-500">Refresh</button>
        </div>

        {error && <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2 mb-3">{error}</p>}

        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl h-16 animate-pulse border border-gray-100 mb-2" />
        ))}

        {!loading && users.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-6">No users assigned yet.</p>
        )}

        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <div key={u.email} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-800 truncate flex-1">{u.email}</p>
                <button
                  onClick={() => handleRemove(u.email)}
                  className="text-gray-300 hover:text-red-400 ml-2 shrink-0 text-lg"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
              <div className="flex gap-1.5">
                {(["technician", "receiver", "admin"] as AppRole[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => u.role !== r && handleChangeRole(u.email, r)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      u.role === r
                        ? `${ROLE_LABELS[r!]?.color}`
                        : "bg-gray-50 text-gray-400 hover:bg-gray-100"
                    }`}
                  >
                    {ROLE_LABELS[r!]?.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 inset-x-4 rounded-2xl py-3 px-4 text-center bg-green-600 text-white font-medium shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
