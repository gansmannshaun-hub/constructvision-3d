import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { apiClient, useStore } from "../store";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * /invite/:token landing page.
 *
 * Renders:
 *   - Loading state while previewing the invite
 *   - "Sign up to accept" if user is logged out + needs_signup
 *   - "Log in to accept" if user is logged out + has account
 *   - "Accept" button if user is logged in
 *   - Friendly state if invite is already accepted or not found
 */
export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const sessionToken = useStore((s) => s.token);
  const setAuth = useStore((s) => s.setAuth);

  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("signup");  // signup | login

  // Inputs for sign-up / log-in flows
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pwd2, setPwd2] = useState("");

  // Load invite preview
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/invites/${token}`);
        setPreview(data);
        setMode(data.needs_signup ? "signup" : "login");
      } catch (e) {
        setError(e?.response?.data?.detail || "Invite not found or expired");
      }
    })();
  }, [token]);

  const accept = async (authToken) => {
    const { data } = await axios.post(
      `${API}/invites/${token}/accept`,
      {},
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    return data;
  };

  const onAcceptLoggedIn = async () => {
    setBusy(true); setError("");
    try {
      const result = await accept(sessionToken);
      navigate(`/app?projectId=${result.project_id}`);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not accept invite");
    } finally {
      setBusy(false);
    }
  };

  const onSignUp = async (e) => {
    e.preventDefault();
    if (password !== pwd2) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true); setError("");
    try {
      const { data } = await axios.post(`${API}/auth/register`, {
        email: preview.email, password, name,
      });
      setAuth(data.token, data.user);
      const result = await accept(data.token);
      navigate(`/app?projectId=${result.project_id}`);
    } catch (e) {
      setError(e?.response?.data?.detail || "Sign-up failed");
    } finally {
      setBusy(false);
    }
  };

  const onLogIn = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { data } = await axios.post(`${API}/auth/login`, {
        email: preview.email, password,
      });
      setAuth(data.token, data.user);
      const result = await accept(data.token);
      navigate(`/app?projectId=${result.project_id}`);
    } catch (e) {
      setError(e?.response?.data?.detail || "Log-in failed");
    } finally {
      setBusy(false);
    }
  };

  if (!preview && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-neutral-500 font-mono">
        Loading invite…
      </div>
    );
  }
  if (error && !preview) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="bg-[#0f0f0f] border border-[#FF3333]/40 px-8 py-6 text-center max-w-md" data-testid="invite-error">
          <div className="label-mono text-[#FF6666] mb-2">// INVITE NOT FOUND</div>
          <div className="text-white font-mono">{error}</div>
          <a href="/" className="inline-block mt-4 text-[#FFCC00] hover:underline label-mono">
            ← go home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] p-6">
      <div
        className="w-full max-w-md bg-[#0f0f0f] border border-white/10 overflow-hidden"
        data-testid="invite-card"
      >
        <div className="px-6 py-5 border-b border-white/10 bg-black">
          <div className="label-mono text-[#FFCC00]">// PROJECT INVITE</div>
          <h1 className="font-display text-2xl tracking-tighter text-white mt-1">
            You&apos;ve been invited
          </h1>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="text-sm text-neutral-300 leading-relaxed">
            <span className="font-bold text-white">{preview.invited_by_name}</span>{" "}
            invited you to join{" "}
            <span className="font-bold text-[#FFCC00]" data-testid="invite-project-name">
              {preview.project_name}
            </span>{" "}
            as a <span className="font-mono uppercase text-[#88AAFF]">{preview.role}</span>.
          </div>

          <div className="border border-white/10 bg-black px-3 py-2 font-mono text-xs">
            <div className="text-neutral-500">invited:</div>
            <div className="text-white" data-testid="invite-email">{preview.email}</div>
          </div>

          {/* Already accepted */}
          {preview.accepted && sessionToken && (
            <button
              data-testid="invite-go-to-project"
              onClick={() => navigate(`/app?projectId=${token /* not actually needed */}`)}
              className="w-full bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold py-3 text-xs uppercase tracking-wider"
            >
              You&apos;ve already accepted · Go to dashboard
            </button>
          )}

          {/* Logged in but not yet accepted */}
          {!preview.accepted && sessionToken && (
            <>
              <button
                data-testid="invite-accept-logged-in"
                onClick={onAcceptLoggedIn}
                disabled={busy}
                className="w-full bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-3 text-xs uppercase tracking-wider"
              >
                {busy ? "Accepting…" : "Accept invitation"}
              </button>
              <div className="text-xs text-neutral-500 font-mono text-center">
                Note: invite must match your signed-in email.
              </div>
            </>
          )}

          {/* Logged out — needs signup OR login */}
          {!sessionToken && (
            <>
              <div className="flex border border-white/10">
                <button
                  data-testid="invite-mode-signup"
                  onClick={() => setMode("signup")}
                  className={`flex-1 py-2 label-mono ${mode === "signup" ? "bg-[#FFCC00] text-black" : "text-neutral-400 hover:text-white"}`}
                >
                  CREATE ACCOUNT
                </button>
                <button
                  data-testid="invite-mode-login"
                  onClick={() => setMode("login")}
                  className={`flex-1 py-2 label-mono ${mode === "login" ? "bg-[#FFCC00] text-black" : "text-neutral-400 hover:text-white"}`}
                >
                  LOG IN
                </button>
              </div>

              {mode === "signup" ? (
                <form onSubmit={onSignUp} className="space-y-3" data-testid="invite-signup-form">
                  <input
                    data-testid="invite-name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
                  />
                  <input
                    data-testid="invite-password"
                    type="password"
                    placeholder="Choose a password (≥8 chars)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
                  />
                  <input
                    data-testid="invite-password-confirm"
                    type="password"
                    placeholder="Confirm password"
                    value={pwd2}
                    onChange={(e) => setPwd2(e.target.value)}
                    required
                    minLength={8}
                    className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
                  />
                  <button
                    data-testid="invite-signup-submit"
                    type="submit"
                    disabled={busy}
                    className="w-full bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-3 text-xs uppercase tracking-wider"
                  >
                    {busy ? "Creating account…" : "Create account & accept"}
                  </button>
                </form>
              ) : (
                <form onSubmit={onLogIn} className="space-y-3" data-testid="invite-login-form">
                  <input
                    data-testid="invite-login-password"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
                  />
                  <button
                    data-testid="invite-login-submit"
                    type="submit"
                    disabled={busy}
                    className="w-full bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-3 text-xs uppercase tracking-wider"
                  >
                    {busy ? "Logging in…" : "Log in & accept"}
                  </button>
                </form>
              )}
            </>
          )}

          {error && (
            <div data-testid="invite-error" className="border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] font-mono text-xs px-3 py-2">
              {error}
            </div>
          )}

          <div className="text-[10px] text-neutral-600 text-center pt-2 font-mono">
            Powered by Atlas Construction Cloud
          </div>
        </div>
      </div>
    </div>
  );
}
