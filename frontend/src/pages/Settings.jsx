import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient, useStore, API } from "../store";

const TABS = [
  { id: "profile", label: "Profile", hint: "01" },
  { id: "preferences", label: "Preferences", hint: "02" },
  { id: "notifications", label: "Notifications", hint: "03" },
  { id: "sessions", label: "Sessions", hint: "04" },
  { id: "danger", label: "Danger Zone", hint: "05" },
];

export default function Settings() {
  const navigate = useNavigate();
  const { user, token, logout, setAuth } = useStore();
  const [tab, setTab] = useState("profile");

  useEffect(() => {
    if (!token) navigate("/");
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-[#0a0a0a]" data-testid="settings-page">
      <header className="border-b border-white/10 bg-black px-6 py-4 flex items-center justify-between">
        <Link to="/app" className="flex items-center gap-3 hover:opacity-80">
          <div className="w-8 h-8 bg-[#FFCC00] flex items-center justify-center">
            <span className="font-display text-black text-lg">A</span>
          </div>
          <div>
            <div className="font-display text-lg leading-none tracking-tighter">ATLAS</div>
            <div className="label-mono text-[9px] leading-none mt-1">SETTINGS</div>
          </div>
        </Link>
        <Link to="/app" data-testid="settings-back" className="label-mono text-neutral-400 hover:text-white">← BACK TO APP</Link>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8">
        <nav className="space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-testid={`settings-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                tab === t.id ? "bg-white/5 border-l-2 border-l-[#FFCC00]" : "hover:bg-white/[0.02] border-l-2 border-transparent"
              }`}
            >
              <span className={`label-mono ${tab === t.id ? "text-[#FFCC00]" : "text-neutral-600"}`}>{t.hint}</span>
              <span className={`text-sm uppercase tracking-wider ${tab === t.id ? "text-white" : "text-neutral-400"}`}>{t.label}</span>
            </button>
          ))}
        </nav>
        <main>
          {tab === "profile" && <ProfileTab user={user} setAuth={setAuth} />}
          {tab === "preferences" && <PreferencesTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "sessions" && <SessionsTab logout={logout} navigate={navigate} />}
          {tab === "danger" && <DangerZone logout={logout} navigate={navigate} />}
        </main>
      </div>
    </div>
  );
}

function Notice({ msg }) {
  if (!msg) return null;
  return (
    <div data-testid="settings-notice" className={`mb-4 px-4 py-3 text-sm font-mono border ${
      msg.kind === "success" ? "border-[#00CC66]/40 bg-[#00CC66]/10 text-[#00CC66]"
        : "border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666]"
    }`}>{msg.text}</div>
  );
}

function ProfileTab({ user, setAuth }) {
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const saveProfile = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await apiClient.put("/user/profile", { name, email });
      setAuth(localStorage.getItem("cm_token"), { id: data.id, email: data.email, name: data.name });
      setMsg({ kind: "success", text: "Profile updated." });
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || "Update failed" });
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await apiClient.put("/user/password", pwForm);
      setPwForm({ current_password: "", new_password: "" });
      setMsg({ kind: "success", text: "Password changed." });
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || "Update failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-10">
      <Notice msg={msg} />
      <section>
        <div className="label-mono mb-2">// PROFILE</div>
        <h2 className="font-display text-2xl tracking-tighter mb-6">Account details</h2>
        <div className="space-y-4 max-w-md">
          <Field label="Full name"><input data-testid="profile-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-[#141414] border border-white/10 px-3 py-2.5" /></Field>
          <Field label="Email"><input data-testid="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-[#141414] border border-white/10 px-3 py-2.5" /></Field>
          <button data-testid="profile-save" onClick={saveProfile} disabled={busy} className="bg-[#FFCC00] text-black font-bold px-5 py-2.5 text-xs uppercase tracking-wider disabled:opacity-50">
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </section>
      <section>
        <div className="label-mono mb-2">// SECURITY</div>
        <h2 className="font-display text-2xl tracking-tighter mb-6">Change password</h2>
        <div className="space-y-4 max-w-md">
          <Field label="Current password"><input data-testid="pw-current" type="password" value={pwForm.current_password} onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })} className="w-full bg-[#141414] border border-white/10 px-3 py-2.5" /></Field>
          <Field label="New password (min 6)"><input data-testid="pw-new" type="password" value={pwForm.new_password} onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })} className="w-full bg-[#141414] border border-white/10 px-3 py-2.5" /></Field>
          <button data-testid="pw-save" onClick={savePassword} disabled={busy || !pwForm.current_password || !pwForm.new_password} className="bg-[#FFCC00] text-black font-bold px-5 py-2.5 text-xs uppercase tracking-wider disabled:opacity-50">
            {busy ? "Saving…" : "Update password"}
          </button>
        </div>
      </section>
    </div>
  );
}

function PreferencesTab() {
  const [prefs, setPrefs] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { apiClient.get("/user/preferences").then(({ data }) => setPrefs(data)); }, []);
  if (!prefs) return <div className="text-neutral-500 font-mono">Loading…</div>;
  const save = async () => {
    try {
      const { data } = await apiClient.put("/user/preferences", prefs);
      setPrefs(data);
      setMsg({ kind: "success", text: "Preferences saved." });
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || "Save failed" });
    }
  };
  return (
    <div className="space-y-6 max-w-md">
      <Notice msg={msg} />
      <div className="label-mono">// REGIONAL</div>
      <h2 className="font-display text-2xl tracking-tighter">Preferences</h2>
      <Field label="Currency">
        <select data-testid="pref-currency" value={prefs.currency} onChange={(e) => setPrefs({ ...prefs, currency: e.target.value })} className="w-full bg-[#141414] border border-white/10 px-3 py-2.5">
          {["USD","EUR","GBP","INR","CAD","AUD"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Units">
        <select data-testid="pref-units" value={prefs.units} onChange={(e) => setPrefs({ ...prefs, units: e.target.value })} className="w-full bg-[#141414] border border-white/10 px-3 py-2.5">
          <option value="imperial">Imperial (ft, in)</option>
          <option value="metric">Metric (m, cm)</option>
        </select>
      </Field>
      <Field label="Date format">
        <select data-testid="pref-date" value={prefs.date_format} onChange={(e) => setPrefs({ ...prefs, date_format: e.target.value })} className="w-full bg-[#141414] border border-white/10 px-3 py-2.5">
          <option value="MMM D, YYYY">Jun 7, 2026</option>
          <option value="DD/MM/YYYY">07/06/2026</option>
          <option value="MM/DD/YYYY">06/07/2026</option>
          <option value="YYYY-MM-DD">2026-06-07</option>
        </select>
      </Field>
      <button data-testid="pref-save" onClick={save} className="bg-[#FFCC00] text-black font-bold px-5 py-2.5 text-xs uppercase tracking-wider">Save preferences</button>
    </div>
  );
}

function NotificationsTab() {
  const [n, setN] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { apiClient.get("/user/notifications").then(({ data }) => setN(data)); }, []);
  if (!n) return <div className="text-neutral-500 font-mono">Loading…</div>;
  const toggles = [
    ["email_trial_ending", "Trial ending soon", "When your free Pro trial is about to expire."],
    ["email_low_credits", "Low upload credits", "When you have fewer than 5 uploads left this month."],
    ["email_payment_receipts", "Payment receipts", "After every successful charge."],
    ["email_product_updates", "Product updates", "New features, occasional newsletter (you can opt out anytime)."],
  ];
  const save = async () => {
    try {
      const { data } = await apiClient.put("/user/notifications", n);
      setN(data);
      setMsg({ kind: "success", text: "Saved." });
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || "Save failed" });
    }
  };
  return (
    <div className="space-y-6 max-w-2xl">
      <Notice msg={msg} />
      <div className="label-mono">// EMAILS</div>
      <h2 className="font-display text-2xl tracking-tighter">Notifications</h2>
      <p className="text-xs text-neutral-500 font-mono">Email delivery is wired through SendGrid in a future release. Toggles are saved now.</p>
      <div className="border border-white/10 divide-y divide-white/10">
        {toggles.map(([key, label, desc]) => (
          <label key={key} className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02]" data-testid={`notif-${key}`}>
            <div>
              <div className="font-medium">{label}</div>
              <div className="text-xs text-neutral-500">{desc}</div>
            </div>
            <input
              type="checkbox"
              checked={!!n[key]}
              onChange={(e) => setN({ ...n, [key]: e.target.checked })}
              className="w-5 h-5"
            />
          </label>
        ))}
      </div>
      <button data-testid="notif-save" onClick={save} className="bg-[#FFCC00] text-black font-bold px-5 py-2.5 text-xs uppercase tracking-wider">Save</button>
    </div>
  );
}

function SessionsTab({ logout, navigate }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const revokeAll = async () => {
    if (!window.confirm("Sign out all other sessions? You'll stay signed in here.")) return;
    setBusy(true);
    try {
      await apiClient.delete("/user/sessions");
      setMsg({ kind: "success", text: "All other sessions revoked." });
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || "Failed" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6 max-w-2xl">
      <Notice msg={msg} />
      <div className="label-mono">// SESSIONS</div>
      <h2 className="font-display text-2xl tracking-tighter">Active sessions</h2>
      <p className="text-sm text-neutral-400">Each device or browser you signed in with creates a session. Revoke any session to force re-login on that device.</p>
      <div className="border border-white/10 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">This browser</div>
            <div className="text-xs text-neutral-500 font-mono">{navigator.userAgent.slice(0, 60)}…</div>
          </div>
          <span className="label-mono bg-[#00CC66]/20 border border-[#00CC66]/40 text-[#00CC66] px-2 py-0.5">ACTIVE</span>
        </div>
      </div>
      <button data-testid="sessions-revoke-all" onClick={revokeAll} disabled={busy} className="bg-white/10 hover:bg-white/15 text-white px-5 py-2.5 text-xs uppercase tracking-wider font-bold disabled:opacity-50">
        Sign out all other sessions
      </button>
    </div>
  );
}

function DangerZone({ logout, navigate }) {
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    const token = localStorage.getItem("cm_token");
    const res = await fetch(`${API}/user/export`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      alert("Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas_export_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    const confirm = window.prompt('Type "DELETE" to confirm permanent account deletion. This wipes all projects, materials, and PDFs.');
    if (confirm !== "DELETE") return;
    setBusy(true);
    try {
      await apiClient.delete("/user/account");
      logout();
      navigate("/");
    } catch (e) {
      alert(e.response?.data?.detail || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <section>
        <div className="label-mono">// EXPORT</div>
        <h2 className="font-display text-2xl tracking-tighter mb-2">Data export</h2>
        <p className="text-sm text-neutral-400 mb-4">Download a JSON snapshot of everything you've created in Atlas.</p>
        <button data-testid="export-data" onClick={exportData} className="bg-white/10 hover:bg-white/15 text-white px-5 py-2.5 text-xs uppercase tracking-wider font-bold">
          Download my data ↓
        </button>
      </section>
      <section className="border border-[#FF3333]/40 bg-[#FF3333]/5 p-6">
        <div className="label-mono text-[#FF6666]">// DANGER</div>
        <h2 className="font-display text-2xl tracking-tighter mt-1 mb-2 text-[#FF6666]">Delete account</h2>
        <p className="text-sm text-neutral-300 mb-4">
          This is irreversible. All projects, blueprints, documents, materials, and payment history will be permanently wiped.
        </p>
        <button data-testid="delete-account" onClick={deleteAccount} disabled={busy} className="bg-[#FF3333] hover:bg-[#CC2222] text-white px-5 py-2.5 text-xs uppercase tracking-wider font-bold disabled:opacity-50">
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </section>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="label-mono mb-1">{label}</div>
      {children}
    </label>
  );
}
