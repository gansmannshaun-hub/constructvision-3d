import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import { useStore, apiClient } from "@/store";
import "@/index.css";

function Protected({ children }) {
  const token = useStore((s) => s.token);
  if (!token) return <Navigate to="/" replace />;
  return children;
}

function HomeRedirect() {
  const token = useStore((s) => s.token);
  if (token) return <Navigate to="/app" replace />;
  return <Auth />;
}

export default function App() {
  // verify token on mount
  useEffect(() => {
    const { token, logout } = useStore.getState();
    if (token) {
      apiClient.get("/auth/me").catch(() => logout());
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route
          path="/app"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
