import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Landing from "@/pages/Landing";
import AppDetail from "@/pages/AppDetail";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Billing from "@/pages/Billing";
import Settings from "@/pages/Settings";
import Admin from "@/pages/Admin";
import AdminSupportInbox from "@/pages/AdminSupportInbox";
import AcceptTerms from "@/pages/AcceptTerms";
import TermsPage from "@/pages/TermsPage";
import PrivacyPage from "@/pages/PrivacyPage";
import SharedProject from "@/pages/SharedProject";
import AcceptInvite from "@/pages/AcceptInvite";
import SupportBubble from "@/components/SupportBubble";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import { useStore, apiClient } from "@/store";
import "@/index.css";

function Protected({ children }) {
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  if (!token) return <Navigate to="/signin" replace />;
  // Force legal acceptance before any protected route
  if (user?.needs_legal_acceptance) return <Navigate to="/accept-terms" replace />;
  return children;
}

function SignInRoute() {
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
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/apps/:id" element={<AppDetail />} />
          <Route path="/signin" element={<SignInRoute />} />
          <Route path="/app" element={<Protected><Dashboard /></Protected>} />
          <Route path="/billing" element={<Protected><Billing /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="/admin" element={<Protected><Admin /></Protected>} />
          <Route path="/admin/support" element={<Protected><AdminSupportInbox /></Protected>} />
          <Route path="/accept-terms" element={<AcceptTerms />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/share/:token" element={<SharedProject />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <SupportBubble />
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
