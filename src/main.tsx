import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// If the service worker has intercepted a /.auth/* navigation and served this
// HTML, we are now running inside an Entra auth flow. Unregister the SW so it
// can't intercept future auth callbacks, clear its caches, then redirect to /
// so the browser re-navigates without the SW in the way.
if (window.location.pathname.startsWith("/.auth")) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      Promise.all([
        ...registrations.map((r) => r.unregister()),
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
      ]).finally(() => {
        window.location.replace("/");
      });
    });
  } else {
    window.location.replace("/");
  }
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );

  // Register service worker for PWA (after auth guard above)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // SW registration is best-effort
      });
    });
  }
}
