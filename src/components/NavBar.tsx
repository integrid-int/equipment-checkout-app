import { NavLink, useNavigate } from "react-router-dom";
import { useRole } from "../context/RoleContext";
import { useActiveJob } from "../context/ActiveJobContext";

interface Tab {
  to: string;
  label: string;
  icon: string;
  roles: Array<"admin" | "technician" | "receiver">;
}

const ALL_TABS: Tab[] = [
  { to: "/job",     label: "Job",      icon: "🎫", roles: ["admin", "technician"] },
  { to: "/pull",    label: "Pull Kit", icon: "📦", roles: ["admin", "technician"] },
  { to: "/return",  label: "Return",   icon: "↩️",  roles: ["admin", "technician"] },
  { to: "/receive", label: "Receive",  icon: "📬", roles: ["admin", "receiver"] },
  { to: "/stock",   label: "Stock",    icon: "🗄️", roles: ["admin", "technician", "receiver"] },
  { to: "/admin",   label: "Admin",    icon: "⚙️", roles: ["admin"] },
];

export default function NavBar() {
  const { role, displayName } = useRole();
  const { ticket, pullList } = useActiveJob();
  const navigate = useNavigate();

  const visibleTabs = ALL_TABS.filter((t) => role && t.roles.includes(role as never));

  return (
    <>
      {/* Top bar */}
      <header className="bg-brand-700 text-white px-4 pt-safe-top pb-2 flex items-center justify-between sticky top-0 z-40">
        <div>
          <span className="font-bold text-lg tracking-tight">Deployment Kits</span>
          {ticket && (
            <button
              onClick={() => navigate("/job")}
              className="block text-xs text-blue-200 truncate max-w-[220px] text-left mt-0.5"
            >
              #{ticket.id} — {ticket.summary}
            </button>
          )}
        </div>
        <div className="text-right">
          <p className="text-white/70 text-xs truncate max-w-[140px]">{displayName}</p>
          {role && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
              role === "admin"      ? "bg-purple-500/40 text-purple-100" :
              role === "technician" ? "bg-blue-500/40 text-blue-100" :
                                      "bg-emerald-500/40 text-emerald-100"
            }`}>
              {role}
            </span>
          )}
        </div>
      </header>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 pb-safe-bottom z-40 flex">
        {visibleTabs.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors relative ${
                isActive ? "text-brand-600" : "text-gray-400"
              }`
            }
          >
            <span className="text-xl leading-none">{icon}</span>
            {label}
            {to === "/pull" && pullList.length > 0 && (
              <span className="absolute top-1 right-[calc(50%-18px)] bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {pullList.length}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
