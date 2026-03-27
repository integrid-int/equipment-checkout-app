import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { ActiveJobProvider } from "./context/ActiveJobContext";
import NavBar from "./components/NavBar";
import FindJobPage from "./pages/FindJobPage";
import PullKitPage from "./pages/PullKitPage";
import ReturnPage from "./pages/ReturnPage";
import StockPage from "./pages/StockPage";
import LoadingScreen from "./components/LoadingScreen";

export default function App() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!isAuthenticated) {
    window.location.href = "/login";
    return <LoadingScreen />;
  }

  return (
    <ActiveJobProvider>
      <div className="flex flex-col min-h-screen bg-gray-50">
        <NavBar />
        <main className="flex-1 overflow-y-auto pb-safe">
          <Routes>
            <Route path="/" element={<Navigate to="/job" replace />} />
            <Route path="/job" element={<FindJobPage />} />
            <Route path="/pull" element={<PullKitPage />} />
            <Route path="/return" element={<ReturnPage />} />
            <Route path="/stock" element={<StockPage />} />
          </Routes>
        </main>
      </div>
    </ActiveJobProvider>
  );
}
