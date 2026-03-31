/**
 * AdminPage — role setup guidance.
 * Role assignments are managed in Entra app registration (App roles).
 */

const ROLE_LABELS: Record<string, { label: string; color: string; description: string }> = {
  admin:      { label: "Admin",      color: "bg-brand-100 text-brand-700", description: "Full access + operational admin pages" },
  technician: { label: "Technician", color: "bg-accent-300/20 text-accent-700", description: "Pull kits, returns, view stock" },
  receiver:   { label: "Receiver",   color: "bg-emerald-100 text-emerald-700", description: "Receive POs, view stock" },
};

export default function AdminPage() {
  return (
    <div className="px-4 pt-4 pb-24 flex flex-col gap-5">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
        <p className="font-semibold mb-1">Note</p>
        <p>This page is informational only. User role assignment is no longer done inside this app.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Role assignments moved to Entra</h2>
        <p className="text-sm text-gray-500">
          This app now reads roles directly from your Entra app registration claims.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Supported app roles</p>
        {Object.entries(ROLE_LABELS).map(([key, { label, color, description }]) => (
          <div key={key} className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${color} w-24 text-center`}>{label}</span>
            <span className="text-sm text-gray-500">{description}</span>
          </div>
        ))}
      </div>

      <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4 text-sm text-brand-900">
        <p className="font-semibold mb-2">How to manage users and roles</p>
        <ol className="list-decimal pl-5 space-y-1 text-brand-800">
          <li>Open Azure portal and go to your Entra app registration for this app.</li>
          <li>Create app roles with values: <span className="font-mono">admin</span>, <span className="font-mono">technician</span>, <span className="font-mono">receiver</span>.</li>
          <li>In Enterprise Applications, assign users/groups to those app roles.</li>
          <li>Users must sign out/in (or refresh token) for new role claims to appear.</li>
        </ol>
      </div>
    </div>
  );
}
