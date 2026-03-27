import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useActiveJob } from "../context/ActiveJobContext";

const tabs = [
  { to: "/job",    label: "Job",     icon: "🎫" },
  { to: "/pull",   label: "Pull Kit", icon: "📦" },
  { to: "/return", label: "Return",  icon: "↩️" },
  { to: "/stock",  label: "Stock",   icon: "🗄️" },
];

export default function NavBar() {
  const { displayName } = useAuth();
  const { ticket, pullList } = useActiveJob();
  const navigate = useNavigate();

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
        <span className="text-white/70 text-sm truncate max-w-[140px]">{displayName}</span>
      </header>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 pb-safe-bottom z-40 flex">
        {tabs.map(({ to, label, icon }) => (
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
            {/* Pull list badge */}
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
