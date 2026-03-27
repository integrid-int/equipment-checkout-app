import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import NavBar from "./components/NavBar";
import ScanPage from "./pages/ScanPage";
import InventoryPage from "./pages/InventoryPage";
import CheckedOutPage from "./pages/CheckedOutPage";
import LoadingScreen from "./components/LoadingScreen";

export default function App() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!isAuthenticated) {
    // SWA will intercept and redirect to Entra, but show a fallback
    window.location.href = "/login";
    return <LoadingScreen />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <NavBar />
      <main className="flex-1 overflow-y-auto pb-safe">
        <Routes>
          <Route path="/" element={<Navigate to="/scan" replace />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/checked-out" element={<CheckedOutPage />} />
        </Routes>
      </main>
    </div>
  );
}
