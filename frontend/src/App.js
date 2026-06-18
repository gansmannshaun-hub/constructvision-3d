import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Billing from "@/pages/Billing";
import Settings from "@/pages/Settings";
import Admin from "@/pages/Admin";
import SharedProject from "@/pages/SharedProject";
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
  // verify token on mount + refresh user (incl. is_admin flag)
  useEffect(() => {
    const { token, logout, setAuth } = useStore.getState();
    if (token) {
      apiClient
        .get("/auth/me")
        .then(({ data }) => setAuth(token, data))
        .catch(() => logout());
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/app" element={<Protected><Dashboard /></Protected>} />
        <Route path="/billing" element={<Protected><Billing /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        <Route path="/admin" element={<Protected><Admin /></Protected>} />
        <Route path="/share/:token" element={<SharedProject />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
