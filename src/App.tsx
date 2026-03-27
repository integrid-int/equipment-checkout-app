import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { ActiveJobProvider } from "./context/ActiveJobContext";
import { RoleProvider, useRole } from "./context/RoleContext";
import NavBar from "./components/NavBar";
import RoleGuard from "./components/RoleGuard";
import FindJobPage from "./pages/FindJobPage";
import PullKitPage from "./pages/PullKitPage";
import ReturnPage from "./pages/ReturnPage";
import StockPage from "./pages/StockPage";
import ReceivePage from "./pages/ReceivePage";
import AdminPage from "./pages/AdminPage";
import LoadingScreen from "./components/LoadingScreen";

function AppRoutes() {
  const { role, loading } = useRole();

  if (loading) return <LoadingScreen />;

  // Default landing page depends on role
  const defaultRoute =
    role === "receiver" ? "/receive" :
    role === "admin"    ? "/job"     :
                          "/job";

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <NavBar />
      <main className="flex-1 overflow-y-auto pb-safe">
        <Routes>
          <Route path="/" element={<Navigate to={defaultRoute} replace />} />

          <Route path="/job" element={
            <RoleGuard roles={["admin", "technician"]}>
              <FindJobPage />
            </RoleGuard>
          } />

          <Route path="/pull" element={
            <RoleGuard roles={["admin", "technician"]}>
              <PullKitPage />
            </RoleGuard>
          } />

          <Route path="/return" element={
            <RoleGuard roles={["admin", "technician"]}>
              <ReturnPage />
            </RoleGuard>
          } />

          <Route path="/receive" element={
            <RoleGuard roles={["admin", "receiver"]}>
              <ReceivePage />
            </RoleGuard>
          } />

          <Route path="/stock" element={
            <RoleGuard roles={["admin", "technician", "receiver"]}>
              <StockPage />
            </RoleGuard>
          } />

          <Route path="/admin" element={
            <RoleGuard roles={["admin"]}>
              <AdminPage />
            </RoleGuard>
          } />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!isAuthenticated) {
    window.location.href = "/login";
    return <LoadingScreen />;
  }

  return (
    <RoleProvider>
      <ActiveJobProvider>
        <AppRoutes />
      </ActiveJobProvider>
    </RoleProvider>
  );
}
