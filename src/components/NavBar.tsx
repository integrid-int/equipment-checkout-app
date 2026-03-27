import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const tabs = [
  { to: "/scan",        label: "Scan",       icon: "⬛" },
  { to: "/inventory",   label: "Inventory",  icon: "📦" },
  { to: "/checked-out", label: "Out",        icon: "📋" },
];

export default function NavBar() {
  const { displayName } = useAuth();

  return (
    <>
      {/* Top bar */}
      <header className="bg-brand-700 text-white px-4 pt-safe-top pb-2 flex items-center justify-between sticky top-0 z-40">
        <span className="font-bold text-lg tracking-tight">Equipment Checkout</span>
        <span className="text-white/70 text-sm truncate max-w-[180px]">{displayName}</span>
      </header>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 pb-safe-bottom z-40 flex">
        {tabs.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                isActive ? "text-brand-600" : "text-gray-400"
              }`
            }
          >
            <span className="text-xl leading-none">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
