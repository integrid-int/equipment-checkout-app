/**
 * RoleGuard — renders children only if the current user has one of the
 * required roles. Otherwise shows an access-denied message or a
 * "pending access" screen for unassigned users.
 */

import type { ReactNode } from "react";
import type { AppRole } from "../context/RoleContext";
import { useRole } from "../context/RoleContext";
import LoadingScreen from "./LoadingScreen";

interface Props {
  roles: AppRole[];
  children: ReactNode;
  /** If true, renders nothing instead of an error card when access is denied */
  silent?: boolean;
}

export default function RoleGuard({ roles, children, silent = false }: Props) {
  const { role, loading, email } = useRole();

  if (loading) return <LoadingScreen />;

  if (role === null) {
    // Authenticated but no role assigned
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-8 text-center gap-4">
        <span className="text-5xl">—</span>
        <h2 className="text-xl font-bold text-gray-800">Access Pending</h2>
        <p className="text-gray-500 text-sm">
          You're signed in as <strong>{email}</strong>, but you haven't been assigned a role yet.
        </p>
        <p className="text-gray-400 text-sm">Ask an admin to assign you a role in the app.</p>
      </div>
    );
  }

  if (!roles.includes(role)) {
    if (silent) return null;
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-8 text-center gap-3">
        <span className="text-4xl">—</span>
        <h2 className="text-lg font-bold text-gray-700">Access Denied</h2>
        <p className="text-gray-400 text-sm">Your role ({role}) doesn't have access to this section.</p>
      </div>
    );
  }

  return <>{children}</>;
}
