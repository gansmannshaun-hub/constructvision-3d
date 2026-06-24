import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, useStore } from "../store";

export default function Auth() {
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { email: form.email, password: form.password, name: form.name };
      const { data } = await apiClient.post(endpoint, payload);
      setAuth(data.token, data.user);
      navigate("/app");
    } catch (e2) {
      setErr(e2.response?.data?.detail || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" data-testid="auth-page">
      {/* Left panel: brand + image */}
      <div className="hidden lg:flex w-1/2 relative bp-grid border-r border-white/10">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "url(https://images.unsplash.com/photo-1542621334-a254cf47733d?crop=entropy&cs=srgb&fm=jpg&q=85&w=1400)",
            backgroundSize: "cover",
            backgroundPosition: "center",
            mixBlendMode: "luminosity",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-black/80" />
        <div className="relative p-12 flex flex-col justify-between w-full z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FFCC00] flex items-center justify-center">
              <span className="font-display text-black text-2xl">A</span>
            </div>
            <div>
              <div className="font-display text-2xl tracking-tighter">ATLAS</div>
              <div className="label-mono text-[10px]">CONSTRUCTION&nbsp;OS</div>
            </div>
          </div>
          <div className="space-y-4 max-w-md">
            <div className="label-mono text-[#FFCC00]">// AI-NATIVE</div>
            <h1 className="font-display text-5xl leading-[0.95]">
              Blueprints in.
              <br />
              <span className="text-[#FFCC00]">3D models out.</span>
            </h1>
            <p className="text-neutral-400 text-sm leading-relaxed font-mono">
              Drop a floor plan. Atlas reads materials, detects walls, syncs
              the 3D model and 2D editor — instantly.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1 border border-white/10">
            {[
              { l: "DOC TYPES", v: "8" },
              { l: "ACCURACY", v: "94%" },
              { l: "SYNC", v: "<3s" },
            ].map((s) => (
              <div key={s.l} className="p-4 border-r border-white/10 last:border-r-0">
                <div className="label-mono">{s.l}</div>
                <div className="font-mono text-2xl mt-1">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel: form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <form
          onSubmit={submit}
          className="w-full max-w-md space-y-6"
          data-testid="auth-form"
        >
          <div>
            <div className="label-mono mb-2">// {mode === "login" ? "ACCESS" : "ONBOARD"}</div>
            <h2 className="font-display text-4xl tracking-tighter">
              {mode === "login" ? "Sign in." : "Create account."}
            </h2>
            <p className="text-neutral-500 text-sm mt-2">
              {mode === "login"
                ? "Welcome back to your control room."
                : "Spin up your first project in under a minute."}
            </p>
          </div>

          {mode === "register" && (
            <div>
              <label className="label-mono block mb-2">Full Name</label>
              <input
                data-testid="auth-name-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full bg-[#141414] border border-white/10 px-4 py-3 text-white placeholder:text-neutral-600"
                placeholder="Alex Foreman"
              />
            </div>
          )}
          <div>
            <label className="label-mono block mb-2">Email</label>
            <input
              data-testid="auth-email-input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              className="w-full bg-[#141414] border border-white/10 px-4 py-3 text-white placeholder:text-neutral-600"
              placeholder="you@firm.com"
            />
          </div>
          <div>
            <label className="label-mono block mb-2">Password</label>
            <input
              data-testid="auth-password-input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={6}
              className="w-full bg-[#141414] border border-white/10 px-4 py-3 text-white placeholder:text-neutral-600"
              placeholder="••••••••"
            />
          </div>

          {err && (
            <div
              data-testid="auth-error"
              className="border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] px-4 py-3 text-sm font-mono"
            >
              {err}
            </div>
          )}

          <button
            data-testid="auth-submit-button"
            type="submit"
            disabled={loading}
            className="w-full bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-50 text-black font-bold py-3 uppercase tracking-wider text-sm transition-all duration-150"
          >
            {loading ? "Working..." : mode === "login" ? "Sign in →" : "Create account →"}
          </button>

          <div className="text-center text-sm text-neutral-500">
            {mode === "login" ? "New to Atlas?" : "Already have an account?"}{" "}
            <button
              data-testid="auth-mode-toggle"
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setErr("");
              }}
              className="text-[#FFCC00] hover:underline"
            >
              {mode === "login" ? "Create one" : "Sign in"}
            </button>
          </div>

          {mode === "register" && (
            <div data-testid="auth-legal-notice" className="text-center text-[10px] font-mono text-neutral-500 leading-relaxed pt-2">
              By creating an account you'll be asked to accept our{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#FFCC00]">Terms of Service</a>
              {" "}and{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#FFCC00]">Privacy &amp; Data Use Policy</a>.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
